// @ts-nocheck
const Parser = require("tree-sitter");
const fs = require("fs-extra");
const path = require("path");

// Import language parsers
const JavaScript = require("tree-sitter-javascript");
const TypeScript = require("tree-sitter-typescript");
const Python = require("tree-sitter-python");
const Java = require("tree-sitter-java");

const Rust = require("tree-sitter-rust");

export class ASTExtractor {
  constructor() {
    this.parsers = {
      ".js": JavaScript,
      ".jsx": JavaScript,
      ".ts": TypeScript,
      ".tsx": TypeScript,
      ".py": Python,
      ".java": Java,

      ".rs": Rust,
    };
  }

  /**
   * Extract AST information for changed functions
   * @param {Array} functionChanges - Array of function changes from DiffParser
   * @param {Object} context - GitHub context
   * @returns {Array} AST analysis results
   */
  async extractAST(functionChanges, context) {
    const astResults = [];

    for (const change of functionChanges) {
      try {
        const astAnalysis = await this.analyzeFunction(change, context);
        astResults.push(astAnalysis);
      } catch (error) {
        console.error(`Error analyzing function ${change.functionName}:`, error);
        // Continue with other functions
      }
    }

    return astResults;
  }

  /**
   * Analyze a single function's AST
   * @param {Object} change - Function change object
   * @param {Object} context - GitHub context
   * @returns {Object} AST analysis result
   */
  async analyzeFunction(change, context) {
    const { filePath, functionName, functionBody } = change;

    // Get the full file content to parse
    const fileContent = await this.getFileContent(filePath, context);
    const language = this.getLanguageFromPath(filePath);

    if (!language) {
      return this.createBasicAnalysis(change);
    }

    const parser = new Parser();
    parser.setLanguage(language);

    try {
      const tree = parser.parse(fileContent);
      const functionNode = this.findFunctionNode(tree.rootNode, functionName);

      if (!functionNode) {
        return this.createBasicAnalysis(change);
      }

      return {
        ...change,
        ast: {
          inputTypes: this.extractInputTypes(functionNode, language),
          outputType: this.extractOutputType(functionNode, language),
          conditionalGuards: this.extractConditionalGuards(functionNode),
          loops: this.extractLoops(functionNode),
          branching: this.extractBranching(functionNode),
          earlyReturns: this.extractEarlyReturns(functionNode),
          controlFlow: this.extractControlFlow(functionNode),
          complexity: this.calculateComplexity(functionNode),
        },
      };
    } catch (error) {
      console.error(`Error parsing AST for ${functionName}:`, error);
      return this.createBasicAnalysis(change);
    }
  }

  /**
   * Get file content from GitHub
   * @param {string} filePath - Path to file
   * @param {Object} context - GitHub context
   * @returns {string} File content
   */
  async getFileContent(filePath, context) {
    try {
      const { payload } = context;
      const { repository } = payload;

      const response = await context.octokit.repos.getContent({
        owner: repository.owner.login,
        repo: repository.name,
        path: filePath,
        ref: payload.pull_request?.head?.sha || "main",
      });

      // Decode content if it's base64 encoded
      if (response.data.content) {
        return Buffer.from(response.data.content, "base64").toString("utf8");
      }

      return "";
    } catch (error) {
      console.error(`Error getting file content for ${filePath}:`, error);
      return "";
    }
  }

  /**
   * Get language parser from file path
   * @param {string} filePath - File path
   * @returns {Object|null} Language parser
   */
  getLanguageFromPath(filePath) {
    const ext = path.extname(filePath);
    return this.parsers[ext] || null;
  }

  /**
   * Find function node in AST
   * @param {Object} rootNode - Root AST node
   * @param {string} functionName - Function name to find
   * @returns {Object|null} Function node
   */
  findFunctionNode(rootNode, functionName) {
    const functionNodes = this.findNodesByType(rootNode, [
      "function_declaration",
      "method_definition",
      "arrow_function",
      "function_expression",
      "function_definition",
    ]);

    for (const node of functionNodes) {
      const name = this.getFunctionName(node);
      if (name === functionName) {
        return node;
      }
    }

    return null;
  }

