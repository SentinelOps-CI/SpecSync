// @ts-nocheck
const express = require("express");
const path = require("path");
const { SpecCoverageTracker } = require("./spec-coverage");
const { CIIntegration } = require("./ci-integration");

export class DashboardUI {
  constructor() {
    this.app = express();
    this.port = process.env.DASHBOARD_PORT || 3001;
    this.coverageTracker = new SpecCoverageTracker();
    this.ciIntegration = new CIIntegration();

    this.setupRoutes();
    this.setupStaticFiles();
  }

  /**
   * Setup Express routes
   */
  setupRoutes() {
    // API Routes
    this.app.get("/api/coverage", this.getCoverageData.bind(this));
    this.app.get("/api/functions", this.getFunctionsData.bind(this));
    this.app.get("/api/proofs", this.getProofsData.bind(this));
    this.app.get("/api/drift", this.getDriftData.bind(this));
    this.app.get("/api/graph", this.getGraphData.bind(this));
    this.app.get("/api/recommendations", this.getRecommendations.bind(this));

    // Dashboard Routes
    this.app.get("/", this.renderDashboard.bind(this));
    this.app.get("/functions", this.renderFunctions.bind(this));
    this.app.get("/proofs", this.renderProofs.bind(this));
    this.app.get("/drift", this.renderDrift.bind(this));
    this.app.get("/graph", this.renderGraph.bind(this));
  }

  /**
   * Setup static file serving
   */
  setupStaticFiles() {
    this.app.use(express.static(path.join(__dirname, "../public")));
    this.app.set("view engine", "ejs");
    this.app.set("views", path.join(__dirname, "../views"));
  }

  /**
   * Start the dashboard server
   */
  start() {
    this.app.listen(this.port, () => {
      console.log(`📊 SpecSync Dashboard running on http://localhost:${this.port}`);
    });
  }

