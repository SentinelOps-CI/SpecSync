// @ts-nocheck
const { WebClient } = require("@slack/web-api");
const fs = require("fs-extra");
const path = require("path");

export class DeveloperFeedback {
  constructor() {
    this.slack = null;
    this.initializeSlack();
    this.notificationQueue = [];
    this.vscodeExtensionPath = process.env.VSCODE_EXTENSION_PATH || "./vscode-extension";
  }

  /**
   * Initialize Slack client
   */
  initializeSlack() {
    const slackToken = process.env.SLACK_BOT_TOKEN;
    if (slackToken) {
      this.slack = new WebClient(slackToken);
      console.log("✅ Slack client initialized");
    } else {
      console.warn("⚠️ No Slack token found. Notifications will be queued.");
    }
  }

  /**
   * Send Slack notification
   * @param {Object} notification - Notification object
   */
  async sendSlackNotification(notification) {
    if (!this.slack) {
      this.notificationQueue.push(notification);
      return;
    }

    try {
      const channel = process.env.SLACK_CHANNEL || "#specsync";
      const message = this.formatSlackMessage(notification);

      await this.slack.chat.postMessage({
        channel: channel,
        ...message,
      });

      console.log(`📢 Slack notification sent: ${notification.type}`);
    } catch (error) {
      console.error("Error sending Slack notification:", error);
      this.notificationQueue.push(notification);
    }
  }

