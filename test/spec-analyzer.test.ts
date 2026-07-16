import { SpecAnalyzer } from "../src/spec-analyzer";
import { hashImplementation } from "../src/spec-store";

describe("SpecAnalyzer budgets and drift", () => {
  test("analyzeChanges caps at SPECSYNC_MAX_SPECS_PER_PR", async () => {
    process.env.SPECSYNC_MAX_SPECS_PER_PR = "2";
    process.env.SPECSYNC_LLM_CONCURRENCY = "2";

    const analyzer = new SpecAnalyzer({
      llmClient: {
        generateSpec: jest.fn().mockResolvedValue({
          preconditions: ["p"],
          postconditions: ["q"],
          invariants: [],
          edgeCases: [],
          confidence: 0.7,
          reasoning: "mock",
        }),
      },
    }) as SpecAnalyzer & {
      lastJobCost: {
        cappedAt: number;
        skippedByBudget: number;
        llmCalls: number;
      };
    };

    const analyses = [1, 2, 3, 4].map((i) => ({
      functionName: `fn${i}`,
      filePath: `src/f${i}.ts`,
      lineNumber: i,
      functionBody: `function fn${i}() { return ${i}; }`,
      comments: [],
      ast: {
        inputTypes: [],
        outputType: "number",
        conditionalGuards: [],
        loops: [],
        branching: [],
        earlyReturns: [],
        controlFlow: {},
        complexity: 1,
      },
    }));

    const context = {
      payload: {
        repository: { owner: { login: "o" }, name: "r", full_name: "o/r" },
        pull_request: { head: { sha: "abc" } },
      },
      octokit: {
        repos: {
          getContent: jest.fn().mockRejectedValue({ status: 404 }),
        },
      },
    };

    const suggestions = await analyzer.analyzeChanges(analyses, context);
    expect(suggestions).toHaveLength(2);
    expect(analyzer.lastJobCost.cappedAt).toBe(2);
    expect(analyzer.lastJobCost.skippedByBudget).toBe(2);
    expect(analyzer.lastJobCost.llmCalls).toBe(2);

    delete process.env.SPECSYNC_MAX_SPECS_PER_PR;
    delete process.env.SPECSYNC_LLM_CONCURRENCY;
  });

  test("detectDrift reports hash mismatch against stored specs", async () => {
    const analyzer = new SpecAnalyzer();
    const oldBody = "function add(a,b){return a+b;}";
    const newBody = "function add(a,b){return a+b+1;}";

    const context = {
      payload: {
        repository: { owner: { login: "o" }, name: "r", full_name: "o/r" },
        ref: "refs/heads/main",
        after: "newsha",
      },
      octokit: {
        repos: {
          getContent: jest.fn().mockImplementation(async ({ path }: { path: string }) => {
            if (path === ".specsync/specs") {
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
            if (path.endsWith(".json")) {
              return {
                data: {
                  content: Buffer.from(
                    JSON.stringify({
                      version: 1,
                      functionName: "add",
                      filePath: "src/math.js",
                      confidence: 0.9,
                      acceptedAt: "t",
                      implementationHash: hashImplementation(oldBody),
                      contract: {
                        preconditions: [],
                        postconditions: [],
                        invariants: [],
                      },
                    })
                  ).toString("base64"),
                },
              };
            }
            if (path === "src/math.js") {
              return {
                data: {
                  content: Buffer.from(newBody, "utf8").toString("base64"),
                },
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
    expect(drift[0].reason).toMatch(/hash/i);
  });
});
