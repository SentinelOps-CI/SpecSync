# SpecSync Repository Audit

**Date:** 2026-07-16  
**Scope:** Full repository at `C:\Users\mateo\SpecSync` (src, tests, CI, Lean, VS Code extension, infra)  
**Method:** Static code review + marker search + structure/CI/test inventory (no live deploy, no paid LLM calls)  
**Companion canvas:** `.cursor/projects/.../canvases/repo-audit.canvas.tsx` (open beside chat)

---

## Executive summary

**Verdict: prototype / architecture demo — not production-ready.**

SpecSync has a credible skeleton: a Probot app that on PR events fetches a diff, heuristically finds changed functions, optionally enriches with Tree-sitter AST, calls OpenAI/Anthropic (or a **mock**), and posts GitHub review comments plus a coverage check. That critical path is real but **fragile** (wrong Octokit client, confidence scale bugs, bad line anchors, sync LLM in the webhook).

Around that path sits a large surface of **stubs, mock dashboards, unwired generators, and a VS Code extension that does not compile**. Spec persistence, drift detection, Lean proof gating, Sigstore, and truthful coverage are missing or faked. Roughly **26+ discrete stub/placeholder surfaces** (plus pervasive `sorry` in the Lean generator and mock data generators). Maturity is early R&D / demo — suitable for local demos with keys, not for a multi-tenant production GitHub App.

---

## Inventory of stubs / placeholders

| Location | Symbol / area | What's missing |
|----------|---------------|----------------|
| `src/spec-analyzer.ts` | `detectDrift` | Placeholder; always `[]`; logs "not yet implemented" |
| `src/spec-analyzer.ts` | `storeSpec` / `retrieveSpec` | `console.log` only; retrieve always `null` |
| `src/spec-analyzer.ts` | `generateSpecSuggestion` | Comment still says "placeholder"; LLM is wired |
| `src/llm-client.ts` | `generateMockSpec` | Silent mock when no API keys or on API failure |
| `src/index.ts` | `proofStatus` | Hardcoded `coverage: 75`, fabricated proof status |
| `src/index.ts` | `void vscodeUI/webDashboard/uiPrinciples` | Constructed, never started |
| `src/index.ts` | `handlePush` | Voids `diffParser`/`astExtractor`; drift never fires |
| `src/ci-integration.ts` | `signFile` | Fake `sigstore:${sha256}`; not called from entry |
| `src/ci-integration.ts` | module | Entire CI/Lean runner unwired from `index.ts` |
| `src/lean4-generator.ts` | theorems / tactics | Heavy `sorry` / `-- TODO`; not wired to accept |
| `src/web-dashboard.ts` | `generateMockCoverageData` | No real coverage store |
| `src/web-dashboard.ts` | `generateMockDriftData` | Demo drift |
| `src/web-dashboard.ts` | `generateMockStoriesData` | Demo stories |
| `src/web-dashboard.ts` | `generateMockAuditData` | Demo audit |
| `src/dashboard-ui.ts` | drift APIs/pages | Hardcoded zeros |
| `src/github-ui.ts` | `storeAcceptedSpec` | Delegates to stub `storeSpec` |
| `src/github-ui.ts` | `generateEditForm` | Posts to `/specsync/edit` — no route |
| `src/github-ui.ts` | accept/ignore | Misuses `pulls.dismissReview` |
| `src/ui-principles.ts` | confidence color coding | Validator: "not implemented" |
| `src/health.ts` | `HealthChecker` | Unused; Probot `/ready` has no dependency checks |
| `src/developer-feedback.ts` | module | Demo/Slack queue; unwired |
| `src/vscode-ui.ts` | module | Code generator, not the shipped extension |
| `src/spec-coverage.ts` | module | Never used for PR coverage check |
| `env.example` | `DATABASE_URL` | "Future use" — no persistence |
| `app.yml` | urls / permissions | `your-org` placeholders; no `checks: write` |
| `specs/Specs.lean` | `specsync_smoke` | Only `True := trivial` |
| `vscode-extension/` | compile + features | Sources fail `tsc`; orphan modules; incomplete handlers |

**Approx count:** ~26 inventory rows above; **~40+** if counting individual `sorry` emission sites, mock generators, and dead command handlers separately. **~20 prioritized findings** in the canvas (5 P0, 11 P1, 4 P2).

---

## Architecture assessment

### Intended shape

```
GitHub webhook → Probot (index.ts)
  → DiffParser → ASTExtractor → SpecAnalyzer (+ LLMClient)
  → GitHubUI (comments + checks)
  → (optional) SlackAlerts, Lean, dashboards, VS Code
```

