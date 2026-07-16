const fs = require("fs-extra");
const path = require("path");
const { execFile } = require("child_process");

export class SpecCoverageTracker {
  specsDir: any;
  sourceDir: any;
  coverageThreshold: any;
  driftThreshold: any;
  constructor() {
    this.specsDir = process.env.SPECS_DIR || "./specs";
    this.sourceDir = process.env.SOURCE_DIR || "./src";
    this.coverageThreshold = process.env.COVERAGE_THRESHOLD || 70;
    this.driftThreshold = process.env.DRIFT_THRESHOLD || 0.1; // 10% change threshold
  }

  /**
   * Analyze spec coverage across the codebase
   * @param {Object} context - Analysis context
   * @returns {Object} Coverage analysis results
   */
  async analyzeSpecCoverage(context: any) {
    const results: {
      totalFunctions: number;
      coveredFunctions: number;
      uncoveredFunctions: any[];
      coveragePercentage: number;
      specFiles: any[];
      userStories: any[];
      failedProofs: any[];
      staleProofs: any[];
      timestamp: string;
    } = {
      totalFunctions: 0,
      coveredFunctions: 0,
      uncoveredFunctions: [],
      coveragePercentage: 0,
      specFiles: [],
      userStories: [],
      failedProofs: [],
      staleProofs: [],
      timestamp: new Date().toISOString(),
    };

    try {
      // Find all source files
      const sourceFiles = await this.findSourceFiles();
      results.totalFunctions = await this.countFunctions(sourceFiles);

      // Find all spec files
      const specFiles = await this.findSpecFiles();
      results.specFiles = specFiles;

      // Analyze coverage
      const coverage = await this.calculateCoverage(sourceFiles, specFiles);
      results.coveredFunctions = coverage.covered;
      results.uncoveredFunctions = coverage.uncoveredFunctions;
      results.coveragePercentage = coverage.percentage;

      // Analyze user stories
      results.userStories = await this.analyzeUserStories();

      // Analyze proof status
      const proofAnalysis = await this.analyzeProofStatus(specFiles);
      results.failedProofs = proofAnalysis.failed;
      results.staleProofs = proofAnalysis.stale;
    } catch (error: unknown) {
      console.error("Error analyzing spec coverage:", error);
    }

    return results;
  }

  /**
   * Find all source files in the codebase
   * @returns {Array} Array of source file paths
   */
  async findSourceFiles() {
    const sourceFiles: string[] = [];
    const extensions = [".js", ".ts", ".py", ".java", ".rs", ".cpp", ".c"];

    const walkDir = async (dir: string) => {
      const files = await fs.readdir(dir);

      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = await fs.stat(filePath);

        if (stat.isDirectory() && !file.startsWith(".") && file !== "node_modules") {
          await walkDir(filePath);
        } else if (stat.isFile() && extensions.includes(path.extname(file))) {
          sourceFiles.push(filePath);
        }
      }
    };

