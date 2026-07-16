const { LLMClient } = require("./llm-client");
const { specStore, hashImplementation } = require("./spec-store");

const DEFAULT_MAX_SPECS = 10;
const DEFAULT_CONCURRENCY = 3;

/**
 * Soft cost estimate: ~4 chars per token + fixed prompt overhead.
 * Logged per job; not a billing meter.
 */
function estimateTokens(context: any) {
  const bodyLen = (context.functionBody || "").length;
  return Math.ceil(bodyLen / 4) + 800;
}

async function mapWithConcurrency(items: any, concurrency: any, mapper: any) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export class SpecAnalyzer {
  llmClient: any;
  specCache: any;
  cacheTtlMs: any;
  lastJobCost: any;
  lastLlmUnavailable: any;
  constructor(options: any= {}) {
    this.llmClient = options.llmClient || new LLMClient();
    this.specCache = new Map();
    this.cacheTtlMs = Number(process.env.SPECSYNC_CACHE_TTL_MS || 3_600_000);
    this.lastJobCost = { estimatedTokens: 0, llmCalls: 0, cappedAt: 0 };
    /** Set when any LLM call returned the production unavailable sentinel. */
    this.lastLlmUnavailable = false;
  }

  getMaxSpecsPerPr() {
    const raw = Number(process.env.SPECSYNC_MAX_SPECS_PER_PR ?? DEFAULT_MAX_SPECS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_SPECS;
  }

  getConcurrency() {
    const raw = Number(process.env.SPECSYNC_LLM_CONCURRENCY ?? DEFAULT_CONCURRENCY);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_CONCURRENCY;
  }

  /**
   * Analyze changes and generate spec suggestions (budgeted + concurrent).
   * @param {Array} astAnalysis - AST analysis results
   * @param {Object} context - GitHub context
   * @returns {Array} Array of spec suggestions
   */
  async analyzeChanges(astAnalysis: any[], context: any) {
    const maxSpecs = this.getMaxSpecsPerPr();
    const concurrency = this.getConcurrency();
    const eligible = Array.isArray(astAnalysis) ? astAnalysis : [];
    const capped = eligible.slice(0, maxSpecs);

    this.lastJobCost = {
      estimatedTokens: 0,
      llmCalls: 0,
      cappedAt: capped.length,
      skippedByBudget: Math.max(0, eligible.length - capped.length),
    };

    const owner = context?.payload?.repository?.owner?.login;
    const repo = context?.payload?.repository?.name;
    const ref =
      context?.payload?.pull_request?.head?.sha ||
      context?.payload?.repository?.default_branch ||
      "main";

    let filtered = capped;
    if (owner && repo) {
      const kept = [];
      for (const analysis of capped) {
        try {
          const ignored = await specStore.isIgnored(
            context.octokit,
            { owner, repo, ref },
            analysis.filePath,
            analysis.functionName
          );
          if (!ignored) {
            kept.push(analysis);
          }
        } catch {
          kept.push(analysis);
        }
      }
      filtered = kept;
    }

    this.lastLlmUnavailable = false;

    const suggestions = await mapWithConcurrency(filtered, concurrency, async (analysis: any) => {
      try {
        return await this.generateSpecSuggestion(analysis, context);
      } catch (error: unknown) {
        console.error(`Error generating spec for ${analysis.functionName}:`, error);
        return null;
      }
    });

    const result = [];
    for (const suggestion of suggestions) {
      if (!suggestion) {
        continue;
      }
      if (suggestion.unavailable) {
        this.lastLlmUnavailable = true;
        continue;
      }
      result.push(suggestion);
    }

    console.log(
      `[SpecSync] soft cost: ~${this.lastJobCost.estimatedTokens} tokens, ` +
        `${this.lastJobCost.llmCalls} LLM calls, ` +
        `${result.length} specs (cap ${maxSpecs}, skipped ${this.lastJobCost.skippedByBudget})` +
        (this.lastLlmUnavailable ? ", llmUnavailable=true" : "")
    );

    return result;
  }

  /**
   * Generate a spec suggestion for a single function via the LLM client.
   * Returns { unavailable: true } when production mock policy denies fallback.
   * @param {Object} analysis - AST analysis for a function
   * @param {Object} context - GitHub context
   * @returns {Object|null} Spec suggestion or unavailable sentinel
   */
  async generateSpecSuggestion(analysis: any, context: any) {
    const { functionName, functionBody, ast, filePath, lineNumber } = analysis;

    const cacheKey = this.buildCacheKey(context, filePath, functionName);
    const cached = this.getCacheEntry(cacheKey);
    if (cached) {
      return cached;
    }

    const llmContext = this.prepareLLMContext(analysis);
    this.lastJobCost.estimatedTokens += estimateTokens(llmContext);
    this.lastJobCost.llmCalls += 1;

    const spec = await this.callLLM(llmContext);

    if (spec?.unavailable) {
      return { unavailable: true, reason: spec.reason || "llm_unavailable" };
    }

    const suggestion = {
      functionName,
      filePath,
      lineNumber,
      side: analysis.side === "LEFT" ? "LEFT" : "RIGHT",
      preconditions: spec.preconditions || [],
      postconditions: spec.postconditions || [],
      invariants: spec.invariants || [],
      edgeCases: spec.edgeCases || [],
      confidence: spec.confidence || 0,
      reasoning: spec.reasoning || "",
      isMock: Boolean(spec.isMock),
      implementationHash: hashImplementation(this.cleanFunctionBody(functionBody || "")),
    };

    this.setCacheEntry(cacheKey, suggestion);
    return suggestion;
  }

  buildCacheKey(context: any, filePath: any, functionName: any) {
    const repo = context?.payload?.repository?.full_name || "local";
    const sha =
      context?.payload?.pull_request?.head?.sha ||
      context?.payload?.after ||
      "unknown";
    return `${repo}@${sha}:${filePath}:${functionName}`;
  }

  getCacheEntry(key: any) {
    const entry = this.specCache.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.specCache.delete(key);
      return null;
    }
    return entry.value;
  }

  setCacheEntry(key: any, value: any) {
    this.specCache.set(key, { value, expiresAt: Date.now() + this.cacheTtlMs });
  }

  /**
   * Prepare context for LLM analysis
   * @param {Object} analysis - AST analysis
   * @returns {Object} LLM context
   */
  prepareLLMContext(analysis: any) {
    const { functionName, functionBody, ast, comments } = analysis;

    return {
      functionName,
      functionBody: this.cleanFunctionBody(functionBody),
      inputTypes: ast.inputTypes,
      outputType: ast.outputType,
      conditionalGuards: ast.conditionalGuards,
      loops: ast.loops,
      branching: ast.branching,
      earlyReturns: ast.earlyReturns,
      controlFlow: ast.controlFlow,
      complexity: ast.complexity,
      comments: (comments || []).map((c: any) => c.text).join("\n"),
      language: this.getLanguageFromPath(analysis.filePath),
    };
  }

  /**
   * Clean function body for LLM analysis
   * @param {string} functionBody - Raw function body
   * @returns {string} Cleaned function body
   */
  cleanFunctionBody(functionBody: string) {
    return functionBody
      .split("\n")
      .map((line: any) => line.replace(/^(\+|\-)?\s*/, ""))
      .filter((line: any) => line.trim())
      .join("\n");
  }

  /**
   * Get language from file path.
   * Only tree-sitter-backed languages are named; others return "Unknown".
   * @param {string} filePath - File path
   * @returns {string} Language name
   */
  getLanguageFromPath(filePath: string) {
    const { getLanguageNameFromPath } = require("./ast-extractor");
    return getLanguageNameFromPath(filePath);
  }

  /**
   * Call LLM to generate spec
   * @param {Object} context - LLM context
   * @returns {Object} Generated spec
   */
  async callLLM(context: any) {
    return await this.llmClient.generateSpec(context);
  }

  /**
   * Detect spec drift: compare current implementations to accepted `.specsync/` snapshots.
   * @param {Array} commits - Array of commits (push payload)
   * @param {Object} context - GitHub context
   * @returns {Array} DriftFinding[]
   */
  async detectDrift(commits: any[], context: any) {
    const { payload } = context;
    const repository = payload.repository;
    const owner = repository.owner.login;
    const repo = repository.name;
    const ref = (payload.ref || "").replace(/^refs\/heads\//, "") || "main";
    const headSha = payload.after || ref;

    const stored = await specStore.listStoredSpecs(context.octokit, {
      owner,
      repo,
      ref: headSha,
    });

    if (stored.length === 0) {
      return [];
    }

    const changedPaths = new Set();
    for (const commit of commits || []) {
      for (const f of commit.added || []) {
        changedPaths.add(f);
      }
      for (const f of commit.modified || []) {
        changedPaths.add(f);
      }
      for (const f of commit.removed || []) {
        changedPaths.add(f);
      }
    }

    // If commit file lists are empty (API often omits them), still check all stored specs
    // against current content when we can resolve file content.
    const candidates =
      changedPaths.size > 0
        ? stored.filter((s: any) => changedPaths.has(s.filePath))
        : stored;

    const driftResults = [];

    for (const spec of candidates) {
      if (changedPaths.size > 0 && changedPaths.has(spec.filePath) === false) {
        continue;
      }

      // Removed file → drift
      if (changedPaths.has(spec.filePath)) {
        const removed = (commits || []).some((c: any) => (c.removed || []).includes(spec.filePath));
        if (removed) {
          driftResults.push({
            functionName: spec.functionName,
            filePath: spec.filePath,
            reason: "File removed but accepted spec still exists",
            previousSpec: JSON.stringify(spec.contract),
            currentImplementation: "(file deleted)",
            confidence: 1,
          });
          continue;
        }
      }

      let fileContent = "";
      try {
        const response = await context.octokit.repos.getContent({
          owner,
          repo,
          path: spec.filePath,
          ref: headSha,
        });
        if (response.data.content) {
          fileContent = Buffer.from(response.data.content, "base64").toString("utf8");
        }
      } catch (error: unknown) {
        const status = (error as { status?: number })?.status;
        if (status === 404) {
          driftResults.push({
            functionName: spec.functionName,
            filePath: spec.filePath,
            reason: "Spec target file missing at head",
            previousSpec: JSON.stringify(spec.contract),
            currentImplementation: "(missing)",
            confidence: 1,
          });
          continue;
        }
        console.error(`Drift: failed to read ${spec.filePath}:`, error instanceof Error ? (error instanceof Error ? error.message : String(error)) : String(error));
        continue;
      }

      const extracted = this.extractFunctionBody(fileContent, spec.functionName);
      if (!extracted) {
        driftResults.push({
          functionName: spec.functionName,
          filePath: spec.filePath,
          reason: "Function no longer found in file (signature removed or renamed)",
          previousSpec: JSON.stringify(spec.contract),
          currentImplementation: "(not found)",
          confidence: 0.9,
        });
        continue;
      }

      const currentHash = hashImplementation(extracted);
      if (spec.implementationHash && spec.implementationHash !== currentHash) {
        driftResults.push({
          functionName: spec.functionName,
          filePath: spec.filePath,
          reason: "Implementation hash differs from accepted snapshot",
          previousSpec: `hash:${spec.implementationHash.slice(0, 12)}…`,
          currentImplementation: `hash:${currentHash.slice(0, 12)}…`,
          confidence: 0.95,
        });
      }
    }

    return driftResults;
  }

  /**
   * Best-effort extract function body text for hashing.
   * @param {string} fileContent
   * @param {string} functionName
   * @returns {string|null}
   */
  extractFunctionBody(fileContent: string, functionName: string) {
    const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(
        `(?:async\\s+)?function\\s+${escaped}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`,
        "m"
      ),
      new RegExp(
        `(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*\\{([\\s\\S]*?)\\n\\}`,
        "m"
      ),
      new RegExp(`${escaped}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`, "m"),
      new RegExp(`def\\s+${escaped}\\s*\\([^)]*\\)\\s*:([\\s\\S]*?)(?=\\ndef\\s|\\nclass\\s|$)`, "m"),
    ];

    for (const pattern of patterns) {
      const match = fileContent.match(pattern);
      if (match) {
        return match[0];
      }
    }

    // Fallback: if name appears, hash surrounding window
    const idx = fileContent.indexOf(functionName);
    if (idx >= 0) {
      return fileContent.slice(idx, Math.min(fileContent.length, idx + 2000));
    }
    return null;
  }

  /**
   * Handle comment commands
   * @param {Object} context - GitHub context
   * @param {Object} comment - Comment object
   */
  async handleCommentCommand(context: any, comment: any) {
    const { body } = comment;

    if (body.includes("/specsync accept")) {
      await this.handleAcceptCommand(context, comment);
    } else if (body.includes("/specsync edit")) {
      await this.handleEditCommand(context, comment);
    } else if (body.includes("/specsync ignore")) {
      await this.handleIgnoreCommand(context, comment);
    } else if (body.includes("/specsync review")) {
      await this.handleReviewCommand(context, comment);
    }
  }

  async handleAcceptCommand(context: any, comment: any) {
    const { payload } = context;
    const { repository } = payload;
    const issueNumber =
      comment.issue_number || payload.issue?.number || payload.pull_request?.number;

    await context.octokit.issues.createComment({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: issueNumber,
      body: `✅ **SpecSync**: Use \`/specsync accept\` on a SpecSync review comment to persist the spec under \`.specsync/\`.`,
    });
  }

  async handleEditCommand(context: any, comment: any) {
    const { payload } = context;
    const { repository } = payload;
    const issueNumber =
      comment.issue_number || payload.issue?.number || payload.pull_request?.number;

    await context.octokit.issues.createComment({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: issueNumber,
      body: `✏️ **SpecSync**: Edit via comment command:

\`\`\`
/specsync edit apply
function: <name>
file: <path>
preconditions:
- ...
postconditions:
- ...
invariants:
- ...
reasoning: ...
\`\`\``,
    });
  }

  async handleIgnoreCommand(context: any, comment: any) {
    const { payload } = context;
    const { repository } = payload;
    const issueNumber =
      comment.issue_number || payload.issue?.number || payload.pull_request?.number;

    await context.octokit.issues.createComment({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: issueNumber,
      body: `❌ **SpecSync**: Use \`/specsync ignore\` on a SpecSync suggestion comment to record it in \`.specsync/ignores.json\`.`,
    });
  }

  async handleReviewCommand(context: any, comment: any) {
    const { payload } = context;
    const { repository } = payload;
    const issueNumber =
      comment.issue_number || payload.issue?.number || payload.pull_request?.number;

    await context.octokit.issues.createComment({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: issueNumber,
      body: `🔍 **SpecSync**: Manual review noted. Update or accept the specification when ready.`,
    });
  }

  /**
   * Store spec via SpecStore (GitHub Contents API). Prefer SpecStore directly.
   */
  async storeSpec(functionKey: any, spec: any, context: any) {
    if (!context?.octokit) {
      console.log(`Storing spec for ${functionKey} (no octokit — skipped):`, spec?.functionName);
      return null;
    }
    const { repository, pull_request } = context.payload;
    const branch = pull_request?.head?.ref;
    if (!branch) {
      throw new Error("storeSpec requires pull_request.head.ref");
    }
    const stored = {
      version: 1,
      functionName: spec.functionName,
      filePath: spec.filePath,
      lineNumber: spec.lineNumber,
      acceptedAt: new Date().toISOString(),
      pr: pull_request.number,
      sha: pull_request.head.sha,
      confidence: spec.confidence,
      contract: {
        preconditions: spec.preconditions || [],
        postconditions: spec.postconditions || [],
        invariants: spec.invariants || [],
        edgeCases: spec.edgeCases || [],
        reasoning: spec.reasoning || "",
      },
      implementationHash: spec.implementationHash,
    };
    return specStore.storeSpec(
      context.octokit,
      { owner: repository.owner.login, repo: repository.name, ref: branch },
      stored
    );
  }

  /**
   * Retrieve spec from `.specsync/` store.
   */
  async retrieveSpec(functionKey: any, context: any, filePath: any, functionName: any) {
    if (!context?.octokit) {
      console.log(`Retrieving spec for ${functionKey}`);
      return null;
    }
    const { repository, pull_request } = context.payload;
    const ref = pull_request?.head?.sha || repository.default_branch || "main";
    const name = functionName || functionKey.split(":").pop();
    const path = filePath || "";
    if (!path || !name) {
      return null;
    }
    return specStore.retrieveSpec(
      context.octokit,
      { owner: repository.owner.login, repo: repository.name, ref },
      path,
      name
    );
  }
}
