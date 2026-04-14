import { SlackAlerts } from "../src/slack-alerts";

describe("SlackAlerts", () => {
  let slackAlerts;

  beforeEach(() => {
    slackAlerts = new SlackAlerts();
    slackAlerts.initialize();
  });

  describe("Prompt 4.1 — Spec Drift Alert", () => {
    test("should format drift alert message with actionable buttons", () => {
      const driftEvent = {
        functionName: "withdraw",
        module: "src/payment",
        severity: "high",
        reason: "Postcondition weakened - balance check removed",
        author: "john.doe",
        commit: "abc123def",
        timestamp: "2024-01-15T10:30:00Z",
      };

      const message = slackAlerts.formatDriftMessage(driftEvent);

      expect(message.text).toContain("🔴 Drift detected in `withdraw`");
      expect(message.text).toContain("Postcondition weakened");
      expect(message.blocks).toHaveLength(6);

      // Check header
      expect(message.blocks[0].type).toBe("header");
      expect(message.blocks[0].text.text).toContain("🔴 Spec Drift Detected");

      // Check fields
      expect(message.blocks[1].type).toBe("section");
      expect(message.blocks[1].fields).toHaveLength(4);

      // Check actions
      expect(message.blocks[4].type).toBe("actions");
      expect(message.blocks[4].elements).toHaveLength(2);
      expect(message.blocks[4].elements[0].text.text).toBe("Review");
      expect(message.blocks[4].elements[1].text.text).toBe("Silence 24h");
    });

    test("should handle different severity levels", () => {
      const severities = ["high", "medium", "low"];
      const expectedEmojis = ["🔴", "🟡", "🟢"];

      severities.forEach((severity, index) => {
        const driftEvent = {
          functionName: "test",
          module: "src/test",
          severity,
          reason: "Test reason",
          author: "test",
          commit: "test123",
          timestamp: "2024-01-15T10:30:00Z",
        };

        const message = slackAlerts.formatDriftMessage(driftEvent);
        expect(message.text).toContain(expectedEmojis[index]);
      });
    });

    test("should send drift alert when Slack is configured", async () => {
      // Mock Slack client
      slackAlerts.slack = {
        chat: {
          postMessage: jest.fn().mockResolvedValue({ ts: "1234567890.123456" }),
        },
      };

      const driftEvent = {
        functionName: "withdraw",
        module: "src/payment",
        severity: "high",
        reason: "Balance check removed",
        author: "john.doe",
        commit: "abc123def",
        timestamp: "2024-01-15T10:30:00Z",
      };

      const result = await slackAlerts.sendDriftAlert(driftEvent);

      expect(result).toBeDefined();
      expect(slackAlerts.slack.chat.postMessage).toHaveBeenCalledWith({
        channel: "#specsync",
        text: expect.stringContaining("🔴 Drift detected"),
        blocks: expect.any(Array),
        unfurl_links: false,
      });
    });

    test("should not send alert when silenced", async () => {
      const driftEvent = {
        functionName: "withdraw",
        module: "src/payment",
        severity: "high",
        reason: "Test reason",
        author: "test",
        commit: "test123",
        timestamp: "2024-01-15T10:30:00Z",
      };

      // Silence the alert
      const alertKey = `drift:${driftEvent.functionName}:${driftEvent.module}`;
      slackAlerts.silencedAlerts.set(alertKey, {
        silencedAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });

      // Mock Slack client to avoid "Slack not configured" message
      slackAlerts.slack = {
        chat: {
          postMessage: jest.fn().mockResolvedValue({ ts: "1234567890.123456" }),
        },
      };

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await slackAlerts.sendDriftAlert(driftEvent);

      expect(consoleSpy).toHaveBeenCalledWith("Drift alert silenced for withdraw");

      consoleSpy.mockRestore();
    });
  });

  describe("Prompt 4.2 — Proof Failure Alert", () => {
    test("should format proof failure alert message", () => {
      const proofFailure = {
        prNumber: 1234,
        functionName: "validateToken",
        repository: "company/repo",
        branch: "feature/new-auth",
        error: "unsolved goals 😱",
        theorem: "validate_token_theorem",
        logsUrl: "https://github.com/company/repo/actions/runs/123456",
        timestamp: "2024-01-15T10:30:00Z",
      };

      const message = slackAlerts.formatProofFailureMessage(proofFailure);

      expect(message.text).toContain("🔴 Proof failed for PR #1234");
      expect(message.text).toContain("validateToken");
      expect(message.text).toContain("unsolved goals 😱");
      expect(message.blocks).toHaveLength(6);

      // Check header
      expect(message.blocks[0].type).toBe("header");
      expect(message.blocks[0].text.text).toBe("🔴 Proof Failure Alert");

      // Check actions
      expect(message.blocks[4].type).toBe("actions");
      expect(message.blocks[4].elements).toHaveLength(2);
      expect(message.blocks[4].elements[0].text.text).toBe("View Logs");
      expect(message.blocks[4].elements[1].text.text).toBe("Retry Proof");
    });

    test("should send proof failure alert and store thread timestamp", async () => {
      // Mock Slack client
      slackAlerts.slack = {
        chat: {
          postMessage: jest.fn().mockResolvedValue({ ts: "1234567890.123456" }),
        },
      };

      const proofFailure = {
        prNumber: 1234,
        functionName: "validateToken",
        repository: "company/repo",
        branch: "feature/new-auth",
        error: "unsolved goals 😱",
        theorem: "validate_token_theorem",
        logsUrl: "https://github.com/company/repo/actions/runs/123456",
        timestamp: "2024-01-15T10:30:00Z",
      };

      const result = await slackAlerts.sendProofFailureAlert(proofFailure);

      expect(result).toBeDefined();
      expect(slackAlerts.slack.chat.postMessage).toHaveBeenCalledWith({
        channel: "#specsync",
        text: expect.stringContaining("🔴 Proof failed"),
        blocks: expect.any(Array),
        unfurl_links: false,
      });

      // Check that thread timestamp was stored
      expect(slackAlerts.getThreadTimestamp(1234)).toBe("1234567890.123456");
    });
  });

  describe("Interactive message handling", () => {
    test("should handle silence alert action", async () => {
      // Mock Slack client
      slackAlerts.slack = {
        chat: {
          postEphemeral: jest.fn().mockResolvedValue({}),
        },
      };

      const payload = {
        type: "block_actions",
        user: { id: "U123456" },
        channel: { id: "C123456" },
        actions: [
          {
            action_id: "silence_drift_alert",
            value: JSON.stringify({
              alertKey: "drift:withdraw:src/payment",
              duration: 24 * 60 * 60 * 1000,
            }),
          },
        ],
      };

      await slackAlerts.handleInteractiveMessage(payload);

      expect(slackAlerts.slack.chat.postEphemeral).toHaveBeenCalledWith({
        channel: "C123456",
        user: "U123456",
        text: expect.stringContaining("Alert silenced for 24 hours"),
      });

      // Check that alert is silenced
      expect(slackAlerts.isAlertSilenced("drift:withdraw:src/payment")).toBe(true);
    });

    test("should handle silence alert with confirmation", async () => {
      // Mock Slack client
      slackAlerts.slack = {
        chat: {
          postEphemeral: jest.fn().mockResolvedValue({}),
        },
      };

      const value = JSON.stringify({
        alertKey: "drift:test:src/test",
        duration: 24 * 60 * 60 * 1000,
      });

      const payload = {
        user: { id: "U123456" },
        channel: { id: "C123456" },
      };

      await slackAlerts.handleSilenceAlert(value, payload);

      expect(slackAlerts.slack.chat.postEphemeral).toHaveBeenCalledWith({
        channel: "C123456",
        user: "U123456",
        text: expect.stringContaining("Alert silenced for 24 hours"),
      });
    });
  });

  describe("Thread updates", () => {
    test("should send thread update for proof status changes", async () => {
      // Mock Slack client
      slackAlerts.slack = {
        chat: {
          postMessage: jest.fn().mockResolvedValue({}),
        },
      };

      // Store thread timestamp
      slackAlerts.storeThreadTimestamp("1234", "1234567890.123456");

      const statusUpdate = {
        success: true,
        functionName: "validateToken",
        details: "Proof completed successfully",
      };

      await slackAlerts.sendThreadUpdate("1234567890.123456", statusUpdate);

      expect(slackAlerts.slack.chat.postMessage).toHaveBeenCalledWith({
        channel: "#specsync",
        thread_ts: "1234567890.123456",
        text: expect.stringContaining("✅ Proof passed"),
        blocks: expect.any(Array),
      });
    });

    test("should format status update message", () => {
      const successUpdate = {
        success: true,
        functionName: "validateToken",
        details: "Proof completed successfully",
      };

      const failureUpdate = {
        success: false,
        functionName: "validateToken",
        details: "Proof failed with errors",
      };

      const successMessage = slackAlerts.formatStatusUpdateMessage(successUpdate);
      const failureMessage = slackAlerts.formatStatusUpdateMessage(failureUpdate);

      expect(successMessage.text).toContain("✅ Proof passed");
      expect(failureMessage.text).toContain("❌ Proof failed");
      expect(successMessage.blocks[0].text.text).toContain("✅ *Proof Passed*");
      expect(failureMessage.blocks[0].text.text).toContain("❌ *Proof Failed*");
    });
  });

  describe("Coverage summary", () => {
    test("should send coverage summary alert", async () => {
      // Mock Slack client
      slackAlerts.slack = {
        chat: {
          postMessage: jest.fn().mockResolvedValue({}),
        },
      };

      const coverageSummary = {
        coverage: 85,
        totalFunctions: 100,
        coveredFunctions: 85,
        failedProofs: 2,
      };

      await slackAlerts.sendCoverageSummary(coverageSummary);

      expect(slackAlerts.slack.chat.postMessage).toHaveBeenCalledWith({
        channel: "#specsync",
        text: expect.stringContaining("🟢 Coverage Summary: 85%"),
        blocks: expect.any(Array),
      });
    });

    test("should format coverage summary with different status levels", () => {
      const goodCoverage = {
        coverage: 85,
        totalFunctions: 100,
        coveredFunctions: 85,
        failedProofs: 2,
      };

      const warningCoverage = {
        coverage: 65,
        totalFunctions: 100,
        coveredFunctions: 65,
        failedProofs: 5,
      };

      const criticalCoverage = {
        coverage: 30,
        totalFunctions: 100,
        coveredFunctions: 30,
        failedProofs: 10,
      };

      const goodMessage = slackAlerts.formatCoverageSummaryMessage(goodCoverage);
      const warningMessage = slackAlerts.formatCoverageSummaryMessage(warningCoverage);
      const criticalMessage = slackAlerts.formatCoverageSummaryMessage(criticalCoverage);

      expect(goodMessage.text).toContain("🟢 Coverage Summary: 85%");
      expect(warningMessage.text).toContain("🟡 Coverage Summary: 65%");
      expect(criticalMessage.text).toContain("🔴 Coverage Summary: 30%");
    });
  });

  describe("Drift resolution", () => {
    test("should send drift resolution alert", async () => {
      // Mock Slack client
      slackAlerts.slack = {
        chat: {
          postMessage: jest.fn().mockResolvedValue({}),
        },
      };

      const driftResolution = {
        functionName: "withdraw",
        module: "src/payment",
        resolvedBy: "jane.doe",
        resolution: "Added balance check back",
        previousIssue: "Balance check was removed",
      };

      await slackAlerts.sendDriftResolution(driftResolution);

      expect(slackAlerts.slack.chat.postMessage).toHaveBeenCalledWith({
        channel: "#specsync",
        text: expect.stringContaining("✅ Drift resolved: withdraw"),
        blocks: expect.any(Array),
      });
    });

    test("should format drift resolution message", () => {
      const driftResolution = {
        functionName: "withdraw",
        module: "src/payment",
        resolvedBy: "jane.doe",
        resolution: "Added balance check back",
        previousIssue: "Balance check was removed",
      };

      const message = slackAlerts.formatDriftResolutionMessage(driftResolution);

      expect(message.text).toContain("✅ Drift resolved: withdraw");
      expect(message.blocks[0].text.text).toBe("✅ Drift Resolved");
      expect(message.blocks[1].fields).toHaveLength(4);
      expect(message.blocks[1].fields[0].text).toContain("withdraw");
      expect(message.blocks[1].fields[1].text).toContain("src/payment");
      expect(message.blocks[1].fields[2].text).toContain("jane.doe");
      expect(message.blocks[1].fields[3].text).toContain("Added balance check back");
    });
  });

  describe("Utility methods", () => {
    test("should store and retrieve thread timestamps", () => {
      slackAlerts.storeThreadTimestamp("1234", "1234567890.123456");

      expect(slackAlerts.getThreadTimestamp("1234")).toBe("1234567890.123456");
      expect(slackAlerts.getThreadTimestamp("9999")).toBeUndefined();
    });

    test("should check if alert is silenced", () => {
      const alertKey = "drift:test:src/test";

      // Initially not silenced
      expect(slackAlerts.isAlertSilenced(alertKey)).toBe(false);

      // Silence the alert
      slackAlerts.silencedAlerts.set(alertKey, {
        silencedAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });

      expect(slackAlerts.isAlertSilenced(alertKey)).toBe(true);

      // Test expired silence
      slackAlerts.silencedAlerts.set(alertKey, {
        silencedAt: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
        expiresAt: Date.now() - 1 * 60 * 60 * 1000, // 1 hour ago
      });

      expect(slackAlerts.isAlertSilenced(alertKey)).toBe(false);
    });

    test("should cleanup expired silenced alerts", () => {
      const alertKey = "drift:test:src/test";

      // Add expired alert
      slackAlerts.silencedAlerts.set(alertKey, {
        silencedAt: Date.now() - 25 * 60 * 60 * 1000,
        expiresAt: Date.now() - 1 * 60 * 60 * 1000,
      });

      expect(slackAlerts.silencedAlerts.size).toBe(1);

      slackAlerts.cleanupSilencedAlerts();

      expect(slackAlerts.silencedAlerts.size).toBe(0);
    });

    test("should get notification statistics", () => {
      const stats = slackAlerts.getNotificationStats();

      expect(stats).toHaveProperty("totalAlerts");
      expect(stats).toHaveProperty("silencedAlerts");
      expect(stats).toHaveProperty("slackConfigured");
      expect(Array.isArray(stats.silencedAlerts)).toBe(true);
    });

    test("should test connectivity", async () => {
      // Test without Slack configured
      const result = await slackAlerts.testConnectivity();

      expect(result.connected).toBe(false);
      expect(result.error).toBe("Slack not configured");

      // Test with mock Slack client
      slackAlerts.slack = {
        auth: {
          test: jest.fn().mockResolvedValue({
            team: "Test Team",
            user: "test-user",
          }),
        },
      };

      const connectedResult = await slackAlerts.testConnectivity();

      expect(connectedResult.connected).toBe(true);
      expect(connectedResult.team).toBe("Test Team");
      expect(connectedResult.user).toBe("test-user");
      expect(connectedResult.channel).toBe("#specsync");
    });
  });
});