### Reality

| Layer | Status |
|-------|--------|
| Webhook ingress | Partial — PR + comment + push registered |
| Diff / AST | Prototype — regex + tree-sitter; Go/C/C++ claimed without parsers |
| LLM specs | Works with keys; silent mock without |
| GitHub comments | Partially wired; auth + line + confidence bugs |
| Spec persistence | Stub |
| Lean / proofs / CI gate | Generator + CI wrapper exist; **disconnected** from webhooks |
| Drift | Stub |
| Dashboards | Demo / mock; voided in entry |
| VS Code | Separate package **broken**; `src/vscode-ui.ts` is a generator |
| Observability | Minimal (`context.log` + unused pino `health.ts`) |
| Multi-tenancy | Broken by static `GITHUB_TOKEN` Octokit in `GitHubUI` |

### Coupling / dead weight

- God-handler `handlePullRequest` does sync I/O + LLM with no queue.
- Duplicate systems: `WebDashboard` vs `DashboardUI`; `SpecAnalyzer.handleCommentCommand` vs `GitHubUI.handleSpecCommentAction`.
- **16/18** `src` files use `// @ts-nocheck` (only `index.ts` and `health.ts` typed).

### Critical path gaps (PR → comment)

1. Wrong Octokit (`GITHUB_TOKEN` vs `context.octokit`)
2. Confidence 0–100 vs 0–1 display bug
3. Line number = hunk index, not file line
4. Coverage check fabricated
5. Accept does not persist or emit Lean
6. No dedupe on PR synchronize → comment spam
7. No `listFiles` pagination

---

## Quality / test / CI gaps

### Tests

- **~101 Jest tests** across 8 suites; strong on LLM mock client, Slack formatting, UI principles, Lean string generation, GitHubUI formatting.
- **0% coverage** on: `index.ts`, `ast-extractor.ts`, `ci-integration.ts`, `spec-coverage.ts`, `health.ts`, dashboards, `developer-feedback.ts`.
- `spec-analyzer.ts` ~12% (mostly via accept → `storeSpec`).
- Global mocks in `test/setup.ts` neutralize tree-sitter, fs-extra, simple-git — AST never exercised for real.
- `llm-integration.test.ts` is mock-only (misleading name).
- Webhook fixture `test/fixtures/pull_request.opened.json` only checked for JSON shape — **not** wired to handlers.
- Helpers `createMockContext` / `createMockDiff` defined but unused.

### CI

| Workflow | Runs | Gaps |
|----------|------|------|
| `node-ci.yml` | lint, prettier, typecheck, build, `npm test` | No `test:coverage` (50% thresholds unused), no audit/CodeQL, no Docker, no extension job |
| `lean4-ci.yml` | `lake build` on Lean paths | No `sorry` gate; skips when only generator TS changes; no Mathlib |
| Dependabot | npm root + extension | No `github-actions` ecosystem |

### VS Code extension

- Sources fail TypeScript compile (broken template literals / strings).
- No `@types/vscode` / scripts / `engines.vscode` in `package.json`.
- Orphan `suggestion-panel.ts` / `proof-runner.ts` with duplicate `activate`; view not in `contributes`.
- `editSpec` / cancel proof incomplete.

### Lean

- Committed: smoke theorem only.
- Generator: Mathlib imports + `sorry`; Lake has **no Mathlib** (`packages: []`).

---

## Performance and cost concerns

| Issue | Severity | Where |
|-------|----------|-------|
| Sync webhook runs full LLM chain | P0 | `src/index.ts` `handlePullRequest` |
| Sequential LLM per changed function, unbounded | P0/P1 | `spec-analyzer.analyzeChanges` |
| No per-PR token/cost budget | P1 | `llm-client.ts` (`max_tokens: 2000` per call) |
| N+1 `repos.getContent` per function | P1 | `ast-extractor.ts` |
| N+1 `createReviewComment` | P1 | `index.ts` loop |
| `listFiles` without pagination | P1 | `index.ts` |
| Full FS walk on dashboard APIs | P1 | `spec-coverage.ts` (if ever started) |
| In-memory `specCache` no TTL / multi-instance | P2 | `spec-analyzer.ts` |

**Cost sketch:** 20-function PR → up to 20× model calls with ~2k output tokens each, no batching, no “changed lines only” hard cap beyond heuristics — expensive and slow under load.

---

## Security and reliability gaps

