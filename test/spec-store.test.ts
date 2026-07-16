import {
  SpecStore,
  buildSpecStorePath,
  buildLeanStorePath,
  hashImplementation,
  suggestionToStoredSpec,
} from "../src/spec-store";

describe("spec-store", () => {
  test("buildSpecStorePath encodes file path and function", () => {
    expect(buildSpecStorePath("src/math.ts", "add")).toBe(
      ".specsync/specs/src__math.ts__add.json"
    );
  });

  test("buildLeanStorePath uses SPECS_DIR", () => {
    expect(buildLeanStorePath("add")).toBe("specs/add_spec.lean");
  });

  test("hashImplementation is stable", () => {
    expect(hashImplementation("fn() {}")).toBe(hashImplementation("fn() {}"));
    expect(hashImplementation("a")).not.toBe(hashImplementation("b"));
  });

  test("suggestionToStoredSpec normalizes confidence", () => {
    const stored = suggestionToStoredSpec(
      {
        functionName: "add",
        filePath: "src/a.ts",
        lineNumber: 1,
        preconditions: ["a"],
        postconditions: ["b"],
        invariants: [],
        confidence: 85,
        reasoning: "ok",
      },
      { pr: 1, sha: "abc" }
    );
    expect(stored.confidence).toBe(0.85);
    expect(stored.version).toBe(1);
    expect(stored.pr).toBe(1);
  });

  test("storeSpec writes via createOrUpdateFileContents", async () => {
    const store = new SpecStore();
    const writes: Array<Record<string, unknown>> = [];
    const octokit = {
      repos: {
        getContent: jest.fn().mockRejectedValue({ status: 404 }),
        createOrUpdateFileContents: jest.fn().mockImplementation(async (params) => {
          writes.push(params);
          return { data: { content: { sha: "newsha" } } };
        }),
      },
    };

    const stored = suggestionToStoredSpec(
      {
        functionName: "add",
        filePath: "src/math.ts",
        lineNumber: 3,
        preconditions: ["x"],
        postconditions: ["y"],
        invariants: [],
        confidence: 0.9,
        reasoning: "r",
      },
      { pr: 9, sha: "deadbeef" }
    );

    const result = await store.storeSpec(
      octokit,
      { owner: "o", repo: "r", ref: "feature" },
      stored
    );

    expect(result.path).toContain(".specsync/specs/");
    expect(writes[0].branch).toBe("feature");
    expect(writes[0].path).toBe(result.path);
    const decoded = Buffer.from(writes[0].content as string, "base64").toString("utf8");
    expect(JSON.parse(decoded).functionName).toBe("add");
  });

  test("computeCoverageForFunctions uses accepted store", async () => {
    const store = new SpecStore();
    const octokit = {
      repos: {
        getContent: jest.fn().mockImplementation(async ({ path }: { path: string }) => {
          if (path === ".specsync/specs") {
            return {
              data: [
                {
                  type: "file",
                  name: "src__math.ts__add.json",
                  path: ".specsync/specs/src__math.ts__add.json",
                },
              ],
            };
          }
          if (path === ".specsync/specs/src__math.ts__add.json") {
            return {
              data: {
                content: Buffer.from(
                  JSON.stringify({
                    version: 1,
                    functionName: "add",
                    filePath: "src/math.ts",
                    confidence: 0.9,
                    acceptedAt: new Date().toISOString(),
                    contract: { preconditions: [], postconditions: [], invariants: [] },
                  })
                ).toString("base64"),
              },
            };
          }
          throw { status: 404 };
        }),
        createOrUpdateFileContents: jest.fn(),
      },
    };

    const coverage = await store.computeCoverageForFunctions(
      octokit,
      { owner: "o", repo: "r", ref: "main" },
      [
        { functionName: "add", filePath: "src/math.ts", lineNumber: 1 },
        { functionName: "sub", filePath: "src/math.ts", lineNumber: 2 },
      ]
    );

    expect(coverage.totalFunctions).toBe(2);
    expect(coverage.coveredFunctions).toBe(1);
    expect(coverage.coverage).toBe(50);
    expect(coverage.formula).toContain("accepted");
  });

  test("in-memory cache expires via TTL", async () => {
    const store = new SpecStore();
    const getContent = jest.fn().mockResolvedValue({
      data: {
        content: Buffer.from(
          JSON.stringify({
            version: 1,
            functionName: "add",
            filePath: "a.ts",
            confidence: 1,
            acceptedAt: "t",
            contract: { preconditions: [], postconditions: [], invariants: [] },
          })
        ).toString("base64"),
      },
    });
    const octokit = {
      repos: { getContent, createOrUpdateFileContents: jest.fn() },
    };

    await store.retrieveSpec(octokit, { owner: "o", repo: "r", ref: "main" }, "a.ts", "add");
    await store.retrieveSpec(octokit, { owner: "o", repo: "r", ref: "main" }, "a.ts", "add");
    expect(getContent).toHaveBeenCalledTimes(1);
  });
});
