#!/usr/bin/env node

/**
 * SpecSync deployment verification (pre-flight checks).
 */

const fs = require("fs");

console.log("SpecSync deployment verification\n");

const criticalFiles = [
  "package.json",
  "tsconfig.json",
  "src/index.ts",
  "Dockerfile",
  "env.example",
  ".github/workflows/lean4-ci.yml",
  ".github/workflows/node-ci.yml",
  "src/github-ui.ts",
  "vscode-extension/src/extension.ts",
  "src/web-dashboard.ts",
  "src/slack-alerts.ts",
  "src/ui-principles.ts",
  "src/health.ts",
  "vscode-extension/package.json",
  "test/github-ui.test.ts",
  "test/ui-principles.test.ts",
  "test/slack-alerts.test.ts",
];

let ok = true;

console.log("Checking critical files...");
criticalFiles.forEach((file) => {
  if (fs.existsSync(file)) {
    console.log(`  OK ${file}`);
  } else {
    console.log(`  MISSING ${file}`);
    ok = false;
  }
});

console.log("\nEnvironment template (Probot names)...");
if (fs.existsSync("env.example")) {
  const envContent = fs.readFileSync("env.example", "utf8");
  const required = ["APP_ID", "PRIVATE_KEY", "WEBHOOK_SECRET"];
  const missing = required.filter((v) => !envContent.includes(`${v}=`));
  if (missing.length === 0) {
    console.log("  OK env.example lists APP_ID, PRIVATE_KEY, WEBHOOK_SECRET");
  } else {
    console.log(`  WARN missing placeholders: ${missing.join(", ")}`);
    ok = false;
  }
} else {
  console.log("  MISSING env.example");
  ok = false;
}

console.log("\nLean CI workflow...");
if (fs.existsSync(".github/workflows/lean4-ci.yml")) {
  const w = fs.readFileSync(".github/workflows/lean4-ci.yml", "utf8");
  if (w.includes("lean-action") && w.includes("lake")) {
    console.log("  OK lean4 workflow references lake / lean-action");
  } else {
    console.log("  WARN lean4 workflow may be outdated");
  }
} else {
  ok = false;
}

console.log("\nNode CI workflow...");
if (fs.existsSync(".github/workflows/node-ci.yml")) {
  console.log("  OK node-ci.yml present");
} else {
  console.log("  MISSING node-ci.yml");
  ok = false;
}

console.log("\n---");
if (ok) {
  console.log("Result: ready (run npm ci && npm run build && npm test before deploy)");
  process.exit(0);
}
console.log("Result: not ready — fix items above");
process.exit(1);