| Issue | Severity | Where |
|-------|----------|-------|
| Static `GITHUB_TOKEN` parallel to App installation auth | P0 | `index.ts`, `github-ui.ts` |
| No authZ on `/specsync` commands | P1 | `index.ts` comment handlers |
| Unauthenticated dashboard APIs (if started) | P1 | `web-dashboard.ts`, `dashboard-ui.ts` |
| Fake Sigstore presented as signing | P1 | `ci-integration.signFile` |
| Mock LLM specs may post to real PRs | P1 | `llm-client.ts` |
| `exec(\`lean --json ${specFile}\`)` shell interpolation | P2 | `ci-integration.ts`, `spec-coverage.ts` |
| Missing `checks: write` in `app.yml` | P1 | Check runs fail in real App |
| HTML form interpolation without escaping | P2 | `github-ui.generateEditForm` |
| `/ready` always ready | P2 | No dependency probes |
| No idempotency → duplicate comments on retries | P1 | PR synchronize + webhook retries |

Not a pentest — high-level code review only.

---

## Missing vs best-in-class SpecSync-like product

A best-in-class “specs meet PRs” product would typically include:

1. **Multi-tenant GitHub App auth** with installation-scoped Octokit only  
2. **Durable spec store** (repo files and/or DB) with versioning and review history  
3. **Async analysis workers** with budgets, caching, and dedupe  
4. **Proof CI** that gates merges on real Lean/Lake outcomes (or explicit “suggest-only” mode)  
5. **Drift detection** comparing code changes to stored contracts  
6. **Policy / repo config** (languages, thresholds, allowlists)  
7. **AuthZ** for accept/edit (CODEOWNERS / role)  
8. **Working IDE extension** reading the same store  
9. **Observability**: structured logs, metrics (LLM cost, latency), tracing  
10. **E2E / contract tests** for webhooks and GitHub API shapes  
11. **Honest UX**: never post mock specs or fake coverage as merge signals  

SpecSync today has **partial (1–4 as sketches)** and **none complete**.

---

## Prioritized backlog

### P0 — unblock a truthful pilot

| Item | Rationale |
|------|-----------|
| Use `context.octokit` for all GitHub writes; stop initializing `GitHubUI` with `GITHUB_TOKEN` for PR path | App installs cannot work reliably otherwise |
| Normalize confidence to 0–1 (or fix formatter + `index` thresholds together) | Comments are wrong in production |
| Map review comment `line` to GitHub file line (diff position API or proper mapping) | Comments fail or misattach |
| Async job queue for analysis; acknowledge webhook quickly; idempotent runs | Timeouts, cost, duplicate posts |
| Real `storeSpec` + accept path writes Lean/spec artifact; fix dismiss API misuse | “Accept” is currently a no-op / broken |

### P1 — make signals honest and shippable

| Item | Rationale |
|------|-----------|
| Remove hardcoded coverage **or** wire `SpecCoverageTracker` / Lean CI | Fake merge signal is worse than none |
| Implement `detectDrift` or delete push/Slack drift path | Dead code that pretends to work |
| Add `checks: write`; paginate files; cap LLM calls | Reliability + cost |
| Refuse to post when using mock LLM in non-dev | Avoid poisoning PRs |
| Probot integration tests for `handlePullRequest`; enforce `test:coverage` in CI | Regressions on critical path |
| Fix VS Code extension compile; wire or delete orphans | Product claim in README |
| Align Lean generator with Lake (Std-only or add Mathlib); CI `sorry` policy | Formal verification story |

### P2 — harden for production ops

| Item | Rationale |
|------|-----------|
| Strip `@ts-nocheck`; tighten ESLint | Safety net |
| AuthZ for commands; auth for dashboards or remove them | Abuse / data leak |
| `npm audit` / CodeQL / Docker smoke / extension CI | Supply chain + deploy confidence |
| Structured logging + metrics + real `/ready` | Operability |
| Dependabot for GitHub Actions | Stale Actions risk |

---

## Suggested order of attack (next sessions)

1. **Session 1 — PR comment correctness:** Octokit + confidence + line numbers.  
2. **Session 2 — Scale/cost:** async jobs, budgets, pagination, dedupe.  
3. **Session 3 — Accept loop:** persistence + Lean/spec file write.  
4. **Session 4 — Honest checks:** real coverage or remove; fix `app.yml`.  
5. **Session 5 — Tests/CI:** Probot integration tests + coverage gate.  
6. **Session 6 — Drift:** implement or delete; stop fake Slack path.  
7. **Session 7 — Lean stack:** Lake/generator alignment + sorry policy.  
8. **Session 8 — Extension:** compile fix or quarantine from README claims.  
9. **Session 9 — Security/DX:** authZ, types, dashboard truth-or-delete.  
10. **Session 10 — Ops:** security scans, Docker, observability.

