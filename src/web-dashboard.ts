// @ts-nocheck
const express = require("express");
const path = require("path");
const fs = require("fs-extra");

export class WebDashboard {
  constructor() {
    this.app = express();
    this.port = process.env.DASHBOARD_PORT || 3001;
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup middleware
   */
  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, "public")));
    this.app.set("view engine", "ejs");
    this.app.set("views", path.join(__dirname, "views"));
  }

  /**
   * Setup routes
   */
  setupRoutes() {
    // Prompt 3.1 — Spec Coverage Map
    this.app.get("/api/coverage", this.getCoverageData.bind(this));
    this.app.get("/coverage", this.renderCoverageMap.bind(this));

    // Prompt 3.2 — Spec Drift Monitor
    this.app.get("/api/drift", this.getDriftData.bind(this));
    this.app.get("/drift", this.renderDriftMonitor.bind(this));

    // Prompt 3.3 — Story ↔ Spec Linker
    this.app.get("/api/stories", this.getStoriesData.bind(this));
    this.app.get("/stories", this.renderStoryLinker.bind(this));

    // Prompt 3.4 — Audit Explorer
    this.app.get("/api/audit/:functionId", this.getAuditData.bind(this));
    this.app.get("/audit/:functionId", this.renderAuditExplorer.bind(this));

    // Dashboard home
    this.app.get("/", this.renderDashboard.bind(this));
  }

  /**
   * Start the dashboard server
   */
  start() {
    this.app.listen(this.port, () => {
      console.log(`SpecSync Dashboard running on http://localhost:${this.port}`);
    });
  }

  /**
   * Prompt 3.1 — Spec Coverage Map
   * Goal: Tree view of repo with color-coded verification status.
   */
  async getCoverageData(req, res) {
    try {
      const coverageData = await this.loadCoverageData();
      res.json(coverageData);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async renderCoverageMap(req, res) {
    try {
      const coverageData = await this.loadCoverageData();
      res.render("coverage-map", {
        title: "Spec Coverage Map",
        coverageData,
        filters: {
          author: req.query.author || "",
          team: req.query.team || "",
          module: req.query.module || "",
          dateRange: req.query.dateRange || "all",
        },
      });
    } catch (error) {
      res.status(500).render("error", { error: error.message });
    }
  }

  /**
   * Load coverage data from file or generate mock data
   */
  async loadCoverageData() {
    try {
      const coveragePath = path.join(process.cwd(), ".specsync", "coverage.json");
      if (await fs.pathExists(coveragePath)) {
        return await fs.readJson(coveragePath);
      }
    } catch (error) {
      console.warn("Could not load coverage data:", error.message);
    }

    // Generate mock coverage data
    return this.generateMockCoverageData();
  }

  /**
   * Generate mock coverage data for demonstration
   */
  generateMockCoverageData() {
    return {
      summary: {
        totalFunctions: 150,
        coveredFunctions: 112,
        coveragePercentage: 75,
        lastUpdated: new Date().toISOString(),
      },
      modules: [
        {
          name: "src/auth",
          coverage: 85,
          functions: [
            { name: "validateToken", status: "verified", line: 15 },
            { name: "generateToken", status: "verified", line: 45 },
            { name: "refreshToken", status: "missing", line: 78 },
          ],
        },
        {
          name: "src/payment",
          coverage: 60,
          functions: [
            { name: "processPayment", status: "verified", line: 12 },
            { name: "refundPayment", status: "failed", line: 34 },
            { name: "validateCard", status: "missing", line: 67 },
          ],
        },
        {
          name: "src/user",
          coverage: 90,
          functions: [
            { name: "createUser", status: "verified", line: 23 },
            { name: "updateUser", status: "verified", line: 56 },
            { name: "deleteUser", status: "verified", line: 89 },
          ],
        },
      ],
    };
  }

  /**
   * Prompt 3.2 — Spec Drift Monitor
   * Goal: Timeline chart of drift events + alert panel.
   */
  async getDriftData(req, res) {
    try {
      const driftData = await this.loadDriftData();
      res.json(driftData);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async renderDriftMonitor(req, res) {
    try {
      const driftData = await this.loadDriftData();
      res.render("drift-monitor", {
        title: "Spec Drift Monitor",
        driftData,
        filters: {
          severity: req.query.severity || "all",
          dateRange: req.query.dateRange || "7d",
        },
      });
    } catch (error) {
      res.status(500).render("error", { error: error.message });
    }
  }

  /**
   * Load drift data
   */
  async loadDriftData() {
    try {
      const driftPath = path.join(process.cwd(), ".specsync", "drift_events.json");
      if (await fs.pathExists(driftPath)) {
        return await fs.readJson(driftPath);
      }
    } catch (error) {
      console.warn("Could not load drift data:", error.message);
    }

    return this.generateMockDriftData();
  }

  /**
   * Generate mock drift data
   */
  generateMockDriftData() {
    return {
      timeline: [
        {
          timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          functionName: "withdraw",
          module: "src/payment",
          severity: "high",
          reason: "Postcondition weakened",
          author: "alice@company.com",
          commit: "abc1234",
        },
        {
          timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
          functionName: "validateToken",
          module: "src/auth",
          severity: "medium",
          reason: "Precondition changed",
          author: "bob@company.com",
          commit: "def5678",
        },
        {
          timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          functionName: "processPayment",
          module: "src/payment",
          severity: "low",
          reason: "Invariant updated",
          author: "charlie@company.com",
          commit: "ghi9012",
        },
      ],
      summary: {
        totalDrifts: 3,
        highSeverity: 1,
        mediumSeverity: 1,
        lowSeverity: 1,
        resolved: 0,
        pending: 3,
      },
    };
  }

  /**
   * Prompt 3.3 — Story ↔ Spec Linker
   * Goal: Trace JIRA stories to formal specs and code.
   */
  async getStoriesData(req, res) {
    try {
      const storiesData = await this.loadStoriesData();
      res.json(storiesData);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async renderStoryLinker(req, res) {
    try {
      const storiesData = await this.loadStoriesData();
      res.render("story-linker", {
        title: "Story ↔ Spec Linker",
        storiesData,
      });
    } catch (error) {
      res.status(500).render("error", { error: error.message });
    }
  }

  /**
   * Load stories data
   */
  async loadStoriesData() {
    try {
      const storiesPath = path.join(process.cwd(), ".specsync", "story_map.json");
      if (await fs.pathExists(storiesPath)) {
        return await fs.readJson(storiesPath);
      }
    } catch (error) {
      console.warn("Could not load stories data:", error.message);
    }

    return this.generateMockStoriesData();
  }

  /**
   * Generate mock stories data
   */
  generateMockStoriesData() {
    return {
      stories: [
        {
          id: "PROJ-123",
          title: "Implement secure payment processing",
          status: "in-progress",
          coverage: 75,
          specs: [
            {
              functionName: "processPayment",
              theorem: "payment_security_theorem",
              status: "verified",
            },
            { functionName: "validateCard", theorem: "card_validation_theorem", status: "missing" },
          ],
          driftWarnings: 1,
        },
        {
          id: "PROJ-124",
          title: "Add user authentication",
          status: "done",
          coverage: 100,
          specs: [
            {
              functionName: "validateToken",
              theorem: "token_validation_theorem",
              status: "verified",
            },
            {
              functionName: "generateToken",
              theorem: "token_generation_theorem",
              status: "verified",
            },
          ],
          driftWarnings: 0,
        },
        {
          id: "PROJ-125",
          title: "User profile management",
          status: "todo",
          coverage: 0,
          specs: [],
          driftWarnings: 0,
        },
      ],
    };
  }

  /**
   * Prompt 3.4 — Audit Explorer
   * Goal: Compliance-friendly modal showing complete proof lineage.
   */
  async getAuditData(req, res) {
    try {
      const functionId = req.params.functionId;
      const auditData = await this.loadAuditData(functionId);
      res.json(auditData);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async renderAuditExplorer(req, res) {
    try {
      const functionId = req.params.functionId;
      const auditData = await this.loadAuditData(functionId);
      res.render("audit-explorer", {
        title: `Audit Explorer - ${functionId}`,
        auditData,
      });
    } catch (error) {
      res.status(500).render("error", { error: error.message });
    }
  }

  /**
   * Load audit data for a specific function
   */
  async loadAuditData(functionId) {
    try {
      const auditPath = path.join(process.cwd(), ".specsync", "audit", `${functionId}.json`);
      if (await fs.pathExists(auditPath)) {
        return await fs.readJson(auditPath);
      }
    } catch (error) {
      console.warn("Could not load audit data:", error.message);
    }

    return this.generateMockAuditData(functionId);
  }

  /**
   * Generate mock audit data
   */
  generateMockAuditData(functionId) {
    return {
      functionId,
      lineage: [
        {
          timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          author: "alice@company.com",
          commit: "abc1234",
          theorem: `${functionId}_security_theorem`,
          proofHash: "sha256:abc123def456",
          status: "verified",
          downloadUrl: `/download/proof/${functionId}_security_theorem.lean`,
        },
        {
          timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
          author: "bob@company.com",
          commit: "def5678",
          theorem: `${functionId}_correctness_theorem`,
          proofHash: "sha256:def456ghi789",
          status: "verified",
          downloadUrl: `/download/proof/${functionId}_correctness_theorem.lean`,
        },
      ],
      metadata: {
        sigstoreSignature: "sigstore:abc123def456",
        verificationTimestamp: new Date().toISOString(),
        proofArtifacts: [
          {
            name: `${functionId}_security_theorem.lean`,
            size: "2.3KB",
            hash: "sha256:abc123def456",
          },
          {
            name: `${functionId}_correctness_theorem.lean`,
            size: "1.8KB",
            hash: "sha256:def456ghi789",
          },
        ],
      },
    };
  }

  /**
   * Render main dashboard
   */
  async renderDashboard(req, res) {
    try {
      const coverageData = await this.loadCoverageData();
      const driftData = await this.loadDriftData();
      const storiesData = await this.loadStoriesData();

      res.render("dashboard", {
        title: "SpecSync Dashboard",
        coverageData,
        driftData,
        storiesData,
      });
    } catch (error) {
      res.status(500).render("error", { error: error.message });
    }
  }

  /**
   * Generate HTML templates for dashboard components
   */
  generateCoverageMapHTML(data) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spec Coverage Map</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; }
    .coverage-tree { background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .tree-node { padding: 8px 16px; border-bottom: 1px solid #f0f0f0; cursor: pointer; }
    .tree-node:hover { background: #f8f9fa; }
    .tree-node.folder { font-weight: bold; }
    .tree-node.file { padding-left: 32px; }
    .status-badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; }
    .status-verified { background: #d4edda; color: #155724; }
    .status-missing { background: #f8d7da; color: #721c24; }
    .status-failed { background: #fff3cd; color: #856404; }
    .filters { margin-bottom: 20px; padding: 16px; background: #f8f9fa; border-radius: 8px; }
    .filter-group { display: inline-block; margin-right: 20px; }
    .filter-group label { display: block; margin-bottom: 4px; font-weight: bold; }
    .filter-group select, .filter-group input { padding: 6px 12px; border: 1px solid #ddd; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Spec Coverage Map</h1>
  
  <div class="filters">
    <div class="filter-group">
      <label>Author</label>
      <select id="author-filter">
        <option value="">All Authors</option>
        <option value="alice">Alice</option>
        <option value="bob">Bob</option>
        <option value="charlie">Charlie</option>
      </select>
    </div>
    <div class="filter-group">
      <label>Team</label>
      <select id="team-filter">
        <option value="">All Teams</option>
        <option value="backend">Backend</option>
        <option value="frontend">Frontend</option>
        <option value="security">Security</option>
      </select>
    </div>
    <div class="filter-group">
      <label>Module</label>
      <select id="module-filter">
        <option value="">All Modules</option>
        <option value="auth">Auth</option>
        <option value="payment">Payment</option>
        <option value="user">User</option>
      </select>
    </div>
    <div class="filter-group">
      <label>Date Range</label>
      <select id="date-filter">
        <option value="all">All Time</option>
        <option value="7d">Last 7 Days</option>
        <option value="30d">Last 30 Days</option>
        <option value="90d">Last 90 Days</option>
      </select>
    </div>
  </div>

  <div class="coverage-tree">
    ${this.generateTreeNodes(data.modules)}
  </div>

  <script>
    // Filter functionality
    document.querySelectorAll('select').forEach(select => {
      select.addEventListener('change', filterTree);
    });

    function filterTree() {
      const author = document.getElementById('author-filter').value;
      const team = document.getElementById('team-filter').value;
      const module = document.getElementById('module-filter').value;
      const dateRange = document.getElementById('date-filter').value;
      
      // Apply filters to tree nodes
      document.querySelectorAll('.tree-node').forEach(node => {
        let show = true;
        
        if (author && node.dataset.author !== author) show = false;
        if (team && node.dataset.team !== team) show = false;
        if (module && node.dataset.module !== module) show = false;
        
        node.style.display = show ? 'block' : 'none';
      });
    }

    // Click handlers for drill-down
    document.querySelectorAll('.tree-node').forEach(node => {
      node.addEventListener('click', function() {
        if (this.classList.contains('file')) {
          const functionName = this.dataset.function;
          window.open(\`/audit/\${functionName}\`, '_blank');
        }
      });
    });
  </script>
</body>
</html>`;
  }

  generateTreeNodes(modules) {
    let html = "";

    modules.forEach((module) => {
      html += `<div class="tree-node folder" data-module="${module.name}">
        <span>📁 ${module.name}</span>
        <span class="status-badge" style="background: ${this.getCoverageColor(module.coverage)}; color: white;">
          ${module.coverage}%
        </span>
      </div>`;

      module.functions.forEach((func) => {
        html += `<div class="tree-node file" data-function="${func.name}" data-module="${module.name}">
          <span>📄 ${func.name}</span>
          <span class="status-badge status-${func.status}">${func.status}</span>
        </div>`;
      });
    });

    return html;
  }

  getCoverageColor(coverage) {
    if (coverage >= 80) return "#28a745";
    if (coverage >= 60) return "#ffc107";
    return "#dc3545";
  }

  generateDriftMonitorHTML(data) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spec Drift Monitor</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; }
    .timeline { position: relative; padding: 20px 0; }
    .timeline::before { content: ''; position: absolute; left: 20px; top: 0; bottom: 0; width: 2px; background: #ddd; }
    .timeline-item { position: relative; margin-bottom: 20px; padding-left: 60px; }
    .timeline-item::before { content: ''; position: absolute; left: 12px; top: 8px; width: 16px; height: 16px; border-radius: 50%; background: #007bff; }
    .timeline-item.high::before { background: #dc3545; }
    .timeline-item.medium::before { background: #ffc107; }
    .timeline-item.low::before { background: #28a745; }
    .timeline-content { background: white; padding: 16px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .severity-badge { display: inline-block; padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; }
    .severity-high { background: #f8d7da; color: #721c24; }
    .severity-medium { background: #fff3cd; color: #856404; }
    .severity-low { background: #d4edda; color: #155724; }
    .filters { margin-bottom: 20px; padding: 16px; background: #f8f9fa; border-radius: 8px; }
    .summary { margin-bottom: 20px; padding: 16px; background: #e9ecef; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>Spec Drift Monitor</h1>
  
  <div class="summary">
    <h3>Summary</h3>
    <p>Total Drifts: ${data.summary.totalDrifts}</p>
    <p>High Severity: ${data.summary.highSeverity}</p>
    <p>Medium Severity: ${data.summary.mediumSeverity}</p>
    <p>Low Severity: ${data.summary.lowSeverity}</p>
    <p>Resolved: ${data.summary.resolved}</p>
    <p>Pending: ${data.summary.pending}</p>
  </div>

  <div class="filters">
    <label>Severity:</label>
    <select id="severity-filter">
      <option value="all">All Severities</option>
      <option value="high">High</option>
      <option value="medium">Medium</option>
      <option value="low">Low</option>
    </select>
    
    <label>Date Range:</label>
    <select id="date-filter">
      <option value="7d">Last 7 Days</option>
      <option value="30d">Last 30 Days</option>
      <option value="90d">Last 90 Days</option>
      <option value="all">All Time</option>
    </select>
  </div>

  <div class="timeline">
    ${data.timeline
      .map(
        (item) => `
      <div class="timeline-item ${item.severity}">
        <div class="timeline-content">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h4>${item.functionName}</h4>
            <span class="severity-badge severity-${item.severity}">${item.severity.toUpperCase()}</span>
          </div>
          <p><strong>Module:</strong> ${item.module}</p>
          <p><strong>Reason:</strong> ${item.reason}</p>
          <p><strong>Author:</strong> ${item.author}</p>
          <p><strong>Commit:</strong> <a href="https://github.com/company/repo/commit/${item.commit}" target="_blank">${item.commit}</a></p>
          <p><strong>Time:</strong> ${new Date(item.timestamp).toLocaleString()}</p>
        </div>
      </div>
    `
      )
      .join("")}
  </div>

  <script>
    // Filter functionality
    document.getElementById('severity-filter').addEventListener('change', filterTimeline);
    document.getElementById('date-filter').addEventListener('change', filterTimeline);

    function filterTimeline() {
      const severity = document.getElementById('severity-filter').value;
      const dateRange = document.getElementById('date-filter').value;
      
      document.querySelectorAll('.timeline-item').forEach(item => {
        let show = true;
        
        if (severity !== 'all' && !item.classList.contains(severity)) {
          show = false;
        }
        
        if (show) {
          const itemDate = new Date(item.querySelector('p:last-child').textContent.split(': ')[1]);
          const now = new Date();
          const daysDiff = (now - itemDate) / (1000 * 60 * 60 * 24);
          
          if (dateRange === '7d' && daysDiff > 7) show = false;
          if (dateRange === '30d' && daysDiff > 30) show = false;
          if (dateRange === '90d' && daysDiff > 90) show = false;
        }
        
        item.style.display = show ? 'block' : 'none';
      });
    }
  </script>
</body>
</html>`;
  }

  generateStoryLinkerHTML(data) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Story ↔ Spec Linker</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; }
    .story-card { background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 20px; padding: 20px; }
    .story-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .story-id { font-weight: bold; color: #007bff; }
    .story-status { padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; }
    .status-todo { background: #f8d7da; color: #721c24; }
    .status-in-progress { background: #fff3cd; color: #856404; }
    .status-done { background: #d4edda; color: #155724; }
    .coverage-bar { background: #e9ecef; border-radius: 4px; height: 8px; margin: 8px 0; }
    .coverage-fill { background: #28a745; height: 100%; border-radius: 4px; transition: width 0.3s; }
    .spec-list { margin-top: 16px; }
    .spec-item { display: flex; justify-content: space-between; align-items: center; padding: 8px; background: #f8f9fa; border-radius: 4px; margin-bottom: 8px; }
    .spec-status { padding: 2px 6px; border-radius: 8px; font-size: 10px; font-weight: bold; }
    .status-verified { background: #d4edda; color: #155724; }
    .status-missing { background: #f8d7da; color: #721c24; }
    .add-mapping { margin-top: 16px; padding: 16px; background: #f8f9fa; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>Story ↔ Spec Linker</h1>
  
  ${data.stories
    .map(
      (story) => `
    <div class="story-card">
      <div class="story-header">
        <div>
          <span class="story-id">${story.id}</span>
          <h3>${story.title}</h3>
        </div>
        <span class="story-status status-${story.status.replace("-", "")}">${story.status.toUpperCase()}</span>
      </div>
      
      <div>
        <p><strong>Coverage:</strong> ${story.coverage}%</p>
        <div class="coverage-bar">
          <div class="coverage-fill" style="width: ${story.coverage}%"></div>
        </div>
        
        ${story.driftWarnings > 0 ? `<p style="color: #dc3545;"><strong>⚠️ ${story.driftWarnings} drift warning(s)</strong></p>` : ""}
        
        <div class="spec-list">
          <h4>Linked Specifications:</h4>
          ${
            story.specs.length > 0
              ? story.specs
                  .map(
                    (spec) => `
            <div class="spec-item">
              <span>${spec.functionName} (${spec.theorem})</span>
              <span class="spec-status status-${spec.status}">${spec.status}</span>
            </div>
          `
                  )
                  .join("")
              : "<p>No specifications linked</p>"
          }
        </div>
        
        <div class="add-mapping">
          <h4>Add Mapping</h4>
          <form onsubmit="addMapping(event, '${story.id}')">
            <input type="text" id="theorem-${story.id}" placeholder="Lean theorem name" required>
            <button type="submit">Link Spec</button>
          </form>
        </div>
      </div>
    </div>
  `
    )
    .join("")}

  <script>
    function addMapping(event, storyId) {
      event.preventDefault();
      const theorem = document.getElementById(\`theorem-\${storyId}\`).value;
      
      // In a real implementation, this would make an API call
      console.log(\`Adding mapping: \${storyId} -> \${theorem}\`);
      
      // Add to the UI
      const specList = event.target.closest('.story-card').querySelector('.spec-list');
      const newSpec = document.createElement('div');
      newSpec.className = 'spec-item';
      newSpec.innerHTML = \`
        <span>\${theorem}</span>
        <span class="spec-status status-missing">pending</span>
      \`;
      specList.appendChild(newSpec);
      
      // Clear the input
      event.target.reset();
    }
  </script>
</body>
</html>`;
  }

  generateAuditExplorerHTML(data) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Audit Explorer - ${data.functionId}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; }
    .audit-card { background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 20px; padding: 20px; }
    .lineage-item { border-left: 3px solid #007bff; padding-left: 16px; margin-bottom: 16px; }
    .lineage-item.verified { border-left-color: #28a745; }
    .lineage-item.failed { border-left-color: #dc3545; }
    .metadata { background: #f8f9fa; padding: 16px; border-radius: 8px; margin-top: 20px; }
    .artifact-list { margin-top: 16px; }
    .artifact-item { display: flex; justify-content: space-between; align-items: center; padding: 8px; background: white; border-radius: 4px; margin-bottom: 8px; }
    .download-btn { background: #007bff; color: white; padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; text-decoration: none; }
    .download-btn:hover { background: #0056b3; }
  </style>
</head>
<body>
  <h1>Audit Explorer - ${data.functionId}</h1>
  
  <div class="audit-card">
    <h2>Proof Lineage</h2>
    ${data.lineage
      .map(
        (item) => `
      <div class="lineage-item ${item.status}">
        <h3>${item.theorem}</h3>
        <p><strong>Author:</strong> ${item.author}</p>
        <p><strong>Commit:</strong> <a href="https://github.com/company/repo/commit/${item.commit}" target="_blank">${item.commit}</a></p>
        <p><strong>Timestamp:</strong> ${new Date(item.timestamp).toLocaleString()}</p>
        <p><strong>Proof Hash:</strong> <code>${item.proofHash}</code></p>
        <p><strong>Status:</strong> <span class="status-${item.status}">${item.status}</span></p>
        <a href="${item.downloadUrl}" class="download-btn">Download Proof</a>
      </div>
    `
      )
      .join("")}
  </div>
  
  <div class="audit-card">
    <h2>Metadata</h2>
    <div class="metadata">
      <p><strong>Sigstore Signature:</strong> <code>${data.metadata.sigstoreSignature}</code></p>
      <p><strong>Verification Timestamp:</strong> ${new Date(data.metadata.verificationTimestamp).toLocaleString()}</p>
      
      <h3>Proof Artifacts</h3>
      <div class="artifact-list">
        ${data.metadata.proofArtifacts
          .map(
            (artifact) => `
          <div class="artifact-item">
            <span>${artifact.name} (${artifact.size})</span>
            <div>
              <code>${artifact.hash}</code>
              <a href="/download/artifact/${artifact.name}" class="download-btn">Download</a>
            </div>
          </div>
        `
          )
          .join("")}
      </div>
    </div>
  </div>

  <script>
    // Verify Sigstore signature
    async function verifySignature() {
      try {
        const response = await fetch('/api/verify-signature', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signature: '${data.metadata.sigstoreSignature}',
            artifacts: ${JSON.stringify(data.metadata.proofArtifacts)}
          })
        });
        
        const result = await response.json();
        if (result.verified) {
          console.log('✅ Signature verified locally');
        } else {
          console.log('❌ Signature verification failed');
        }
      } catch (error) {
        console.error('Error verifying signature:', error);
      }
    }
    
    // Auto-verify on page load
    verifySignature();
  </script>
</body>
</html>`;
  }
}
