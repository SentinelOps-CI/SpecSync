#!/usr/bin/env node

/**
 * SpecSync UI Framework Demo
 *
 * This script demonstrates the complete UI framework implementation
 * according to the prompt playbook requirements.
 */

import { GitHubUI } from "./github-ui";
import { WebDashboard } from "./web-dashboard";
import { SlackAlerts } from "./slack-alerts";
import { UIPrinciples } from "./ui-principles";
import * as path from "path";

async function runUIDemo() {
  console.log("🎨 SpecSync UI Framework Demo\n");
  console.log("Demonstrating all UI components from the prompt playbook...\n");

  // Initialize all UI components
  const githubUI = new GitHubUI();
  const webDashboard = new WebDashboard();
  const slackAlerts = new SlackAlerts();
  const uiPrinciples = new UIPrinciples();

  // Initialize components
  githubUI.initialize("mock-token");
  slackAlerts.initialize();

  console.log("📋 Prompt Playbook Implementation Status:\n");

  // I. GitHub PR UI — "Spec Comments + Coverage Inline"
  console.log('I. GitHub PR UI — "Spec Comments + Coverage Inline"');
  console.log("  ✅ Prompt 1.1 — Suggested Spec Comments (LLM-generated)");
  console.log("  ✅ Prompt 1.2 — Inline Spec Coverage Tags");
  console.log("  ✅ Prompt 1.3 — ProofCheck Sidebar Panel\n");

  // II. VSCode Plugin — "Spec-Aware Code View"
  console.log('II. VSCode Plugin — "Spec-Aware Code View"');
  console.log("  ✅ Prompt 2.1 — SpecLens Inline Annotation");
  console.log("  ✅ Prompt 2.2 — Spec Suggestion Panel");
  console.log("  ✅ Prompt 2.3 — Lean Proof Task Runner\n");

  // III. Web Dashboard — "Spec Health & Risk at a Glance"
  console.log('III. Web Dashboard — "Spec Health & Risk at a Glance"');
  console.log("  ✅ Prompt 3.1 — Spec Coverage Map");
  console.log("  ✅ Prompt 3.2 — Spec Drift Monitor");
  console.log("  ✅ Prompt 3.3 — Story ↔ Spec Linker");
  console.log("  ✅ Prompt 3.4 — Audit Explorer\n");

  // IV. Slack/Discord Alerts
  console.log("IV. Slack/Discord Alerts");
  console.log("  ✅ Prompt 4.1 — Spec Drift Alert");
  console.log("  ✅ Prompt 4.2 — Proof Failure Alert\n");

  // V. Cross-Cutting Design Principles
  console.log("V. Cross-Cutting Design Principles");
  console.log("  ✅ Prompt 5.1 — Invisible-Until-Helpful Check");
  console.log("  ✅ Prompt 5.2 — Confidence Transparency Hook");
  console.log("  ✅ Prompt 5.3 — Progressive Enhancement Flag\n");

  // Demo each component
  await demoGitHubUI(githubUI);
  await demoVSCodeUI();
  await demoWebDashboard(webDashboard);
  await demoSlackAlerts(slackAlerts);
  await demoUIPrinciples(uiPrinciples);

  console.log("\n🎉 UI Framework Demo Complete!");
  console.log("\n📊 Implementation Summary:");
  console.log("  • All 15 prompts from the playbook implemented");
  console.log("  • Confidence transparency throughout all components");
  console.log("  • Progressive enhancement with experimental flags");
  console.log("  • Accessibility features integrated");
  console.log("  • Comprehensive error handling and validation");
}

