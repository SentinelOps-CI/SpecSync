import * as vscode from "vscode";
import { ProofRunner } from "./proof-runner";
import {
  getSpecForFunction,
  listSpecs,
  normalizeConfidence,
  relativeSourcePath,
  saveSpec,
  workspaceRootFor,
  type SpecViewModel,
} from "./spec-reader";
import {
  SpecSuggestionProvider,
  addSuggestionToActiveEditor,
  analyzeTextChange,
} from "./suggestion-panel";

let proofRunner: ProofRunner | undefined;
let suggestionProvider: SpecSuggestionProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  proofRunner = new ProofRunner();
  suggestionProvider = new SpecSuggestionProvider();

  const specLensProvider = new SpecLensProvider();
  const specHoverProvider = new SpecHoverProvider();
  const languageSelector: vscode.DocumentSelector = [
    { scheme: "file", language: "javascript" },
    { scheme: "file", language: "typescript" },
    { scheme: "file", language: "typescriptreact" },
    { scheme: "file", language: "javascriptreact" },
    { scheme: "file", language: "python" },
  ];

  context.subscriptions.push(
    proofRunner,
    vscode.window.registerTreeDataProvider("specsync.suggestions", suggestionProvider),
    vscode.languages.registerCodeLensProvider(languageSelector, specLensProvider),
    vscode.languages.registerHoverProvider(languageSelector, specHoverProvider),
    vscode.commands.registerCommand("specsync.showSpec", showSpecification),
    vscode.commands.registerCommand("specsync.editSpec", editSpecification),
    vscode.commands.registerCommand("specsync.runProof", () => proofRunner?.run()),
    vscode.commands.registerCommand("specsync.cancelProof", () => proofRunner?.cancel()),
    vscode.commands.registerCommand("specsync.addSuggestion", addSuggestionToActiveEditor),
    vscode.commands.registerCommand("specsync.refreshSpecs", () => {
      specLensProvider.refresh();
      vscode.window.showInformationMessage("SpecSync: refreshed specs from .specsync/");
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (!suggestionProvider) {
        return;
      }
      for (const change of event.contentChanges) {
        const suggestions = analyzeTextChange(
          change.text,
          change.range.start,
          event.document
        );
        if (suggestions.length > 0) {
          suggestionProvider.updateSuggestions(suggestions);
        }
      }
    })
  );
}

export function deactivate(): void {
  proofRunner = undefined;
  suggestionProvider = undefined;
}

class SpecLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const codeLenses: vscode.CodeLens[] = [];
    for (const func of findFunctions(document)) {
      const spec = getSpecForFunction(func.name, document.fileName);
      if (!spec) {
        continue;
      }
      const range = new vscode.Range(func.line, 0, func.line, 0);
      const confidence = normalizeConfidence(spec.confidence, 0);
      const confidenceEmoji = confidence >= 0.8 ? "🟢" : confidence >= 0.6 ? "🟡" : "🔴";
      const confidenceText =
        confidence >= 0.8 ? "High" : confidence >= 0.6 ? "Medium" : "Low";
      const invariant = spec.invariants[0] || "No invariant";

      codeLenses.push(
        new vscode.CodeLens(range, {
          title: `Spec: [${invariant}] ${confidenceEmoji} ${confidenceText}`,
          command: "specsync.showSpec",
          arguments: [func.name, spec],
        })
      );
    }
    return codeLenses;
  }
}

class SpecHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Hover> {
    const functionName = getFunctionAtLine(document, position.line);
    if (!functionName) {
      return null;
    }

    const spec = getSpecForFunction(functionName, document.fileName);
    if (!spec) {
      return null;
    }

    const confidence = normalizeConfidence(spec.confidence, 0);
    const confidenceEmoji = confidence >= 0.8 ? "🟢" : confidence >= 0.6 ? "🟡" : "🔴";
    const confidenceText =
      confidence >= 0.8 ? "High" : confidence >= 0.6 ? "Medium" : "Low";

    const content = new vscode.MarkdownString();
    content.appendMarkdown(`## Specification for \`${functionName}\`\n\n`);
    content.appendMarkdown(
      `**Confidence:** ${confidenceEmoji} ${confidenceText} (${Math.round(confidence * 100)}%)\n`
    );

