const { Octokit } = require("@octokit/rest");
const { normalizeConfidence } = require("./types");
const { Lean4Generator } = require("./lean4-generator");
const {
  specStore,
  suggestionToStoredSpec,
  buildSpecStorePath,
  buildLeanStorePath,
} = require("./spec-store");
const { incr } = require("./metrics");
const { commandRateLimiter } = require("./command-rate-limit");

/** Escape HTML special chars in comment bodies (GitHub still renders limited HTML). */
function escapeHtml(value: any) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const MUTATING_COMMANDS = ["/specsync accept", "/specsync ignore", "/specsync edit"];

function resolveCommentSide(suggestion: { side?: string; changeType?: string }): "LEFT" | "RIGHT" {
  if (suggestion.side === "LEFT" || suggestion.side === "RIGHT") {
    return suggestion.side;
  }
  if (suggestion.changeType === "removed" || suggestion.changeType === "-") {
    return "LEFT";
  }
  return "RIGHT";
}

export class GitHubUI {
  octokit: any;
  webhookSecret: any;
  leanGenerator: any;
  constructor() {
    this.octokit = null;
    this.webhookSecret = process.env.WEBHOOK_SECRET;
    this.leanGenerator = new Lean4Generator();
  }

  /**
   * Initialize GitHub client for local CLI/demo only.
   * Production handlers must use context.octokit (installation auth).
   * @param {string} token - GitHub token
   */
  initialize(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  /**
   * Resolve Octokit: prefer per-request context.octokit, fall back to CLI initialize().
   * @param {Object} context - Probot/GitHub context
   * @returns {Object} Octokit instance
   */
  getOctokit(context: any) {
    if (context?.octokit) {
      return context.octokit;
    }
    if (this.octokit) {
      return this.octokit;
    }
    throw new Error("Octokit not available: pass context.octokit or call initialize() for CLI/demo");
  }

  /**
   * Prefer one review with multiple comments over N sequential createReviewComment calls.
   * Falls back to per-comment createReviewComment if createReview fails.
   */
  async createSpecComments(context: any, specSuggestions: any) {
    if (!specSuggestions || specSuggestions.length === 0) {
      return [];
    }

    const { payload } = context;
    const { pull_request, repository } = payload;
    const octokit = this.getOctokit(context);

    const comments = specSuggestions.map((suggestion: any) => ({
      path: suggestion.filePath,
      line: suggestion.lineNumber,
      side: resolveCommentSide(suggestion),
      body: this.formatSpecComment(suggestion),
    }));

    try {
      const review = await octokit.pulls.createReview({
        owner: repository.owner.login,
        repo: repository.name,
        pull_number: pull_request.number,
        commit_id: pull_request.head.sha,
        event: "COMMENT",
        comments,
      });
      return [review];
    } catch (error: unknown) {
      console.warn("createReview failed; falling back to individual comments:", (error instanceof Error ? error.message : String(error)));
      const results = [];
      for (const suggestion of specSuggestions) {
        results.push(await this.createSpecComment(context, suggestion));
      }
      return results;
    }
  }

  /**
   * Enhanced Prompt 1.1 — Suggested Spec Comments (LLM-generated)
   * Goal: Auto-insert spec suggestions as native review comments on new/updated PRs.
   * Inputs: PR diff, surrounding code, existing tests.
   * Explicit Outputs: One GitHub review comment per suggestion, formatted with confidence and rationale
   */
  async createSpecComment(context: any, specSuggestion: any) {
    const { payload } = context;
    const { pull_request, repository } = payload;
    const octokit = this.getOctokit(context);

    const commentBody = this.formatSpecComment(specSuggestion);

    const reviewComment = await octokit.pulls.createReviewComment({
      owner: repository.owner.login,
      repo: repository.name,
      pull_number: pull_request.number,
      commit_id: pull_request.head.sha,
      path: specSuggestion.filePath,
      line: specSuggestion.lineNumber,
      side: resolveCommentSide(specSuggestion),
      body: commentBody,
    });

    return reviewComment;
  }

  /**
   * Enhanced format spec comment with confidence transparency and action buttons
   * Confidence must be in [0, 1]; displayed as a percentage.
   * @param {Object} specSuggestion - Spec suggestion object
   * @returns {string} Formatted comment body
   */
  formatSpecComment(specSuggestion: any) {
    const functionName = escapeHtml(specSuggestion.functionName);
    const filePath = escapeHtml(specSuggestion.filePath);
    const preconditions = (specSuggestion.preconditions || []).map(escapeHtml);
    const postconditions = (specSuggestion.postconditions || []).map(escapeHtml);
    const invariants = (specSuggestion.invariants || []).map(escapeHtml);
    const reasoning = escapeHtml(specSuggestion.reasoning);
    const confidence = normalizeConfidence(specSuggestion.confidence, 0);
    const mockBadge = specSuggestion.isMock ? " **[MOCK]**" : "";

    const confidenceEmoji = confidence >= 0.8 ? "🟢" : confidence >= 0.6 ? "🟡" : "🔴";
    const confidenceText = confidence >= 0.8 ? "High" : confidence >= 0.6 ? "Medium" : "Low";
    const confidencePercent = Math.round(confidence * 100);

    const footer = specSuggestion.isMock
      ? "*Generated by SpecSync [MOCK] fallback (not a live LLM)*"
      : "*Generated by SpecSync AI*";

    return `## 🤖 SpecSync: Specification for \`${functionName}\`${mockBadge}

**File:** \`${filePath}\` (line ${escapeHtml(specSuggestion.lineNumber)})
**Confidence:** ${confidenceEmoji} ${confidenceText} (${confidencePercent}%)

### 📋 Preconditions
${preconditions.map((pre: any) => `- ${pre}`).join("\n")}

### ✅ Postconditions
${postconditions.map((post: any) => `- ${post}`).join("\n")}

### 🔒 Invariants
${invariants.map((inv: any) => `- ${inv}`).join("\n")}

### 💭 Reasoning
${reasoning}

---

**Actions:**
- ✅ \`/specsync accept\` - Accept this specification
- ✏️ \`/specsync edit\` - Edit the specification (reply with \`/specsync edit apply\` block)
- ❌ \`/specsync ignore\` - Ignore this suggestion
- 🔍 \`/specsync review\` - Request manual review

${footer}`;
  }

  /**
   * Post a single PR comment when the LLM is unavailable and mock specs are denied.
   * @param {Object} context - GitHub context
   */
  async createLlmUnavailableComment(context: any) {
    const { payload } = context;
    const { pull_request, repository } = payload;
    const octokit = this.getOctokit(context);

    return octokit.issues.createComment({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: pull_request.number,
      body: `⚠️ **SpecSync**: SpecSync could not generate specs (LLM unavailable).`,
    });
  }

  /**
   * Coverage check from real `.specsync/` numbers (no fabricated constants).
   */
  async createCoverageCheck(context: any, proofStatus: any) {
    const { payload } = context;
    const { pull_request, repository } = payload;
    const octokit = this.getOctokit(context);
    const threshold = Number(process.env.COVERAGE_THRESHOLD || 70);
    const coverage = Number(proofStatus.coverage) || 0;

    let conclusion = "neutral";
    if (proofStatus.totalFunctions === 0) {
      conclusion = "neutral";
    } else if (coverage >= threshold) {
      conclusion = "success";
    } else {
      conclusion = "failure";
    }

    const checkRun = await octokit.checks.create({
      owner: repository.owner.login,
      repo: repository.name,
      name: "SpecSync Coverage",
      head_sha: pull_request.head.sha,
      status: "completed",
      conclusion,
      output: {
        title: `Spec Coverage: ${coverage}%`,
        summary: this.generateCoverageSummary(proofStatus),
        text: this.generateCoverageDetails(proofStatus),
      },
      annotations: this.generateCoverageAnnotations(proofStatus).slice(0, 50),
    });

    return checkRun;
  }

  /**
   * Create a check run on an arbitrary commit (push / default branch).
   */
  async createCommitCheck(
    context: any,
    {
      headSha,
      name,
      conclusion,
      title,
      summary,
      text = undefined,
    }: {
      headSha: string;
      name: string;
      conclusion: string;
      title: string;
      summary: string;
      text?: string;
    }
  ) {
    const { payload } = context;
    const { repository } = payload;
    const octokit = this.getOctokit(context);

    return octokit.checks.create({
      owner: repository.owner.login,
      repo: repository.name,
      name,
      head_sha: headSha,
      status: "completed",
      conclusion,
      output: { title, summary, text: text || summary },
    });
  }

  generateCoverageAnnotations(proofStatus: any) {
    const annotations: any[] = [];

    (proofStatus.functions || []).forEach((func: any) => {
      const statusEmoji = func.hasProof ? "🟢" : "🔴";
      const statusText = func.hasProof ? "Accepted spec in .specsync/" : "No accepted spec";

      annotations.push({
        path: func.filePath,
        start_line: func.line || 1,
        end_line: func.line || 1,
        annotation_level: func.hasProof ? "notice" : "failure",
        message: `${statusEmoji} ${statusText}`,
        title: func.hasProof ? "Spec Accepted" : "Missing Spec",
        raw_details: this.generateTooltipContent(func),
      });
    });

    return annotations;
  }

  generateTooltipContent(func: any) {
    if (func.hasProof) {
      return `**Accepted Specification**
- Theorem: ${func.theorem || "N/A"}
- Last verified: ${func.lastVerified || "Unknown"}
- [View Proof](${this.generateProofUrl(func)})`;
    }
    return `**Missing Specification**
- No accepted \`.specsync/\` entry
- [Add Specification](${this.generateAddSpecUrl(func)})`;
  }

  generateProofUrl(func: any) {
    return `${process.env.DASHBOARD_URL || ""}/audit/${func.name}`;
  }

  generateAddSpecUrl(func: any) {
    return `${process.env.DASHBOARD_URL || ""}/specs/add?function=${func.name}&file=${func.filePath}&line=${func.line}`;
  }

  /**
   * PR-only proof/drift summary comment. Do not call from push handlers.
   */
  async createProofCheckComment(context: any, proofResults: any) {
    const { payload } = context;
    const pullRequest = payload.pull_request;
    if (!pullRequest?.number) {
      throw new Error("createProofCheckComment requires a pull_request in context");
    }
    const { repository } = payload;
    const octokit = this.getOctokit(context);

    const commentBody = this.formatProofCheckComment(proofResults);

    return octokit.issues.createComment({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: pullRequest.number,
      body: commentBody,
    });
  }

  formatProofCheckComment(proofResults: any) {
    const { functions, drift, coverage } = proofResults;

    let comment = `## 🔍 ProofCheck Results

<details>
<summary>📊 Coverage Summary (${coverage}%)</summary>

| Function | Status | Proof | Drift |
|----------|--------|-------|-------|
`;

    functions.forEach((func: any) => {
      const status = func.proofValid ? "✅" : "❌";
      const driftStatus = func.hasDrift ? "⚠️" : "✅";
      comment += `| \`${func.name}\` | ${status} | ${func.theorem || "N/A"} | ${driftStatus} |\n`;
    });

    comment += `\n</details>\n\n`;

    if (drift.length > 0) {
      comment += `<details>
<summary>⚠️ Drift Detection (${drift.length} functions)</summary>

`;
      drift.forEach((d: any) => {
        comment += `### \`${d.functionName}\`
**Reason:** ${d.reason}
**Previous:** ${d.previousSpec}
**Current:** ${d.currentImplementation}

`;
      });
      comment += `</details>\n\n`;
    }

    comment += `**Actions:**
- 🔄 [Prove Now](${this.generateProveNowUrl(proofResults)}) - Re-run Lean proofs
- 📊 [View Dashboard](${this.generateDashboardUrl(proofResults)}) - Detailed analysis
- 📋 [Export Report](${this.generateExportUrl(proofResults)}) - Download proof artifacts

*Generated by SpecSync ProofCheck*`;

    return comment;
  }

  generateCoverageSummary(proofStatus: any) {
    const { coverage, totalFunctions, coveredFunctions, failedProofs, formula } = proofStatus;
    const threshold = Number(process.env.COVERAGE_THRESHOLD || 70);

    return `## SpecSync Coverage Report

- **Coverage:** ${coverage}%
- **Functions:** ${coveredFunctions}/${totalFunctions} with accepted \`.specsync/\` specs
- **Failed Proofs:** ${failedProofs ?? 0}
- **Formula:** ${formula || "accepted specs covering changed functions / eligible changed functions × 100"}

${
      totalFunctions === 0
        ? "ℹ️ No eligible changed functions in this PR"
        : coverage >= threshold
          ? "✅ Coverage threshold met"
          : "❌ Coverage below threshold"
    }`;
  }

  generateCoverageDetails(proofStatus: any) {
    const { functions, proofs } = proofStatus;

    let details = "## Function Coverage\n\n";

    (functions || []).forEach((func: any) => {
      const status = func.hasProof ? "🟢" : "🔴";
      details += `${status} \`${func.name}\` - ${func.filePath}:${func.line}\n`;
    });

    if (proofs && proofs.length > 0) {
      details += "\n## Proof Status\n\n";
      proofs.forEach((proof: any) => {
        const status = proof.valid ? "✅" : "❌";
        details += `${status} \`${proof.theorem}\` - ${proof.file}\n`;
      });
    }

    return details;
  }

  generateProveNowUrl(proofResults: any) {
    return `https://github.com/${proofResults.repository}/actions/workflows/lean4-ci.yml`;
  }

  generateDashboardUrl(proofResults: any) {
    return `${process.env.DASHBOARD_URL || ""}/repo/${proofResults.repository}/pr/${proofResults.prNumber}`;
  }

  generateExportUrl(proofResults: any) {
    return `${process.env.DASHBOARD_URL || ""}/export/${proofResults.repository}/${proofResults.prNumber}`;
  }

  /**
   * Resolve PR number from issue_comment or review_comment payloads.
   */
  resolvePrNumber(context: any, comment: any) {
    const { payload } = context;
    if (payload.pull_request?.number) {
      return payload.pull_request.number;
    }
    if (payload.issue?.pull_request && payload.issue.number) {
      return payload.issue.number;
    }
    if (comment?.pull_request_url) {
      const match = comment.pull_request_url.match(/\/pulls\/(\d+)/);
      if (match) {
        return Number(match[1]);
      }
    }
    return null;
  }

  async resolvePrHead(context: any, prNumber: any) {
    const { repository } = context.payload;
    const octokit = this.getOctokit(context);
    const pr = await octokit.pulls.get({
      owner: repository.owner.login,
      repo: repository.name,
      pull_number: prNumber,
    });
    return {
      number: pr.data.number,
      headRef: pr.data.head.ref,
      headSha: pr.data.head.sha,
    };
  }

  async handleSpecCommentAction(context: any, comment: any) {
    const body = comment.body || "";
    const isMutating = MUTATING_COMMANDS.some((cmd: any) => body.includes(cmd));

    if (isMutating) {
      const authz = await this.authorizeSpecMutation(context, comment);
      if (!authz.allowed) {
        await this.replyOnThread(
          context,
          comment,
          `🚫 **SpecSync**: You are not allowed to run this command. ` +
            `Only the PR author, PR committers, or users with write permission may ` +
            `\`/specsync accept|ignore|edit\`.` +
            (authz.reason ? ` (${escapeHtml(authz.reason)})` : "")
        );
        return;
      }

      const actor =
        context.payload?.sender?.login || comment.user?.login || comment.author?.login || "unknown";
      const { repository } = context.payload;
      const prNumber = this.resolvePrNumber(context, comment) || 0;
      const scope = `${repository.owner.login}/${repository.name}#${prNumber}`;
      const rate = commandRateLimiter.allow(actor, scope);
      if (!rate.allowed) {
        incr("commands_rate_limited");
        const seconds = Math.ceil((rate.retryAfterMs || 0) / 1000);
        await this.replyOnThread(
          context,
          comment,
          `⏳ **SpecSync**: Rate limit exceeded for mutating commands on this PR. ` +
            `Try again in ~${seconds}s ` +
            `(limit: \`SPECSYNC_COMMAND_RATE_LIMIT\` / \`SPECSYNC_COMMAND_RATE_WINDOW_MS\`).`
        );
        return;
      }
    }

    if (body.includes("/specsync edit apply")) {
      await this.handleEditApplyAction(context, comment);
    } else if (body.includes("/specsync accept")) {
      await this.handleAcceptAction(context, comment);
    } else if (body.includes("/specsync edit")) {
      await this.handleEditAction(context, comment);
    } else if (body.includes("/specsync ignore")) {
      await this.handleIgnoreAction(context, comment);
    } else if (body.includes("/specsync review")) {
      await this.handleReviewAction(context, comment);
    }
  }

  /**
   * AuthZ for mutating `/specsync` commands.
   * Allowed: PR author, anyone who committed on the PR, or write/maintain/admin on the repo.
   */
  async authorizeSpecMutation(context: any, comment: any) {
    const actor =
      context.payload?.sender?.login || comment.user?.login || comment.author?.login || null;
    if (!actor) {
      return { allowed: false, reason: "missing actor" };
    }

    const { repository } = context.payload;
    const owner = repository.owner.login;
    const repo = repository.name;
    const octokit = this.getOctokit(context);
    const prNumber = this.resolvePrNumber(context, comment);
    if (!prNumber) {
      return { allowed: false, reason: "not a pull request" };
    }

    try {
      const pr = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
      if (pr.data.user?.login && pr.data.user.login === actor) {
        return { allowed: true, reason: "pr_author" };
      }
    } catch (error: unknown) {
      return { allowed: false, reason: `pr lookup failed: ${(error instanceof Error ? error.message : String(error))}` };
    }

    try {
      const perm = await octokit.repos.getCollaboratorPermissionLevel({
        owner,
        repo,
        username: actor,
      });
      const level = perm.data?.permission;
      if (level === "admin" || level === "write" || level === "maintain") {
        return { allowed: true, reason: `permission:${level}` };
      }
    } catch {
      // Collaborator API may 404 for outside collaborators without access — fall through.
    }

    try {
      let commits;
      if (typeof octokit.paginate === "function") {
        commits = await octokit.paginate(octokit.pulls.listCommits, {
          owner,
          repo,
          pull_number: prNumber,
          per_page: 100,
        });
      } else {
        const listed = await octokit.pulls.listCommits({
          owner,
          repo,
          pull_number: prNumber,
          per_page: 100,
        });
        commits = listed.data || [];
      }
      const isCommitter = commits.some(
        (c: any) =>
          c.author?.login === actor ||
          c.committer?.login === actor ||
          c.commit?.author?.name === actor ||
          c.commit?.committer?.name === actor
      );
      if (isCommitter) {
        return { allowed: true, reason: "pr_committer" };
      }
    } catch {
      // ignore and deny
    }

    return { allowed: false, reason: "insufficient permission" };
  }

  async replyOnThread(context: any, comment: any, body: any) {
    const { repository } = context.payload;
    const octokit = this.getOctokit(context);
    const prNumber = this.resolvePrNumber(context, comment);

    // Prefer reply to review comment when in_reply_to / review comment id exists
    if (comment.id && (comment.pull_request_review_id || comment.path)) {
      try {
        await octokit.pulls.createReplyForReviewComment({
          owner: repository.owner.login,
          repo: repository.name,
          pull_number: prNumber,
          comment_id: comment.in_reply_to || comment.id,
          body,
        });
        return;
      } catch {
        // fall through to issue comment
      }
    }

    await octokit.issues.createComment({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: prNumber,
      body,
    });
  }

  async handleAcceptAction(context: any, comment: any) {
    const { repository } = context.payload;
    const prNumber = this.resolvePrNumber(context, comment);
    if (!prNumber) {
      throw new Error("Cannot accept spec without a pull request");
    }

    const pr = await this.resolvePrHead(context, prNumber);
    const spec = this.extractSpecFromComment(comment.body);
    if (!spec.functionName || !spec.filePath) {
      await this.replyOnThread(
        context,
        comment,
        "⚠️ **SpecSync**: Could not parse function name/file from the suggestion comment."
      );
      return;
    }

    const stored = suggestionToStoredSpec(spec, { pr: pr.number, sha: pr.headSha });
    const repoRef = {
      owner: repository.owner.login,
      repo: repository.name,
      ref: pr.headRef,
    };

    const { path: jsonPath } = await specStore.storeSpec(
      this.getOctokit(context),
      repoRef,
      stored
    );

    const leanWithMeta = this.leanGenerator.generateLean4File(
      {
        ...stored.contract,
        confidence: stored.confidence,
        reasoning: stored.contract.reasoning,
      },
      {
        functionName: stored.functionName,
        inputTypes: [],
        outputType: "any",
      }
    );

    const { path: leanPath } = await specStore.storeLeanFile(
      this.getOctokit(context),
      repoRef,
      stored.functionName,
      leanWithMeta
    );

    await this.replyOnThread(
      context,
      comment,
      `✅ **SpecSync**: Specification accepted and committed to \`${pr.headRef}\`.\n\n` +
        `- Spec: [\`${jsonPath}\`](${jsonPath})\n` +
        `- Lean: [\`${leanPath}\`](${leanPath})\n\n` +
        `Proof gate is **${process.env.SPECSYNC_PROOF_GATE || "soft"}** ` +
        `(closed fragments are proved; undecided goals stay labeled unproved; CI reports them).`
    );
    incr("specs_accepted");
  }

  extractSpecFromComment(commentBody: any) {
    const lines = commentBody.split("\n");
    const spec = {
      functionName: "",
      filePath: "",
      lineNumber: 1,
      preconditions: [] as string[],
      postconditions: [] as string[],
      invariants: [] as string[],
      edgeCases: [] as string[],
      confidence: 0,
      reasoning: "",
    };

    let currentSection = "";

    for (const line of lines) {
      if (line.includes("Specification for")) {
        spec.functionName = line.match(/`([^`]+)`/)?.[1] || "";
      } else if (line.includes("**File:**") || line.startsWith("**File:**")) {
        const fileMatch = line.match(/`([^`]+)`/);
        const lineMatch = line.match(/line\s+(\d+)/i);
        if (fileMatch) {
          spec.filePath = fileMatch[1];
        }
        if (lineMatch) {
          spec.lineNumber = Number(lineMatch[1]);
        }
      } else if (line.includes("Confidence:")) {
        const percent = parseInt(line.match(/(\d+)%/)?.[1] || "0", 10);
        spec.confidence = normalizeConfidence(percent, 0);
      } else if (line.includes("### 📋 Preconditions") || line.includes("### Preconditions")) {
        currentSection = "preconditions";
      } else if (line.includes("### ✅ Postconditions") || line.includes("### Postconditions")) {
        currentSection = "postconditions";
      } else if (line.includes("### 🔒 Invariants") || line.includes("### Invariants")) {
        currentSection = "invariants";
      } else if (line.includes("### 💭 Reasoning") || line.includes("### Reasoning")) {
        currentSection = "reasoning";
      } else if (line.startsWith("- ") && currentSection !== "reasoning") {
        const item = line.substring(2);
        if (currentSection === "preconditions") {
          spec.preconditions.push(item);
        } else if (currentSection === "postconditions") {
          spec.postconditions.push(item);
        } else if (currentSection === "invariants") {
          spec.invariants.push(item);
        }
      } else if (currentSection === "reasoning" && line.trim() && !line.startsWith("---") && !line.startsWith("**Actions")) {
        spec.reasoning += line + "\n";
      }
    }

    return spec;
  }

  /** @deprecated Prefer SpecStore via handleAcceptAction */
  async storeAcceptedSpec(spec: any, context: any) {
    const prNumber = this.resolvePrNumber(context, null);
    const pr = await this.resolvePrHead(context, prNumber);
    const { repository } = context.payload;
    const stored = suggestionToStoredSpec(spec, { pr: pr.number, sha: pr.headSha });
    return specStore.storeSpec(
      this.getOctokit(context),
      { owner: repository.owner.login, repo: repository.name, ref: pr.headRef },
      stored
    );
  }

  async handleEditAction(context: any, comment: any) {
    const spec = this.extractSpecFromComment(comment.body);
    await this.replyOnThread(
      context,
      comment,
      this.generateEditInstructions(spec)
    );
  }

  /**
   * Apply an edit from a structured comment command (no HTML form / missing route).
   */
  async handleEditApplyAction(context: any, comment: any) {
    const { repository } = context.payload;
    const prNumber = this.resolvePrNumber(context, comment);
    if (!prNumber) {
      throw new Error("Cannot edit spec without a pull request");
    }

    const edited = this.parseEditApplyBody(comment.body);
    if (!edited.functionName || !edited.filePath) {
      await this.replyOnThread(
        context,
        comment,
        "⚠️ **SpecSync**: `/specsync edit apply` needs `function:` and `file:` fields."
      );
      return;
    }

    const pr = await this.resolvePrHead(context, prNumber);
    const stored = suggestionToStoredSpec(edited, { pr: pr.number, sha: pr.headSha });
    const { path: jsonPath } = await specStore.storeSpec(
      this.getOctokit(context),
      { owner: repository.owner.login, repo: repository.name, ref: pr.headRef },
      stored,
      `specsync: edit spec for ${stored.functionName}`
    );

    await this.replyOnThread(
      context,
      comment,
      `✏️ **SpecSync**: Updated specification committed to \`${pr.headRef}\` at \`${jsonPath}\`.`
    );
    incr("specs_edited");
  }

  parseEditApplyBody(body: any) {
    const lines = body.split("\n");
    const spec = {
      functionName: "",
      filePath: "",
      lineNumber: 1,
      preconditions: [] as string[],
      postconditions: [] as string[],
      invariants: [] as string[],
      edgeCases: [] as string[],
      confidence: 0.5,
      reasoning: "",
    };
    let section = "";

    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith("function:")) {
        spec.functionName = line.slice("function:".length).trim();
      } else if (line.startsWith("file:")) {
        spec.filePath = line.slice("file:".length).trim();
      } else if (line.startsWith("preconditions:")) {
        section = "preconditions";
      } else if (line.startsWith("postconditions:")) {
        section = "postconditions";
      } else if (line.startsWith("invariants:")) {
        section = "invariants";
      } else if (line.startsWith("reasoning:")) {
        section = "reasoning";
        const rest = line.slice("reasoning:".length).trim();
        if (rest) {
          spec.reasoning += rest + "\n";
        }
      } else if (line.startsWith("- ") && section && section !== "reasoning") {
        (spec as any)[section].push(line.slice(2));
      } else if (section === "reasoning" && line && !line.startsWith("/specsync") && line !== "```") {
        spec.reasoning += line + "\n";
      }
    }

