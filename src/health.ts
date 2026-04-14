import * as http from "http";
import pino from "pino";

const log = pino({ name: "specsync-health" });

export class HealthChecker {
  private startTime: number;
  private requestCount: number;

  constructor() {
    this.startTime = Date.now();
    this.requestCount = 0;
  }

  /**
   * Liveness + readiness HTTP server (same port for small deployments).
   * GET /health — process is up (liveness).
   * GET /ready — app finished startup (readiness); extend when adding DB/queues.
   */
  createHealthEndpoint(port: number): http.Server {
    const server = http.createServer((req, res) => {
      this.requestCount++;

      if (req.url === "/health") {
        const uptime = Date.now() - this.startTime;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "healthy",
            uptime,
            requests: this.requestCount,
            timestamp: new Date().toISOString(),
          })
        );
        return;
      }

      if (req.url === "/ready") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ready",
            timestamp: new Date().toISOString(),
          })
        );
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    server.listen(port, () => {
      log.info({ port }, "Health endpoints listening");
    });

    return server;
  }

  getStatus(): {
    status: string;
    uptime: number;
    requests: number;
    timestamp: string;
  } {
    return {
      status: "healthy",
      uptime: Date.now() - this.startTime,
      requests: this.requestCount,
      timestamp: new Date().toISOString(),
    };
  }
}