    await walkDir(this.sourceDir);
    return sourceFiles;
  }

  /**
   * Find all spec files
   * @returns {Array} Array of spec file paths
   */
  async findSpecFiles() {
    const specFiles = [];

    try {
      const files = await fs.readdir(this.specsDir);
      for (const file of files) {
        if (file.endsWith(".lean")) {
          specFiles.push(path.join(this.specsDir, file));
        }
      }
    } catch (error: unknown) {
      console.warn("Specs directory not found:", (error instanceof Error ? error.message : String(error)));
    }

    return specFiles;
  }

  /**
   * Count functions in source files
   * @param {Array} sourceFiles - Array of source file paths
   * @returns {number} Total function count
   */
  async countFunctions(sourceFiles: any[]) {
    let totalFunctions = 0;

    for (const file of sourceFiles) {
      try {
        const content = await fs.readFile(file, "utf8");
        const functionCount = this.countFunctionsInFile(content, path.extname(file));
        totalFunctions += functionCount;
      } catch (error: unknown) {
        console.warn(`Error reading file ${file}:`, (error instanceof Error ? error.message : String(error)));
      }
    }

    return totalFunctions;
  }

  /**
   * Count functions in a single file
   * @param {string} content - File content
   * @param {string} extension - File extension
   * @returns {number} Function count
   */
  countFunctionsInFile(content: string, extension: string) {
    let count = 0;

    switch (extension) {
      case ".js":
      case ".ts":
        // JavaScript/TypeScript function patterns
        const jsPatterns = [
          /function\s+\w+\s*\(/g,
          /const\s+\w+\s*=\s*\(/g,
          /let\s+\w+\s*=\s*\(/g,
          /var\s+\w+\s*=\s*\(/g,
          /=>\s*{/g,
        ];
        jsPatterns.forEach((pattern: any) => {
          const matches = content.match(pattern);
          if (matches) count += matches.length;
        });
        break;

      case ".py":
        // Python function patterns
        const pyPatterns = [/def\s+\w+\s*\(/g];
        pyPatterns.forEach((pattern: any) => {
          const matches = content.match(pattern);
          if (matches) count += matches.length;
        });
        break;

      case ".java":
        // Java method patterns
        const javaPatterns = [/(public|private|protected)?\s*(static\s+)?\w+\s+\w+\s*\(/g];
        javaPatterns.forEach((pattern: any) => {
          const matches = content.match(pattern);
          if (matches) count += matches.length;
        });
        break;

      case ".rs":
        // Rust function patterns
        const rustPatterns = [/fn\s+\w+\s*\(/g];
        rustPatterns.forEach((pattern: any) => {
          const matches = content.match(pattern);
          if (matches) count += matches.length;
        });
        break;
    }

    return count;
  }

  /**
   * Calculate coverage between source files and spec files
   * @param {Array} sourceFiles - Source file paths
   * @param {Array} specFiles - Spec file paths
   * @returns {Object} Coverage results
   */
  async calculateCoverage(sourceFiles: any[], specFiles: any[]) {
    const covered = [];
    const uncovered = [];

    // Extract function names from spec files
    const specFunctions = new Set();
    for (const specFile of specFiles) {
      try {
        const content = await fs.readFile(specFile, "utf8");
        const functionName = this.extractFunctionNameFromSpec(content);
        if (functionName) {
          specFunctions.add(functionName);
        }
      } catch (error: unknown) {
        console.warn(`Error reading spec file ${specFile}:`, (error instanceof Error ? error.message : String(error)));
      }
    }

    // Check source files for covered/uncovered functions
    for (const sourceFile of sourceFiles) {
      try {
        const content = await fs.readFile(sourceFile, "utf8");
        const functions = this.extractFunctionNames(content, path.extname(sourceFile));

        for (const func of functions) {
          if (specFunctions.has(func)) {
            covered.push({ function: func, file: sourceFile });
          } else {
            uncovered.push({ function: func, file: sourceFile });
          }
        }
      } catch (error: unknown) {
        console.warn(`Error analyzing source file ${sourceFile}:`, (error instanceof Error ? error.message : String(error)));
      }
    }

    const total = covered.length + uncovered.length;
    const percentage = total > 0 ? Math.round((covered.length / total) * 100) : 0;

    return {
      covered: covered.length,
      uncovered: uncovered.length,
      percentage,
      coveredFunctions: covered,
      uncoveredFunctions: uncovered,
    };
  }

  /**
   * Extract function name from spec file
   * @param {string} content - Spec file content
   * @returns {string|null} Function name
   */
  extractFunctionNameFromSpec(content: string) {
    const match = content.match(/-- Function: (\w+)/);
    return match ? match[1] : null;
  }

  /**
   * Extract function names from source file
   * @param {string} content - Source file content
   * @param {string} extension - File extension
   * @returns {Array} Array of function names
   */
  extractFunctionNames(content: string, extension: string) {
    const functions: any[] = [];

    switch (extension) {
      case ".js":
      case ".ts":
        // JavaScript/TypeScript function extraction
        const jsMatches = content.match(/function\s+(\w+)\s*\(/g);
        if (jsMatches) {
          jsMatches.forEach((match: any) => {
            const name = match.match(/function\s+(\w+)/)[1];
            functions.push(name);
          });
        }
        break;

      case ".py":
        // Python function extraction
        const pyMatches = content.match(/def\s+(\w+)\s*\(/g);
        if (pyMatches) {
          pyMatches.forEach((match: any) => {
            const name = match.match(/def\s+(\w+)/)[1];
            functions.push(name);
          });
        }
        break;
    }

    return functions;
  }

  /**
   * Analyze user stories linked to formal guarantees
   * @returns {Array} User stories analysis
   */
  async analyzeUserStories() {
    const userStories = [];

    try {
      // Look for user story files or documentation
      const storyFiles = await this.findUserStoryFiles();

      for (const file of storyFiles) {
        try {
          const content = await fs.readFile(file, "utf8");
          const stories = this.extractUserStories(content);
          userStories.push(...stories);
        } catch (error: unknown) {
          console.warn(`Error reading user story file ${file}:`, (error instanceof Error ? error.message : String(error)));
        }
      }
    } catch (error: unknown) {
      console.warn("No user story files found");
    }

    return userStories;
  }

  /**
   * Find user story files
   * @returns {Array} Array of user story file paths
   */
  async findUserStoryFiles() {
    const storyFiles = [];
    const patterns = ["**/*.md", "**/*.txt", "**/stories/**", "**/docs/**"];

    for (const pattern of patterns) {
      try {
        const files = await fs.glob(pattern);
        storyFiles.push(...files);
      } catch (error: unknown) {
        // Pattern not found, continue
      }
    }

    return storyFiles;
  }

  /**
   * Extract user stories from content
   * @param {string} content - File content
   * @returns {Array} Array of user stories
   */
  extractUserStories(content: string) {
    const stories = [];
    const storyPattern = /(?:As a|User story|Story):\s*(.+?)(?:\n|$)/gi;

    let match;
    while ((match = storyPattern.exec(content)) !== null) {
      stories.push({
        description: match[1].trim(),
        hasFormalGuarantee: this.checkFormalGuarantee(match[1]),
        timestamp: new Date().toISOString(),
      });
    }

    return stories;
  }

  /**
   * Check if user story has formal guarantee
   * @param {string} story - User story description
   * @returns {boolean} Has formal guarantee
   */
  checkFormalGuarantee(story: string) {
    const formalKeywords = [
      "proof",
      "theorem",
      "specification",
      "formal",
      "guarantee",
      "verification",
    ];
    return formalKeywords.some((keyword: any) => story.toLowerCase().includes(keyword));
  }

  /**
   * Analyze proof status of spec files
   * @param {Array} specFiles - Array of spec file paths
   * @returns {Object} Proof analysis results
   */
  async analyzeProofStatus(specFiles: any[]) {
    const failed = [];
    const stale = [];

    for (const specFile of specFiles) {
      try {
        const result = await this.checkProofStatus(specFile);
        if (result.status === "failed") {
          failed.push({ file: specFile, error: result.error });
        } else if (result.status === "stale") {
          stale.push({ file: specFile, lastModified: result.lastModified });
        }
      } catch (error: unknown) {
        console.warn(`Error checking proof status for ${specFile}:`, (error instanceof Error ? error.message : String(error)));
      }
    }

    return { failed, stale };
  }

  /**
   * Check proof status of a single spec file
   * @param {string} specFile - Spec file path
   * @returns {Object} Proof status
   */
  async checkProofStatus(specFile: string) {
    try {
      // Try to compile the Lean4 file
      const result = await this.compileLeanFile(specFile);

      if (!result.success) {
        return {
          status: "failed",
          error: result.error,
        };
      }

      // Check if file is stale (older than 30 days)
      const stats = await fs.stat(specFile);
      const daysSinceModified = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceModified > 30) {
        return {
          status: "stale",
          lastModified: stats.mtime.toISOString(),
        };
      }

      return { status: "valid" };
    } catch (error: unknown) {
      return {
        status: "failed",
        error: (error instanceof Error ? error.message : String(error)),
      };
    }
  }

  /**
   * Compile Lean4 file
   * @param {string} specFile - Spec file path
   * @returns {Object} Compilation result
   */
  async compileLeanFile(specFile: string): Promise<{ success: boolean; error?: string; stdout?: string; stderr?: string }> {
    return new Promise((resolve) => {
      execFile("lean", ["--json", specFile], { timeout: 30000 }, (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          resolve({
            success: false,
            error: (error instanceof Error ? error.message : String(error)),
            stderr: stderr,
          });
        } else {
          resolve({
            success: true,
            stdout: stdout,
          });
        }
      });
    });
  }

  /**
   * Detect spec drift in changed functions
   * @param {Array} changedFunctions - Array of changed functions
   * @param {Object} context - Analysis context
   * @returns {Array} Drift detection results
   */
  async detectDrift(changedFunctions: any[], context: any) {
    const driftResults = [];

    for (const func of changedFunctions) {
      try {
        const drift = await this.analyzeFunctionDrift(func, context);
        if (drift.hasDrift) {
          driftResults.push(drift);
        }
      } catch (error: unknown) {
        console.warn(`Error analyzing drift for ${func.functionName}:`, (error instanceof Error ? error.message : String(error)));
      }
    }

    return driftResults;
  }

  /**
   * Analyze drift for a single function
   * @param {Object} function - Function object
   * @param {Object} context - Analysis context
   * @returns {Object} Drift analysis result
   */
  async analyzeFunctionDrift(functionData: any, context: any) {
    const { functionName, functionBody, filePath } = functionData;

    // Find existing spec for this function
    const existingSpec = await this.findExistingSpec(functionName);

    if (!existingSpec) {
      return {
        functionName,
        filePath,
        hasDrift: false,
        reason: "No existing spec found",
      };
    }

    // Analyze current implementation
    const currentAnalysis = await this.analyzeCurrentImplementation(functionBody);

    // Compare with existing spec
    const drift = this.compareWithSpec(currentAnalysis, existingSpec);

    return {
      functionName,
      filePath,
      hasDrift: drift.hasDrift,
      previousSpec: existingSpec,
      currentImplementation: currentAnalysis,
      driftDetails: drift.details,
      confidence: drift.confidence,
    };
  }

  /**
   * Find existing spec for a function
   * @param {string} functionName - Function name
   * @returns {Object|null} Existing spec
   */
  async findExistingSpec(functionName: string) {
    const specFiles = await this.findSpecFiles();

    for (const specFile of specFiles) {
      try {
        const content = await fs.readFile(specFile, "utf8");
        if (content.includes(`Function: ${functionName}`)) {
          return this.parseSpecFile(content);
        }
      } catch (error: unknown) {
        console.warn(`Error reading spec file ${specFile}:`, (error instanceof Error ? error.message : String(error)));
      }
    }

    return null;
  }

  /**
   * Parse spec file content
   * @param {string} content - Spec file content
   * @returns {Object} Parsed spec
   */
  parseSpecFile(content: string) {
    // Extract spec information from Lean4 file
    const spec = {
      preconditions: [] as string[],
      postconditions: [] as string[],
      invariants: [] as string[],
      edgeCases: [] as string[],
      confidence: 0,
    };

    // Extract confidence
    const confidenceMatch = content.match(/-- Confidence: (\d+)%/);
    if (confidenceMatch) {
      spec.confidence = parseInt(confidenceMatch[1]);
    }

    // Extract predicates from theorem
    const theoremMatch = content.match(/theorem.*?:(.*?) :=/s);
    if (theoremMatch) {
      const theorem = theoremMatch[1];
      // Parse preconditions and postconditions from theorem
      // This is a simplified parser
      const precondMatch = theorem.match(/∀.*?:(.*?)→/s);
      if (precondMatch) {
        spec.preconditions = this.parsePredicates(precondMatch[1]);
      }
    }

    return spec;
  }

  /**
   * Parse predicates from Lean4 theorem
   * @param {string} predicateString - Predicate string
   * @returns {Array} Array of predicates
   */
  parsePredicates(predicateString: string) {
    // Simplified predicate parsing
    const predicates = [];
    const parts = predicateString.split("∧");

    for (const part of parts) {
      const clean = part.trim();
      if (clean && !clean.includes("sorry")) {
        predicates.push(clean);
      }
    }

    return predicates;
  }

  /**
   * Analyze current implementation
   * @param {string} functionBody - Function body
   * @returns {Object} Implementation analysis
   */
  async analyzeCurrentImplementation(functionBody: string) {
    // This would use the same analysis as the spec generator
    // For now, return a simplified analysis
    return {
      complexity: this.calculateComplexity(functionBody),
      hasValidation: functionBody.includes("if") || functionBody.includes("throw"),
      hasReturn: functionBody.includes("return"),
      lines: functionBody.split("\n").length,
    };
  }

  /**
   * Calculate function complexity
   * @param {string} functionBody - Function body
   * @returns {number} Complexity score
   */
  calculateComplexity(functionBody: string) {
    let complexity = 1;

    // Count conditionals
    const ifMatches = functionBody.match(/if\s*\(/g);
    if (ifMatches) complexity += ifMatches.length;

    // Count loops
    const loopMatches = functionBody.match(/(for|while|do)\s*\(/g);
    if (loopMatches) complexity += loopMatches.length;

    // Count early returns
    const returnMatches = functionBody.match(/return/g);
    if (returnMatches) complexity += returnMatches.length - 1; // Subtract final return

    return complexity;
  }

  /**
   * Compare current implementation with existing spec
   * @param {Object} current - Current implementation analysis
   * @param {Object} spec - Existing spec
   * @returns {Object} Comparison result
   */
  compareWithSpec(current: any, spec: any) {
    const drift = {
      hasDrift: false,
      details: [] as string[],
      confidence: 0,
    };

    // Check if complexity has changed significantly
    if (current.complexity > spec.complexity * 1.5) {
      drift.hasDrift = true;
      drift.details.push("Function complexity increased significantly");
    }

    // Check if validation patterns have changed
    if (current.hasValidation !== spec.hasValidation) {
      drift.hasDrift = true;
      drift.details.push("Input validation patterns changed");
    }

    // Calculate drift confidence
    const changes = drift.details.length;
    drift.confidence = Math.min(100, changes * 25);

    return drift;
  }

  /**
   * Generate coverage report
   * @param {Object} analysis - Coverage analysis results
   * @returns {Object} Coverage report
   */
  generateCoverageReport(analysis: any) {
    return {
      summary: {
        totalFunctions: analysis.totalFunctions,
        coveredFunctions: analysis.coveredFunctions,
        coveragePercentage: analysis.coveragePercentage,
        userStoriesWithGuarantees: analysis.userStories.filter((s: any) => s.hasFormalGuarantee).length,
        totalUserStories: analysis.userStories.length,
        failedProofs: analysis.failedProofs.length,
        staleProofs: analysis.staleProofs.length,
      },
      details: {
        uncoveredFunctions: analysis.uncoveredFunctions,
        failedProofs: analysis.failedProofs,
        staleProofs: analysis.staleProofs,
        userStories: analysis.userStories,
      },
      recommendations: this.generateRecommendations(analysis),
      timestamp: analysis.timestamp,
    };
  }

  /**
   * Generate recommendations based on coverage analysis
   * @param {Object} analysis - Coverage analysis results
   * @returns {Array} Array of recommendations
   */
  generateRecommendations(analysis: any) {
    const recommendations = [];

    if (analysis.coveragePercentage < this.coverageThreshold) {
      recommendations.push({
        type: "coverage",
        priority: "high",
        message: `Spec coverage is ${analysis.coveragePercentage}%, below threshold of ${this.coverageThreshold}%`,
        action: "Add specifications for uncovered functions",
      });
    }

    if (analysis.failedProofs.length > 0) {
      recommendations.push({
        type: "proofs",
        priority: "high",
        message: `${analysis.failedProofs.length} proofs are failing`,
        action: "Fix failing proofs to maintain verification",
      });
    }

    if (analysis.staleProofs.length > 0) {
      recommendations.push({
        type: "maintenance",
        priority: "medium",
        message: `${analysis.staleProofs.length} proofs are stale`,
        action: "Review and update stale proofs",
      });
    }

    return recommendations;
  }
}
