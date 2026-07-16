/**
 * Probot-style integration: fixture webhook → enqueue → analyze → comment.
 * Octokit is mocked (jest); LLM is mocked explicitly via SpecAnalyzer.analyzeChanges.
 */
import * as fs from "fs";
import * as path from "path";
import { DiffParser } from "../src/diff-parser";
import { ASTExtractor } from "../src/ast-extractor";
import { SpecAnalyzer } from "../src/spec-analyzer";
import { GitHubUI } from "../src/github-ui";
import { analysisJobQueue, buildAnalysisJobKey } from "../src/analysis-queue";
import { hashImplementation } from "../src/spec-store";

jest.mock("../src/web-dashboard", () => ({
  WebDashboard: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockReturnValue(null),
  })),
}));
jest.mock("../src/slack-alerts", () => ({
  SlackAlerts: jest.fn().mockImplementation(() => ({
    initialize: jest.fn(),
    sendDriftAlert: jest.fn().mockResolvedValue(undefined),
  })),
}));

import probotApp = require("../src/index");

const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "pull_request.opened.json"), "utf8")
) as {
  action: string;
  installation: { id: number };
  repository: { name: string; full_name: string; owner: { login: string } };
  pull_request: {
    number: number;
    head: { sha: string; ref: string };
  };
};

const SAMPLE_DIFF = `diff --git a/src/math.js b/src/math.js
index 1111111..2222222 100644
--- a/src/math.js
+++ b/src/math.js
@@ -1,3 +1,7 @@
+function add(a, b) {
+  return a + b;
+}
`;

function loadAppHandlers(): Map<string, (context: unknown) => Promise<void>> {
  const handlers = new Map<string, (context: unknown) => Promise<void>>();
  const app = {
    on: (event: string, handler: (context: unknown) => Promise<void>) => {
      handlers.set(event, handler);
    },
  };
  const router = { get: jest.fn() };
  probotApp(app as never, { getRouter: () => router } as never);
  return handlers;
}

async function flushQueue(ms = 80): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, ms));
}

