// @ts-nocheck
const fs = require("fs-extra");
const path = require("path");
const simpleGit = require("simple-git");

export class DiffParser {
  constructor() {
    this.git = simpleGit();
  }

  /**
   * Parse diff and extract function changes
   * @param {string} diff - Raw diff content
   * @param {Array} changedFiles - List of changed files from GitHub API
   * @returns {Array} Array of function changes with metadata
   */
  async parseDiff(diff, changedFiles) {
    const functionChanges = [];

    for (const file of changedFiles) {
      if (this.isCodeFile(file.filename)) {
        const fileChanges = await this.parseFileDiff(file, diff);
        functionChanges.push(...fileChanges);
      }
    }

    return functionChanges;
  }

  /**
   * Check if file is a code file that should be analyzed
   * @param {string} filename - File path
   * @returns {boolean}
   */
  isCodeFile(filename) {
    const codeExtensions = [
      ".js",
      ".ts",
      ".jsx",
      ".tsx",
      ".py",
      ".java",
      ".go",
      ".rs",
      ".cpp",
      ".c",
      ".h",
    ];
    const testPatterns = ["test", "spec", "Test", "Spec"];

    const ext = path.extname(filename);
    const isCodeFile = codeExtensions.includes(ext);
    const isTestFile = testPatterns.some((pattern) => filename.includes(pattern));

    return isCodeFile && !isTestFile;
  }

  /**
   * Parse diff for a specific file
   * @param {Object} file - File metadata from GitHub API
   * @param {string} diff - Raw diff content
   * @returns {Array} Function changes in this file
   */
  async parseFileDiff(file, diff) {
    const functionChanges = [];
    const fileDiff = this.extractFileDiff(diff, file.filename);

    if (!fileDiff) return functionChanges;

    // Extract function signatures and bodies
    const functions = this.extractFunctions(fileDiff);

    for (const func of functions) {
      const change = {
        filePath: file.filename,
        functionName: func.name,
        functionBody: func.body,
        lineNumber: func.lineNumber,
        changeType: this.determineChangeType(func),
        comments: this.extractComments(fileDiff, func.lineNumber),
        testFiles: await this.findTestFiles(file.filename),
      };

      functionChanges.push(change);
    }

    return functionChanges;
  }

  /**
   * Extract diff content for a specific file
   * @param {string} diff - Raw diff content
   * @param {string} filename - Target filename
   * @returns {string} File-specific diff
   */
  extractFileDiff(diff, filename) {
    const lines = diff.split("\n");
    let inTargetFile = false;
    let fileDiff = [];

    for (const line of lines) {
      if (line.startsWith("diff --git")) {
        inTargetFile = line.includes(filename);
        if (inTargetFile) {
          fileDiff = [];
        }
      } else if (inTargetFile) {
        fileDiff.push(line);
      }
    }

    return fileDiff.join("\n");
  }

