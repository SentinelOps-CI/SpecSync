import {
  ASTExtractor,
  isSupportedAstPath,
  getLanguageNameFromPath,
  SUPPORTED_AST_EXTENSIONS,
} from "../src/ast-extractor";

describe("ASTExtractor language support", () => {
  test("isSupportedAstPath accepts tree-sitter-backed extensions only", () => {
    expect(isSupportedAstPath("src/app.ts")).toBe(true);
    expect(isSupportedAstPath("src/app.js")).toBe(true);
    expect(isSupportedAstPath("src/app.py")).toBe(true);
    expect(isSupportedAstPath("src/Main.java")).toBe(true);
    expect(isSupportedAstPath("src/lib.rs")).toBe(true);
    expect(isSupportedAstPath("src/main.go")).toBe(false);
    expect(isSupportedAstPath("src/util.c")).toBe(false);
    expect(isSupportedAstPath("src/util.cpp")).toBe(false);
  });

  test("getLanguageNameFromPath maps known extensions", () => {
    expect(getLanguageNameFromPath("a.ts")).toBe("TypeScript");
    expect(getLanguageNameFromPath("a.py")).toBe("Python");
    expect(getLanguageNameFromPath("a.go")).toBe("Unknown");
  });

  test("SUPPORTED_AST_EXTENSIONS does not claim Go/C/C++", () => {
    expect(SUPPORTED_AST_EXTENSIONS).not.toContain(".go");
    expect(SUPPORTED_AST_EXTENSIONS).not.toContain(".c");
    expect(SUPPORTED_AST_EXTENSIONS).not.toContain(".cpp");
  });

  test("createBasicAnalysis preserves side and line metadata", () => {
    const extractor = new ASTExtractor();
    const analysis = extractor.createBasicAnalysis({
      filePath: "src/old.js",
      functionName: "doomed",
      functionBody: "-function doomed() {}",
      lineNumber: 8,
      side: "LEFT",
      changeType: "removed",
    });

    expect(analysis.side).toBe("LEFT");
    expect(analysis.lineNumber).toBe(8);
    expect(analysis.ast.complexity).toBe(1);
  });

  test("getFileContent caches by path+ref", async () => {
    const extractor = new ASTExtractor();
    const getContent = jest.fn().mockResolvedValue({
      data: { content: Buffer.from("function add() {}").toString("base64") },
    });
    const context = {
      payload: {
        repository: { owner: { login: "acme" }, name: "app" },
        pull_request: { head: { sha: "deadbeef" } },
      },
      octokit: { repos: { getContent } },
    };

    const first = await extractor.getFileContent("src/a.js", context);
    const second = await extractor.getFileContent("src/a.js", context);
    expect(first).toBe("function add() {}");
    expect(second).toBe("function add() {}");
    expect(getContent).toHaveBeenCalledTimes(1);

    extractor.clearContentCache();
    await extractor.getFileContent("src/a.js", context);
    expect(getContent).toHaveBeenCalledTimes(2);
  });

  test("extractAST skips unsupported languages", async () => {
    const extractor = new ASTExtractor();
    const results = await extractor.extractAST(
      [
        {
          filePath: "src/main.go",
          functionName: "main",
          functionBody: "func main() {}",
          lineNumber: 1,
          side: "RIGHT",
        },
      ],
      { payload: {}, octokit: {} }
    );
    expect(results).toEqual([]);
  });
});
