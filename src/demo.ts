#!/usr/bin/env node

/**
 * SpecSync Demo
 *
 * This script demonstrates how the SpecSync components work together
 * to analyze code changes and generate specifications.
 */

import { DiffParser } from "./diff-parser";
import { ASTExtractor } from "./ast-extractor";
import { SpecAnalyzer } from "./spec-analyzer";
import { LLMClient } from "./llm-client";
import { Lean4Generator } from "./lean4-generator";
import { CIIntegration } from "./ci-integration";
import { SpecCoverageTracker } from "./spec-coverage";
import { WebDashboard } from "./web-dashboard";
import { SlackAlerts } from "./slack-alerts";
import { UIPrinciples } from "./ui-principles";

async function runDemo() {
  console.log("🚀 Starting SpecSync Demo with Track B Implementation\n");

  // Initialize components
  const diffParser = new DiffParser();
  const astExtractor = new ASTExtractor();
  const specAnalyzer = new SpecAnalyzer();
  const llmClient = new LLMClient();
  const lean4Generator = new Lean4Generator();
  const ciIntegration = new CIIntegration();
  const coverageTracker = new SpecCoverageTracker();
  const webDashboard = new WebDashboard();
  const slackAlerts = new SlackAlerts();
  const uiPrinciples = new UIPrinciples();

  void webDashboard;
  void slackAlerts;
  void uiPrinciples;

  // Test LLM connectivity
  console.log("🔍 Testing LLM Connectivity...");
  const connectivity = await llmClient.testConnectivity();
  console.log("Connectivity Results:", connectivity);

  // Sample diff and changed files
  const sampleDiff = `
diff --git a/src/calculator.js b/src/calculator.js
index 1234567..abcdefg 100644
--- a/src/calculator.js
+++ b/src/calculator.js
@@ -5,6 +5,15 @@
+function calculateInterest(principal, rate, time) {
+  // Validate inputs
+  if (principal <= 0 || rate < 0 || time <= 0) {
+    throw new Error('Invalid parameters: all values must be positive');
+  }
+  
+  // Calculate simple interest
+  const interest = principal * rate * time;
+  return Math.round(interest * 100) / 100; // Round to 2 decimal places
+}
+
 function add(a: any, b: any) {
   return a + b;
 }
@@ -15,6 +24,20 @@ function multiply(a, b) {
   return a * b;
 }
+
+function validateEmail(email) {
+  if (!email || typeof email !== 'string') {
+    return false;
+  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
 `;

  const changedFiles = [
    {
      filename: "src/calculator.js",
      status: "modified",
      additions: 25,
      deletions: 0,
    },
  ];

  // Mock GitHub context
  const mockContext = {
    payload: {
      pull_request: {
        html_url: "https://github.com/example/repo/pull/1",
        number: 1,
      },
      repository: {
        owner: { login: "example" },
        name: "repo",
      },
    },
    octokit: {
      repos: {
        getContent: async ({ path }: { path: string }) => {
          if (path === "src/calculator.js") {
            return {
              data: {
                content: Buffer.from(
                  `
function calculateInterest(principal: any, rate: any, time: any) {
  // Validate inputs
  if (principal <= 0 || rate < 0 || time <= 0) {
    throw new Error('Invalid parameters: all values must be positive');
  }
  
  // Calculate simple interest
  const interest = principal * rate * time;
  return Math.round(interest * 100) / 100; // Round to 2 decimal places
}

function add(a: any, b: any) {
  return a + b;
}

function subtract(a: any, b: any) {
  return a - b;
}

function multiply(a: any, b: any) {
  return a * b;
}

function validateEmail(email: any) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
`,
                  "utf-8"
                ).toString("base64"),
                encoding: "base64",
              },
            };
          }
          throw new Error("File not found");
        },
      },
    },
  };

  try {
    console.log("📊 Step 1: Parsing Diff...");
    const functionChanges = await diffParser.parseDiff(sampleDiff, changedFiles);
    console.log(`Found ${functionChanges.length} changed functions:`);
    functionChanges.forEach((change: any) => {
      console.log(`  - ${change.functionName} (${change.changeType})`);
    });

    console.log("\n🌳 Step 2: AST Analysis...");
    const astAnalysis = await astExtractor.extractAST(functionChanges, mockContext);
    console.log(`AST analysis completed for ${astAnalysis.length} functions:`);
    astAnalysis.forEach((analysis: any) => {
      console.log(
        `  - ${analysis.functionName}: ${analysis.ast.inputTypes.length} inputs, complexity ${analysis.ast.complexity}`
      );
    });

    console.log("\n🤖 Step 3: LLM Specification Generation...");
    const specSuggestions = await specAnalyzer.analyzeChanges(astAnalysis, mockContext);
    console.log(`Generated ${specSuggestions.length} spec suggestions:`);

    specSuggestions.forEach((spec: any) => {
      console.log(`\n📋 ${spec.functionName}:`);
      console.log(`  Confidence: ${spec.confidence}%`);
      console.log(`  Preconditions: ${spec.preconditions.length}`);
      console.log(`  Postconditions: ${spec.postconditions.length}`);
      console.log(`  Invariants: ${spec.invariants.length}`);
      console.log(`  Edge Cases: ${spec.edgeCases.length}`);
      console.log(`  Reasoning: ${spec.reasoning}`);

      // Show first few items of each category
      if (spec.preconditions.length > 0) {
        console.log(
          `    Preconditions: ${spec.preconditions.slice(0, 2).join(", ")}${spec.preconditions.length > 2 ? "..." : ""}`
        );
      }
      if (spec.postconditions.length > 0) {
        console.log(
          `    Postconditions: ${spec.postconditions.slice(0, 2).join(", ")}${spec.postconditions.length > 2 ? "..." : ""}`
        );
      }
    });

    console.log("\n📐 Step 4: Lean4 Theorem Generation...");
    const lean4Specs = [];

    for (const spec of specSuggestions) {
      const context = {
        functionName: spec.functionName,
        inputTypes: spec.ast ? spec.ast.inputTypes : [],
        outputType: spec.ast ? spec.ast.outputType : "any",
      };

      const lean4Content = lean4Generator.generateLean4Theorem(spec, context);
      lean4Specs.push({ spec, context, lean4Content });

      console.log(`\n📄 Generated Lean4 for ${spec.functionName}:`);
      console.log(`  Theorem: ${lean4Content.theorem.split("\n")[0]}`);
      console.log(`  Type Definitions: ${lean4Content.typeDefinitions.split("\n").length} lines`);
      console.log(`  Helper Lemmas: ${lean4Content.helperLemmas.length} lemmas`);
    }

    console.log("\n💬 Step 5: GitHub Comment Formatting...");
    specSuggestions.forEach((spec: any) => {
      const commentBody = formatSpecComment(spec);
      console.log(`\n📝 Comment for ${spec.functionName}:`);
      console.log(`  Length: ${commentBody.length} characters`);
      console.log(`  Contains actions: ${commentBody.includes("/specsync accept") ? "✅" : "❌"}`);
      console.log(
        `  Contains confidence: ${commentBody.includes(`${spec.confidence}%`) ? "✅" : "❌"}`
      );
    });

    console.log("\n📐 Step 6: CI Integration & Proof Validation...");
    const ciWorkflow = ciIntegration.generateGitHubActionsWorkflow();
    console.log(`  Generated CI workflow: ${ciWorkflow}`);

    console.log("\n📊 Step 7: Spec Coverage Analysis...");
    const coverageAnalysis = await coverageTracker.analyzeSpecCoverage({});
    const coverageReport = coverageTracker.generateCoverageReport(coverageAnalysis);
    console.log(`  Coverage: ${coverageReport.summary.coveragePercentage}%`);
    console.log(
      `  Functions: ${coverageReport.summary.coveredFunctions}/${coverageReport.summary.totalFunctions}`
    );
    console.log(`  Failed Proofs: ${coverageReport.summary.failedProofs}`);

    console.log("\n📟 Step 8: Dashboard (WebDashboard, gated by SPECSYNC_DASHBOARD=1)...");
    console.log(
      `  Dashboard module loaded; start() is a no-op unless SPECSYNC_DASHBOARD=1 and secret set`
    );
    console.log(`  Port default: ${process.env.DASHBOARD_PORT || 3001}`);

    console.log("\n🔁 Step 9: Confidence transparency + Slack alerts...");
    const sampleSuggestion = specSuggestions[0];
    if (sampleSuggestion) {
      const validation = uiPrinciples.validateConfidenceTransparency(sampleSuggestion);
      console.log(
        `  Confidence validation: ${validation.isValid ? "ok" : "fail"} ` +
          `(confidence=${validation.confidenceValue})`
      );
    }
    slackAlerts.initialize();
    console.log(`  Slack alerts initialized (optional SLACK_BOT_TOKEN)`);

    console.log("\n✅ All Tracks Implementation Complete!");
    console.log("\n🎯 Complete SpecSync Implementation:");
    console.log("  ✅ Track A — GitHub Integration + Diff Parser");
    console.log("  ✅ Track B — LLM Prompt Chain");
    console.log("  ✅ Track C — Autoformalization Engine (Enhanced Lean4)");
    console.log("  ✅ Track D — CI Integration & Proof Validation");
    console.log("  ✅ Track E — Spec Coverage & Drift Detection");
    console.log("  ✅ Track F — WebDashboard (.specsync data, secret auth)");
    console.log("  ✅ Track G — Slack alerts + confidence transparency");

    console.log("\n🚀 Production Ready Features:");
    console.log("  📊 Real-time spec coverage tracking");
    console.log("  🔍 Automated drift detection");
    console.log("  📋 Interactive dashboard with recommendations");
    console.log("  🔔 Slack notifications for spec events");
    console.log("  💻 VSCode extension for inline spec management");
    console.log("  ✅ CI/CD integration with Lean4 proof validation");
    console.log("  🎯 Branch protection with proof gating");

    console.log("\n💡 Next Steps:");
    console.log("  1. Set up environment variables for all services");
    console.log("  2. Deploy the complete system to production");
    console.log("  3. Install the VSCode extension for developers");
    console.log("  4. Configure Slack workspace for notifications");
    console.log("  5. Set up monitoring and alerting");
  } catch (error: unknown) {
    console.error("❌ Demo failed:", error);
  }
}

// Helper function to format spec comments (from index.js)
function formatSpecComment(suggestion: any) {
  const {
    functionName,
    filePath,
    lineNumber,
    preconditions,
    postconditions,
    invariants,
    edgeCases,
    confidence,
    reasoning,
  } = suggestion;

  return `## 🤖 SpecSync: Specification for \`${functionName}\`

**File:** \`${filePath}\` (line ${lineNumber})
**Confidence:** ${confidence}%

### 📋 Preconditions
${preconditions.map((pre: any) => `- ${pre}`).join("\n")}

### ✅ Postconditions
${postconditions.map((post: any) => `- ${post}`).join("\n")}

### 🔒 Invariants
${invariants.map((inv: any) => `- ${inv}`).join("\n")}

### ⚠️ Edge Cases
${edgeCases.map((edge: any) => `- ${edge}`).join("\n")}

### 💭 Reasoning
${reasoning}

---

**Actions:**
- ✅ \`/specsync accept\` - Accept this specification
- ✏️ \`/specsync edit\` - Edit the specification
- ❌ \`/specsync ignore\` - Ignore this suggestion
- 🔍 \`/specsync review\` - Request manual review

*Generated by SpecSync AI*`;
}

// Run the demo
runDemo();