  /**
   * Extract function definitions from diff
   * @param {string} fileDiff - File-specific diff
   * @returns {Array} Array of function objects
   */
  extractFunctions(fileDiff) {
    const functions = [];
    const lines = fileDiff.split("\n");

    // Common function patterns for different languages
    const functionPatterns = [
      // JavaScript/TypeScript
      /^(\+|\-)?\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
      /^(\+|\-)?\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/,
      /^(\+|\-)?\s*(?:export\s+)?(\w+)\s*[:=]\s*(?:async\s+)?\(/,
      // Python
      /^(\+|\-)?\s*def\s+(\w+)\s*\(/,
      // Java
      /^(\+|\-)?\s*(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:<[^>]+>\s+)?\w+\s+(\w+)\s*\(/,
      // Go
      /^(\+|\-)?\s*func\s+(\w+)\s*\(/,
      // Rust
      /^(\+|\-)?\s*fn\s+(\w+)\s*\(/,
      // C/C++
      /^(\+|\-)?\s*(?:static\s+)?(?:inline\s+)?(?:const\s+)?\w+(?:\s*\*)?\s+(\w+)\s*\(/,
    ];

    let currentFunction = null;
    let braceCount = 0;
    let inFunction = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for function start
      for (const pattern of functionPatterns) {
        const match = line.match(pattern);
        if (match) {
          if (currentFunction) {
            functions.push(currentFunction);
          }

          currentFunction = {
            name: match[2],
            body: line,
            lineNumber: i + 1,
            changeType: match[1] || "modified",
          };

          inFunction = true;
          braceCount = this.countBraces(line);
          break;
        }
      }

      // Continue building function body
      if (inFunction && currentFunction) {
        currentFunction.body += "\n" + line;
        braceCount += this.countBraces(line);

        // Check if function ends
        if (braceCount === 0 && line.trim() !== "") {
          inFunction = false;
          functions.push(currentFunction);
          currentFunction = null;
        }
      }
    }

    if (currentFunction) {
      functions.push(currentFunction);
    }

    return functions;
  }

  /**
   * Count opening and closing braces in a line
   * @param {string} line - Code line
   * @returns {number} Net brace count
   */
  countBraces(line) {
    const openBraces = (line.match(/\{/g) || []).length;
    const closeBraces = (line.match(/\}/g) || []).length;
    return openBraces - closeBraces;
  }

  /**
   * Determine the type of change made to a function
   * @param {Object} func - Function object
   * @returns {string} Change type
   */
  determineChangeType(func) {
    const lines = func.body.split("\n");
    const hasAdded = lines.some((line) => line.startsWith("+"));
    const hasRemoved = lines.some((line) => line.startsWith("-"));

    if (hasAdded && hasRemoved) {
      return "modified";
    } else if (hasAdded) {
      return "added";
    } else if (hasRemoved) {
      return "removed";
    }

    return "modified";
  }

  /**
   * Extract comments associated with a function
   * @param {string} fileDiff - File-specific diff
   * @param {number} functionLine - Line number of function
   * @returns {Array} Array of comments
   */
  extractComments(fileDiff, functionLine) {
    const comments = [];
    const lines = fileDiff.split("\n");

    // Look for comments within 5 lines of the function
    const searchRange = 5;

    for (
      let i = Math.max(0, functionLine - searchRange - 1);
      i < Math.min(lines.length, functionLine + searchRange);
      i++
    ) {
      const line = lines[i];

      // Extract different types of comments
      if (line.includes("//") || line.includes("/*") || line.includes("*/")) {
        const comment = line.replace(/^(\+|\-)?\s*/, "").trim();
        if (comment) {
          comments.push({
            text: comment,
            lineNumber: i + 1,
            type: this.getCommentType(comment),
          });
        }
      }
    }

    return comments;
  }

  /**
   * Determine the type of comment
   * @param {string} comment - Comment text
   * @returns {string} Comment type
   */
  getCommentType(comment) {
    if (comment.includes("TODO") || comment.includes("FIXME")) {
      return "todo";
    } else if (comment.includes("@param") || comment.includes("@return")) {
      return "documentation";
    } else if (comment.includes("@spec") || comment.includes("@pre") || comment.includes("@post")) {
      return "specification";
    } else {
      return "general";
    }
  }

  /**
   * Find associated test files for a given file
   * @param {string} filePath - Path to the source file
   * @returns {Array} Array of test file paths
   */
  async findTestFiles(filePath) {
    const testFiles = [];
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, path.extname(filePath));

    // Common test file patterns
    const testPatterns = [
      `${baseName}.test.js`,
      `${baseName}.spec.js`,
      `${baseName}.test.ts`,
      `${baseName}.spec.ts`,
      `${baseName}_test.py`,
      `${baseName}_spec.py`,
      `Test${baseName}.java`,
      `${baseName}Test.java`,
      `${baseName}_test.go`,
      `${baseName}_test.rs`,
    ];

    for (const pattern of testPatterns) {
      const testPath = path.join(dir, pattern);
      try {
        await fs.access(testPath);
        testFiles.push(testPath);
      } catch (error) {
        // File doesn't exist, continue
      }
    }

    return testFiles;
  }
}
