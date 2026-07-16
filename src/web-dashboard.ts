/**
 * SpecSync local dashboard — serves data from `.specsync/` only.
 * Started only when SPECSYNC_DASHBOARD=1 and SPECSYNC_DASHBOARD_SECRET is set.
 * All HTTP routes (including static) require the shared-secret header.
 */
const express = require("express");
const path = require("path");
const fsExtra = require("fs-extra");
const fs = fsExtra.default ?? fsExtra;
const { analysisJobQueue } = require("./analysis-queue");

const SPECSYNC_ROOT = ".specsync";

function escapeHtml(value: any) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const EMPTY_COVERAGE = {
  summary: {
    totalFunctions: 0,
    coveredFunctions: 0,
    coveragePercentage: 0,
    lastUpdated: null,
  },
  modules: [],
  source: "empty",
};

const EMPTY_DRIFT = {
  timeline: [],
  summary: {
    totalDrifts: 0,
    highSeverity: 0,
    mediumSeverity: 0,
    lowSeverity: 0,
    resolved: 0,
    pending: 0,
  },
  source: "empty",
};

const EMPTY_STORIES = { stories: [], source: "empty" };

export class WebDashboard {
  app: any;
  port: any;
  host: any;
  secret: any;
  server: any;
  constructor() {
    this.app = express();
    this.port = Number(process.env.DASHBOARD_PORT || 3001);
    this.host = process.env.DASHBOARD_HOST || "127.0.0.1";
    this.secret = process.env.SPECSYNC_DASHBOARD_SECRET || "";
    this.server = null;
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json({ limit: "256kb" }));
    this.app.use(this.requireDashboardSecret.bind(this));
  }

  /**
   * Shared-secret AuthZ before any HTTP API or HTML page.
   * Accepts `X-SpecSync-Dashboard-Secret` or `Authorization: Bearer <secret>`.
   */
  requireDashboardSecret(req: any, res: any, next: any) {
    if (!this.secret) {
      res.status(503).json({
        error: "Dashboard secret not configured (SPECSYNC_DASHBOARD_SECRET)",
      });
      return;
    }

    const headerSecret = req.get("x-specsync-dashboard-secret");
    const auth = req.get("authorization") || "";
    const bearer = auth.toLowerCase().startsWith("bearer ")
      ? auth.slice(7).trim()
      : "";
    const provided = headerSecret || bearer;

    if (!provided || provided !== this.secret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  }

  setupRoutes() {
    this.app.get("/api/coverage", this.getCoverageData.bind(this));
    this.app.get("/api/drift", this.getDriftData.bind(this));
    this.app.get("/api/stories", this.getStoriesData.bind(this));
    this.app.get("/api/audit/:functionId", this.getAuditData.bind(this));
    this.app.get("/api/jobs", this.getJobsMetrics.bind(this));
    this.app.get("/api/specs", this.listStoredSpecs.bind(this));

    this.app.get("/coverage", this.renderCoverageMap.bind(this));
    this.app.get("/drift", this.renderDriftMonitor.bind(this));
    this.app.get("/", this.renderDashboard.bind(this));
  }

  /**
   * Start only when SPECSYNC_DASHBOARD=1 and a secret is configured.
   * Binds to loopback by default (DASHBOARD_HOST).
   */
  start() {
    if (process.env.SPECSYNC_DASHBOARD !== "1") {
      console.log("SpecSync Dashboard not started (set SPECSYNC_DASHBOARD=1 to enable)");
      return null;
    }
    if (!this.secret) {
      console.warn(
        "SPECSYNC_DASHBOARD=1 but SPECSYNC_DASHBOARD_SECRET is unset; dashboard not started"
      );
      return null;
    }

    this.server = this.app.listen(this.port, this.host, () => {
      console.log(
        `SpecSync Dashboard listening on http://${this.host}:${this.port} (secret auth required)`
      );
    });
    return this.server;
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  async getCoverageData(_req: any, res: any) {
    try {
      res.json(await this.loadCoverageData());
    } catch (error: unknown) {
      res.status(500).json({ error: error instanceof Error ? (error instanceof Error ? error.message : String(error)) : String(error) });
    }
  }

  async getDriftData(_req: any, res: any) {
    try {
      res.json(await this.loadDriftData());
    } catch (error: unknown) {
      res.status(500).json({ error: error instanceof Error ? (error instanceof Error ? error.message : String(error)) : String(error) });
    }
  }

  async getStoriesData(_req: any, res: any) {
    try {
      res.json(await this.loadStoriesData());
    } catch (error: unknown) {
      res.status(500).json({ error: error instanceof Error ? (error instanceof Error ? error.message : String(error)) : String(error) });
    }
  }

  async getAuditData(req: any, res: any) {
    try {
      const auditData = await this.loadAuditData(req.params.functionId);
      if (!auditData) {
        res.status(404).json({ error: "Audit record not found" });
        return;
      }
      res.json(auditData);
    } catch (error: unknown) {
      res.status(500).json({ error: error instanceof Error ? (error instanceof Error ? error.message : String(error)) : String(error) });
    }
  }

  async getJobsMetrics(_req: any, res: any) {
    res.json({
      source: "analysis-queue",
      ...analysisJobQueue.getStats(),
    });
  }

  async listStoredSpecs(_req: any, res: any) {
    try {
      res.json(await this.loadSpecsFromStore());
    } catch (error: unknown) {
      res.status(500).json({ error: error instanceof Error ? (error instanceof Error ? error.message : String(error)) : String(error) });
    }
  }

  async renderCoverageMap(req: any, res: any) {
    try {
      const coverageData = await this.loadCoverageData();
      res.type("html").send(this.generateCoverageMapHTML(coverageData));
    } catch (error: unknown) {
      res.status(500).type("html").send(`<p>${escapeHtml((error instanceof Error ? error.message : String(error)))}</p>`);
    }
  }

  async renderDriftMonitor(_req: any, res: any) {
    try {
      const driftData = await this.loadDriftData();
      res.type("html").send(this.generateDriftMonitorHTML(driftData));
    } catch (error: unknown) {
      res.status(500).type("html").send(`<p>${escapeHtml((error instanceof Error ? error.message : String(error)))}</p>`);
    }
  }

  async renderDashboard(_req: any, res: any) {
    try {
      const coverageData = await this.loadCoverageData();
      const driftData = await this.loadDriftData();
      const jobs = analysisJobQueue.getStats();
      res.type("html").send(this.generateDashboardHTML(coverageData, driftData, jobs));
    } catch (error: unknown) {
      res.status(500).type("html").send(`<p>${escapeHtml((error instanceof Error ? error.message : String(error)))}</p>`);
    }
  }

  async readSpecsyncJson(relativePath: any, fallback: any) {
    const fullPath = path.join(process.cwd(), SPECSYNC_ROOT, relativePath);
    if (!(await fs.pathExists(fullPath))) {
      return { ...fallback, source: "empty" };
    }
    const data = await fs.readJson(fullPath);
    return { ...data, source: `.specsync/${relativePath.replace(/\\/g, "/")}` };
  }

  async loadCoverageData() {
    const fromFile = await this.readSpecsyncJson("coverage.json", EMPTY_COVERAGE);
    if (fromFile.source !== "empty") {
      return fromFile;
    }
    // Derive a summary from accepted specs on disk when coverage.json is absent.
    const specs = await this.loadSpecsFromStore();
    if (specs.specs.length === 0) {
      return EMPTY_COVERAGE;
    }
    const byModule = new Map();
    for (const spec of specs.specs) {
      const dir = path.posix.dirname(spec.filePath.replace(/\\/g, "/")) || ".";
      if (!byModule.has(dir)) {
        byModule.set(dir, { name: dir, coverage: 100, functions: [] });
      }
      byModule.get(dir).functions.push({
        name: spec.functionName,
        status: "verified",
        line: spec.lineNumber || 0,
      });
    }
    return {
      summary: {
        totalFunctions: specs.specs.length,
        coveredFunctions: specs.specs.length,
        coveragePercentage: 100,
        lastUpdated: new Date().toISOString(),
      },
      modules: Array.from(byModule.values()),
      source: ".specsync/specs",
    };
  }

  async loadDriftData() {
    return this.readSpecsyncJson("drift_events.json", EMPTY_DRIFT);
  }

  async loadStoriesData() {
    return this.readSpecsyncJson("story_map.json", EMPTY_STORIES);
  }

  async loadAuditData(functionId: any) {
    const safeId = String(functionId || "").replace(/[^a-zA-Z0-9._-]/g, "_");
    const auditPath = path.join(process.cwd(), SPECSYNC_ROOT, "audit", `${safeId}.json`);
    if (!(await fs.pathExists(auditPath))) {
      return null;
    }
    return fs.readJson(auditPath);
  }

  async loadSpecsFromStore() {
    const specsDir = path.join(process.cwd(), SPECSYNC_ROOT, "specs");
    if (!(await fs.pathExists(specsDir))) {
      return { specs: [], source: "empty" };
    }
    const files = await fs.readdir(specsDir);
    const specs = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const data = await fs.readJson(path.join(specsDir, file));
        specs.push({
          storeFile: file,
          functionName: data.functionName,
          filePath: data.filePath,
          lineNumber: data.lineNumber,
          confidence: data.confidence,
          acceptedAt: data.acceptedAt,
          pr: data.pr,
          sha: data.sha,
        });
      } catch {
        // skip corrupt entries
      }
    }
    return { specs, source: ".specsync/specs" };
  }

  generateDashboardHTML(coverage: any, drift: any, jobs: any) {
    const summary = coverage.summary || EMPTY_COVERAGE.summary;
    const driftSummary = drift.summary || EMPTY_DRIFT.summary;
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>SpecSync Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; background: #f6f7f9; }
    h1 { margin-top: 0; }
    .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .card { background: #fff; padding: 1rem 1.25rem; border: 1px solid #e2e5ea; }
    a { color: #0b57d0; }
    .muted { color: #667085; font-size: 0.875rem; }
  </style>
</head>
<body>
  <h1>SpecSync</h1>
  <p class="muted">Data source: ${escapeHtml(coverage.source || "empty")}</p>
  <div class="grid">
    <div class="card">
      <h2>Coverage</h2>
      <p>${escapeHtml(summary.coveredFunctions)} / ${escapeHtml(summary.totalFunctions)}
         (${escapeHtml(summary.coveragePercentage)}%)</p>
      <p><a href="/coverage">Coverage map</a></p>
    </div>
    <div class="card">
      <h2>Drift</h2>
      <p>Pending: ${escapeHtml(driftSummary.pending)} / Total: ${escapeHtml(driftSummary.totalDrifts)}</p>
      <p><a href="/drift">Drift monitor</a></p>
    </div>
    <div class="card">
      <h2>Jobs</h2>
      <p>Running: ${escapeHtml(jobs.running)} / Total tracked: ${escapeHtml(jobs.total)}</p>
      <p class="muted">${escapeHtml(JSON.stringify(jobs.byStatus || {}))}</p>
    </div>
  </div>
</body>
</html>`;
  }

  generateCoverageMapHTML(data: any) {
    const modules = data.modules || [];
    const nodes = modules
      .map((module: any) => {
        const fns = (module.functions || [])
          .map(
            (func: any) =>
              `<div class="file">${escapeHtml(func.name)} ` +
              `<span class="badge">${escapeHtml(func.status)}</span></div>`
          )
          .join("");
        return `<div class="module"><strong>${escapeHtml(module.name)}</strong> ` +
          `(${escapeHtml(module.coverage)}%)${fns}</div>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Spec Coverage Map</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; }
  .module { margin-bottom: 1rem; padding: 0.75rem; background: #fff; border: 1px solid #ddd; }
  .file { margin-left: 1rem; }
  .badge { font-size: 0.75rem; padding: 0.1rem 0.4rem; background: #eef; }
</style>
</head>
<body>
  <h1>Spec Coverage Map</h1>
  <p>Source: ${escapeHtml(data.source || "empty")}</p>
  ${nodes || "<p>No coverage data under <code>.specsync/</code>.</p>"}
</body>
</html>`;
  }

  generateDriftMonitorHTML(data: any) {
    const timeline = data.timeline || [];
    const rows = timeline
      .map(
        (event: any) =>
          `<li><strong>${escapeHtml(event.functionName)}</strong> ` +
          `(${escapeHtml(event.severity)}): ${escapeHtml(event.reason)} ` +
          `<span>${escapeHtml(event.timestamp || "")}</span></li>`
      )
      .join("");

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Spec Drift Monitor</title>
<style>body { font-family: system-ui, sans-serif; margin: 2rem; }</style>
</head>
<body>
  <h1>Spec Drift Monitor</h1>
  <p>Source: ${escapeHtml(data.source || "empty")}</p>
  <ul>${rows || "<li>No drift events under <code>.specsync/drift_events.json</code>.</li>"}</ul>
</body>
</html>`;
  }
}

(WebDashboard as any).escapeHtml = escapeHtml;