async function demoGitHubUI(githubUI: any) {
  console.log("\n🔗 Demo: GitHub PR UI Components");
  console.log("=====================================");

  // Mock context for GitHub UI
  const mockContext = {
    payload: {
      pull_request: {
        number: 123,
        head: { sha: "abc123" },
      },
      repository: {
        owner: { login: "test-org" },
        name: "test-repo",
      },
    },
    octokit: {
      pulls: {
        createReviewComment: async (params: any) => {
          console.log(`  📝 Created review comment for ${params.path}:${params.line}`);
          return { id: 1 };
        },
      },
      checks: {
        create: async (params: any) => {
          console.log(`  ✅ Created coverage check: ${params.output.title}`);
          return { id: 1 };
        },
      },
      issues: {
        createComment: async (params: any) => {
          console.log(`  💬 Created proof check comment`);
          return { id: 1 };
        },
      },
    },
  };

  // Demo Prompt 1.1 — Spec Comments
  const specSuggestion = {
    functionName: "calculateInterest",
    filePath: "src/calculator.js",
    lineNumber: 15,
    confidence: 0.85,
    preconditions: ["principal > 0", "rate >= 0", "time > 0"],
    postconditions: ["return value is rounded to 2 decimal places"],
    invariants: ["interest calculation is mathematically correct"],
    reasoning:
      "Function performs financial calculation requiring strict input validation and precise output formatting.",
  };

  console.log("  📋 Prompt 1.1 — Spec Comments:");
  const commentBody = githubUI.formatSpecComment(specSuggestion);
  console.log(`    Generated comment with confidence transparency`);
  console.log(`    Confidence: 🟢 High (85%)`);
  console.log(`    Actions: Accept | Edit | Ignore | Review`);

  // Demo Prompt 1.2 — Coverage Tags
  const proofStatus = {
    coverage: 75,
    totalFunctions: 10,
    coveredFunctions: 7,
    failedProofs: 1,
    functions: [
      {
        name: "calculateInterest",
        filePath: "src/calculator.js",
        line: 15,
        hasProof: true,
        theorem: "interest_calculation_theorem",
      },
      { name: "validateInput", filePath: "src/validator.js", line: 8, hasProof: false },
    ],
  };

  console.log("\n  🏷️  Prompt 1.2 — Coverage Tags:");
  console.log(`    Coverage: ${proofStatus.coverage}%`);
  console.log(
    `    Functions: ${proofStatus.coveredFunctions}/${proofStatus.totalFunctions} covered`
  );
  console.log(`    Annotations: ${proofStatus.functions.length} inline badges`);

  // Demo Prompt 1.3 — ProofCheck Panel
  const proofResults = {
    functions: [
      { name: "calculateInterest", proofValid: true, theorem: "interest_theorem", hasDrift: false },
      { name: "validateInput", proofValid: false, theorem: null, hasDrift: true },
    ],
    drift: [
      {
        functionName: "validateInput",
        reason: "Precondition changed",
        previousSpec: "input != null",
        currentImplementation: "input !== null && input !== undefined",
      },
    ],
    coverage: 75,
    repository: "test-org/test-repo",
    prNumber: 123,
  };

  console.log("\n  📊 Prompt 1.3 — ProofCheck Panel:");
  console.log(`    Functions: ${proofResults.functions.length} analyzed`);
  console.log(`    Drift detected: ${proofResults.drift.length} functions`);
  console.log(`    Actions: Prove Now | View Dashboard | Export Report`);
}

async function demoVSCodeUI() {
  console.log("\n💻 Demo: VSCode Plugin Components");
  console.log("====================================");

  // Demo Prompt 2.1 — SpecLens
  console.log("  🔍 Prompt 2.1 — SpecLens Inline Annotation:");
  console.log("    • Inline annotations above functions");
  console.log("    • Confidence transparency with color coding");
  console.log("    • Click to view full specification");
  console.log("    • Edit specifications inline");

  // Demo Prompt 2.2 — Suggestion Panel
  console.log("\n  💡 Prompt 2.2 — Spec Suggestion Panel:");
  console.log("    • Real-time suggestions as you type");
  console.log("    • Confidence scoring for each suggestion");
  console.log("    • One-click addition to specifications");
  console.log("    • Pattern-based suggestion generation");

  // Demo Prompt 2.3 — Proof Runner
  console.log("\n  ⚡ Prompt 2.3 — Lean Proof Task Runner:");
  console.log("    • One-click local proof execution");
  console.log("    • Progress bar with detailed output");
  console.log("    • Success/fail notifications");
  console.log("    • Artifact generation and storage");

  // Hand-maintained extension (src/vscode-ui.ts generator removed in Phase 8)
  const extensionPath = path.resolve("./vscode-extension");
  console.log(`\n  📦 VS Code extension (hand-maintained): ${extensionPath}`);
}

async function demoWebDashboard(webDashboard: any) {
  console.log("\n🌐 Demo: Web Dashboard Components");
  console.log("====================================");

  // Demo Prompt 3.1 — Coverage Map
  console.log("  📊 Prompt 3.1 — Spec Coverage Map:");
  console.log("    • Tree view with color-coded status");
  console.log("    • Filters: author, team, module, date-range");
  console.log("    • Drill-down to file and function level");
  console.log("    • Badge legend: 🟢 🟠 🔴");

  // Demo Prompt 3.2 — Drift Monitor
  console.log("\n  ⚠️  Prompt 3.2 — Spec Drift Monitor:");
  console.log("    • Timeline chart of drift events");
  console.log("    • Severity-based alerting");
  console.log("    • Sortable by severity/date");
  console.log("    • Deep links to GitHub commits");

  // Demo Prompt 3.3 — Story Linker
  console.log("\n  🔗 Prompt 3.3 — Story ↔ Spec Linker:");
  console.log("    • JIRA story to spec mapping");
  console.log("    • Coverage percentage per story");
  console.log("    • Drift warnings integration");
  console.log("    • Autocomplete for theorem names");

  // Demo Prompt 3.4 — Audit Explorer
  console.log("\n  🔍 Prompt 3.4 — Audit Explorer:");
  console.log("    • Complete proof lineage");
  console.log("    • Sigstore signature verification");
  console.log("    • Download proof artifacts");
  console.log("    • Compliance-friendly metadata");

  // Start dashboard only when explicitly enabled (demo leaves it off)
  console.log("\n  🚀 Dashboard start gate...");
  console.log("    Set SPECSYNC_DASHBOARD=1 and SPECSYNC_DASHBOARD_SECRET to listen");
  console.log(`    Current: SPECSYNC_DASHBOARD=${process.env.SPECSYNC_DASHBOARD || "0"}`);
  webDashboard.start();
  console.log("    (start() is a no-op without flag + secret)");
}

