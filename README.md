<div align="center">

<pre>
##################################################################################
#                                                                                #
#               ____                  ____                         _             #
#              / ___| _ __   ___  ___/ ___| _   _ _ __   ___      | |            #
#              \___ \| '_ \ / _ \/ __\___ \| | | | '_ \ / __|     | |            #
#               ___) | |_) |  __/ (__ ___) | |_| | | | | (__      |_|            #
#              |____/| .__/ \___|\___|____/ \__, |_| |_|\___|     (_)            #
#                    |_|                    |___/                                #
##################################################################################
</pre>

**Formal specs, meet your pull requests.**

A GitHub App that turns PR diffs into structured specification suggestions—powered by LLMs when configured, grounded in tree-sitter AST analysis, and able to write Lean 4 **spec-as-contract** modules under `.specsync/` (opaque stubs + closed proofs where possible; labeled unfinished goals otherwise — not claimed complete).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Probot](https://img.shields.io/badge/Probot-GitHub_App-00befd?logo=github)](https://probot.github.io/)
[![Lean](https://img.shields.io/badge/Lean-4-1f425f)](https://leanprover.github.io/)

[Features](#what-it-does) · [Quick start](#quick-start) · [Configuration](#configuration) · [Development](#development) · [Deploy](#production)

</div>

---

## What it does

| Capability | Description |
| --- | --- |
| **Async PR analysis** | Webhooks enqueue work on an in-process `AnalysisJobQueue` (idempotent per PR head SHA) so GitHub gets a fast ack. Optional `SPECSYNC_JOB_MARKERS_DIR` shares completion markers across instances on a volume (not committed to the target repo). |
| **Multi-language diffs** | Tree-sitter AST for JavaScript, TypeScript, Python, Java, and Rust (no Go/C/C++ parsers). Review comments use `RIGHT` for adds/modifies and `LEFT` for pure deletions. |
| **LLM-assisted specs** | Proposes preconditions, postconditions, invariants, and rationale when API keys are set. Production denies silent mock output unless `SPECSYNC_ALLOW_MOCK_LLM=true`. |
| **`.specsync/` store** | `/specsync accept` commits JSON contracts (and Lean stubs) under `.specsync/` on the PR branch. Mutating commands require write AuthZ and are rate-limited per actor/PR. |
| **Soft proof gate** | Default `SPECSYNC_PROOF_GATE=soft`: Lean CI **reports** `sorry` count (comments stripped). Set `strict` to **fail** on any remaining `sorry` in `specs/`. Closed fragments use real proofs (`trivial`, `Nat.zero_le`); unfinished LLM obligations stay labeled — this is not end-to-end formal verification. |
| **Drift on push** | Compares changed functions against accepted `.specsync/` specs on main/master pushes. |
| **Operator-friendly** | `GET /health`, `GET /ready` (includes job + metrics counters), optional secret-gated dashboard (loopback by default), Docker image, Node + Lean + CodeQL + VS Code extension CI. |

The optional [VS Code extension](vscode-extension/) reads the same `.specsync/` store; compile it with `npm run compile` in that folder.

---

## Architecture

GitHub webhooks hit **Probot**; handlers enqueue analysis, then the worker parses diffs, walks ASTs, calls the **spec analyzer** / **LLM client**, and posts review comments plus coverage checks. Accepted specs live under **`.specsync/`**; Lake-built Lean sources for this repo also live under [`specs/`](specs/).

```mermaid
flowchart TB
  subgraph ingest [GitHub]
    E[Webhooks]
  end
  subgraph pipeline [Analysis]
    Q[AnalysisJobQueue]
    D[Diff parser]
    T[AST extractor]
    N[Spec analyzer]
    L[LLM client]
  end
  subgraph surface [Surfaces]
    G[PR comments and checks]
    S[".specsync/ store"]
    K[Lean stubs / Lake specs]
  end
  E --> Q --> D --> T --> N
  N --> L
  N --> G
  G --> S
  S --> K
```

Formal modules consumed by Lake live under [`specs/`](specs/), with [`lakefile.lean`](lakefile.lean) and [`lean-toolchain`](lean-toolchain) pinning the toolchain. Generated accept-path Lean may also land under `.specsync/lean/` depending on configuration.

---

## Repository layout

| Location | Role |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Probot entry: webhooks, queue, `GET /health`, `GET /ready` |
| [`src/analysis-queue.ts`](src/analysis-queue.ts) | In-process async job runner with idempotency |
| [`src/spec-store.ts`](src/spec-store.ts) | `.specsync/` read/write helpers |
| [`src/`](src/) | Parser, analyzer, GitHub UI, LLM client, generators, metrics |
| [`dist/`](dist/) | Build output from `npm run build` (generated, not committed) |
| [`specs/`](specs/) | Lean 4 sources for `lake build` |
| [`test/`](test/) | Jest tests (`*.test.ts`) |
| [`vscode-extension/`](vscode-extension/) | Editor extension (`npm run compile`) |
| [`.github/workflows/`](.github/workflows/) | Node CI, Lean CI, CodeQL |

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
GITHUB_TOKEN=...          # CLI/demo only; PR path uses installation octokit
SPECS_DIR=specs
PORT=3000
SPECSYNC_ALLOW_MOCK_LLM=false
SPECSYNC_PROOF_GATE=soft
SPECSYNC_MAX_SPECS_PER_PR=10
SPECSYNC_JOB_MARKERS_DIR=       # optional shared FS for multi-instance job idempotency
SPECSYNC_COMMAND_RATE_LIMIT=10
SPECSYNC_COMMAND_RATE_WINDOW_MS=60000
SPECSYNC_DASHBOARD=0
SPECSYNC_DASHBOARD_SECRET=
```

See [`env.example`](env.example) and [`app.yml`](app.yml) for the full App permission set (`checks: write`, `contents: write` for accept commits, etc.).

### GitHub App manifest (reference)

Use [`app.yml`](app.yml) when registering the app; point the webhook URL at your deployed Probot instance. Replace org/domain placeholders with your deployment.

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
- `GET /ready` — readiness, including analysis-queue stats and in-process metrics counters

The [`Dockerfile`](Dockerfile) healthcheck expects `GET /health` on the process port (default `3000`).

---

## Lean and Lake

- **CI:** [`lean4-ci.yml`](.github/workflows/lean4-ci.yml) runs `lake build` via [lean-action](https://github.com/leanprover/lean-action) when Lean-related paths or `src/lean4-generator.ts` change.
- **Local:** From the repo root, `lake build` after installing Elan/Lean (see `lean-toolchain`).
- **Committed baseline:** [`specs/Specs.lean`](specs/Specs.lean) + [`specs/Specs/ClosedNatContract.lean`](specs/Specs/ClosedNatContract.lean) are Std-only and **contain zero `sorry`** (opaque + closed proofs).
- **Generator contract:** [`src/lean4-generator.ts`](src/lean4-generator.ts) emits Std-only Lake modules:
  - Function under contract → `opaque` (no unfinished proof for missing bodies)
  - Smoke / Nat nonneg / other decidable fragments → real proofs (`trivial`, `Nat.zero_le`, …)
  - Undecided LLM postconditions → `/- SpecSync: unproved: <reason> -/` + `sorry` only
- **Proof gate:** `SPECSYNC_PROOF_GATE=soft` (default) reports counts; `strict` fails if any `sorry` remains. SpecSync does **not** claim completed formal verification while open obligations exist.
- **Accept path:** Artifacts for target repos are stored under `.specsync/` (separate from this repo’s `specs/` library).

---

## Continuous integration

| Workflow | Purpose |
| --- | --- |
| [`node-ci.yml`](.github/workflows/node-ci.yml) | Lint, format, typecheck, build, coverage tests, `npm audit --production`, Docker smoke, vscode-extension `compile` |
| [`lean4-ci.yml`](.github/workflows/lean4-ci.yml) | `lake build` for Lean specs |
| [`codeql.yml`](.github/workflows/codeql.yml) | CodeQL analysis for JavaScript/TypeScript |

[`dependabot.yml`](.github/dependabot.yml) schedules weekly npm and GitHub Actions updates.

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
  -e NODE_ENV=production \
  -e SPECSYNC_ALLOW_MOCK_LLM=false \
  specsync
```

Add LLM keys the same way if you use live models in production. Without keys (and without `SPECSYNC_ALLOW_MOCK_LLM=true`), the app posts an LLM-unavailable notice instead of fake specs.

### Other platforms

Any environment that provides Node, `PORT`, Probot env vars, and a **public HTTPS URL** for GitHub webhooks will work—containers on AWS/GCP/Azure, Fly.io, Railway, Heroku, or a VM behind nginx.

---

## Usage notes

- **Accept / ignore / edit:** Comment `/specsync accept` (or ignore/edit) on a suggestion; AuthZ requires a collaborator (or stronger) or PR committer. Accept writes `.specsync/specs/` + Lean stubs on the PR branch.
- **Demos:** After `npm run build`, run `npm run demo` or `npm run ui-demo`.
- **VS Code:** See [`vscode-extension/README.md`](vscode-extension/README.md); CI runs `npm run compile` in that package.
- **Lean:** Committed modules under `specs/` pass `lake build` with zero `sorry`. Accept-path sketches may still use labeled unfinished proofs until a human (or stronger autoformalization) closes them.

---

## Quality and security

- PRs run lint, format, typecheck, build, coverage-gated tests, production `npm audit`, Docker image smoke, and extension compile; CodeQL runs on push/PR/schedule.
- Structured logs (Probot `context.log` / shared pino) include job id, PR, latency, and LLM mock|live soft-cost fields where available.
- Prefer Dependabot PRs; treat audit failures as blocking unless an exception is documented in the workflow.

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
