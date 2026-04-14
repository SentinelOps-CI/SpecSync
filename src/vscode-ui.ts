// @ts-nocheck
const fs = require("fs-extra");
const path = require("path");
const { exec } = require("child_process");

export class VSCodeUI {
  constructor() {
    this.specCache = new Map();
    this.suggestionPanel = null;
    this.proofRunner = null;
  }

  /**
   * Enhanced Prompt 2.1 — SpecLens Inline Annotation
   * Goal: Display current verified invariant above each function while editing.
   * Inputs: Local AST, .specsync/spec.json cache.
   * Explicit Outputs: Inline annotation with clickable mini-editor
   */
  generateSpecLensExtension() {
    return {
      name: "specsync-spec-lens",
      displayName: "SpecSync SpecLens",
      description: "Inline specification annotations for functions",
      version: "1.0.0",
      publisher: "specsync",
      categories: ["Programming Languages", "Other"],
      activationEvents: ["onLanguage:javascript", "onLanguage:typescript", "onLanguage:python"],
      main: "./out/extension.js",
      contributes: {
        commands: [
          {
            command: "specsync.showSpec",
            title: "Show Specification",
            category: "SpecSync",
          },
          {
            command: "specsync.editSpec",
            title: "Edit Specification",
            category: "SpecSync",
          },
          {
            command: "specsync.runProof",
            title: "Run Lean Proof",
            category: "SpecSync",
          },
        ],
        configuration: {
          title: "SpecSync",
          properties: {
            "specsync.specCachePath": {
              type: "string",
              default: ".specsync/spec.json",
              description: "Path to spec cache file",
            },
            "specsync.leanPath": {
              type: "string",
              default: "lean",
              description: "Path to Lean executable",
            },
            "specsync.confidenceThreshold": {
              type: "number",
              default: 0.7,
              description: "Minimum confidence for displaying suggestions",
            },
          },
        },
      },
    };
  }

