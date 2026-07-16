const fs = require("fs-extra");
const path = require("path");
const simpleGit = require("simple-git");

export class DiffParser {
  git: any;
  constructor() {
    this.git = simpleGit();
  }

  /**
   * Parse diff and extract function changes
   * @param {string} diff - Raw diff content
   * @param {Array} changedFiles - List of changed files from GitHub API
   * @returns {Array} Array of function changes with metadata
   */
  async parseDiff(diff: string, changedFiles: any[]) {
    const functionChanges: any[] = [];

    for (const file of changedFiles) {
      if (this.isCodeFile(file.filename)) {
        const fileChanges = await this.parseFileDiff(file, diff);
        functionChanges.push(...fileChanges);
      }
    }

    return functionChanges;
  }

  /**
   * Check if file is a code file that should be analyzed.
   * Only tree-sitter-backed languages (JS/TS/Python/Java/Rust) are analyzed.
   * @param {string} filename - File path
   * @returns {boolean}
   */
  isCodeFile(filename: string) {
    const { isSupportedAstPath } = require("./ast-extractor");
    const testPatterns = ["test", "spec", "Test", "Spec"];
    const isTestFile = testPatterns.some((pattern: any) => filename.includes(pattern));
    return isSupportedAstPath(filename) && !isTestFile;
  }

  /**
   * Parse diff for a specific file
   * @param {Object} file - File metadata from GitHub API
   * @param {string} diff - Raw diff content
   * @returns {Array} Function changes in this file
   */
  async parseFileDiff(file: any, diff: string) {
    const functionChanges: any[] = [];
    const fileDiff = this.extractFileDiff(diff, file.filename);

    if (!fileDiff) return functionChanges;

    // Extract function signatures and bodies
    const functions = this.extractFunctions(fileDiff);

    for (const func of functions) {
      const changeType = this.determineChangeType(func);
      const change = {
        filePath: file.filename,
        functionName: func.name,
        functionBody: func.body,
        lineNumber: func.lineNumber,
        // Pure deletions must use LEFT; GitHub rejects RIGHT lines that do not exist on head.
        side: func.side || (changeType === "removed" ? "LEFT" : "RIGHT"),
        changeType,
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
  extractFileDiff(diff: string, filename: string) {
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
   * Parse a unified-diff hunk header into old/new start line numbers and counts.
   * @param {string} line - Hunk header line (e.g. @@ -10,6 +12,8 @@ or @@ -1,5 +0,0 @@)
   * @returns {{ oldStart: number, oldCount: number, newStart: number, newCount: number } | null}
   */
  parseHunkHeader(line: string) {
    const match = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (!match) {
      return null;
    }
    return {
      oldStart: parseInt(match[1], 10),
      oldCount: match[2] !== undefined ? parseInt(match[2], 10) : 1,
      newStart: parseInt(match[3], 10),
      newCount: match[4] !== undefined ? parseInt(match[4], 10) : 1,
    };
  }

  /**
   * Extract function definitions from diff.
   * Maps each function start to a GitHub-valid file line + side:
   * - RIGHT + new-file line for adds/modifies/context
   * - LEFT + old-file line for pure deletions (no head line exists)
   * @param {string} fileDiff - File-specific diff
   * @returns {Array} Array of function objects
   */
  extractFunctions(fileDiff: string) {
    const functions: any[] = [];
    const lines = fileDiff.split("\n");

    const functionPatterns = [
      /^(\+|\-)?\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
      /^(\+|\-)?\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/,
      /^(\+|\-)?\s*(?:export\s+)?(\w+)\s*[:=]\s*(?:async\s+)?\(/,
      /^(\+|\-)?\s*def\s+(\w+)\s*\(/,
      /^(\+|\-)?\s*(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:<[^>]+>\s+)?\w+\s+(\w+)\s*\(/,
      /^(\+|\-)?\s*func\s+(\w+)\s*\(/,
      /^(\+|\-)?\s*fn\s+(\w+)\s*\(/,
      /^(\+|\-)?\s*(?:static\s+)?(?:inline\s+)?(?:const\s+)?\w+(?:\s*\*)?\s+(\w+)\s*\(/,
    ];

    let currentFunction: any = null;
    let braceCount = 0;
    let inFunction = false;
    let rightLine = 0;
    let leftLine = 0;
    let inHunk = false;
    /** True when the current hunk has zero new-file lines (pure deletion / deleted file). */
    let hunkIsPureDeletion = false;

    const pushCurrent = () => {
      if (currentFunction) {
        functions.push(currentFunction);
      }
      currentFunction = null;
      inFunction = false;
      braceCount = 0;
    };

    for (const line of lines) {
      const hunk = this.parseHunkHeader(line);
      if (hunk) {
        rightLine = hunk.newStart;
        leftLine = hunk.oldStart;
        inHunk = true;
        hunkIsPureDeletion = hunk.newCount === 0;
        continue;
      }

      if (
        line.startsWith("diff --git") ||
        line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line.startsWith("new file") ||
        line.startsWith("deleted file") ||
        line.startsWith("similarity index") ||
        line.startsWith("rename ") ||
        line.startsWith("Binary files") ||
        line.startsWith("\\")
      ) {
        continue;
      }

      if (!inHunk) {
        continue;
      }

      const prefix = line[0];
      const isAdded = prefix === "+";
      const isRemoved = prefix === "-";
      const isContext = !isAdded && !isRemoved;

      const currentRightLine = isRemoved ? null : rightLine > 0 ? rightLine : null;
      const currentLeftLine = isAdded ? null : leftLine > 0 ? leftLine : null;

      let startedFunction = false;
      for (const pattern of functionPatterns) {
        const match = line.match(pattern);
        if (match) {
          if (currentFunction) {
            pushCurrent();
          }

          const useLeft =
            isRemoved || hunkIsPureDeletion || (currentRightLine == null && currentLeftLine != null);

          currentFunction = {
            name: match[2],
            body: line,
            lineNumber: useLeft
              ? (currentLeftLine ?? currentRightLine ?? 0)
              : (currentRightLine ?? currentLeftLine ?? 0),
            side: useLeft ? "LEFT" : "RIGHT",
            changeType: match[1] || "modified",
          };
          inFunction = true;
          braceCount = this.countBraces(line);
          startedFunction = true;
          break;
        }
      }

      if (inFunction && currentFunction && !startedFunction) {
        currentFunction.body += "\n" + line;
        braceCount += this.countBraces(line);

        if (braceCount === 0 && line.trim() !== "") {
          pushCurrent();
        }
      } else if (startedFunction && braceCount === 0 && line.includes("{")) {
        // Single-line braced function already complete
        pushCurrent();
      }

      if (isRemoved) {
        leftLine += 1;
      } else if (isAdded) {
        rightLine += 1;
      } else if (isContext) {
        leftLine += 1;
        rightLine += 1;
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
  countBraces(line: string) {
    const openBraces = (line.match(/\{/g) || []).length;
    const closeBraces = (line.match(/\}/g) || []).length;
    return openBraces - closeBraces;
  }

  /**
   * Determine the type of change made to a function
   * @param {Object} func - Function object
   * @returns {string} Change type
   */
  determineChangeType(func: any) {
    const lines = func.body.split("\n");
    const hasAdded = lines.some((line: any) => line.startsWith("+"));
    const hasRemoved = lines.some((line: any) => line.startsWith("-"));

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
  extractComments(fileDiff: string, functionLine: number) {
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
  getCommentType(comment: string) {
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
  async findTestFiles(filePath: string) {
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
      } catch (error: unknown) {
        // File doesn't exist, continue
      }
    }

    return testFiles;
  }
}
