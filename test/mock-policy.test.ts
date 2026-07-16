/**
 * Phase 6 — focused tests for mock LLM policy and language support honesty.
 */
import {
  getLanguageNameFromPath,
  isSupportedAstPath,
  SUPPORTED_AST_EXTENSIONS,
} from "../src/ast-extractor";

describe("Phase 6 language support honesty", () => {
  it("lists only tree-sitter-backed extensions", () => {
    expect(SUPPORTED_AST_EXTENSIONS).toEqual([
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
      ".py",
      ".java",
      ".rs",
    ]);
  });

  it("accepts supported paths", () => {
    expect(isSupportedAstPath("src/a.ts")).toBe(true);
    expect(isSupportedAstPath("pkg/mod.rs")).toBe(true);
  });

  it("rejects Go/C/C++ paths", () => {
    expect(isSupportedAstPath("main.go")).toBe(false);
    expect(isSupportedAstPath("x.c")).toBe(false);
    expect(isSupportedAstPath("x.cpp")).toBe(false);
  });

  it("names only supported languages", () => {
    expect(getLanguageNameFromPath("a.ts")).toBe("TypeScript");
    expect(getLanguageNameFromPath("a.py")).toBe("Python");
    expect(getLanguageNameFromPath("a.go")).toBe("Unknown");
    expect(getLanguageNameFromPath("a.c")).toBe("Unknown");
  });
});

describe("Phase 6 SpecAnalyzer mock unavailable propagation", () => {
  it("sets lastLlmUnavailable and returns no suggestions when LLM denies mock", async () => {
    const unavailableClient = {
      generateSpec: jest.fn().mockResolvedValue({
        unavailable: true,
        reason: "llm_unavailable",
        isMock: false,
      }),
    };

    jest.resetModules();
    const { SpecAnalyzer } = require("../src/spec-analyzer");
    const analyzer = new SpecAnalyzer({ llmClient: unavailableClient });

    const result = await analyzer.analyzeChanges(
      [
        {
          functionName: "f",
          filePath: "src/a.js",
          lineNumber: 1,
          functionBody: "function f() {}",
          ast: {
            inputTypes: [],
            outputType: "any",
            conditionalGuards: [],
            loops: [],
            branching: [],
            earlyReturns: [],
            controlFlow: {},
            complexity: 1,
          },
          comments: [],
        },
      ],
      { payload: { repository: { full_name: "o/r", owner: { login: "o" }, name: "r" } } }
    );

    expect(result).toEqual([]);
    expect(analyzer.lastLlmUnavailable).toBe(true);
  });

  it("propagates isMock on suggestions", async () => {
    const mockClient = {
      generateSpec: jest.fn().mockResolvedValue({
        preconditions: ["p"],
        postconditions: ["q"],
        invariants: ["i"],
        edgeCases: ["e"],
        confidence: 0.5,
        reasoning: "mock",
        isMock: true,
      }),
    };

    jest.resetModules();
    const { SpecAnalyzer } = require("../src/spec-analyzer");
    const analyzer = new SpecAnalyzer({ llmClient: mockClient });

    const result = await analyzer.analyzeChanges(
      [
        {
          functionName: "f",
          filePath: "src/a.js",
          lineNumber: 1,
          functionBody: "function f() { return 1; }",
          ast: {
            inputTypes: [],
            outputType: "any",
            conditionalGuards: [],
            loops: [],
            branching: [],
            earlyReturns: [],
            controlFlow: {},
            complexity: 1,
          },
          comments: [],
        },
      ],
      { payload: { repository: { full_name: "o/r", owner: { login: "o" }, name: "r" } } }
    );

    expect(result).toHaveLength(1);
    expect(result[0].isMock).toBe(true);
    expect(analyzer.lastLlmUnavailable).toBe(false);
  });
});
