import { WebDashboard } from "../src/web-dashboard";

describe("WebDashboard auth + .specsync data", () => {
  const prevDashboard = process.env.SPECSYNC_DASHBOARD;
  const prevSecret = process.env.SPECSYNC_DASHBOARD_SECRET;

  afterEach(() => {
    if (prevDashboard === undefined) {
      delete process.env.SPECSYNC_DASHBOARD;
    } else {
      process.env.SPECSYNC_DASHBOARD = prevDashboard;
    }
    if (prevSecret === undefined) {
      delete process.env.SPECSYNC_DASHBOARD_SECRET;
    } else {
      process.env.SPECSYNC_DASHBOARD_SECRET = prevSecret;
    }
  });

  test("start() is a no-op without SPECSYNC_DASHBOARD=1", () => {
    delete process.env.SPECSYNC_DASHBOARD;
    process.env.SPECSYNC_DASHBOARD_SECRET = "secret";
    const dashboard = new WebDashboard() as any;
    expect(dashboard.start()).toBeNull();
  });

  test("start() is a no-op without secret", () => {
    process.env.SPECSYNC_DASHBOARD = "1";
    delete process.env.SPECSYNC_DASHBOARD_SECRET;
    const dashboard = new WebDashboard() as any;
    expect(dashboard.start()).toBeNull();
  });

  test("API rejects missing secret header", async () => {
    process.env.SPECSYNC_DASHBOARD_SECRET = "test-secret";
    const dashboard = new WebDashboard() as any;

    const result = await new Promise<{ status: number; body: any }>((resolve) => {
      const req = {
        get: (_name: string) => undefined,
      };
      const res = {
        statusCode: 200,
        body: null as any,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(payload: unknown) {
          this.body = payload;
          resolve({ status: this.statusCode, body: payload });
          return this;
        },
      };
      dashboard.requireDashboardSecret(req, res, () => {
        resolve({ status: 200, body: { ok: true } });
      });
    });

    expect(result.status).toBe(401);
    expect(result.body.error).toBe("Unauthorized");
  });

  test("API accepts X-SpecSync-Dashboard-Secret", async () => {
    process.env.SPECSYNC_DASHBOARD_SECRET = "test-secret";
    const dashboard = new WebDashboard() as any;
    let nextCalled = false;

    await new Promise<void>((resolve) => {
      const req = {
        get: (name: string) =>
          name.toLowerCase() === "x-specsync-dashboard-secret" ? "test-secret" : undefined,
      };
      const res = {
        status() {
          return this;
        },
        json() {
          return this;
        },
      };
      dashboard.requireDashboardSecret(req, res, () => {
        nextCalled = true;
        resolve();
      });
    });

    expect(nextCalled).toBe(true);
  });

  test("loadCoverageData returns empty shape when .specsync missing", async () => {
    const dashboard = new WebDashboard() as any;
    const data = await dashboard.loadCoverageData();
    expect(data.summary.totalFunctions).toBeGreaterThanOrEqual(0);
    expect(data.modules).toBeDefined();
    expect(Array.isArray(data.modules)).toBe(true);
  });

  test("escapeHtml escapes markup", () => {
    const dashboard = new WebDashboard() as any;
    expect(dashboard.constructor.escapeHtml(`<a href="x">`)).toBe("&lt;a href=&quot;x&quot;&gt;");
  });
});