    return spec;
  }

  generateEditInstructions(spec: any) {
    return `## ✏️ Edit Specification for \`${spec.functionName || "unknown"}\`

Reply with:

\`\`\`
/specsync edit apply
function: ${spec.functionName || ""}
file: ${spec.filePath || ""}
preconditions:
${(spec.preconditions || []).map((p: any) => `- ${p}`).join("\n") || "- "}
postconditions:
${(spec.postconditions || []).map((p: any) => `- ${p}`).join("\n") || "- "}
invariants:
${(spec.invariants || []).map((p: any) => `- ${p}`).join("\n") || "- "}
reasoning: ${(spec.reasoning || "").trim()}
\`\`\`

This commits the updated contract under \`.specsync/specs/\` on the PR branch.`;
  }

  /** @deprecated HTML forms are not supported; use generateEditInstructions */
  generateEditForm(spec: any) {
    return this.generateEditInstructions(spec);
  }

  async handleIgnoreAction(context: any, comment: any) {
    const { repository } = context.payload;
    const prNumber = this.resolvePrNumber(context, comment);
    if (!prNumber) {
      throw new Error("Cannot ignore spec without a pull request");
    }

    const spec = this.extractSpecFromComment(comment.body);
    const pr = await this.resolvePrHead(context, prNumber);

    if (spec.functionName && spec.filePath) {
      await specStore.addIgnore(
        this.getOctokit(context),
        { owner: repository.owner.login, repo: repository.name, ref: pr.headRef },
        {
          functionName: spec.functionName,
          filePath: spec.filePath,
          ignoredAt: new Date().toISOString(),
          pr: pr.number,
          reason: "Ignored via /specsync ignore",
        }
      );
    }

    await this.replyOnThread(
      context,
      comment,
      `❌ **SpecSync**: Suggestion ignored` +
        (spec.functionName
          ? ` and recorded in \`.specsync/ignores.json\` for \`${spec.functionName}\`.`
          : ".")
    );
    incr("specs_ignored");
  }

  async handleReviewAction(context: any, comment: any) {
    const spec = this.extractSpecFromComment(comment.body);
    await this.replyOnThread(
      context,
      comment,
      `## 🔍 Manual Review Requested\n\n**Function:** \`${spec.functionName || "unknown"}\`\n\nPlease review the suggested specification and provide feedback.`
    );
  }
}

// Re-export path helpers for tests
export const githubUiPathHelpers = {
  buildSpecStorePath,
  buildLeanStorePath,
};
(GitHubUI as any).buildSpecStorePath = buildSpecStorePath;
(GitHubUI as any).buildLeanStorePath = buildLeanStorePath;
