# SpecSync VS Code extension (SpecLens)

TypeScript extension that provides SpecSync-related commands and configuration for local workflows: specification views, edits, and Lean proof invocation. It lives alongside the main SpecSync Probot app in the repository root.

## Features

- **Commands** (see `package.json` `contributes.commands`): Show Specification, Edit Specification, Run Lean Proof.
- **Settings**: Spec cache path, Lean executable path, confidence threshold for inline suggestions.
- **Activation**: JavaScript, TypeScript, and Python files (`activationEvents` in `package.json`).

## Requirements

- [VS Code](https://code.visualstudio.com/) (or a compatible editor).
- [Lean 4](https://leanprover.github.io/) on your `PATH` if you use proof commands, or set `specsync.leanPath`.

## Installation

### From source (this monorepo)

1. Open a terminal at the repository root.
2. Install extension dependencies and compile:

```bash
cd vscode-extension
npm install
npx tsc -p .
```

Compiled JavaScript is emitted to `out/` per [`tsconfig.json`](tsconfig.json) (`rootDir`: `src`, `outDir`: `out`).

3. In VS Code: **File → Open Folder** and select the `vscode-extension` folder (or the whole repo).
4. Press **F5** to launch the **Extension Development Host** with this extension loaded (add [`.vscode/launch.json`](https://code.visualstudio.com/api/working-with-extensions/testing-extension) if you use the debugger).

### From a marketplace package

If the extension is published, install from the Extensions view by searching for the publisher/name shown in `package.json`.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `specsync.specCachePath` | `.specsync/spec.json` | Path to the spec cache file (relative to workspace when applicable). |
| `specsync.leanPath` | `lean` | Lean executable name or path. |
| `specsync.confidenceThreshold` | `0.7` | Minimum confidence for showing suggestions. |

Example **User Settings** JSON:

```json
{
  "specsync.specCachePath": ".specsync/spec.json",
  "specsync.leanPath": "lean",
  "specsync.confidenceThreshold": 0.7
}
```

## Usage

- **View specs**: Command palette → `SpecSync: Show Specification` (or use CodeLens if provided by your build).
- **Edit specs**: `SpecSync: Edit Specification`.
- **Proofs**: `SpecSync: Run Lean Proof`; check the Output panel for logs. Proof artifacts may be written under `.specsync/artifacts` depending on implementation.

## Development

```bash
cd vscode-extension
npm install
npx tsc -p .
```

- Re-run `npx tsc -p .` after editing `src/*.ts`.
- The root SpecSync package (`..`) is separate: it builds the GitHub App to `../dist/`; the extension does not depend on that build for its own `out/` output.

## Relationship to the main app

The GitHub App and automation live in the parent directory ([`../README.md`](../README.md)). This extension is optional tooling for developers in the editor; it does not replace the server-side SpecSync service.

## License

MIT License (same as the root project).
