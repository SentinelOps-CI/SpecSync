import type { ApplicationFunction, ApplicationFunctionOptions, Context } from "probot";
import { DiffParser } from "./diff-parser";
import { ASTExtractor } from "./ast-extractor";
import { SpecAnalyzer } from "./spec-analyzer";
import { GitHubUI } from "./github-ui";
import { VSCodeUI } from "./vscode-ui";
import { WebDashboard } from "./web-dashboard";
import { SlackAlerts } from "./slack-alerts";
import { UIPrinciples } from "./ui-principles";

const probotApp: ApplicationFunction = (app, options: ApplicationFunctionOptions) => {
  const diffParser = new DiffParser();
  const astExtractor = new ASTExtractor();
  const specAnalyzer = new SpecAnalyzer();

  const githubUI = new GitHubUI();
  const vscodeUI = new VSCodeUI();
  const webDashboard = new WebDashboard();
  const slackAlerts = new SlackAlerts();
  const uiPrinciples = new UIPrinciples();

  void vscodeUI;
  void webDashboard;
  void uiPrinciples;

  const router = options.getRouter?.("/");
  if (router) {
    router.get("/health", (_req, res) => {
      res.status(200).json({ status: "healthy", service: "specsync" });
    });
    router.get("/ready", (_req, res) => {
      res.status(200).json({ status: "ready", service: "specsync" });
    });
  }

  githubUI.initialize(process.env.GITHUB_TOKEN);
  slackAlerts.initialize();

  app.on("pull_request.opened", async (context) => {
    await handlePullRequest(context, diffParser, astExtractor, specAnalyzer, githubUI);
  });

  app.on("pull_request.synchronize", async (context) => {
    await handlePullRequest(context, diffParser, astExtractor, specAnalyzer, githubUI);
  });

  app.on("pull_request.reopened", async (context) => {
    await handlePullRequest(context, diffParser, astExtractor, specAnalyzer, githubUI);
  });

  app.on("push", async (context) => {
    await handlePush(context, diffParser, astExtractor, specAnalyzer, githubUI, slackAlerts);
  });

  app.on("issue_comment.created", async (context) => {
    await handleIssueComment(context, githubUI);
  });

  app.on("pull_request_review_comment.created", async (context) => {
    await handleReviewComment(context, githubUI);
  });
};

async function handlePullRequest(
  context: Context<"pull_request">,
  diffParser: DiffParser,
  astExtractor: ASTExtractor,
  specAnalyzer: SpecAnalyzer,
  githubUI: GitHubUI
): Promise<void> {
  const { payload } = context;
  const { pull_request, repository } = payload;

  context.log.info(`Processing PR #${pull_request.number} in ${repository.full_name}`);

  try {
    const diff = await context.octokit.pulls.get({
      owner: repository.owner.login,
      repo: repository.name,
      pull_number: pull_request.number,
      mediaType: {
        format: "diff",
      },
    });

    const changedFiles = await context.octokit.pulls.listFiles({
      owner: repository.owner.login,
      repo: repository.name,
      pull_number: pull_request.number,
    });

    const functionChanges = await diffParser.parseDiff(
      diff.data as unknown as string,
      changedFiles.data
    );

    const astAnalysis = await astExtractor.extractAST(functionChanges, context);

    const specSuggestions = await specAnalyzer.analyzeChanges(astAnalysis, context);

    for (const suggestion of specSuggestions) {
      await githubUI.createSpecComment(context, suggestion);
    }

    const proofStatus = {
      coverage: 75,
      totalFunctions: specSuggestions.length,
      coveredFunctions: specSuggestions.filter((s) => s.confidence > 70).length,
      failedProofs: 0,
      functions: specSuggestions.map((s) => ({
        name: s.functionName,
        filePath: s.filePath,
        line: s.lineNumber,
        hasProof: s.confidence > 70,
      })),
      proofs: [] as unknown[],
    };

    await githubUI.createCoverageCheck(context, proofStatus);
  } catch (error: unknown) {
    context.log.error({ err: error }, "Error processing pull request");
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
  diffParser: DiffParser,
  astExtractor: ASTExtractor,
  specAnalyzer: SpecAnalyzer,
  githubUI: GitHubUI,
  slackAlerts: SlackAlerts
): Promise<void> {
  void diffParser;
  void astExtractor;
  const { payload } = context;
  const { ref, repository } = payload;

  if (!ref.includes("refs/heads/main") && !ref.includes("refs/heads/master")) {
    return;
  }

  context.log.info(`Processing push to ${ref} in ${repository.full_name}`);

  try {
    const driftResults = await specAnalyzer.detectDrift(payload.commits, context);

    if (driftResults.length > 0) {
      for (const drift of driftResults) {
        await slackAlerts.sendDriftAlert(drift);
      }

      const proofResults = {
        functions: driftResults.map((d) => ({
          name: d.functionName,
          proofValid: false,
          theorem: null,
          hasDrift: true,
        })),
        drift: driftResults,
        coverage: 60,
        repository: repository.full_name,
        prNumber: 0,
      };

      await githubUI.createProofCheckComment(context, proofResults);
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
