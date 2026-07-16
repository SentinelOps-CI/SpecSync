import * as path from "path";
import * as vscode from "vscode";
import { appendClauseToSpec, normalizeConfidence, relativeSourcePath } from "./spec-reader";

export type SuggestionKind = "precondition" | "postcondition" | "invariant";

export class SpecSuggestionItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly confidence: number,
    public readonly reasoning: string,
    public readonly type: SuggestionKind
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);

    const pct = Math.round(normalizeConfidence(confidence, 0) * 100);
    this.tooltip = `Confidence: ${pct}%\nReasoning: ${reasoning}`;
    this.description = `${pct}% confidence`;
    this.contextValue = "specSuggestion";
    this.iconPath = new vscode.ThemeIcon("lightbulb");
    this.command = {
      command: "specsync.addSuggestion",
      title: "Add Suggestion",
      arguments: [this],
    };
  }
}

export class SpecSuggestionProvider implements vscode.TreeDataProvider<SpecSuggestionItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    SpecSuggestionItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private suggestions: SpecSuggestionItem[] = [];

  getTreeItem(element: SpecSuggestionItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SpecSuggestionItem): Thenable<SpecSuggestionItem[]> {
    if (element) {
      return Promise.resolve([]);
    }
    return Promise.resolve(this.suggestions);
  }

  updateSuggestions(newSuggestions: SpecSuggestionItem[]): void {
    this.suggestions = newSuggestions;
    this._onDidChangeTreeData.fire();
  }

  clear(): void {
    this.suggestions = [];
    this._onDidChangeTreeData.fire();
  }
}

/** Heuristic local suggestions (confidence always 0–1). */
export function analyzeTextChange(
  text: string,
  _position: vscode.Position,
  _document: vscode.TextDocument
): SpecSuggestionItem[] {
  const suggestions: SpecSuggestionItem[] = [];

  if (text.includes("balance -= amount")) {
    suggestions.push(
      new SpecSuggestionItem(
        "Ensure balance ≥ 0",
        0.85,
        "Detected balance reduction — should maintain non-negative balance",
        "invariant"
      )
    );
  }

  if (text.includes("return result")) {
    suggestions.push(
      new SpecSuggestionItem(
        "Result is not null",
        0.9,
        "Function returns a value — should ensure it is not null",
        "postcondition"
      )
    );
  }

  if (text.includes("if (input")) {
    suggestions.push(
      new SpecSuggestionItem(
        "Input is validated",
        0.8,
        "Detected input validation — should document precondition",
        "precondition"
      )
    );
  }

  return suggestions;
}

function getFunctionNearPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): string | null {
  for (let line = position.line; line >= Math.max(0, position.line - 40); line--) {
    const match = document.lineAt(line).text.match(
      /(?:(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\()/
    );
    if (match) {
      return match[1] || match[2] || null;
    }
  }
  return null;
}

export async function addSuggestionToActiveEditor(
  suggestion: SpecSuggestionItem
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("No active editor");
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!workspaceFolder) {
    vscode.window.showErrorMessage("No workspace folder for active editor");
    return;
  }

  const functionName = getFunctionNearPosition(editor.document, editor.selection.active);
  if (!functionName) {
    vscode.window.showErrorMessage("No function found near the cursor");
    return;
  }

  const rel = relativeSourcePath(workspaceFolder.uri.fsPath, editor.document.fileName);
  try {
    const saved = appendClauseToSpec(
      workspaceFolder.uri.fsPath,
      rel,
      functionName,
      suggestion.type,
      suggestion.label
    );
    vscode.window.showInformationMessage(
      `Added ${suggestion.type} to ${functionName} (${path.basename(saved)})`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to save suggestion: ${message}`);
  }
}
