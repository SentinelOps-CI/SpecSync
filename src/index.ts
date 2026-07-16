import type { ApplicationFunction, ApplicationFunctionOptions, Context } from "probot";
import { DiffParser } from "./diff-parser";
import { ASTExtractor } from "./ast-extractor";
import { SpecAnalyzer } from "./spec-analyzer";
import { GitHubUI } from "./github-ui";
import { WebDashboard } from "./web-dashboard";
import { SlackAlerts } from "./slack-alerts";
import { UIPrinciples } from "./ui-principles";
import { HealthChecker } from "./health";
import { analysisJobQueue } from "./analysis-queue";
import { specStore } from "./spec-store";
import { getMetrics, incr } from "./metrics";
import type { AnalysisJobPayload, DriftFinding } from "./types";

const probotApp: ApplicationFunction = (app, options: ApplicationFunctionOptions) => {
  const diffParser = new DiffParser();
  const astExtractor = new ASTExtractor();
  const specAnalyzer = new SpecAnalyzer();

  const githubUI = new GitHubUI();
  const webDashboard = new WebDashboard();
  const slackAlerts = new SlackAlerts();
  const uiPrinciples = new UIPrinciples();
  const healthChecker = new HealthChecker();

  // Dashboard listens only when SPECSYNC_DASHBOARD=1 and SPECSYNC_DASHBOARD_SECRET are set.
  webDashboard.start();

  const router = options.getRouter?.("/");
  if (router) {
    router.get("/health", (_req, res) => {
      const status = healthChecker.getStatus();
      res.status(200).json({
        status: "healthy",
        service: "specsync",
        uptime: status.uptime,
        timestamp: status.timestamp,
      });
    });
    router.get("/ready", (_req, res) => {
      const status = healthChecker.getStatus();
      const jobs = analysisJobQueue.getStats();
      res.status(200).json({
        status: "ready",
        service: "specsync",
        uptime: status.uptime,
        jobs,
        metrics: getMetrics(),
        dashboard:
          process.env.SPECSYNC_DASHBOARD === "1" && Boolean(process.env.SPECSYNC_DASHBOARD_SECRET)
            ? "enabled"
            : "disabled",
        timestamp: new Date().toISOString(),
      });
    });
  }

  // PR path uses context.octokit (installation auth). GITHUB_TOKEN is for local CLI/demo only.
  slackAlerts.initialize();

  app.on("pull_request.opened", async (context) => {
    await enqueuePullRequestAnalysis(
      context,
      diffParser,
      astExtractor,
      specAnalyzer,
      githubUI,
      uiPrinciples
    );
  });

  app.on("pull_request.synchronize", async (context) => {
    await enqueuePullRequestAnalysis(
      context,
      diffParser,
      astExtractor,
      specAnalyzer,
      githubUI,
      uiPrinciples
    );
  });

  app.on("pull_request.reopened", async (context) => {
    await enqueuePullRequestAnalysis(
      context,
      diffParser,
      astExtractor,
      specAnalyzer,
      githubUI,
      uiPrinciples
    );
  });

  app.on("push", async (context) => {
    await handlePush(context, specAnalyzer, githubUI, slackAlerts);
  });

  app.on("issue_comment.created", async (context) => {
    await handleIssueComment(context, githubUI);
  });

  app.on("pull_request_review_comment.created", async (context) => {
    await handleReviewComment(context, githubUI);
  });
};

async function enqueuePullRequestAnalysis(
  context: Context<"pull_request">,
  diffParser: DiffParser,
  astExtractor: ASTExtractor,
  specAnalyzer: SpecAnalyzer,
  githubUI: GitHubUI,
  uiPrinciples: UIPrinciples
): Promise<void> {
  const { payload } = context;
  const { pull_request, repository, installation } = payload;

  const jobPayload: AnalysisJobPayload = {
    installationId: installation?.id ?? 0,
    owner: repository.owner.login,
    repo: repository.name,
    pr: pull_request.number,
    headSha: pull_request.head.sha,
  };

  const result = analysisJobQueue.enqueue(jobPayload, async (job) => {
    if (job.status === "superseded") {
      return;
    }
    await runPullRequestPipeline(
      context,
      diffParser,
      astExtractor,
      specAnalyzer,
      githubUI,
      uiPrinciples,
      job.id
    );
  });

  if (result.enqueued) {
    context.log.info(
      {
        jobId: result.jobId,
        jobKey: result.key,
        reason: result.reason,
        pr: pull_request.number,
        headSha: pull_request.head.sha,
      },
      `Enqueued SpecSync analysis for PR #${pull_request.number}`
    );
    try {
      await context.octokit.issues.createComment({
        owner: repository.owner.login,
        repo: repository.name,
        issue_number: pull_request.number,
        body:
          `⏳ **SpecSync**: Analysis started for \`${pull_request.head.sha.slice(0, 7)}\`` +
          (result.reason === "superseded_prior" ? " (superseded prior head)." : "."),
      });
    } catch (error: unknown) {
      context.log.warn({ err: error }, "Could not post analysis-started comment");
    }
  } else {
    context.log.info(
      { jobKey: result.key, reason: result.reason },
      `Skipped duplicate SpecSync analysis for PR #${pull_request.number}`
    );
  }
}