    if (spec.preconditions.length > 0) {
      content.appendMarkdown(`\n### Preconditions\n`);
      for (const pre of spec.preconditions) {
        content.appendMarkdown(`- ${pre}\n`);
      }
    }
    if (spec.postconditions.length > 0) {
      content.appendMarkdown(`\n### Postconditions\n`);
      for (const post of spec.postconditions) {
        content.appendMarkdown(`- ${post}\n`);
      }
    }
    if (spec.invariants.length > 0) {
      content.appendMarkdown(`\n### Invariants\n`);
      for (const inv of spec.invariants) {
        content.appendMarkdown(`- ${inv}\n`);
      }
    }
    if (spec.reasoning) {
      content.appendMarkdown(`\n### Reasoning\n${spec.reasoning}\n`);
    }

    return new vscode.Hover(content);
  }
}

function findFunctions(
  document: vscode.TextDocument
): Array<{ name: string; line: number }> {
  const functions: Array<{ name: string; line: number }> = [];
  const text = document.getText();
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const name = matchFunctionName(lines[i]);
    if (name) {
      functions.push({ name, line: i });
    }
  }
  return functions;
}

function getFunctionAtLine(document: vscode.TextDocument, line: number): string | null {
  return matchFunctionName(document.lineAt(line).text);
}

