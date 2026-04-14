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

    it("should exclude non-code files", () => {
      expect(diffParser.isCodeFile("README.md")).toBe(false);
      expect(diffParser.isCodeFile("package.json")).toBe(false);
      expect(diffParser.isCodeFile("src/app.css")).toBe(false);
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