---

## Inspection limits / blockers

- No live GitHub App installation or webhook delivery exercised.  
- No live OpenAI/Anthropic calls.  
- Docker image not built; `lake build` not re-run in this audit pass (Lean CI exists; contents reviewed statically).  
- VS Code `tsc` failure reported via explore pass — re-confirm with `npx tsc -p vscode-extension`.  
- Runtime behavior of tree-sitter natives under Docker not validated.

---

## Post-remediation status

**Updated:** 2026-07-16 (after Phases 0–10 + Lean sorry-reduction pass)

Phases 0–10 of `audit_remediation_plan_5ae97077` are marked complete. The critical path is no longer the prototype described in the executive summary above; treat the inventory table as historical.

### Lean `sorry` status (honest)

| Surface | Status |
|---------|--------|
| Committed `specs/` (`Specs.lean`, `Specs/ClosedNatContract.lean`) | **0 `sorry`**; `lake build` green (Std-only) |
| `src/lean4-generator.ts` | Spec-as-contract: `opaque` bodies; smoke / Nat nonneg closed with real proofs; LLM-undecided posts keep `/- SpecSync: unproved: <reason> -/` + `sorry` |
| `SPECSYNC_PROOF_GATE` | `soft` reports count; `strict` fails on any `sorry` (comments stripped) |
| Mathlib / full autoformalization | **Still deferred** — not claimed |

### Done (remediated)

| Area | Status |
|------|--------|
| Confidence 0–1 + comment formatting | Done |
| Installation-scoped `context.octokit` on PR path | Done |
| Diff hunk → file line mapping; LEFT for pure deletions | Done |
| Async `AnalysisJobQueue` + idempotency; optional FS job markers | Done |
| `.specsync/` accept / ignore / edit apply + Lean write | Done |
| Real coverage checks; honest digests (no fake Sigstore claims) | Done |
| `detectDrift` on push; Slack only when findings exist | Done |
| Mock LLM policy; language support honesty (JS/TS/Python/Java/Rust) | Done |
| Probot integration tests; CI `test:coverage`; CodeQL; Docker; extension compile job | Done |
| VS Code extension compiles; reads `.specsync/`; generator `vscode-ui.ts` removed | Done |
| Single secret-gated dashboard; comment AuthZ; command rate limits | Done |
| `@ts-nocheck` stripped from critical path; metrics + `/ready` | Done |
| README / `env.example` / `app.yml` aligned with behavior | Done |

### Intentionally deferred

| Item | Notes |
|------|-------|
| Multi-tenant Postgres SaaS / billing | `DATABASE_URL` documented as future only |
| Real Sigstore/cosign keyless signing | Digests remain honest content hashes |
| Closing all Lean `sorry` / Mathlib autoformalization | **Partial progress:** committed `specs/` is sorry-free; generator minimizes sorry to undecided LLM props. Full autoformalization + Mathlib still deferred |
| Redis/BullMQ workers | Queue interface shaped for swap; in-process + optional markers for now |
| Full multi-region HA / durable queue | Single-instance default; markers need shared volume |

### Suggested next session (material remaining)

1. Live install smoke: open a PR with adds + pure deletions; confirm LEFT/RIGHT anchors and accept commits.  
2. Raise coverage on `ci-integration.ts` / `spec-coverage.ts` if those modules stay in the product path.  
3. If running >1 Probot replica, deploy with a shared `SPECSYNC_JOB_MARKERS_DIR` (or swap in Redis).  
4. Optional: wire dashboard to live drift history beyond empty/`.specsync` snapshots.

---

## File index (primary)

- Entry: `src/index.ts`  
- Pipeline: `diff-parser.ts`, `ast-extractor.ts`, `spec-analyzer.ts`, `llm-client.ts`, `github-ui.ts`, `analysis-queue.ts`, `spec-store.ts`, `command-rate-limit.ts`  
- Formal/CI: `lean4-generator.ts`, `ci-integration.ts`, `spec-coverage.ts`, `specs/`, `lakefile.lean`  
- Surfaces: `web-dashboard.ts`, `slack-alerts.ts`, `vscode-extension/`  
- Quality: `test/`, `.github/workflows/`, `jest.config.js`, `Dockerfile`, `app.yml`, `env.example`