  /**
   * Find nodes by type in AST
   * @param {Object} node - AST node
   * @param {Array} types - Array of node types to find
   * @returns {Array} Array of matching nodes
   */
  findNodesByType(node, types) {
    const results = [];

    if (types.includes(node.type)) {
      results.push(node);
    }

    for (const child of node.children) {
      results.push(...this.findNodesByType(child, types));
    }

    return results;
  }

  /**
   * Get function name from node
   * @param {Object} node - Function node
   * @returns {string} Function name
   */
  getFunctionName(node) {
    // Look for name in different possible locations
    const nameNode =
      node.childForFieldName("name") ||
      node.childForFieldName("identifier") ||
      node.children.find((child) => child.type === "identifier");

    return nameNode ? nameNode.text : "";
  }

  /**
   * Extract input types from function node
   * @param {Object} functionNode - Function AST node
   * @param {Object} language - Language parser
   * @returns {Array} Array of input types
   */
  extractInputTypes(functionNode, language) {
    const parameters = [];
    const paramList =
      functionNode.childForFieldName("parameters") ||
      functionNode.children.find((child) => child.type === "formal_parameters");

    if (!paramList) return parameters;

    for (const param of paramList.children) {
      if (param.type === "parameter" || param.type === "formal_parameter") {
        const name = this.getParameterName(param);
        const type = this.getParameterType(param);

        parameters.push({
          name,
          type,
          required: !this.isOptionalParameter(param),
        });
      }
    }

    return parameters;
  }

  /**
   * Get parameter name from parameter node
   * @param {Object} paramNode - Parameter node
   * @returns {string} Parameter name
   */
  getParameterName(paramNode) {
    const nameNode =
      paramNode.childForFieldName("name") ||
      paramNode.children.find((child) => child.type === "identifier");

    return nameNode ? nameNode.text : "";
  }

  /**
   * Get parameter type from parameter node
   * @param {Object} paramNode - Parameter node
   * @returns {string} Parameter type
   */
  getParameterType(paramNode) {
    const typeNode =
      paramNode.childForFieldName("type") ||
      paramNode.children.find(
        (child) => child.type === "type_annotation" || child.type === "type_identifier"
      );

    return typeNode ? typeNode.text : "any";
  }

  /**
   * Check if parameter is optional
   * @param {Object} paramNode - Parameter node
   * @returns {boolean} Is optional
   */
  isOptionalParameter(paramNode) {
    return (
      paramNode.text.includes("?") ||
      paramNode.text.includes("default") ||
      paramNode.text.includes("=")
    );
  }

  /**
   * Extract output type from function node
   * @param {Object} functionNode - Function AST node
   * @param {Object} language - Language parser
   * @returns {string} Output type
   */
  extractOutputType(functionNode, language) {
    const returnTypeNode =
      functionNode.childForFieldName("return_type") ||
      functionNode.children.find(
        (child) => child.type === "type_annotation" || child.type === "return_type"
      );

    return returnTypeNode ? returnTypeNode.text : "any";
  }

  /**
   * Extract conditional guards from function
   * @param {Object} functionNode - Function AST node
   * @returns {Array} Array of conditional guards
   */
  extractConditionalGuards(functionNode) {
    const guards = [];
    const ifStatements = this.findNodesByType(functionNode, ["if_statement"]);

    for (const ifStmt of ifStatements) {
      const condition = ifStmt.childForFieldName("condition");
      if (condition) {
        guards.push({
          type: "if",
          condition: condition.text,
          lineNumber: condition.startPosition.row,
        });
      }
    }

    return guards;
  }

  /**
   * Extract loops from function
   * @param {Object} functionNode - Function AST node
   * @returns {Array} Array of loops
   */
  extractLoops(functionNode) {
    const loops = [];
    const loopTypes = ["for_statement", "while_statement", "do_statement", "for_in_statement"];

    for (const loopType of loopTypes) {
      const loopNodes = this.findNodesByType(functionNode, [loopType]);

      for (const loop of loopNodes) {
        loops.push({
          type: loopType,
          condition: this.getLoopCondition(loop),
          lineNumber: loop.startPosition.row,
        });
      }
    }

    return loops;
  }

  /**
   * Get loop condition from loop node
   * @param {Object} loopNode - Loop AST node
   * @returns {string} Loop condition
   */
  getLoopCondition(loopNode) {
    const condition =
      loopNode.childForFieldName("condition") ||
      loopNode.children.find((child) => child.type === "condition" || child.type === "test");

    return condition ? condition.text : "";
  }