  /**
   * Enhanced generate SpecLens TypeScript implementation with confidence transparency
   * @returns {string} TypeScript code
   */
  generateSpecLensTypeScript() {
    return `import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  const specLensProvider = new SpecLensProvider();
  const specHoverProvider = new SpecHoverProvider();
  
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', language: 'javascript' },
      specLensProvider
    ),
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', language: 'typescript' },
      specLensProvider
    ),
    vscode.languages.registerHoverProvider(
      { scheme: 'file', language: 'javascript' },
      specHoverProvider
    ),
    vscode.languages.registerHoverProvider(
      { scheme: 'file', language: 'typescript' },
      specHoverProvider
    )
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('specsync.showSpec', showSpecification),
    vscode.commands.registerCommand('specsync.editSpec', editSpecification),
    vscode.commands.registerCommand('specsync.runProof', runLeanProof)
  );
}

class SpecLensProvider implements vscode.CodeLensProvider {
  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const codeLenses: vscode.CodeLens[] = [];
    const functions = this.findFunctions(document);
    
    for (const func of functions) {
      const spec = await this.getSpecForFunction(func.name, document.fileName);
      if (spec) {
        const range = new vscode.Range(func.line, 0, func.line, 0);
        
        // Confidence transparency (Prompt 5.2)
        const confidenceEmoji = spec.confidence >= 0.8 ? '🟢' : spec.confidence >= 0.6 ? '🟡' : '🔴';
        const confidenceText = spec.confidence >= 0.8 ? 'High' : spec.confidence >= 0.6 ? 'Medium' : 'Low';
        
        codeLenses.push(
          new vscode.CodeLens(range, {
            title: \`🔍 Spec: [\${spec.invariants[0] || 'No invariant'}] \${confidenceEmoji} \${confidenceText}\`,
            command: 'specsync.showSpec',
            arguments: [func.name, spec]
          })
        );
      }
    }
    
    return codeLenses;
  }

  private findFunctions(document: vscode.TextDocument): Array<{name: string, line: number}> {
    const functions: Array<{name: string, line: number}> = [];
    const text = document.getText();
    const lines = text.split('\\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const functionMatch = line.match(/function\\s+(\\w+)\\s*\\(/);
      if (functionMatch) {
        functions.push({
          name: functionMatch[1],
          line: i
        });
      }
    }
    
    return functions;
  }

  private async getSpecForFunction(functionName: string, filePath: string): Promise<any> {
    const config = vscode.workspace.getConfiguration('specsync');
    const cachePath = config.get('specCachePath', '.specsync/spec.json');
    const confidenceThreshold = config.get('confidenceThreshold', 0.7);
    
    try {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
      if (!workspaceFolder) return null;
      
      const fullCachePath = path.join(workspaceFolder.uri.fsPath, cachePath);
      if (!fs.existsSync(fullCachePath)) return null;
      
      const cacheContent = fs.readFileSync(fullCachePath, 'utf8');
      const cache = JSON.parse(cacheContent);
      
      const key = \`\${workspaceFolder.name}:\${functionName}\`;
      const spec = cache[key] || null;
      
      // Filter by confidence threshold
      if (spec && spec.confidence < confidenceThreshold) {
        return null;
      }
      
      return spec;
    } catch (error) {
      console.error('Error reading spec cache:', error);
      return null;
    }
  }
}

class SpecHoverProvider implements vscode.HoverProvider {
  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
    const functionName = this.getFunctionAtPosition(document, position);
    if (!functionName) return null;
    
    return this.getSpecHover(functionName, document.fileName);
  }

  private getFunctionAtPosition(document: vscode.TextDocument, position: vscode.Position): string | null {
    const line = document.lineAt(position.line);
    const functionMatch = line.text.match(/function\\s+(\\w+)\\s*\\(/);
    return functionMatch ? functionMatch[1] : null;
  }

  private async getSpecHover(functionName: string, filePath: string): Promise<vscode.Hover> {
    const spec = await this.getSpecForFunction(functionName, filePath);
    if (!spec) return null;
    
    const content = new vscode.MarkdownString();
    
    // Confidence transparency (Prompt 5.2)
    const confidenceEmoji = spec.confidence >= 0.8 ? '🟢' : spec.confidence >= 0.6 ? '🟡' : '🔴';
    const confidenceText = spec.confidence >= 0.8 ? 'High' : spec.confidence >= 0.6 ? 'Medium' : 'Low';
    
    content.appendMarkdown(\`## Specification for \`\${functionName}\`\`\`);
    content.appendMarkdown(\`\\n\\n**Confidence:** \${confidenceEmoji} \${confidenceText} (\${Math.round(spec.confidence * 100)}%)\`\`);
    
    if (spec.preconditions.length > 0) {
      content.appendMarkdown(\`\\n\\n### Preconditions\\n\`);
      spec.preconditions.forEach(pre => {
        content.appendMarkdown(\`- \${pre}\\n\`);
      });
    }
    
    if (spec.postconditions.length > 0) {
      content.appendMarkdown(\`\\n\\n### Postconditions\\n\`);
      spec.postconditions.forEach(post => {
        content.appendMarkdown(\`- \${post}\\n\`);
      });
    }
    
    if (spec.invariants.length > 0) {
      content.appendMarkdown(\`\\n\\n### Invariants\\n\`);
      spec.invariants.forEach(inv => {
        content.appendMarkdown(\`- \${inv}\\n\`);
      });
    }
    
    // Add reasoning if available
    if (spec.reasoning) {
      content.appendMarkdown(\`\\n\\n### Reasoning\\n\`);
      content.appendMarkdown(\`\${spec.reasoning}\\n\`);
    }
    
    return new vscode.Hover(content);
  }

  private async getSpecForFunction(functionName: string, filePath: string): Promise<any> {
    // Same implementation as SpecLensProvider
    const config = vscode.workspace.getConfiguration('specsync');
    const cachePath = config.get('specCachePath', '.specsync/spec.json');
    const confidenceThreshold = config.get('confidenceThreshold', 0.7);
    
    try {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
      if (!workspaceFolder) return null;
      
      const fullCachePath = path.join(workspaceFolder.uri.fsPath, cachePath);
      if (!fs.existsSync(fullCachePath)) return null;
      
      const cacheContent = fs.readFileSync(fullCachePath, 'utf8');
      const cache = JSON.parse(cacheContent);
      
      const key = \`\${workspaceFolder.name}:\${functionName}\`;
      const spec = cache[key] || null;
      
      // Filter by confidence threshold
      if (spec && spec.confidence < confidenceThreshold) {
        return null;
      }
      
      return spec;
    } catch (error) {
      console.error('Error reading spec cache:', error);
      return null;
    }
  }
}

async function showSpecification(functionName: string, spec: any) {
  const panel = vscode.window.createWebviewPanel(
    'specSyncSpec',
    \`Specification: \${functionName}\`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  );
  
  panel.webview.html = generateSpecViewHTML(spec);
}

async function editSpecification(functionName: string) {
  const spec = await getSpecForFunction(functionName);
  if (!spec) {
    vscode.window.showErrorMessage(\`No specification found for \${functionName}\`);
    return;
  }
  
  const panel = vscode.window.createWebviewPanel(
    'specSyncEdit',
    \`Edit Specification: \${functionName}\`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  );
  
  panel.webview.html = generateSpecEditHTML(functionName, spec);
}

async function runLeanProof() {
  const config = vscode.workspace.getConfiguration('specsync');
  const leanPath = config.get('leanPath', 'lean');
  
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }
  
  const specsDir = path.join(workspaceFolder.uri.fsPath, 'specs');
  if (!fs.existsSync(specsDir)) {
    vscode.window.showErrorMessage('No specs directory found');
    return;
  }
  
  const progressOptions = {
    location: vscode.ProgressLocation.Notification,
    title: 'Running Lean Proofs',
    cancellable: true
  };
  
  await vscode.window.withProgress(progressOptions, async (progress, token) => {
    try {
      progress.report({ message: 'Initializing Lean environment...' });
      
      let successCount = 0;
      let totalCount = 0;
      const results: any[] = [];
      
      const leanFiles = fs.readdirSync(specsDir).filter(f => f.endsWith('.lean'));
      totalCount = leanFiles.length;
      
      for (const file of leanFiles) {
        if (token.isCancellationRequested) {
          vscode.window.showInformationMessage('Proof execution cancelled');
          break;
        }
        
        const filePath = path.join(specsDir, file);
        progress.report({ 
          message: \`Processing \${file}...\`,
          increment: 100 / totalCount
        });
        
        try {
          const result = await executeLeanFile(leanPath, filePath);
          results.push({ file, success: result.success, output: result.output });
          
          if (result.success) {
            successCount++;
          }
        } catch (error) {
          results.push({ file, success: false, error: error.message });
        }
      }
      
      const coverage = Math.round((successCount / totalCount) * 100);
      
      // Show results with confidence transparency
      const message = \`Proof validation complete: \${successCount}/\${totalCount} successful (\${coverage}% coverage)\`;
      
      if (coverage >= 70) {
        vscode.window.showInformationMessage(message);
      } else {
        vscode.window.showWarningMessage(message + ' - Below threshold');
      }
      
      // Generate artifacts
      await generateProofArtifacts(results, workspaceFolder.uri.fsPath);
      
    } catch (error) {
      vscode.window.showErrorMessage(\`Proof execution failed: \${error.message}\`);
    }
  });
}

function executeLeanFile(leanPath: string, filePath: string): Promise<{success: boolean, output: string}> {
  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');
    exec(\`\${leanPath} --json "\${filePath}"\`, { timeout: 30000 }, (error: any, stdout: string, stderr: string) => {
      if (error) {
        resolve({ success: false, output: stderr });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
}

async function generateProofArtifacts(results: any[], workspacePath: string) {
  const artifactsDir = path.join(workspacePath, '.specsync', 'artifacts');
  
  // Ensure artifacts directory exists
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(artifactsDir, \`proof-report-\${timestamp}.json\`);
  
  const report = {
    timestamp: new Date().toISOString(),
    totalFiles: results.length,
    successfulProofs: results.filter(r => r.success).length,
    failedProofs: results.filter(r => !r.success).length,
    coverage: Math.round((results.filter(r => r.success).length / results.length) * 100),
    results: results
  };
  
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  // Create a summary file
  const summaryPath = path.join(artifactsDir, 'latest-report.json');
  fs.writeFileSync(summaryPath, JSON.stringify(report, null, 2));
  
  vscode.window.showInformationMessage(\`Proof artifacts saved to \${artifactsDir}\`);
}

function generateSpecViewHTML(spec: any): string {
  // Confidence transparency (Prompt 5.2)
  const confidenceEmoji = spec.confidence >= 0.8 ? '🟢' : spec.confidence >= 0.6 ? '🟡' : '🔴';
  const confidenceText = spec.confidence >= 0.8 ? 'High' : spec.confidence >= 0.6 ? 'Medium' : 'Low';
  const confidenceColor = spec.confidence >= 0.8 ? '#28a745' : spec.confidence >= 0.6 ? '#ffc107' : '#dc3545';
  
  return \`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SpecSync Specification</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; }
    .spec-section { margin-bottom: 20px; }
    .spec-section h3 { color: #0366d6; margin-bottom: 10px; }
    .spec-item { background: #f6f8fa; padding: 8px; margin: 5px 0; border-radius: 4px; }
    .confidence { color: \${confidenceColor}; font-weight: bold; }
    .reasoning { background: #fff3cd; padding: 15px; border-radius: 4px; margin-top: 15px; }
    .confidence-badge { display: inline-block; padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; background: \${confidenceColor}; color: white; }
  </style>
</head>
<body>
  <h2>Specification Details</h2>
  <div class="confidence">
    <span class="confidence-badge">\${confidenceEmoji} \${confidenceText} Confidence (\${Math.round(spec.confidence * 100)}%)</span>
  </div>
  
  <div class="spec-section">
    <h3>Preconditions</h3>
    \${spec.preconditions.map(pre => \`<div class="spec-item">\${pre}</div>\`).join('')}
  </div>
  
  <div class="spec-section">
    <h3>Postconditions</h3>
    \${spec.postconditions.map(post => \`<div class="spec-item">\${post}</div>\`).join('')}
  </div>
  
  <div class="spec-section">
    <h3>Invariants</h3>
    \${spec.invariants.map(inv => \`<div class="spec-item">\${inv}</div>\`).join('')}
  </div>
  
  <div class="reasoning">
    <h3>Reasoning</h3>
    <p>\${spec.reasoning}</p>
  </div>
</body>
</html>
\`;
}

function generateSpecEditHTML(functionName: string, spec: any): string {
  return \`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Edit Specification</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; }
    .form-group { margin-bottom: 15px; }
    label { display: block; margin-bottom: 5px; font-weight: bold; }
    textarea { width: 100%; min-height: 80px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
    button { background: #0366d6; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #0256b3; }
    .confidence-slider { width: 100%; margin: 10px 0; }
  </style>
</head>
<body>
  <h2>Edit Specification: \${functionName}</h2>
  
  <form id="specForm">
    <div class="form-group">
      <label>Confidence Level (\${Math.round(spec.confidence * 100)}%)</label>
      <input type="range" id="confidence" min="0" max="100" value="\${Math.round(spec.confidence * 100)}" class="confidence-slider">
      <span id="confidenceValue">\${Math.round(spec.confidence * 100)}%</span>
    </div>
    
    <div class="form-group">
      <label>Preconditions (one per line):</label>
      <textarea name="preconditions" id="preconditions">\${spec.preconditions.join('\\n')}</textarea>
    </div>
    
    <div class="form-group">
      <label>Postconditions (one per line):</label>
      <textarea name="postconditions" id="postconditions">\${spec.postconditions.join('\\n')}</textarea>
    </div>
    
    <div class="form-group">
      <label>Invariants (one per line):</label>
      <textarea name="invariants" id="invariants">\${spec.invariants.join('\\n')}</textarea>
    </div>
    
    <div class="form-group">
      <label>Reasoning:</label>
      <textarea name="reasoning" id="reasoning">\${spec.reasoning}</textarea>
    </div>
    
    <button type="submit">Save Changes</button>
  </form>
  
  <script>
    // Update confidence display
    document.getElementById('confidence').addEventListener('input', function() {
      document.getElementById('confidenceValue').textContent = this.value + '%';
    });
    
    document.getElementById('specForm').addEventListener('submit', function(e) {
      e.preventDefault();
      
      const formData = {
        confidence: parseInt(document.getElementById('confidence').value) / 100,
        preconditions: document.getElementById('preconditions').value.split('\\n').filter(line => line.trim()),
        postconditions: document.getElementById('postconditions').value.split('\\n').filter(line => line.trim()),
        invariants: document.getElementById('invariants').value.split('\\n').filter(line => line.trim()),
        reasoning: document.getElementById('reasoning').value
      };
      
      // Send message to extension
      vscode.postMessage({
        command: 'saveSpec',
        data: formData
      });
    });
  </script>
</body>
</html>
\`;
}

export function deactivate() {}
`;
  }

