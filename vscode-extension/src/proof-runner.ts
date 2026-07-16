import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export interface ProofFileResult {
  file: string;
  success: boolean;
  output?: string;
  error?: string;
}

/**
 * Runs Lean on `specs/` (and optional `.specsync/lean/`) with cancellable progress.
 * Single instance — cancelProof kills the active child process.
 */
export class ProofRunner {
  private currentProcess: ChildProcess | null = null;
  private readonly outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("SpecSync Proof Runner");
  }

  dispose(): void {
    this.cancel();
    this.outputChannel.dispose();
  }

  cancel(): void {
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
      this.outputChannel.appendLine("Proof execution cancelled");
      vscode.window.showInformationMessage("Proof execution cancelled");
    } else {
      vscode.window.showInformationMessage("No proof run in progress");
    }
  }

  async run(): Promise<void> {
    const config = vscode.workspace.getConfiguration("specsync");
    const leanPath = config.get<string>("leanPath", "lean");

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage("No workspace folder found");
      return;
    }

    const root = workspaceFolder.uri.fsPath;
    const leanFiles = collectLeanFiles(root);
    if (leanFiles.length === 0) {
      vscode.window.showInformationMessage(
        "No Lean files found under specs/ or .specsync/lean/"
      );
      return;
    }

    this.outputChannel.clear();
    this.outputChannel.show(true);

    const progressOptions: vscode.ProgressOptions = {
      location: vscode.ProgressLocation.Notification,
      title: "Running Lean Proofs",
      cancellable: true,
    };

    await vscode.window.withProgress(progressOptions, async (progress, token) => {
      const cancelListener = token.onCancellationRequested(() => {
        this.cancel();
      });

      try {
        progress.report({ message: "Initializing Lean environment..." });

        let successCount = 0;
        const results: ProofFileResult[] = [];
        const totalCount = leanFiles.length;

        for (const filePath of leanFiles) {
          if (token.isCancellationRequested) {
            this.outputChannel.appendLine("Proof execution cancelled by user");
            break;
          }

          const file = path.relative(root, filePath);
          progress.report({
            message: `Processing ${file}...`,
            increment: 100 / totalCount,
          });
          this.outputChannel.appendLine(`\nProcessing ${file}...`);

          try {
            const result = await this.executeLeanFile(leanPath, filePath);
            results.push({ file, success: result.success, output: result.output });
            if (result.success) {
              successCount++;
              this.outputChannel.appendLine(`OK ${file}`);
            } else {
              this.outputChannel.appendLine(`FAIL ${file}`);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            results.push({ file, success: false, error: message });
            this.outputChannel.appendLine(`FAIL ${file} — ${message}`);
          }
        }

        const coverage =
          results.length === 0
            ? 0
            : Math.round((successCount / results.length) * 100);
        const summary = [
          "",
          "## Proof Execution Summary",
          `Coverage: ${coverage}%`,
          `Successful: ${successCount}/${results.length}`,
          `Failed: ${results.length - successCount}`,
          "",
          ...results.map((r) => `${r.success ? "OK" : "FAIL"} ${r.file}`),
        ].join("\n");

        this.outputChannel.appendLine(summary);

        const message = `Proof validation complete: ${successCount}/${results.length} successful (${coverage}% coverage)`;
        if (coverage >= 70) {
          vscode.window.showInformationMessage(message);
        } else {
          vscode.window.showWarningMessage(`${message} — below threshold`);
        }

        await writeProofArtifacts(results, root);
      } finally {
        cancelListener.dispose();
        this.currentProcess = null;
      }
    });
  }

  private executeLeanFile(
    leanPath: string,
    filePath: string
  ): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(leanPath, ["--json", filePath], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.currentProcess = child;

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        this.outputChannel.append(text);
      });

      child.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        this.outputChannel.append(text);
      });

      child.on("close", (code) => {
        if (this.currentProcess === child) {
          this.currentProcess = null;
        }
        if (code === 0) {
          resolve({ success: true, output: stdout });
        } else {
          resolve({ success: false, output: stderr || stdout });
        }
      });

      child.on("error", (error) => {
        if (this.currentProcess === child) {
          this.currentProcess = null;
        }
        reject(error);
      });
    });
  }
}

function collectLeanFiles(workspaceRoot: string): string[] {
  const dirs = [
    path.join(workspaceRoot, "specs"),
    path.join(workspaceRoot, ".specsync", "lean"),
  ];
  const files: string[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      continue;
    }
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith(".lean")) {
        files.push(path.join(dir, name));
      }
    }
  }
  return files;
}

async function writeProofArtifacts(
  results: ProofFileResult[],
  workspacePath: string
): Promise<void> {
  const artifactsDir = path.join(workspacePath, ".specsync", "artifacts");
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const report = {
    timestamp: new Date().toISOString(),
    totalFiles: results.length,
    successfulProofs: results.filter((r) => r.success).length,
    failedProofs: results.filter((r) => !r.success).length,
    coverage:
      results.length === 0
        ? 0
        : Math.round((results.filter((r) => r.success).length / results.length) * 100),
    results,
  };

  fs.writeFileSync(
    path.join(artifactsDir, `proof-report-${timestamp}.json`),
    JSON.stringify(report, null, 2)
  );
  fs.writeFileSync(
    path.join(artifactsDir, "latest-report.json"),
    JSON.stringify(report, null, 2)
  );

  vscode.window.showInformationMessage(`Proof artifacts saved to ${artifactsDir}`);
}