  /**
   * Extract branching logic from function
   * @param {Object} functionNode - Function AST node
   * @returns {Array} Array of branching statements
   */
  extractBranching(functionNode) {
    const branching = [];
    const branchTypes = ["if_statement", "switch_statement", "conditional_expression"];

    for (const branchType of branchTypes) {
      const branchNodes = this.findNodesByType(functionNode, [branchType]);

      for (const branch of branchNodes) {
        branching.push({
          type: branchType,
          condition: this.getBranchCondition(branch),
          lineNumber: branch.startPosition.row,
        });
      }
    }

    return branching;
  }

  /**
   * Get branch condition from branch node
   * @param {Object} branchNode - Branch AST node
   * @returns {string} Branch condition
   */
  getBranchCondition(branchNode) {
    const condition =
      branchNode.childForFieldName("condition") ||
      branchNode.childForFieldName("test") ||
      branchNode.children.find((child) => child.type === "condition" || child.type === "test");

    return condition ? condition.text : "";
  }

  /**
   * Extract early returns from function
   * @param {Object} functionNode - Function AST node
   * @returns {Array} Array of early returns
   */
  extractEarlyReturns(functionNode) {
    const earlyReturns = [];
    const returnStatements = this.findNodesByType(functionNode, ["return_statement"]);

    for (const returnStmt of returnStatements) {
      // Check if this is not the last statement (early return)
      const parent = returnStmt.parent;
      const siblings = parent ? parent.children : [];
      const returnIndex = siblings.indexOf(returnStmt);

      if (returnIndex < siblings.length - 1) {
        earlyReturns.push({
          value: this.getReturnValue(returnStmt),
          lineNumber: returnStmt.startPosition.row,
        });
      }
    }

    return earlyReturns;
  }

  /**
   * Get return value from return statement
   * @param {Object} returnNode - Return AST node
   * @returns {string} Return value
   */
  getReturnValue(returnNode) {
    const value =
      returnNode.childForFieldName("value") ||
      returnNode.children.find(
        (child) => child.type === "expression" || child.type === "identifier"
      );

    return value ? value.text : "";
  }

  /**
   * Extract control flow information
   * @param {Object} functionNode - Function AST node
   * @returns {Object} Control flow analysis
   */
  extractControlFlow(functionNode) {
    return {
      hasEarlyReturns: this.extractEarlyReturns(functionNode).length > 0,
      hasLoops: this.extractLoops(functionNode).length > 0,
      hasConditionals: this.extractConditionalGuards(functionNode).length > 0,
      hasBranching: this.extractBranching(functionNode).length > 0,
      maxDepth: this.calculateMaxDepth(functionNode),
    };
  }

  /**
   * Calculate function complexity
   * @param {Object} functionNode - Function AST node
   * @returns {number} Complexity score
   */
  calculateComplexity(functionNode) {
    let complexity = 1; // Base complexity

    // Add complexity for each conditional
    complexity += this.extractConditionalGuards(functionNode).length;

    // Add complexity for each loop
    complexity += this.extractLoops(functionNode).length;

    // Add complexity for each early return
    complexity += this.extractEarlyReturns(functionNode).length;

    return complexity;
  }

  /**
   * Calculate maximum nesting depth
   * @param {Object} node - AST node
   * @returns {number} Maximum depth
   */
  calculateMaxDepth(node, currentDepth = 0) {
    let maxDepth = currentDepth;

    for (const child of node.children) {
      const childDepth = this.calculateMaxDepth(child, currentDepth + 1);
      maxDepth = Math.max(maxDepth, childDepth);
    }

    return maxDepth;
  }

  /**
   * Create basic analysis when AST parsing fails
   * @param {Object} change - Function change object
   * @returns {Object} Basic analysis
   */
  createBasicAnalysis(change) {
    return {
      ...change,
      ast: {
        inputTypes: [],
        outputType: "any",
        conditionalGuards: [],
        loops: [],
        branching: [],
        earlyReturns: [],
        controlFlow: {
          hasEarlyReturns: false,
          hasLoops: false,
          hasConditionals: false,
          hasBranching: false,
          maxDepth: 1,
        },
        complexity: 1,
      },
    };
  }
}
