import {
  CommandRateLimiter,
  commandRateLimiter,
} from "../src/command-rate-limit";
import { GitHubUI } from "../src/github-ui";
import { resetMetricsForTests, getMetrics } from "../src/metrics";

describe("CommandRateLimiter", () => {
  test("allows up to max then blocks within the window", () => {
    const limiter = new CommandRateLimiter({ max: 2, windowMs: 60_000 });
    expect(limiter.allow("alice", "acme/app#1").allowed).toBe(true);
    expect(limiter.allow("alice", "acme/app#1").allowed).toBe(true);
    const blocked = limiter.allow("alice", "acme/app#1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  test("scopes by actor and PR independently", () => {
    const limiter = new CommandRateLimiter({ max: 1, windowMs: 60_000 });
    expect(limiter.allow("alice", "acme/app#1").allowed).toBe(true);
    expect(limiter.allow("bob", "acme/app#1").allowed).toBe(true);
    expect(limiter.allow("alice", "acme/app#2").allowed).toBe(true);
    expect(limiter.allow("alice", "acme/app#1").allowed).toBe(false);
  });
});

describe("GitHubUI rate limit on mutating commands", () => {
  beforeEach(() => {
    commandRateLimiter.clearForTests();
    resetMetricsForTests();
  });

  test("handleSpecCommentAction rejects when rate limited", async () => {
    const githubUI = new GitHubUI();
    const octokit = {
      pulls: {
        get: jest.fn().mockResolvedValue({
          data: {
            number: 42,
            user: { login: "pr-author" },
            head: { ref: "feature", sha: "abc" },
          },
        }),
        listCommits: jest.fn().mockResolvedValue({ data: [] }),
        createReplyForReviewComment: jest.fn().mockResolvedValue({ id: 1 }),
      },
      issues: {
        createComment: jest.fn().mockResolvedValue({ id: 1 }),
      },
      repos: {
        getCollaboratorPermissionLevel: jest.fn().mockResolvedValue({
          data: { permission: "admin" },
        }),
        getContent: jest.fn().mockRejectedValue({ status: 404 }),
        createOrUpdateFileContents: jest.fn().mockResolvedValue({
          data: { content: { sha: "x" } },
        }),
      },
    };

    const context = {
      payload: {
        sender: { login: "pr-author" },
        repository: { owner: { login: "acme" }, name: "app" },
        issue: { number: 42, pull_request: {} },
        pull_request: { number: 42 },
      },
      octokit,
    };

    // Exhaust default limiter (max 10) — use a tight custom window via direct limiter.
    // The shared limiter defaults to 10; burn them then assert.
    for (let i = 0; i < 10; i++) {
      expect(commandRateLimiter.allow("pr-author", "acme/app#42").allowed).toBe(true);
    }

    await githubUI.handleSpecCommentAction(context, {
      body: "/specsync accept",
      user: { login: "pr-author" },
      id: 99,
      path: "src/a.js",
    });

    expect(getMetrics().commands_rate_limited).toBe(1);
    const replies =
      octokit.pulls.createReplyForReviewComment.mock.calls.length +
      octokit.issues.createComment.mock.calls.length;
    expect(replies).toBeGreaterThan(0);
    const body =
      octokit.pulls.createReplyForReviewComment.mock.calls[0]?.[0]?.body ||
      octokit.issues.createComment.mock.calls[0]?.[0]?.body;
    expect(body).toContain("Rate limit");
    expect(octokit.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
  });
});
