<div align="center">

# SpecSync

**Formal specs, meet your pull requests.**

A GitHub App that turns diffs into structured specification suggestions—powered by LLMs, grounded in AST analysis, and wired for Lean 4 when you want proofs to compile.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Probot](https://img.shields.io/badge/Probot-GitHub_App-00befd?logo=github)](https://probot.github.io/)
[![Lean](https://img.shields.io/badge/Lean-4-1f425f)](https://leanprover.github.io/)

[Features](#what-it-does) · [Quick start](#quick-start) · [Configuration](#configuration) · [Development](#development) · [Deploy](#production)

<br/>

<img src=".github/assets/SpecSync1.png" alt="SpecSync" width="280"/>

<br/>

</div>

---

## What it does

| Capability               | Description                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| **Event-driven**         | Listens on GitHub for pull requests, pushes, and comments—then runs the analysis pipeline.       |
| **Multi-language diffs** | Parses changes across common languages using Tree-sitter–backed extraction.                      |
| **LLM-assisted specs**   | Proposes preconditions, postconditions, invariants, and rationale where API keys are configured. |
| **Lean-ready output**    | Generated modules can target your Lake `specs/` tree so `lake build` stays honest.               |
| **Operator-friendly**    | Health and readiness routes on the Probot router, Docker image, and CI for Node + Lean.          |

The optional [VS Code extension](vscode-extension/) adds editor-side commands and local proof hooks; the server-side app lives in this repository’s `src/` tree.

---

## Architecture

At a glance: GitHub sends webhooks to **Probot**; the app parses diffs, walks ASTs, asks the **spec analyzer** (and **LLM client** when configured), then posts back via the **GitHub UI** layer. Lean artifacts and CI are first-class paths, not an afterthought.

```mermaid
flowchart TB
  subgraph ingest [GitHub]
    E[Webhooks]
  end
  subgraph pipeline [Analysis]
    D[Diff parser]
    T[AST extractor]
    N[Spec analyzer]
    L[LLM client]
  end
  subgraph surface [Surfaces]
    G[PR comments and checks]
    K[Lean specs under specs/]
    S[Slack and dashboards]
  end
  E --> D --> T --> N
  N --> L
  N --> G
  N --> K
  N --> S
```

Formal modules consumed by Lake live under [`specs/`](specs/), with [`lakefile.lean`](lakefile.lean) and [`lean-toolchain`](lean-toolchain) pinning the toolchain.

---

## Repository layout

| Location                                   | Role                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| [`src/index.ts`](src/index.ts)             | Probot entry: webhooks, `GET /health`, `GET /ready` when the router is available |
| [`src/`](src/)                             | Application modules—parser, analyzer, GitHub UI, LLM client, generators          |
| [`dist/`](dist/)                           | Build output from `npm run build` (generated, not committed)                     |
| [`specs/`](specs/)                         | Lean 4 sources for `lake build`                                                  |
| [`test/`](test/)                           | Jest tests (`*.test.ts`)                                                         |
| [`vscode-extension/`](vscode-extension/)   | Editor extension (TypeScript → `out/`)                                           |
| [`.github/workflows/`](.github/workflows/) | Continuous integration                                                           |

---

## Requirements

- **Node.js** 20 or newer (see [`package.json`](package.json) `engines`)
- **Lean 4 and Lake** only if you work on or build [`specs/`](specs/) locally (`lake build`)

---

## Quick start

```bash
git clone <repository-url> && cd SpecSync
npm ci
npm run dev
```

For a production binary, compile first: `npm run build`, then `npm start` runs `node dist/index.js`.

> **Secrets:** Never commit real keys. Copy [`env.example`](env.example) to `.env` for local use, and inject credentials in production via your host (Kubernetes secrets, Doppler, Vault, etc.).

---

## Configuration

### Environment

Variable names follow [Probot’s configuration](https://probot.github.io/docs/configuration/). See [`env.example`](env.example) for the full list with comments.

Minimal variables for the GitHub App:

```env
APP_ID=...
PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
WEBHOOK_SECRET=...
```

Optional but common:

```env
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GITHUB_TOKEN=...
SPECS_DIR=specs
PORT=3000
```

### GitHub App manifest (reference)

Use this shape when registering the app; point the webhook URL at your deployed Probot instance.

```yaml
name: SpecSync
description: GitHub-native specification assistant
url: https://github.com/your-org/specsync
hook_attributes:
  url: https://your-domain.com/webhook
  content_type: json
default_permissions:
  contents: read
  pull_requests: write
  issues: write
  metadata: read
default_events:
  - pull_request
  - push
  - issues
  - issue_comment
  - pull_request_review
  - pull_request_review_comment
```

---

## Development

| Command                            | What it runs                                          |
| ---------------------------------- | ----------------------------------------------------- |
| `npm ci`                           | Install from lockfile                                 |
| `npm run dev`                      | `tsx watch src/index.ts` for local Probot development |
| `npm run build`                    | TypeScript compile to `dist/`                         |
| `npm start`                        | `node dist/index.js`                                  |
| `npm run typecheck`                | `tsc --noEmit` on `src/`                              |
| `npm run lint`                     | ESLint ([`eslint.config.mjs`](eslint.config.mjs))     |
| `npm run format`                   | Prettier write                                        |
| `npm run format:check`             | Prettier check (also in CI)                           |
| `npm test`                         | Jest ([`jest.config.js`](jest.config.js))             |
| `npm run test:coverage`            | Jest with coverage                                    |
| `npm run demo` / `npm run ui-demo` | Demos (run `build` first)                             |
| `node verify-deployment.js`        | Sanity-check paths and workflow files                 |

### Health checks

When the Probot server exposes a router, the app registers:

- `GET /health` — liveness
- `GET /ready` — readiness (extend when you add databases or queues)

The [`Dockerfile`](Dockerfile) healthcheck expects `GET /health` on the process port (default `3000`).

---

## Lean and Lake

- **CI:** [`lean4-ci.yml`](.github/workflows/lean4-ci.yml) runs `lake build` via [lean-action](https://github.com/leanprover/lean-action) when Lean-related paths change.
- **Local:** From the repo root, `lake build` after installing Elan/Lean.
- **Generator contract:** Output from [`src/lean4-generator.ts`](src/lean4-generator.ts) should respect `SPECS_DIR` (default `specs`) so files sit in the same Lake library as [`lakefile.lean`](lakefile.lean).

---

## Continuous integration

| Workflow                                         | Purpose                                    |
| ------------------------------------------------ | ------------------------------------------ |
| [`node-ci.yml`](.github/workflows/node-ci.yml)   | Lint, format check, typecheck, build, test |
| [`lean4-ci.yml`](.github/workflows/lean4-ci.yml) | `lake build` for Lean specs                |

[`dependabot.yml`](.github/dependabot.yml) schedules weekly npm updates for the root package and [`vscode-extension/`](vscode-extension/).

---

## Production

### Docker

Multi-stage **Node 22 Alpine** image: installs dependencies, runs `npm run build`, prunes devDependencies, runs as a non-root user.

```bash
docker build -t specsync .
docker run -p 3000:3000 \
  -e APP_ID=<id> \
  -e PRIVATE_KEY=<pem-or-base64> \
  -e WEBHOOK_SECRET=<secret> \
  specsync
```

Add LLM keys the same way if you use live models in production.

### Other platforms

Any environment that provides Node, `PORT`, Probot env vars, and a **public HTTPS URL** for GitHub webhooks will work—containers on AWS/GCP/Azure, Fly.io, Railway, Heroku, or a VM behind nginx.

---

## Usage notes

- **Demos:** After `npm run build`, run `npm run demo` or `npm run ui-demo`.
- **VS Code:** See [`vscode-extension/README.md`](vscode-extension/README.md) for building the extension (`npx tsc -p .` inside that folder).
- **Lean:** Modules under `specs/` should pass `lake build`; proof sketches may use `sorry` until completed.

---

## Quality and security

- Pull requests run lint, format, typecheck, build, and tests; Lean CI validates the Lake project.
- Prefer Dependabot PRs and periodic `npm audit` before releases.
- Probot uses structured logging; see [`src/health.ts`](src/health.ts) for optional standalone health HTTP.

---

## Contributing

1. Fork and branch from `main`.
2. Run `npm ci`, then `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
3. Add or update tests for behavior changes; run `npm run format`.
4. Open a PR with a clear description. [Conventional commits](https://www.conventionalcommits.org/) are welcome.

---

## License

Distributed under the [MIT License](LICENSE).

---

## Acknowledgments

[Probot](https://probot.github.io/) · [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) · [Lean 4](https://leanprover.github.io/) · [Lake](https://github.com/leanprover/lean4) · [OpenAI](https://openai.com/) · [Anthropic](https://www.anthropic.com/)