  /**
   * Get coverage data for API
   */
  async getCoverageData(req, res) {
    try {
      const analysis = await this.coverageTracker.analyzeSpecCoverage({});
      const report = this.coverageTracker.generateCoverageReport(analysis);

      res.json({
        success: true,
        data: report,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Get functions data for API
   */
  async getFunctionsData(req, res) {
    try {
      const analysis = await this.coverageTracker.analyzeSpecCoverage({});

      const functions = {
        total: analysis.totalFunctions,
        covered: analysis.coveredFunctions,
        uncovered: analysis.uncoveredFunctions,
        coverage: analysis.coveragePercentage,
      };

      res.json({
        success: true,
        data: functions,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Get proofs data for API
   */
  async getProofsData(req, res) {
    try {
      const analysis = await this.coverageTracker.analyzeSpecCoverage({});

      const proofs = {
        total: analysis.specFiles.length,
        failed: analysis.failedProofs.length,
        stale: analysis.staleProofs.length,
        valid:
          analysis.specFiles.length - analysis.failedProofs.length - analysis.staleProofs.length,
      };

      res.json({
        success: true,
        data: proofs,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Get drift data for API
   */
  async getDriftData(req, res) {
    try {
      // Mock drift data for now
      const drift = {
        total: 0,
        detected: 0,
        resolved: 0,
        pending: 0,
      };

      res.json({
        success: true,
        data: drift,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Get graph data for API
   */
  async getGraphData(req, res) {
    try {
      const analysis = await this.coverageTracker.analyzeSpecCoverage({});

      // Generate graph data
      const graph = this.generateGraphData(analysis);

      res.json({
        success: true,
        data: graph,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Generate graph data from analysis
   */
  generateGraphData(analysis) {
    const nodes = [];
    const edges = [];

    // Add function nodes
    analysis.uncoveredFunctions.forEach((func) => {
      nodes.push({
        id: `func_${func.function}`,
        label: func.function,
        type: "function",
        status: "uncovered",
        file: func.file,
      });
    });

    // Add spec nodes
    analysis.specFiles.forEach((spec) => {
      const functionName = this.coverageTracker.extractFunctionNameFromSpec(spec);
      if (functionName) {
        nodes.push({
          id: `spec_${functionName}`,
          label: functionName,
          type: "specification",
          status: "verified",
          file: spec,
        });

        // Add edge from function to spec
        edges.push({
          from: `func_${functionName}`,
          to: `spec_${functionName}`,
          type: "covered_by",
        });
      }
    });

    // Add user story nodes
    analysis.userStories.forEach((story, index) => {
      nodes.push({
        id: `story_${index}`,
        label: story.description.substring(0, 30) + "...",
        type: "user_story",
        status: story.hasFormalGuarantee ? "verified" : "unverified",
      });
    });

    return { nodes, edges };
  }

  /**
   * Get recommendations for API
   */
  async getRecommendations(req, res) {
    try {
      const analysis = await this.coverageTracker.analyzeSpecCoverage({});
      const report = this.coverageTracker.generateCoverageReport(analysis);

      res.json({
        success: true,
        data: report.recommendations,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Render main dashboard
   */
  async renderDashboard(req, res) {
    try {
      const analysis = await this.coverageTracker.analyzeSpecCoverage({});
      const report = this.coverageTracker.generateCoverageReport(analysis);

      res.render("dashboard", {
        title: "SpecSync Dashboard",
        coverage: report.summary,
        recommendations: report.recommendations,
        timestamp: report.timestamp,
      });
    } catch (error) {
      res.render("error", {
        title: "Error",
        error: error.message,
      });
    }
  }

  /**
   * Render functions page
   */
  async renderFunctions(req, res) {
    try {
      const analysis = await this.coverageTracker.analyzeSpecCoverage({});

      res.render("functions", {
        title: "Functions Overview",
        functions: {
          covered: analysis.coveredFunctions,
          uncovered: analysis.uncoveredFunctions,
          total: analysis.totalFunctions,
          coverage: analysis.coveragePercentage,
        },
      });
    } catch (error) {
      res.render("error", {
        title: "Error",
        error: error.message,
      });
    }
  }

  /**
   * Render proofs page
   */
  async renderProofs(req, res) {
    try {
      const analysis = await this.coverageTracker.analyzeSpecCoverage({});

      res.render("proofs", {
        title: "Proof Status",
        proofs: {
          total: analysis.specFiles.length,
          failed: analysis.failedProofs,
          stale: analysis.staleProofs,
          valid:
            analysis.specFiles.length - analysis.failedProofs.length - analysis.staleProofs.length,
        },
      });
    } catch (error) {
      res.render("error", {
        title: "Error",
        error: error.message,
      });
    }
  }

  /**
   * Render drift page
   */
  async renderDrift(req, res) {
    try {
      // Mock drift data
      const drift = {
        total: 0,
        detected: 0,
        resolved: 0,
        pending: 0,
      };

      res.render("drift", {
        title: "Drift Detection",
        drift: drift,
      });
    } catch (error) {
      res.render("error", {
        title: "Error",
        error: error.message,
      });
    }
  }

  /**
   * Render graph page
   */
  async renderGraph(req, res) {
    try {
      const analysis = await this.coverageTracker.analyzeSpecCoverage({});
      const graph = this.generateGraphData(analysis);

      res.render("graph", {
        title: "Spec Graph",
        graph: graph,
      });
    } catch (error) {
      res.render("error", {
        title: "Error",
        error: error.message,
      });
    }
  }

  /**
   * Generate HTML dashboard
   */
  generateHTMLDashboard(data) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SpecSync Dashboard</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .header {
            background: white;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }
        .stat-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .stat-number {
            font-size: 2em;
            font-weight: bold;
            color: #333;
        }
        .stat-label {
            color: #666;
            margin-top: 5px;
        }
        .coverage-bar {
            width: 100%;
            height: 20px;
            background: #e0e0e0;
            border-radius: 10px;
            overflow: hidden;
            margin-top: 10px;
        }
        .coverage-fill {
            height: 100%;
            background: linear-gradient(90deg, #4CAF50, #8BC34A);
            transition: width 0.3s ease;
        }
        .recommendations {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .recommendation {
            padding: 10px;
            margin: 10px 0;
            border-left: 4px solid #2196F3;
            background: #f8f9fa;
        }
        .priority-high {
            border-left-color: #f44336;
        }
        .priority-medium {
            border-left-color: #ff9800;
        }
        .priority-low {
            border-left-color: #4CAF50;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 SpecSync Dashboard</h1>
            <p>Formal specification coverage and verification status</p>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-number">${data.coverage.coveredFunctions}/${data.coverage.totalFunctions}</div>
                <div class="stat-label">Functions Covered</div>
                <div class="coverage-bar">
                    <div class="coverage-fill" style="width: ${data.coverage.coveragePercentage}%"></div>
                </div>
                <div class="stat-label">${data.coverage.coveragePercentage}% Coverage</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-number">${data.proofs.valid}</div>
                <div class="stat-label">Valid Proofs</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-number">${data.proofs.failed}</div>
                <div class="stat-label">Failed Proofs</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-number">${data.drift.detected}</div>
                <div class="stat-label">Drift Detected</div>
            </div>
        </div>
        
        <div class="recommendations">
            <h2>📋 Recommendations</h2>
            ${data.recommendations
              .map(
                (rec) => `
                <div class="recommendation priority-${rec.priority}">
                    <strong>${rec.type.toUpperCase()}</strong>: ${rec.message}
                    <br><em>Action: ${rec.action}</em>
                </div>
            `
              )
              .join("")}
        </div>
    </div>
    
    <script>
        // Auto-refresh every 30 seconds
        setTimeout(() => {
            location.reload();
        }, 30000);
    </script>
</body>
</html>`;
  }

  /**
   * Generate React component for dashboard
   */
  generateReactComponent() {
    return `
import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const SpecSyncDashboard = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [coverage, functions, proofs, drift] = await Promise.all([
        fetch('/api/coverage').then(r => r.json()),
        fetch('/api/functions').then(r => r.json()),
        fetch('/api/proofs').then(r => r.json()),
        fetch('/api/drift').then(r => r.json())
      ]);
      
      setData({
        coverage: coverage.data,
        functions: functions.data,
        proofs: proofs.data,
        drift: drift.data
      });
      setLoading(false);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setLoading(false);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>📊 SpecSync Dashboard</h1>
        <p>Formal specification coverage and verification status</p>
      </header>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-number">
            {data.functions.covered}/{data.functions.total}
          </div>
          <div className="stat-label">Functions Covered</div>
          <div className="coverage-bar">
            <div 
              className="coverage-fill" 
              style={{width: data.functions.coverage + '%'}}
            ></div>
          </div>
          <div className="stat-label">{data.functions.coverage}% Coverage</div>
        </div>

        <div className="stat-card">
          <div className="stat-number">{data.proofs.valid}</div>
          <div className="stat-label">Valid Proofs</div>
        </div>

        <div className="stat-card">
          <div className="stat-number">{data.proofs.failed}</div>
          <div className="stat-label">Failed Proofs</div>
        </div>

        <div className="stat-card">
          <div className="stat-number">{data.drift.detected}</div>
          <div className="stat-label">Drift Detected</div>
        </div>
      </div>

      <div className="recommendations">
        <h2>📋 Recommendations</h2>
        {data.coverage.recommendations.map((rec, index) => (
          <div key={index} className={\`recommendation priority-\${rec.priority}\`}>
            <strong>{rec.type.toUpperCase()}</strong>: {rec.message}
            <br /><em>Action: {rec.action}</em>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SpecSyncDashboard;`;
  }

  /**
   * Generate Next.js page for dashboard
   */
  generateNextJSPage() {
    return `
import { useState, useEffect } from 'react';
import Head from 'next/head';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [coverage, functions, proofs, drift] = await Promise.all([
        fetch('/api/coverage').then(r => r.json()),
        fetch('/api/functions').then(r => r.json()),
        fetch('/api/proofs').then(r => r.json()),
        fetch('/api/drift').then(r => r.json())
      ]);
      
      setData({
        coverage: coverage.data,
        functions: functions.data,
        proofs: proofs.data,
        drift: drift.data
      });
      setLoading(false);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>SpecSync Dashboard</title>
        <meta name="description" content="Formal specification coverage and verification status" />
      </Head>

      <div className="dashboard">
        <header className="dashboard-header">
          <h1>📊 SpecSync Dashboard</h1>
          <p>Formal specification coverage and verification status</p>
        </header>

        {loading ? (
          <div>Loading...</div>
        ) : (
          <>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-number">
                  {data.functions.covered}/{data.functions.total}
                </div>
                <div className="stat-label">Functions Covered</div>
                <div className="coverage-bar">
                  <div 
                    className="coverage-fill" 
                    style={{width: data.functions.coverage + '%'}}
                  ></div>
                </div>
                <div className="stat-label">{data.functions.coverage}% Coverage</div>
              </div>

              <div className="stat-card">
                <div className="stat-number">{data.proofs.valid}</div>
                <div className="stat-label">Valid Proofs</div>
              </div>

              <div className="stat-card">
                <div className="stat-number">{data.proofs.failed}</div>
                <div className="stat-label">Failed Proofs</div>
              </div>

              <div className="stat-card">
                <div className="stat-number">{data.drift.detected}</div>
                <div className="stat-label">Drift Detected</div>
              </div>
            </div>

            <div className="recommendations">
              <h2>📋 Recommendations</h2>
              {data.coverage.recommendations.map((rec, index) => (
                <div key={index} className={\`recommendation priority-\${rec.priority}\`}>
                  <strong>{rec.type.toUpperCase()}</strong>: {rec.message}
                  <br /><em>Action: {rec.action}</em>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}`;
  }
}