  /**
   * Format Slack message
   * @param {Object} notification - Notification object
   * @returns {Object} Formatted Slack message
   */
  formatSlackMessage(notification) {
    const baseMessage = {
      text: notification.title,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: notification.title,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: notification.description,
          },
        },
      ],
    };

    // Add action buttons for spec suggestions
    if (notification.type === "spec_suggestion") {
      baseMessage.blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "✅ Accept",
            },
            style: "primary",
            value: `accept_${notification.functionName}`,
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "✏️ Edit",
            },
            value: `edit_${notification.functionName}`,
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "❌ Ignore",
            },
            style: "danger",
            value: `ignore_${notification.functionName}`,
          },
        ],
      });
    }

    // Add context for proof failures
    if (notification.type === "proof_failure") {
      baseMessage.blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `*File:* ${notification.file}\n*Function:* ${notification.functionName}`,
          },
        ],
      });
    }

    return baseMessage;
  }

  /**
   * Notify about new spec suggestion
   * @param {Object} spec - Specification object
   * @param {Object} context - GitHub context
   */
  async notifySpecSuggestion(spec, context) {
    const notification = {
      type: "spec_suggestion",
      title: "🤖 New SpecSync Suggestion",
      description: `A new specification has been generated for \`${spec.functionName}\` with ${spec.confidence}% confidence.`,
      functionName: spec.functionName,
      confidence: spec.confidence,
      prUrl: context.payload.pull_request?.html_url,
      timestamp: new Date().toISOString(),
    };

    await this.sendSlackNotification(notification);
  }

  /**
   * Notify about proof failure
   * @param {Object} proofFailure - Proof failure object
   * @param {Object} context - GitHub context
   */
  async notifyProofFailure(proofFailure, context) {
    const notification = {
      type: "proof_failure",
      title: "❌ Proof Validation Failed",
      description: `A Lean4 proof has failed validation. Please review and fix the proof.`,
      functionName: proofFailure.functionName,
      file: proofFailure.file,
      error: proofFailure.error,
      prUrl: context.payload.pull_request?.html_url,
      timestamp: new Date().toISOString(),
    };

    await this.sendSlackNotification(notification);
  }

  /**
   * Notify about drift detection
   * @param {Object} drift - Drift detection object
   * @param {Object} context - GitHub context
   */
  async notifyDriftDetection(drift, context) {
    const notification = {
      type: "drift_detection",
      title: "⚠️ Spec Drift Detected",
      description: `Specification drift detected for \`${drift.functionName}\`. The implementation may no longer satisfy the existing specification.`,
      functionName: drift.functionName,
      confidence: drift.confidence,
      details: drift.driftDetails,
      prUrl: context.payload.pull_request?.html_url,
      timestamp: new Date().toISOString(),
    };

    await this.sendSlackNotification(notification);
  }

  /**
   * Generate VSCode extension
   * @param {string} outputPath - Output path for extension
   * @returns {string} Extension path
   */
  async generateVSCodeExtension(outputPath = "./vscode-extension") {
    const extensionPath = path.resolve(outputPath);

    // Create extension directory structure
    await fs.ensureDir(extensionPath);
    await fs.ensureDir(path.join(extensionPath, "src"));
    await fs.ensureDir(path.join(extensionPath, "resources"));

    // Generate package.json
    const packageJson = this.generateExtensionPackageJson();
    await fs.writeFile(
      path.join(extensionPath, "package.json"),
      JSON.stringify(packageJson, null, 2)
    );

    // Generate extension.ts
    const extensionTs = this.generateExtensionTypeScript();
    await fs.writeFile(path.join(extensionPath, "src/extension.ts"), extensionTs);

    // Generate README
    const readme = this.generateExtensionReadme();
    await fs.writeFile(path.join(extensionPath, "README.md"), readme);

    // Generate configuration
    const config = this.generateExtensionConfig();
    await fs.writeFile(path.join(extensionPath, "package.json"), JSON.stringify(config, null, 2));

    console.log(`✅ VSCode extension generated at ${extensionPath}`);
    return extensionPath;
  }

  /**
   * Generate extension package.json
   * @returns {Object} Package.json content
   */
  generateExtensionPackageJson() {
    return {
      name: "specsync",
      displayName: "SpecSync",
      description: "Formal specification integration for VSCode",
      version: "1.0.0",
      publisher: "specsync",
      categories: ["Other"],
      activationEvents: [
        "onCommand:specsync.showSpec",
        "onCommand:specsync.editSpec",
        "onCommand:specsync.runProof",
        "onLanguage:javascript",
        "onLanguage:typescript",
        "onLanguage:python",
        "onLanguage:java",
      ],
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
            title: "Run Lean4 Proof",
            category: "SpecSync",
          },
        ],
        configuration: {
          title: "SpecSync",
          properties: {
            "specsync.apiUrl": {
              type: "string",
              default: "http://localhost:3000",
              description: "SpecSync API URL",
            },
            "specsync.autoShowSpec": {
              type: "boolean",
              default: true,
              description: "Automatically show specifications when hovering over functions",
            },
          },
        },
      },
      scripts: {
        "vscode:prepublish": "npm run compile",
        compile: "tsc -p ./",
        watch: "tsc -watch -p ./",
      },
      devDependencies: {
        "@types/vscode": "^1.74.0",
        "@types/node": "^16.11.7",
        typescript: "^4.7.4",
      },
    };
  }

  /**
   * Generate extension TypeScript
   * @returns {string} Extension TypeScript content
   */
  generateExtensionTypeScript() {
    return `
import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    console.log('SpecSync extension is now active!');

    // Register commands
    let showSpec = vscode.commands.registerCommand('specsync.showSpec', () => {
        showSpecification();
    });

    let editSpec = vscode.commands.registerCommand('specsync.editSpec', () => {
        editSpecification();
    });

    let runProof = vscode.commands.registerCommand('specsync.runProof', () => {
        runLeanProof();
    });

    context.subscriptions.push(showSpec, editSpec, runProof);

    // Register hover provider
    const hoverProvider = vscode.languages.registerHoverProvider(
        ['javascript', 'typescript', 'python', 'java'],
        {
            provideHover(document, position, token) {
                return provideSpecHover(document, position);
            }
        }
    );

    context.subscriptions.push(hoverProvider);
}

export function deactivate() {}

async function showSpecification() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showInformationMessage('No active editor');
        return;
    }

    const position = editor.selection.active;
    const functionName = getFunctionAtPosition(editor.document, position);
    
    if (!functionName) {
        vscode.window.showInformationMessage('No function found at cursor position');
        return;
    }

    try {
        const config = vscode.workspace.getConfiguration('specsync');
        const apiUrl = config.get('apiUrl', 'http://localhost:3000');
        
        const response = await fetch(\`\${apiUrl}/api/spec/\${functionName}\`);
        const spec = await response.json();
        
        if (spec.success) {
            showSpecPanel(spec.data);
        } else {
            vscode.window.showInformationMessage('No specification found for this function');
        }
    } catch (error) {
        vscode.window.showErrorMessage('Failed to fetch specification');
    }
}

async function editSpecification() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showInformationMessage('No active editor');
        return;
    }

    const position = editor.selection.active;
    const functionName = getFunctionAtPosition(editor.document, position);
    
    if (!functionName) {
        vscode.window.showInformationMessage('No function found at cursor position');
        return;
    }

    // Open spec editing panel
    const panel = vscode.window.createWebviewPanel(
        'specEdit',
        'Edit Specification',
        vscode.ViewColumn.One,
        {
            enableScripts: true
        }
    );

    panel.webview.html = generateSpecEditHTML(functionName);
}

async function runLeanProof() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showInformationMessage('No active editor');
        return;
    }

    const position = editor.selection.active;
    const functionName = getFunctionAtPosition(editor.document, position);
    
    if (!functionName) {
        vscode.window.showInformationMessage('No function found at cursor position');
        return;
    }

    // Run Lean4 proof
    const terminal = vscode.window.createTerminal('SpecSync Proof');
    terminal.show();
    terminal.sendText(\`lean --json specs/\${functionName}_spec.lean\`);
}

function getFunctionAtPosition(document: vscode.TextDocument, position: vscode.Position): string | null {
    const line = document.lineAt(position.line);
    const text = line.text;
    
    // Simple function detection
    const functionPatterns = [
        /function\\s+(\\w+)\\s*\\(/,
        /const\\s+(\\w+)\\s*=\\s*\\(/,
        /def\\s+(\\w+)\\s*\\(/,
        /public\\s+\\w+\\s+(\\w+)\\s*\\(/
    ];
    
    for (const pattern of functionPatterns) {
        const match = text.match(pattern);
        if (match) {
            return match[1];
        }
    }
    
    return null;
}

function provideSpecHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | null {
    const functionName = getFunctionAtPosition(document, position);
    
    if (!functionName) {
        return null;
    }
    
    const config = vscode.workspace.getConfiguration('specsync');
    const autoShow = config.get('autoShowSpec', true);
    
    if (!autoShow) {
        return null;
    }
    
    // Return hover with spec info
    return new vscode.Hover([
        '**SpecSync Specification**',
        \`Function: \${functionName}\`,
        'Click to view full specification'
    ]);
}

function showSpecPanel(spec: any) {
    const panel = vscode.window.createWebviewPanel(
        'specView',
        'Specification',
        vscode.ViewColumn.One,
        {
            enableScripts: true
        }
    );

    panel.webview.html = generateSpecViewHTML(spec);
}

function generateSpecViewHTML(spec: any): string {
    return \`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Specification</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; }
        .spec-section { margin: 20px 0; }
        .spec-title { font-weight: bold; color: #333; }
        .spec-content { margin: 10px 0; padding: 10px; background: #f5f5f5; border-radius: 4px; }
        .confidence { color: #666; font-size: 0.9em; }
    </style>
</head>
<body>
    <h2>Specification for \${spec.functionName}</h2>
    <div class="confidence">Confidence: \${spec.confidence}%</div>
    
    <div class="spec-section">
        <div class="spec-title">Preconditions:</div>
        <div class="spec-content">
            \${spec.preconditions.map(p => \`<div>• \${p}</div>\`).join('')}
        </div>
    </div>
    
    <div class="spec-section">
        <div class="spec-title">Postconditions:</div>
        <div class="spec-content">
            \${spec.postconditions.map(p => \`<div>• \${p}</div>\`).join('')}
        </div>
    </div>
    
    <div class="spec-section">
        <div class="spec-title">Invariants:</div>
        <div class="spec-content">
            \${spec.invariants.map(i => \`<div>• \${i}</div>\`).join('')}
        </div>
    </div>
    
    <div class="spec-section">
        <div class="spec-title">Edge Cases:</div>
        <div class="spec-content">
            \${spec.edgeCases.map(e => \`<div>• \${e}</div>\`).join('')}
        </div>
    </div>
</body>
</html>
\`;
}

function generateSpecEditHTML(functionName: string): string {
    return \`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit Specification</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; }
        .form-group { margin: 20px 0; }
        label { display: block; font-weight: bold; margin-bottom: 5px; }
        textarea { width: 100%; height: 100px; padding: 10px; border: 1px solid #ccc; border-radius: 4px; }
        button { padding: 10px 20px; background: #007acc; color: white; border: none; border-radius: 4px; cursor: pointer; }
        button:hover { background: #005a9e; }
    </style>
</head>
<body>
    <h2>Edit Specification for \${functionName}</h2>
    
    <form id="specForm">
        <div class="form-group">
            <label for="preconditions">Preconditions (one per line):</label>
            <textarea id="preconditions" name="preconditions"></textarea>
        </div>
        
        <div class="form-group">
            <label for="postconditions">Postconditions (one per line):</label>
            <textarea id="postconditions" name="postconditions"></textarea>
        </div>
        
        <div class="form-group">
            <label for="invariants">Invariants (one per line):</label>
            <textarea id="invariants" name="invariants"></textarea>
        </div>
        
        <div class="form-group">
            <label for="edgeCases">Edge Cases (one per line):</label>
            <textarea id="edgeCases" name="edgeCases"></textarea>
        </div>
        
        <button type="submit">Save Specification</button>
    </form>
    
    <script>
        document.getElementById('specForm').addEventListener('submit', function(e) {
            e.preventDefault();
            
            const formData = {
                functionName: '\${functionName}',
                preconditions: document.getElementById('preconditions').value.split('\\n').filter(line => line.trim()),
                postconditions: document.getElementById('postconditions').value.split('\\n').filter(line => line.trim()),
                invariants: document.getElementById('invariants').value.split('\\n').filter(line => line.trim()),
                edgeCases: document.getElementById('edgeCases').value.split('\\n').filter(line => line.trim())
            };
            
            // Send to SpecSync API
            fetch('/api/spec', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            }).then(response => {
                if (response.ok) {
                    vscode.postMessage({ command: 'specSaved' });
                }
            });
        });
    </script>
</body>
</html>
\`;
}
`;
  }

  /**
   * Generate extension README
   * @returns {string} README content
   */
  generateExtensionReadme() {
    return `# SpecSync VSCode Extension

This extension provides integration with SpecSync for formal specification management in VSCode.

## Features

- **Inline Specification Display**: Hover over functions to see their specifications
- **Specification Editing**: Edit preconditions, postconditions, invariants, and edge cases
- **Lean4 Proof Execution**: Run Lean4 proofs directly from VSCode
- **Real-time Updates**: Specifications update automatically when changed

## Commands

- \`SpecSync: Show Specification\` - Display specification for the function at cursor
- \`SpecSync: Edit Specification\` - Open specification editor
- \`SpecSync: Run Lean4 Proof\` - Execute Lean4 proof for current function

## Configuration

- \`specsync.apiUrl\` - SpecSync API URL (default: http://localhost:3000)
- \`specsync.autoShowSpec\` - Automatically show specifications on hover (default: true)

## Installation

1. Build the extension: \`npm run compile\`
2. Package the extension: \`vsce package\`
3. Install the .vsix file in VSCode

## Development

\`\`\`bash
npm install
npm run compile
npm run watch
\`\`\`

## Usage

1. Open a JavaScript/TypeScript/Python/Java file
2. Hover over a function to see its specification
3. Use commands to edit specifications or run proofs
4. Specifications are automatically synced with SpecSync API
`;
  }

  /**
   * Generate extension configuration
   * @returns {Object} Configuration object
   */
  generateExtensionConfig() {
    return {
      name: "specsync",
      displayName: "SpecSync",
      description: "Formal specification integration for VSCode",
      version: "1.0.0",
      publisher: "specsync",
      categories: ["Other"],
      activationEvents: [
        "onCommand:specsync.showSpec",
        "onCommand:specsync.editSpec",
        "onCommand:specsync.runProof",
      ],
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
            title: "Run Lean4 Proof",
            category: "SpecSync",
          },
        ],
        configuration: {
          title: "SpecSync",
          properties: {
            "specsync.apiUrl": {
              type: "string",
              default: "http://localhost:3000",
              description: "SpecSync API URL",
            },
            "specsync.autoShowSpec": {
              type: "boolean",
              default: true,
              description: "Automatically show specifications when hovering over functions",
            },
          },
        },
      },
    };
  }

  /**
   * Process queued notifications
   */
  async processQueuedNotifications() {
    if (this.notificationQueue.length === 0) {
      return;
    }

    console.log(`Processing ${this.notificationQueue.length} queued notifications...`);

    for (const notification of this.notificationQueue) {
      try {
        await this.sendSlackNotification(notification);
      } catch (error) {
        console.error("Error processing queued notification:", error);
      }
    }

    this.notificationQueue = [];
  }

  /**
   * Get notification statistics
   * @returns {Object} Notification statistics
   */
  getNotificationStats() {
    return {
      queued: this.notificationQueue.length,
      slackConnected: this.slack !== null,
      lastProcessed: new Date().toISOString(),
    };
  }
}