  /**
   * Prompt 2.2 — Spec Suggestion Panel
   * Goal: Real-time side panel surfacing speculative invariants as developer types.
   */
  generateSuggestionPanel() {
    return {
      name: "specsync-suggestion-panel",
      displayName: "SpecSync Suggestion Panel",
      description: "Real-time spec suggestions as you type",
      version: "1.0.0",
      publisher: "specsync",
      categories: ["Programming Languages", "Other"],
      activationEvents: ["onLanguage:javascript", "onLanguage:typescript"],
      main: "./out/suggestion-panel.js",
      contributes: {
        viewsContainers: {
          activitybar: [
            {
              id: "specsync-suggestions",
              title: "SpecSync Suggestions",
              icon: "resources/specsync-icon.svg",
            },
          ],
        },
        views: {
          "specsync-suggestions": [
            {
              id: "specsync-suggestion-list",
              name: "Suggestions",
              when: "true",
            },
          ],
        },
        commands: [
          {
            command: "specsync.addSuggestion",
            title: "Add Suggestion",
            category: "SpecSync",
          },
        ],
      },
    };
  }

  /**
   * Generate suggestion panel TypeScript implementation
   * @returns {string} TypeScript code
   */
  generateSuggestionPanelTypeScript() {
    return `import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  const suggestionProvider = new SpecSuggestionProvider();
  
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('specsync-suggestion-list', suggestionProvider),
    vscode.commands.registerCommand('specsync.addSuggestion', addSuggestion)
  );
  
  // Listen for text changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(handleTextChange)
  );
}

class SpecSuggestionProvider implements vscode.TreeDataProvider<SpecSuggestion> {
  private _onDidChangeTreeData: vscode.EventEmitter<SpecSuggestion | undefined | null | undefined> = new vscode.EventEmitter<SpecSuggestion | undefined | null | undefined>();
  readonly onDidChangeTreeData: vscode.Event<SpecSuggestion | undefined | null | undefined> = this._onDidChangeTreeData.event;
  
  private suggestions: SpecSuggestion[] = [];
  
  getTreeItem(element: SpecSuggestion): vscode.TreeItem {
    return element;
  }
  
  getChildren(element?: SpecSuggestion): Thenable<SpecSuggestion[]> {
    if (element) {
      return Promise.resolve([]);
    }
    return Promise.resolve(this.suggestions);
  }
  
  updateSuggestions(newSuggestions: SpecSuggestion[]) {
    this.suggestions = newSuggestions;
    this._onDidChangeTreeData.fire(undefined);
  }
}

class SpecSuggestion extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly confidence: number,
    public readonly reasoning: string,
    public readonly type: 'precondition' | 'postcondition' | 'invariant'
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    
    this.tooltip = \`Confidence: \${confidence}%\\nReasoning: \${reasoning}\`;
    this.description = \`\${confidence}% confidence\`;
    this.contextValue = 'specSuggestion';
    
    this.command = {
      command: 'specsync.addSuggestion',
      title: 'Add Suggestion',
      arguments: [this]
    };
  }
  
  iconPath = new vscode.ThemeIcon('lightbulb');
}

async function handleTextChange(event: vscode.TextDocumentChangeEvent) {
  const document = event.document;
  const changes = event.contentChanges;
  
  for (const change of changes) {
    const text = change.text;
    const position = change.range.start;
    
    // Analyze the change for potential spec suggestions
    const suggestions = await analyzeTextChange(text, position, document);
    
    if (suggestions.length > 0) {
      // Update the suggestion panel
      const provider = vscode.workspace.getConfiguration('specsync').get('suggestionProvider');
      if (provider) {
        provider.updateSuggestions(suggestions);
      }
    }
  }
}

async function analyzeTextChange(text: string, position: vscode.Position, document: vscode.TextDocument): Promise<SpecSuggestion[]> {
  const suggestions: SpecSuggestion[] = [];
  
  // Simple pattern matching for common cases
  if (text.includes('balance -= amount')) {
    suggestions.push(new SpecSuggestion(
      'Ensure balance ≥ 0',
      85,
      'Detected balance reduction - should maintain non-negative balance',
      'invariant'
    ));
  }
  
  if (text.includes('return result')) {
    suggestions.push(new SpecSuggestion(
      'Result is not null',
      90,
      'Function returns a value - should ensure it\'s not null',
      'postcondition'
    ));
  }
  
  if (text.includes('if (input')) {
    suggestions.push(new SpecSuggestion(
      'Input is validated',
      80,
      'Detected input validation - should document precondition',
      'precondition'
    ));
  }
  
  return suggestions;
}

async function addSuggestion(suggestion: SpecSuggestion) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor');
    return;
  }
  
  // Find the function at current position
  const position = editor.selection.active;
  const functionName = getFunctionAtPosition(editor.document, position);
  
  if (!functionName) {
    vscode.window.showErrorMessage('No function found at current position');
    return;
  }
  
  // Add the suggestion to the function's spec
  await addSuggestionToFunction(functionName, suggestion);
  
  vscode.window.showInformationMessage(\`Added \${suggestion.type}: \${suggestion.label}\`);
}

function getFunctionAtPosition(document: vscode.TextDocument, position: vscode.Position): string | null {
  const line = document.lineAt(position.line);
  const functionMatch = line.text.match(/function\\s+(\\w+)\\s*\\(/);
  return functionMatch ? functionMatch[1] : null;
}

async function addSuggestionToFunction(functionName: string, suggestion: SpecSuggestion) {
  // This would integrate with the spec storage system
  const config = vscode.workspace.getConfiguration('specsync');
  const cachePath = config.get('specCachePath', '.specsync/spec.json');
  
  try {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return;
    
    const fullCachePath = path.join(workspaceFolder.uri.fsPath, cachePath);
    let cache = {};
    
    if (fs.existsSync(fullCachePath)) {
      const cacheContent = fs.readFileSync(fullCachePath, 'utf8');
      cache = JSON.parse(cacheContent);
    }
    
    const key = \`\${workspaceFolder.name}:\${functionName}\`;
    if (!cache[key]) {
      cache[key] = {
        functionName,
        preconditions: [],
        postconditions: [],
        invariants: [],
        confidence: 0,
        reasoning: ''
      };
    }
    
    // Add the suggestion to the appropriate array
    switch (suggestion.type) {
      case 'precondition':
        cache[key].preconditions.push(suggestion.label);
        break;
      case 'postcondition':
        cache[key].postconditions.push(suggestion.label);
        break;
      case 'invariant':
        cache[key].invariants.push(suggestion.label);
        break;
    }
    
    // Ensure directory exists
    const dir = path.dirname(fullCachePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(fullCachePath, JSON.stringify(cache, null, 2));
    
  } catch (error) {
    console.error('Error saving suggestion:', error);
    vscode.window.showErrorMessage(\`Failed to save suggestion: \${error.message}\`);
  }
}

export function deactivate() {}
`;
  }

