# SpecSync VS Code extension

Hand-maintained TypeScript extension. Reads accepted specs from `.specsync/specs/` (same store as the GitHub App). Confidence is always **0–1**.

> Do not regenerate this package from the Probot app. The old `src/vscode-ui.ts` code generator was removed in Phase 8.

## Features

- **SpecLens / hover** — CodeLens and hover for functions with stored specs
- **Suggestions view** — Activity-bar tree (`specsync.suggestions`) with heuristic suggestions
- **Edit / show** — Webview commands that read/write `.specsync/specs/*.json`
- **Lean proofs** — Run/cancel Lean on `specs/` and `.specsync/lean/`; artifacts under `.specsync/artifacts/`

## Requirements

- VS Code `^1.74.0` (see `engines.vscode` in `package.json`)
- [Lean 4](https://leanprover.github.io/) on `PATH` (or set `specsync.leanPath`) for proof commands

## Build

```bash
cd vscode-extension
npm install
npm run compile
```

Watch mode: `npm run watch`. Output goes to `out/` (`main`: `./out/extension.js`).

## Launch (Extension Development Host)

1. Open this folder (or the monorepo) in VS Code / Cursor
2. Press **F5** (add a launch config if needed) with `main` pointing at `out/extension.js`

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `specsync.specsDir` | `.specsync/specs` | Accepted spec JSON directory (workspace-relative) |
| `specsync.leanPath` | `lean` | Lean executable |
| `specsync.confidenceThreshold` | `0.7` | Minimum confidence (0–1) for CodeLens/hover |

## Commands

- `SpecSync: Show Specification`
- `SpecSync: Edit Specification` (saves back to `.specsync/specs/`)
- `SpecSync: Run Lean Proof` / `Cancel Lean Proof`
- `SpecSync: Refresh Specs from .specsync/`

## Spec file layout

Matches the root `SpecStore`:

```text
.specsync/specs/{sanitizedFilePath}__{functionName}.json
```

Each file is a `StoredSpec` with nested `contract` and `confidence` in `[0, 1]`.

## License

MIT (same as the root project).