async function runPullRequestPipeline(
  context: Context<"pull_request">,
  diffParser: DiffParser,
  astExtractor: ASTExtractor,
  specAnalyzer: SpecAnalyzer,
  githubUI: GitHubUI,
  uiPrinciples: UIPrinciples,
  jobId?: string
): Promise<void> {
  const { payload } = context;
  const { pull_request, repository } = payload;
  const startedAt = Date.now();
  const logBase = {
    jobId,
    pr: pull_request.number,
    owner: repository.owner.login,
    repo: repository.name,
    headSha: pull_request.head.sha,
  };

  context.log.info(logBase, `Processing PR #${pull_request.number} in ${repository.full_name}`);

  try {
    astExtractor.clearContentCache?.();

    const diff = await context.octokit.pulls.get({
      owner: repository.owner.login,
      repo: repository.name,
      pull_number: pull_request.number,
      mediaType: {
        format: "diff",
      },
    });

    const changedFiles = await context.octokit.paginate(context.octokit.pulls.listFiles, {
      owner: repository.owner.login,
      repo: repository.name,
      pull_number: pull_request.number,
      per_page: 100,
    });

    const functionChanges = await diffParser.parseDiff(
      diff.data as unknown as string,
      changedFiles
    );

    const astAnalysis = await astExtractor.extractAST(functionChanges, context);

    const specSuggestions = await specAnalyzer.analyzeChanges(astAnalysis, context);
    const cost = (specAnalyzer as { lastJobCost?: Record<string, unknown> }).lastJobCost;

    // Phase 6: production without LLM keys/API must not post mock review comments.
    if (specSuggestions.length === 0 && (specAnalyzer as { lastLlmUnavailable?: boolean }).lastLlmUnavailable) {
      incr("llm_failures");
      await githubUI.createLlmUnavailableComment(context);
      context.log.warn(
        { ...logBase, latencyMs: Date.now() - startedAt, llm: cost, mode: "unavailable" },
        "PR analysis skipped: LLM unavailable"
      );
      return;
    }

    // Phase 9: enforce 0–1 confidence transparency before posting.
    const validatedSuggestions = [];
    for (const suggestion of specSuggestions) {
      const validation = uiPrinciples.validateConfidenceTransparency(suggestion);
      if (!validation.isValid) {
        context.log.warn(
          {
            ...logBase,
            functionName: suggestion.functionName,
            issues: validation.issues,
          },
          "Spec suggestion failed confidence transparency validation; skipping"
        );
        continue;
      }
      validatedSuggestions.push(suggestion);
    }

    const mockCount = validatedSuggestions.filter((s) => s.isMock).length;
    const liveCount = validatedSuggestions.length - mockCount;

    await githubUI.createSpecComments(context, validatedSuggestions);
    incr("specs_posted", validatedSuggestions.length);

    const coverage = await specStore.computeCoverageForFunctions(
      // Installation octokit satisfies the store's structural OctokitLike at runtime.
      context.octokit as never,
      {
        owner: repository.owner.login,
        repo: repository.name,
        ref: pull_request.head.sha,
      },
      functionChanges.map((f: { functionName: string; filePath: string; lineNumber?: number }) => ({
        functionName: f.functionName,
        filePath: f.filePath,
        lineNumber: f.lineNumber,
      }))
    );

    const proofStatus = {
      coverage: coverage.coverage,
      totalFunctions: coverage.totalFunctions,
      coveredFunctions: coverage.coveredFunctions,
      failedProofs: 0,
      formula: coverage.formula,
      functions: coverage.functions,
      proofs: [] as unknown[],
    };

    await githubUI.createCoverageCheck(context, proofStatus);

    incr("analysis_jobs_completed");
    context.log.info(
      {
        ...logBase,
        latencyMs: Date.now() - startedAt,
        specsPosted: validatedSuggestions.length,
        llm: {
          ...cost,
          mock: mockCount,
          live: liveCount,
        },
        coverage: coverage.coverage,
        metrics: getMetrics(),
      },
      "PR analysis completed"
    );
  } catch (error: unknown) {
    incr("analysis_jobs_failed");
    context.log.error(
      { ...logBase, err: error, latencyMs: Date.now() - startedAt },
      "Error processing pull request"
    );
    await context.octokit.issues.createComment({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: pull_request.number,
      body: `⚠️ **SpecSync Error**: Failed to analyze changes. Please check the logs for details.`,
    });
  }
}