  /**
   * Prompt 2.3 — Lean Proof Task Runner
   * Goal: One-click local proof execution with progress UI.
   */
  generateProofRunner() {
    return {
      name: "specsync-proof-runner",
      displayName: "SpecSync Proof Runner",
      description: "Local Lean proof execution with progress UI",
      version: "1.0.0",
      publisher: "specsync",
      categories: ["Programming Languages", "Other"],
      activationEvents: ["onCommand:specsync.runProof"],
      main: "./out/proof-runner.js",
      contributes: {
        commands: [
          {
            command: "specsync.runProof",
            title: "Run Lean Proof",
            category: "SpecSync",
          },
          {
            command: "specsync.cancelProof",
            title: "Cancel Proof",
            category: "SpecSync",
          },
        ],
        menus: {
          commandPalette: [
            {
              command: "specsync.runProof",
              when: "workspaceHasSpecs",
            },
          ],
        },
      },
    };
  }

  /**
   * Generate proof runner TypeScript implementation
   * @returns {string} TypeScript code
   */
  generateProofRunnerTypeScript() {
    return `import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec, spawn } from 'child_process';

export function activate(context: vscode.ExtensionContext) {
  let currentProofProcess: any = null;
  
  context.subscriptions.push(
    vscode.commands.registerCommand('specsync.runProof', () => runProof(currentProofProcess)),
    vscode.commands.registerCommand('specsync.cancelProof', () => cancelProof(currentProofProcess))
  );
}

async function runProof(currentProcess: any) {
  const config = vscode.workspace.getConfiguration('specsync');
  const leanPath = config.get('leanPath', 'lean');
  
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }
  
  const specsDir = path.join(workspaceFolder.uri.fsPath, 'specs');
  if (!fs.existsSync(specsDir)) {
    vscode.window.showErrorMessage('No specs directory found');
    return;
  }
  
  const leanFiles = fs.readdirSync(specsDir).filter(f => f.endsWith('.lean'));
  if (leanFiles.length === 0) {
    vscode.window.showInformationMessage('No Lean files found in specs directory');
    return;
  }
  
  const progressOptions = {
    location: vscode.ProgressLocation.Notification,
    title: 'Running Lean Proofs',
    cancellable: true
  };
  
  const outputChannel = vscode.window.createOutputChannel('SpecSync Proof Runner');
  outputChannel.show();
  
  await vscode.window.withProgress(progressOptions, async (progress, token) => {
    try {
      progress.report({ message: 'Initializing Lean environment...' });
      
      let successCount = 0;
      let totalCount = leanFiles.length;
      const results: any[] = [];
      
      for (const file of leanFiles) {
        if (token.isCancellationRequested) {
          outputChannel.appendLine('Proof execution cancelled by user');
          break;
        }
        
        const filePath = path.join(specsDir, file);
        progress.report({ 
          message: \`Processing \${file}...\`,
          increment: 100 / totalCount
        });
        
        outputChannel.appendLine(\`\\nProcessing \${file}...\`);
        
        try {
          const result = await executeLeanFile(leanPath, filePath, outputChannel);
          results.push({ file, success: result.success, output: result.output });
          
          if (result.success) {
            successCount++;
            outputChannel.appendLine(\`✅ \${file} - Proof successful\`);
          } else {
            outputChannel.appendLine(\`❌ \${file} - Proof failed\`);
          }
        } catch (error) {
          results.push({ file, success: false, error: error.message });
          outputChannel.appendLine(\`❌ \${file} - Error: \${error.message}\`);
        }
      }
      
      const coverage = Math.round((successCount / totalCount) * 100);
      
      // Show results summary
      const summary = \`
## Proof Execution Summary

**Coverage:** \${coverage}%
**Successful:** \${successCount}/\${totalCount}
**Failed:** \${totalCount - successCount}

### Results:
\${results.map(r => \`\${r.success ? '✅' : '❌'} \${r.file}\`).join('\\n')}
\`;
      
      outputChannel.appendLine(summary);
      
      // Show notification
      if (coverage >= 70) {
        vscode.window.showInformationMessage(
          \`Proof validation complete: \${successCount}/\${totalCount} successful (\${coverage}% coverage)\`
        );
      } else {
        vscode.window.showWarningMessage(
          \`Proof validation complete: \${successCount}/\${totalCount} successful (\${coverage}% coverage) - Below threshold\`
        );
      }
      
      // Generate artifacts
      await generateProofArtifacts(results, workspaceFolder.uri.fsPath);
      
    } catch (error) {
      outputChannel.appendLine(\`\\n❌ Proof execution failed: \${error.message}\`);
      vscode.window.showErrorMessage(\`Proof execution failed: \${error.message}\`);
    }
  });
}

function executeLeanFile(leanPath: string, filePath: string, outputChannel: vscode.OutputChannel): Promise<{success: boolean, output: string}> {
  return new Promise((resolve, reject) => {
    const process = spawn(leanPath, ['--json', filePath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
      outputChannel.append(data.toString());
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
      outputChannel.append(data.toString());
    });
    
    process.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output: stdout });
      } else {
        resolve({ success: false, output: stderr });
      }
    });
    
    process.on('error', (error) => {
      reject(error);
    });
  });
}

async function generateProofArtifacts(results: any[], workspacePath: string) {
  const artifactsDir = path.join(workspacePath, '.specsync', 'artifacts');
  
  // Ensure artifacts directory exists
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(artifactsDir, \`proof-report-\${timestamp}.json\`);
  
  const report = {
    timestamp: new Date().toISOString(),
    totalFiles: results.length,
    successfulProofs: results.filter(r => r.success).length,
    failedProofs: results.filter(r => !r.success).length,
    coverage: Math.round((results.filter(r => r.success).length / results.length) * 100),
    results: results
  };
  
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  // Create a summary file
  const summaryPath = path.join(artifactsDir, 'latest-report.json');
  fs.writeFileSync(summaryPath, JSON.stringify(report, null, 2));
  
  vscode.window.showInformationMessage(\`Proof artifacts saved to \${artifactsDir}\`);
}

function cancelProof(currentProcess: any) {
  if (currentProcess) {
    currentProcess.kill();
    vscode.window.showInformationMessage('Proof execution cancelled');
  }
}

export function deactivate() {}
`;
  }