describe("Probot PR pipeline (fixture + octokit mocks)", () => {
  let handlers: Map<string, (context: unknown) => Promise<void>>;
  let createComment: jest.Mock;
  let createReview: jest.Mock;
  let checksCreate: jest.Mock;
  let parseDiffSpy: jest.SpyInstance;
  let extractASTSpy: jest.SpyInstance;
  let analyzeChangesSpy: jest.SpyInstance;

  beforeEach(() => {
    analysisJobQueue.clearForTests();
    jest.clearAllMocks();
    handlers = loadAppHandlers();

    createComment = jest.fn().mockResolvedValue({ data: { id: 1 } });
    createReview = jest.fn().mockResolvedValue({ data: { id: 99 } });
    checksCreate = jest.fn().mockResolvedValue({ data: { id: 2 } });

    parseDiffSpy = jest.spyOn(DiffParser.prototype, "parseDiff").mockResolvedValue([
      {
        filePath: "src/math.js",
        functionName: "add",
        functionBody: "function add(a, b) {\n  return a + b;\n}",
        lineNumber: 1,
        changeType: "+",
        comments: [],
        testFiles: [],
      },
    ]);

    extractASTSpy = jest.spyOn(ASTExtractor.prototype, "extractAST").mockResolvedValue([
      {
        functionName: "add",
        filePath: "src/math.js",
        lineNumber: 1,
        functionBody: "function add(a, b) {\n  return a + b;\n}",
        comments: [],
        ast: {
          inputTypes: [
            { name: "a", type: "number", required: true },
            { name: "b", type: "number", required: true },
          ],
          outputType: "number",
          conditionalGuards: [],
          loops: [],
          branching: [],
          earlyReturns: [],
          controlFlow: { type: "linear" },
          complexity: 1,
        },
      },
    ]);

    // Explicit LLM mock — bypass live providers.
    analyzeChangesSpy = jest.spyOn(SpecAnalyzer.prototype, "analyzeChanges").mockResolvedValue([
      {
        functionName: "add",
        filePath: "src/math.js",
        lineNumber: 1,
        preconditions: ["a is number", "b is number"],
        postconditions: ["returns sum"],
        invariants: [],
        edgeCases: [],
        confidence: 0.85,
        reasoning: "explicit mock LLM result for integration test",
        isMock: true,
      },
    ]);

    jest.spyOn(ASTExtractor.prototype, "clearContentCache").mockImplementation(() => undefined);
  });

  afterEach(() => {
    parseDiffSpy?.mockRestore();
    extractASTSpy?.mockRestore();
    analyzeChangesSpy?.mockRestore();
    jest.restoreAllMocks();
    analysisJobQueue.clearForTests();
  });

  function buildPrContext() {
    const headSha = FIXTURE.pull_request.head.sha + Math.random().toString(16).slice(2, 10);

    const octokit = {
      pulls: {
        get: jest.fn().mockResolvedValue({ data: SAMPLE_DIFF }),
        listFiles: jest.fn().mockResolvedValue({
          data: [{ filename: "src/math.js", status: "modified", additions: 4, deletions: 0 }],
        }),
        createReview,
        createReviewComment: jest.fn().mockResolvedValue({ data: { id: 3 } }),
      },
      paginate: jest.fn().mockImplementation(async (fn: unknown) => {
        if (fn === octokit.pulls.listFiles) {
          return [
            { filename: "src/math.js", status: "modified", additions: 4, deletions: 0 },
          ];
        }
        return [];
      }),
      issues: {
        createComment,
        create: jest.fn().mockResolvedValue({ data: { id: 10 } }),
      },
      checks: {
        create: checksCreate,
      },
      repos: {
        getContent: jest.fn().mockRejectedValue({ status: 404 }),
        createOrUpdateFileContents: jest.fn(),
      },
    };

    return {
      payload: {
        action: FIXTURE.action,
        installation: FIXTURE.installation,
        repository: FIXTURE.repository,
        pull_request: {
          ...FIXTURE.pull_request,
          head: { ...FIXTURE.pull_request.head, sha: headSha },
          number: FIXTURE.pull_request.number,
        },
      },
      octokit,
      log: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      },
    };
  }

  test("pull_request.opened enqueues, analyzes, and posts review comments", async () => {
    const handler = handlers.get("pull_request.opened");
    expect(handler).toBeDefined();

    const context = buildPrContext();
    await handler!(context);
    await flushQueue(150);

    const key = buildAnalysisJobKey({
      installationId: FIXTURE.installation.id,
      owner: "acme",
      repo: "demo-repo",
      pr: 42,
      headSha: context.payload.pull_request.head.sha,
    });
    const job = analysisJobQueue.getJob(key);
    expect(job?.status).toBe("completed");

    expect(createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "demo-repo",
        issue_number: 42,
        body: expect.stringContaining("Analysis started"),
      })
    );

    expect(parseDiffSpy).toHaveBeenCalled();
    expect(extractASTSpy).toHaveBeenCalled();
    expect(analyzeChangesSpy).toHaveBeenCalled();

    expect(createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "demo-repo",
        pull_number: 42,
        commit_id: context.payload.pull_request.head.sha,
        event: "COMMENT",
        comments: expect.arrayContaining([
          expect.objectContaining({
            path: "src/math.js",
            line: 1,
            side: "RIGHT",
            body: expect.stringContaining("85%"),
          }),
        ]),
      })
    );

    expect(checksCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "SpecSync Coverage",
      })
    );
  });

  test("duplicate head SHA skips second enqueue", async () => {
    const handler = handlers.get("pull_request.opened");
    const fixedSha = "dupsha00000000000000000000000000000001";
    const context = buildPrContext();
    context.payload.pull_request.head.sha = fixedSha;

    await handler!(context);
    await flushQueue(120);
    createComment.mockClear();

    await handler!(context);
    await flushQueue(40);

    expect(createComment).not.toHaveBeenCalled();
  });

  test("issue_comment /specsync routes to GitHubUI", async () => {
    const handleSpy = jest
      .spyOn(GitHubUI.prototype, "handleSpecCommentAction")
      .mockResolvedValue(undefined);

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!({
      payload: {
        issue: { pull_request: { url: "https://example" }, number: 42 },
        comment: { body: "/specsync accept", id: 1 },
        repository: FIXTURE.repository,
      },
      octokit: { issues: { createComment } },
      log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });

    expect(handleSpy).toHaveBeenCalled();
  });
});