async function handlePush(
  context: Context<"push">,
  specAnalyzer: SpecAnalyzer,
  githubUI: GitHubUI,
  slackAlerts: SlackAlerts
): Promise<void> {
  const { payload } = context;
  const { ref, repository, after } = payload;

  if (!ref.includes("refs/heads/main") && !ref.includes("refs/heads/master")) {
    return;
  }

  context.log.info(`Processing push to ${ref} in ${repository.full_name}`);

  try {
    const driftResults: DriftFinding[] = await specAnalyzer.detectDrift(payload.commits, context);

    const headSha = after || payload.head_commit?.id;
    if (!headSha) {
      context.log.warn("Push payload missing head SHA; skipping check run");
      return;
    }

    if (driftResults.length === 0) {
      await githubUI.createCommitCheck(context, {
        headSha,
        name: "SpecSync Drift",
        conclusion: "success",
        title: "No spec drift detected",
        summary:
          "Compared changed files against accepted `.specsync/` specs. No drift findings " +
          "(or no stored specs for changed functions).",
      });
      return;
    }

    incr("drifts_detected", driftResults.length);
    context.log.info(
      { drifts: driftResults.length, ref, headSha, metrics: getMetrics() },
      "Spec drift findings"
    );

    const summaryLines = driftResults
      .map((d) => `- \`${d.filePath}\` / \`${d.functionName}\`: ${d.reason}`)
      .join("\n");

    await githubUI.createCommitCheck(context, {
      headSha,
      name: "SpecSync Drift",
      conclusion: "neutral",
      title: `Drift: ${driftResults.length} finding(s)`,
      summary: `## SpecSync Drift Report\n\n${summaryLines}`,
      text: summaryLines,
    });

    // Open a tracking issue (not a PR-only API). Labels are best-effort.
    try {
      await context.octokit.issues.create({
        owner: repository.owner.login,
        repo: repository.name,
        title: `[SpecSync] Spec drift on ${ref.replace("refs/heads/", "")} (${headSha.slice(0, 7)})`,
        body:
          `SpecSync detected **${driftResults.length}** drift finding(s) after push to \`${ref}\`.\n\n` +
          `${summaryLines}\n\n` +
          `Accepted specs live under \`.specsync/specs/\`. Update or re-accept specs as needed.`,
      });
    } catch (error: unknown) {
      context.log.warn({ err: error }, "Could not open drift tracking issue");
    }
    for (const drift of driftResults) {
      await slackAlerts.sendDriftAlert({
        functionName: drift.functionName,
        module: drift.filePath,
        reason: drift.reason,
        severity: "medium",
        previousSpec: drift.previousSpec,
        currentImplementation: drift.currentImplementation,
        repository: repository.full_name,
        commit: headSha,
      });
    }
  } catch (error: unknown) {
    context.log.error({ err: error }, "Error processing push");
  }
}

async function handleIssueComment(
  context: Context<"issue_comment.created">,
  githubUI: GitHubUI
): Promise<void> {
  const { payload } = context;
  if (!payload.issue.pull_request) {
    return;
  }
  if (payload.comment.body.includes("/specsync")) {
    await githubUI.handleSpecCommentAction(context, payload.comment);
  }
}

async function handleReviewComment(
  context: Context<"pull_request_review_comment.created">,
  githubUI: GitHubUI
): Promise<void> {
  const { payload } = context;
  if (payload.comment.body.includes("/specsync")) {
    await githubUI.handleSpecCommentAction(context, payload.comment);
  }
}

export = probotApp;