  /**
   * Generate complete VSCode extension package
   * @param {string} outputPath - Output directory
   */
  async generateVSCodeExtension(outputPath = "./vscode-extension") {
    await fs.ensureDir(outputPath);

    // Generate package.json
    const packageJson = this.generateSpecLensExtension();
    await fs.writeJson(path.join(outputPath, "package.json"), packageJson, { spaces: 2 });

    // Generate TypeScript files
    const srcDir = path.join(outputPath, "src");
    await fs.ensureDir(srcDir);

    await fs.writeFile(path.join(srcDir, "extension.ts"), this.generateSpecLensTypeScript());

    await fs.writeFile(
      path.join(srcDir, "suggestion-panel.ts"),
      this.generateSuggestionPanelTypeScript()
    );

    await fs.writeFile(path.join(srcDir, "proof-runner.ts"), this.generateProofRunnerTypeScript());

    // Generate README
    const readme = this.generateVSCodeReadme();
    await fs.writeFile(path.join(outputPath, "README.md"), readme);

    // Generate tsconfig.json
    const tsconfig = {
      compilerOptions: {
        module: "commonjs",
        target: "ES2020",
        outDir: "out",
        lib: ["ES2020"],
        sourceMap: true,
        rootDir: "src",
        strict: true,
      },
      exclude: ["node_modules", ".vscode-test"],
    };
    await fs.writeJson(path.join(outputPath, "tsconfig.json"), tsconfig, { spaces: 2 });

    return outputPath;
  }