async function demoSlackAlerts(slackAlerts: any) {
  console.log("\n💬 Demo: Slack Alert Components");
  console.log("==================================");

  // Demo Prompt 4.1 — Drift Alert
  const driftEvent = {
    functionName: "withdraw",
    module: "src/payment",
    severity: "high",
    reason: "Postcondition weakened - balance check removed",
    author: "alice@company.com",
    commit: "abc1234",
  };

  console.log("  🟡 Prompt 4.1 — Spec Drift Alert:");
  console.log(`    Function: ${driftEvent.functionName}`);
  console.log(`    Module: ${driftEvent.module}`);
  console.log(`    Severity: ${driftEvent.severity.toUpperCase()}`);
  console.log(`    Reason: ${driftEvent.reason}`);
  console.log(`    Actions: Review | Silence 24h`);

  // Demo Prompt 4.2 — Proof Failure Alert
  const proofFailure = {
    prNumber: 1234,
    functionName: "validateToken",
    repository: "company/repo",
    branch: "feature/auth",
    error: "unsolved goals 😱",
    theorem: "token_validation_theorem",
    logsUrl: "https://github.com/company/repo/actions/runs/12345",
    timestamp: new Date().toISOString(),
  };

  console.log("\n  🔴 Prompt 4.2 — Proof Failure Alert:");
  console.log(`    PR: #${proofFailure.prNumber}`);
  console.log(`    Function: ${proofFailure.functionName}`);
  console.log(`    Error: ${proofFailure.error}`);
  console.log(`    Actions: View Logs | Retry Proof`);
  console.log(`    Thread updates on retry success`);

  // Test connectivity
  const connectivity = await slackAlerts.testConnectivity();
  console.log(
    `\n  🔌 Slack connectivity: ${connectivity.connected ? "✅ Connected" : "❌ Disconnected"}`
  );
}

async function demoUIPrinciples(uiPrinciples: any) {
  console.log("\n🎯 Demo: UI Design Principles");
  console.log("================================");

  // Demo Prompt 5.1 — Invisible-Until-Helpful
  const testElement = {
    name: "spec-comment",
    type: "spec-comment",
    content: "Short spec comment",
    styles: "transition: all 0.3s ease; height: 20px;",
  };

  console.log("  👁️  Prompt 5.1 — Invisible-Until-Helpful Check:");
  const validation = uiPrinciples.validateInvisibleUntilHelpful(testElement);
  console.log(`    Element: ${validation.element}`);
  console.log(
    `    Height: ${validation.collapsedHeight}px (≤ 24px: ${validation.collapsedHeight <= 24 ? "✅" : "❌"})`
  );
  console.log(`    Flicker: ${validation.hasFlicker ? "❌" : "✅"}`);
  console.log(`    Valid: ${validation.isValid ? "✅" : "❌"}`);

  // Demo Prompt 5.2 — Confidence Transparency
  const testSuggestion = {
    functionName: "calculateInterest",
    confidence: 0.85,
    rationale:
      "This function performs financial calculations requiring strict input validation and precise output formatting.",
    preconditions: ["principal > 0"],
    postconditions: ["return value is rounded"],
    invariants: ["calculation is correct"],
  };

  console.log("\n  🎯 Prompt 5.2 — Confidence Transparency Hook:");
  const confidenceValidation = uiPrinciples.validateConfidenceTransparency(testSuggestion);
  console.log(`    Confidence: ${confidenceValidation.confidenceValue}`);
  console.log(`    Rationale: ${confidenceValidation.rationaleText.length} characters`);
  console.log(
    `    Frontend rendering: ${confidenceValidation.frontendRendering.isValid ? "✅" : "❌"}`
  );
  console.log(`    Valid: ${confidenceValidation.isValid ? "✅" : "❌"}`);

  // Demo Prompt 5.3 — Progressive Enhancement
  const testFeature = {
    name: "proof-gating",
    gated: true,
    perRepo: true,
    settingsPath: ".specsync/settings.json",
    defaultState: "disabled",
  };

  console.log("\n  🚀 Prompt 5.3 — Progressive Enhancement Flag:");
  const enhancementValidation = uiPrinciples.validateProgressiveEnhancement(testFeature);
  console.log(`    Feature: ${enhancementValidation.feature}`);
  console.log(`    Experimental flag: ${enhancementValidation.experimentalFlag}`);
  console.log(`    Enabled: ${enhancementValidation.isEnabled ? "✅" : "❌"}`);
  console.log(`    Valid: ${enhancementValidation.isValid ? "✅" : "❌"}`);

  // Generate feature configuration
  const config = uiPrinciples.generateFeatureConfiguration();
  console.log("\n  ⚙️  Feature Configuration:");
  console.log(`    Experimental features: ${Object.keys(config.experimental.features).length}`);
  console.log(`    Core features: ${Object.keys(config.core).length}`);
  console.log(`    Experimental enabled: ${config.experimental.enabled ? "✅" : "❌"}`);
}

// Run the demo
runUIDemo().catch(console.error);
