import { DiffParser } from "../src/diff-parser";

describe("DiffParser", () => {
  let diffParser;

  beforeEach(() => {
    diffParser = new DiffParser();
  });

  describe("isCodeFile", () => {
    it("should identify JavaScript files as code files", () => {
      expect(diffParser.isCodeFile("src/app.js")).toBe(true);
      expect(diffParser.isCodeFile("src/app.ts")).toBe(true);
      expect(diffParser.isCodeFile("src/app.py")).toBe(true);
    });

    it("should exclude test files", () => {
      expect(diffParser.isCodeFile("src/app.test.js")).toBe(false);
      expect(diffParser.isCodeFile("src/app.spec.js")).toBe(false);
      expect(diffParser.isCodeFile("test/app.js")).toBe(false);
    });

    it("should exclude languages without tree-sitter parsers", () => {
      expect(diffParser.isCodeFile("src/main.go")).toBe(false);
      expect(diffParser.isCodeFile("src/util.c")).toBe(false);
      expect(diffParser.isCodeFile("src/util.cpp")).toBe(false);
      expect(diffParser.isCodeFile("include/util.h")).toBe(false);
    });

    it("should include tree-sitter-backed languages", () => {
      expect(diffParser.isCodeFile("src/App.tsx")).toBe(true);
      expect(diffParser.isCodeFile("src/Main.java")).toBe(true);
      expect(diffParser.isCodeFile("src/lib.rs")).toBe(true);
    });
  });

  describe("extractFunctions", () => {
    it("should extract JavaScript function declarations", () => {
      const diff = `
diff --git a/src/app.js b/src/app.js
index 1234567..abcdefg 100644
--- a/src/app.js
+++ b/src/app.js
@@ -10,6 +10,10 @@
+function calculateInterest(principal, rate, time) {
+  if (principal <= 0 || rate < 0 || time <= 0) {
+    throw new Error('Invalid parameters');
+  }
+  return principal * rate * time;
+}
       `;

      const functions = diffParser.extractFunctions(diff);
      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe("calculateInterest");
      expect(functions[0].changeType).toBe("+");
      expect(functions[0].lineNumber).toBe(10);
    });

    it("should map function start to RIGHT-side file line after hunk context", () => {
      const diff = `@@ -20,3 +20,7 @@
 context line one
 context line two
+function addedAfterContext(x) {
+  return x;
+}
`;

      const functions = diffParser.extractFunctions(diff);
      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe("addedAfterContext");
      // Hunk starts at right line 20; two context lines → function at 22
      expect(functions[0].lineNumber).toBe(22);
    });

    it("should skip removed lines when advancing RIGHT-side line numbers", () => {
      const diff = `@@ -5,4 +5,4 @@
-function oldName() {
+function newName() {
   return 1;
 }
`;

      const functions = diffParser.extractFunctions(diff);
      const added = functions.find((f) => f.name === "newName");
      expect(added).toBeDefined();
      expect(added.lineNumber).toBe(5);
    });

    it("should parse hunk headers", () => {
      expect(diffParser.parseHunkHeader("@@ -10,6 +12,8 @@")).toEqual({
        oldStart: 10,
        oldCount: 6,
        newStart: 12,
        newCount: 8,
      });
      expect(diffParser.parseHunkHeader("@@ -1 +1 @@")).toEqual({
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 1,
      });
      expect(diffParser.parseHunkHeader("@@ -1,5 +0,0 @@")).toEqual({
        oldStart: 1,
        oldCount: 5,
        newStart: 0,
        newCount: 0,
      });
      expect(diffParser.parseHunkHeader("not a hunk")).toBeNull();
    });

    it("should anchor pure deletions to LEFT-side old-file lines", () => {
      const diff = `diff --git a/src/old.js b/src/old.js
deleted file mode 100644
index abcdef1..0000000
--- a/src/old.js
+++ /dev/null
@@ -8,5 +0,0 @@
-function doomed() {
-  return 1;
-}
`;

      const functions = diffParser.extractFunctions(diff);
      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe("doomed");
      expect(functions[0].side).toBe("LEFT");
      expect(functions[0].lineNumber).toBe(8);
      expect(functions[0].changeType).toBe("-");
    });

    it("should use LEFT for removed function lines in mixed hunks", () => {
      const diff = `@@ -5,4 +5,4 @@
-function oldName() {
+function newName() {
   return 1;
 }
`;

      const functions = diffParser.extractFunctions(diff);
      const removed = functions.find((f: { name: string }) => f.name === "oldName");
      const added = functions.find((f: { name: string }) => f.name === "newName");
      expect(removed).toBeDefined();
      expect(removed.side).toBe("LEFT");
      expect(removed.lineNumber).toBe(5);
      expect(added).toBeDefined();
      expect(added.side).toBe("RIGHT");
      expect(added.lineNumber).toBe(5);
    });

    it("should extract arrow functions", () => {
      const diff = `
diff --git a/src/app.js b/src/app.js
index 1234567..abcdefg 100644
--- a/src/app.js
+++ b/src/app.js
@@ -5,6 +5,8 @@
+const multiply = (a, b) => {
+  return a * b;
+};
       `;

      const functions = diffParser.extractFunctions(diff);
      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe("multiply");
      expect(functions[0].lineNumber).toBe(5);
    });

    it("should extract Python function definitions", () => {
      const diff = `
diff --git a/src/app.py b/src/app.py
index 1234567..abcdefg 100644
--- a/src/app.py
+++ b/src/app.py
@@ -3,6 +3,10 @@
+def calculate_area(radius):
+    if radius <= 0:
+        raise ValueError("Radius must be positive")
+    return 3.14159 * radius * radius
       `;

      const functions = diffParser.extractFunctions(diff);
      expect(functions.length).toBeGreaterThan(0);
      expect(functions[0].name).toBe("calculate_area");
      expect(functions[0].lineNumber).toBe(3);
    });
  });

  describe("extractComments", () => {
    it("should extract comments near functions", () => {
      const fileDiff = `
+// Calculate simple interest
+function calculateInterest(principal, rate, time) {
+  // Validate inputs
+  if (principal <= 0 || rate < 0 || time <= 0) {
+    throw new Error('Invalid parameters');
+  }
+  return principal * rate * time;
+}
       `;

      const comments = diffParser.extractComments(fileDiff, 2);
      expect(comments.length).toBeGreaterThan(0);
      expect(comments.some((c) => c.text.includes("Calculate simple interest"))).toBe(true);
    });
  });

  describe("determineChangeType", () => {
    it("should identify added functions", () => {
      const func = {
        body: "+function newFunction() {\n+  return true;\n+}",
      };
      expect(diffParser.determineChangeType(func)).toBe("added");
    });

    it("should identify removed functions", () => {
      const func = {
        body: "-function oldFunction() {\n-  return false;\n-}",
      };
      expect(diffParser.determineChangeType(func)).toBe("removed");
    });

    it("should identify modified functions", () => {
      const func = {
        body: " function modifiedFunction() {\n-  return false;\n+  return true;\n }",
      };
      expect(diffParser.determineChangeType(func)).toBe("modified");
    });
  });

  describe("getCommentType", () => {
    it("should identify TODO comments", () => {
      expect(diffParser.getCommentType("// TODO: implement this")).toBe("todo");
      expect(diffParser.getCommentType("// FIXME: fix this bug")).toBe("todo");
    });

    it("should identify documentation comments", () => {
      expect(diffParser.getCommentType("/** @param {number} x */")).toBe("documentation");
      expect(diffParser.getCommentType("// @return {boolean}")).toBe("documentation");
    });

    it("should identify specification comments", () => {
      expect(diffParser.getCommentType("// @spec pre: x > 0")).toBe("specification");
      expect(diffParser.getCommentType("// @pre x > 0")).toBe("specification");
    });

    it("should identify general comments", () => {
      expect(diffParser.getCommentType("// This is a general comment")).toBe("general");
    });
  });
});