describe("SpecAnalyzer storeSpec commit payload", () => {
  test("storeSpec writes normalized commit payload via SpecStore", async () => {
    const analyzer = new SpecAnalyzer();
    const writes: Array<Record<string, unknown>> = [];
    const context = {
      payload: {
        repository: { owner: { login: "acme" }, name: "demo-repo" },
        pull_request: {
          number: 42,
          head: { ref: "feature/specs", sha: "deadbeef" },
        },
      },
      octokit: {
        repos: {
          getContent: jest.fn().mockRejectedValue({ status: 404 }),
          createOrUpdateFileContents: jest.fn().mockImplementation(async (params) => {
            writes.push(params);
            return { data: { content: { sha: "new" } } };
          }),
        },
      },
    };

    await analyzer.storeSpec(
      "src/math.js:add",
      {
        functionName: "add",
        filePath: "src/math.js",
        lineNumber: 1,
        preconditions: ["a"],
        postconditions: ["b"],
        invariants: [],
        confidence: 85,
        reasoning: "r",
        implementationHash: hashImplementation("function add(){}"),
      },
      context
    );

    expect(writes).toHaveLength(1);
    expect(writes[0].branch).toBe("feature/specs");
    expect(writes[0].path).toMatch(/\.specsync\/specs\//);
    const decoded = JSON.parse(
      Buffer.from(writes[0].content as string, "base64").toString("utf8")
    );
    expect(decoded.functionName).toBe("add");
    expect(decoded.pr).toBe(42);
    expect(decoded.sha).toBe("deadbeef");
  });
});

describe("detectDrift with fixture stored spec", () => {
  test("reports hash mismatch using fixture contract", async () => {
    const fixture = JSON.parse(
      fs.readFileSync(path.join(__dirname, "fixtures", "stored-spec.add.json"), "utf8")
    ) as Record<string, unknown>;

    const oldBody = "function add(a,b){return a+b;}";
    const newBody = "function add(a,b){return a-b;}";
    fixture.implementationHash = hashImplementation(oldBody);

    const analyzer = new SpecAnalyzer();
    const context = {
      payload: {
        repository: { owner: { login: "acme" }, name: "demo-repo", full_name: "acme/demo-repo" },
        ref: "refs/heads/main",
        after: "newsha",
      },
      octokit: {
        repos: {
          getContent: jest.fn().mockImplementation(async ({ path: p }: { path: string }) => {
            if (p === ".specsync/specs") {
              return {
                data: [
                  {
                    type: "file",
                    name: "src__math.js__add.json",
                    path: ".specsync/specs/src__math.js__add.json",
                  },
                ],
              };
            }
            if (p.endsWith(".json")) {
              return {
                data: { content: Buffer.from(JSON.stringify(fixture), "utf8").toString("base64") },
              };
            }
            if (p === "src/math.js") {
              return {
                data: { content: Buffer.from(newBody, "utf8").toString("base64") },
              };
            }
            throw { status: 404 };
          }),
        },
      },
    };

    const drift = await analyzer.detectDrift(
      [{ modified: ["src/math.js"], added: [], removed: [] }],
      context
    );

    expect(drift).toHaveLength(1);
    expect(drift[0].functionName).toBe("add");
    expect(drift[0].filePath).toBe("src/math.js");
    expect(drift[0].reason).toMatch(/hash|implementation/i);
  });
});
