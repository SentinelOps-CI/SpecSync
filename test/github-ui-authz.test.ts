import { GitHubUI } from "../src/github-ui";

describe("GitHubUI comment AuthZ", () => {
  let githubUI: GitHubUI;
  let octokit: any;
  let context: any;

  beforeEach(() => {
    githubUI = new GitHubUI();
    octokit = {
      pulls: {
        get: jest.fn().mockResolvedValue({
          data: {
            number: 42,
            user: { login: "pr-author" },
            head: { ref: "feature", sha: "abc123" },
          },
        }),
        listCommits: jest.fn().mockResolvedValue({
          data: [{ author: { login: "committer-user" }, committer: { login: "committer-user" } }],
        }),
        createReplyForReviewComment: jest.fn().mockResolvedValue({ id: 1 }),
      },
      issues: {
        createComment: jest.fn().mockResolvedValue({ id: 1 }),
      },
      repos: {
        getCollaboratorPermissionLevel: jest.fn().mockResolvedValue({
          data: { permission: "read" },
        }),
        getContent: jest.fn().mockRejectedValue({ status: 404 }),
        createOrUpdateFileContents: jest.fn().mockResolvedValue({
          data: { content: { sha: "x" } },
        }),
      },
    };

    context = {
      payload: {
        sender: { login: "random-reader" },
        repository: {
          owner: { login: "acme" },
          name: "app",
        },
        issue: { number: 42, pull_request: {} },
        pull_request: { number: 42 },
      },
      octokit,
    };
  });

  test("authorizeSpecMutation allows PR author", async () => {
    context.payload.sender.login = "pr-author";
    const result = await githubUI.authorizeSpecMutation(context, {
      body: "/specsync accept",
      user: { login: "pr-author" },
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("pr_author");
  });

  test("authorizeSpecMutation allows write collaborators", async () => {
    octokit.repos.getCollaboratorPermissionLevel.mockResolvedValue({
      data: { permission: "write" },
    });
    const result = await githubUI.authorizeSpecMutation(context, {
      body: "/specsync ignore",
      user: { login: "random-reader" },
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("permission:write");
  });

  test("authorizeSpecMutation allows PR committers", async () => {
    context.payload.sender.login = "committer-user";
    const result = await githubUI.authorizeSpecMutation(context, {
      body: "/specsync edit",
      user: { login: "committer-user" },
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("pr_committer");
  });

  test("authorizeSpecMutation denies readers without commits", async () => {
    const result = await githubUI.authorizeSpecMutation(context, {
      body: "/specsync accept",
      user: { login: "random-reader" },
    });
    expect(result.allowed).toBe(false);
  });

  test("handleSpecCommentAction rejects unauthorized accept", async () => {
    await githubUI.handleSpecCommentAction(context, {
      id: 9,
      body: "/specsync accept\n## Spec for `foo`",
      user: { login: "random-reader" },
      path: "src/a.ts",
    });

    expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalled();
    const reply = octokit.pulls.createReplyForReviewComment.mock.calls[0][0];
    expect(reply.body).toContain("not allowed");
    expect(octokit.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
  });

  test("formatSpecComment escapes HTML in user-controlled fields", () => {
    const body = githubUI.formatSpecComment({
      functionName: '<script>alert(1)</script>',
      filePath: 'src/<evil>.ts',
      lineNumber: 3,
      preconditions: ["x < 0 && y > 1"],
      postconditions: ['ret == "<ok>"'],
      invariants: [],
      confidence: 0.9,
      reasoning: "Uses <b>tags</b>",
    });

    expect(body).toContain("&lt;script&gt;");
    expect(body).not.toContain("<script>");
    expect(body).toContain("src/&lt;evil&gt;.ts");
    expect(body).toContain("Uses &lt;b&gt;tags&lt;/b&gt;");
  });
});