  /**
   * Generate VSCode extension README
   * @returns {string} README content
   */
  generateVSCodeReadme() {
    return `# SpecSync VSCode Extension

A comprehensive VSCode extension for SpecSync that provides inline specification annotations, real-time suggestions, and local proof execution.

## Features

### SpecLens Inline Annotations
- Display verified invariants above each function
- Click to view full specification details
- Edit specifications inline

### Real-time Suggestion Panel
- Get spec suggestions as you type
- Add suggestions with one click
- Confidence scoring for each suggestion

### Lean Proof Runner
- Execute Lean proofs locally
- Progress tracking with detailed output
- Generate proof artifacts and reports

## Installation

1. Install the extension from the VSCode marketplace
2. Configure your Lean path in settings
3. Open a project with specifications

## Usage

### Viewing Specifications
- Hover over functions to see their specifications
- Click on spec annotations to view details
- Use the command palette: "SpecSync: Show Specification"

### Adding Suggestions
- Type code and watch for suggestions in the sidebar
- Click on suggestions to add them to your function
- Suggestions appear based on code patterns

### Running Proofs
- Use command palette: "SpecSync: Run Lean Proof"
- View progress and results in the output panel
- Proof artifacts are saved to \`.specsync/artifacts\`

## Configuration

\`\`\`json
{
  "specsync.specCachePath": ".specsync/spec.json",
  "specsync.leanPath": "lean"
}
\`\`\`

## Development

\`\`\`bash
npm install
npm run compile
npm run watch
\`\`\`

## License

MIT License
`;
  }
}