function matchFunctionName(line: string): string | null {
  const patterns = [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/,
    /def\s+(\w+)\s*\(/,
  ];
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

async function resolveSpec(
  functionName?: string,
  spec?: SpecViewModel
): Promise<{ functionName: string; spec: SpecViewModel } | null> {
  if (functionName && spec) {
    return { functionName, spec };
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("No active editor");
    return null;
  }

  const name =
    functionName ||
    getFunctionAtLine(editor.document, editor.selection.active.line) ||
    (await pickFunctionFromSpecs(editor.document.fileName));

  if (!name) {
    vscode.window.showErrorMessage("No function selected");
    return null;
  }

  const resolved =
    spec ||
    getSpecForFunction(name, editor.document.fileName, { respectThreshold: false });
  if (!resolved) {
    vscode.window.showErrorMessage(`No specification found for ${name} in .specsync/specs/`);
    return null;
  }

  return { functionName: name, spec: resolved };
}

async function pickFunctionFromSpecs(sourceFilePath: string): Promise<string | undefined> {
  const root = workspaceRootFor(sourceFilePath);
  if (!root) {
    return undefined;
  }
  const specs = listSpecs(root);
  if (specs.length === 0) {
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    specs.map((s) => ({
      label: s.functionName,
      description: s.filePath,
      detail: `${Math.round(normalizeConfidence(s.confidence, 0) * 100)}% confidence`,
    })),
    { placeHolder: "Select a function with a stored spec" }
  );
  return picked?.label;
}

async function showSpecification(functionName?: string, spec?: SpecViewModel): Promise<void> {
  const resolved = await resolveSpec(functionName, spec);
  if (!resolved) {
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "specSyncSpec",
    `Specification: ${resolved.functionName}`,
    vscode.ViewColumn.Beside,
    { enableScripts: false, retainContextWhenHidden: true }
  );
  panel.webview.html = generateSpecViewHTML(resolved.spec);
}

async function editSpecification(functionName?: string, spec?: SpecViewModel): Promise<void> {
  const resolved = await resolveSpec(functionName, spec);
  if (!resolved) {
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "specSyncEdit",
    `Edit Specification: ${resolved.functionName}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const working: SpecViewModel = { ...resolved.spec };
  if (!working.filePath) {
    const editor = vscode.window.activeTextEditor;
    const root = editor && workspaceRootFor(editor.document.fileName);
    if (editor && root) {
      working.filePath = relativeSourcePath(root, editor.document.fileName);
    }
  }

  panel.webview.html = generateSpecEditHTML(resolved.functionName, working);

  panel.webview.onDidReceiveMessage(async (message) => {
    if (message?.command !== "saveSpec" || !message.data) {
      return;
    }
    try {
      const data = message.data as {
        confidence: number;
        preconditions: string[];
        postconditions: string[];
        invariants: string[];
        reasoning: string;
      };
      working.confidence = normalizeConfidence(data.confidence, working.confidence);
      working.preconditions = data.preconditions || [];
      working.postconditions = data.postconditions || [];
      working.invariants = data.invariants || [];
      working.reasoning = data.reasoning || "";
      const savedPath = saveSpec(working);
      vscode.window.showInformationMessage(`Saved specification to ${savedPath}`);
      panel.dispose();
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to save specification: ${errMessage}`);
    }
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateSpecViewHTML(spec: SpecViewModel): string {
  const confidence = normalizeConfidence(spec.confidence, 0);
  const confidenceEmoji = confidence >= 0.8 ? "🟢" : confidence >= 0.6 ? "🟡" : "🔴";
  const confidenceText =
    confidence >= 0.8 ? "High" : confidence >= 0.6 ? "Medium" : "Low";
  const confidenceColor =
    confidence >= 0.8 ? "#28a745" : confidence >= 0.6 ? "#ffc107" : "#dc3545";

  const list = (items: string[]) =>
    items.map((item) => `<div class="spec-item">${escapeHtml(item)}</div>`).join("") ||
    "<div class=\"spec-item\">(none)</div>";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SpecSync Specification</title>
  <style>
    body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground); }
    .spec-section { margin-bottom: 20px; }
    .spec-section h3 { margin-bottom: 10px; }
    .spec-item { background: var(--vscode-editor-inactiveSelectionBackground); padding: 8px; margin: 5px 0; border-radius: 4px; }
    .confidence-badge { display: inline-block; padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; background: ${confidenceColor}; color: white; }
    .reasoning { background: var(--vscode-textBlockQuote-background); padding: 15px; border-radius: 4px; margin-top: 15px; }
  </style>
</head>
<body>
  <h2>Specification: ${escapeHtml(spec.functionName)}</h2>
  <p><span class="confidence-badge">${confidenceEmoji} ${confidenceText} (${Math.round(confidence * 100)}%)</span></p>
  <div class="spec-section"><h3>Preconditions</h3>${list(spec.preconditions)}</div>
  <div class="spec-section"><h3>Postconditions</h3>${list(spec.postconditions)}</div>
  <div class="spec-section"><h3>Invariants</h3>${list(spec.invariants)}</div>
  <div class="reasoning"><h3>Reasoning</h3><p>${escapeHtml(spec.reasoning || "")}</p></div>
</body>
</html>`;
}

function generateSpecEditHTML(functionName: string, spec: SpecViewModel): string {
  const confidencePct = Math.round(normalizeConfidence(spec.confidence, 0) * 100);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Edit Specification</title>
  <style>
    body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground); }
    .form-group { margin-bottom: 15px; }
    label { display: block; margin-bottom: 5px; font-weight: bold; }
    textarea, input[type="range"] { width: 100%; }
    textarea { min-height: 80px; padding: 8px; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
  </style>
</head>
<body>
  <h2>Edit Specification: ${escapeHtml(functionName)}</h2>
  <form id="specForm">
    <div class="form-group">
      <label>Confidence (<span id="confidenceValue">${confidencePct}</span>%)</label>
      <input type="range" id="confidence" min="0" max="100" value="${confidencePct}">
    </div>
    <div class="form-group">
      <label>Preconditions (one per line)</label>
      <textarea id="preconditions">${escapeHtml(spec.preconditions.join("\n"))}</textarea>
    </div>
    <div class="form-group">
      <label>Postconditions (one per line)</label>
      <textarea id="postconditions">${escapeHtml(spec.postconditions.join("\n"))}</textarea>
    </div>
    <div class="form-group">
      <label>Invariants (one per line)</label>
      <textarea id="invariants">${escapeHtml(spec.invariants.join("\n"))}</textarea>
    </div>
    <div class="form-group">
      <label>Reasoning</label>
      <textarea id="reasoning">${escapeHtml(spec.reasoning || "")}</textarea>
    </div>
    <button type="submit">Save Changes</button>
  </form>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('confidence').addEventListener('input', function () {
      document.getElementById('confidenceValue').textContent = this.value;
    });
    document.getElementById('specForm').addEventListener('submit', function (e) {
      e.preventDefault();
      vscode.postMessage({
        command: 'saveSpec',
        data: {
          confidence: parseInt(document.getElementById('confidence').value, 10) / 100,
          preconditions: document.getElementById('preconditions').value.split('\\n').filter(function (l) { return l.trim(); }),
          postconditions: document.getElementById('postconditions').value.split('\\n').filter(function (l) { return l.trim(); }),
          invariants: document.getElementById('invariants').value.split('\\n').filter(function (l) { return l.trim(); }),
          reasoning: document.getElementById('reasoning').value
        }
      });
    });
  </script>
</body>
</html>`;
}
