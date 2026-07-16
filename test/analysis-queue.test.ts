import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  AnalysisJobQueue,
  buildAnalysisJobKey,
  markerFileName,
} from "../src/analysis-queue";
import type { AnalysisJobPayload } from "../src/types";

function payload(overrides: Partial<AnalysisJobPayload> = {}): AnalysisJobPayload {
  return {
    installationId: 1,
    owner: "acme",
    repo: "app",
    pr: 42,
    headSha: "aaa111",
    ...overrides,
  };
}

describe("AnalysisJobQueue", () => {
  test("buildAnalysisJobKey includes owner/repo/pr/sha", () => {
    expect(buildAnalysisJobKey(payload())).toBe("pr:acme/app/42:aaa111");
  });

  test("skips duplicate completed or in-flight jobs for same key", async () => {
    const queue = new AnalysisJobQueue({ maxConcurrent: 1 });
    let runs = 0;

    const first = queue.enqueue(payload(), async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(first.enqueued).toBe(true);

    const second = queue.enqueue(payload(), async () => {
      runs += 1;
    });
    expect(second.enqueued).toBe(false);
    expect(second.reason).toBe("in_flight");

    await new Promise((r) => setTimeout(r, 80));
    expect(runs).toBe(1);

    const third = queue.enqueue(payload(), async () => {
      runs += 1;
    });
    expect(third.enqueued).toBe(false);
    expect(third.reason).toBe("duplicate");
  });

  test("supersedes older SHAs on synchronize", async () => {
    const queue = new AnalysisJobQueue({ maxConcurrent: 1 });
    const order: string[] = [];

    queue.enqueue(payload({ headSha: "oldsha" }), async (job) => {
      await new Promise((r) => setTimeout(r, 60));
      if (job.status === "superseded") {
        return;
      }
      order.push(job.payload.headSha);
    });

    const next = queue.enqueue(payload({ headSha: "newsha" }), async (job) => {
      order.push(job.payload.headSha);
    });

    expect(next.enqueued).toBe(true);
    expect(next.reason).toBe("superseded_prior");

    const old = queue.getJob(buildAnalysisJobKey(payload({ headSha: "oldsha" })));
    expect(old?.status).toBe("superseded");

    await new Promise((r) => setTimeout(r, 100));
    expect(order).toEqual(["newsha"]);
  });

  test("optional job markers skip completed keys across queue instances", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "specsync-jobs-"));
    try {
      const queueA = new AnalysisJobQueue({ maxConcurrent: 1, markersDir: dir });
      let runs = 0;

      queueA.enqueue(payload(), async () => {
        runs += 1;
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(runs).toBe(1);

      const key = buildAnalysisJobKey(payload());
      const markerPath = path.join(dir, markerFileName(key));
      expect(fs.existsSync(markerPath)).toBe(true);
      const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
      expect(marker.status).toBe("completed");

      const queueB = new AnalysisJobQueue({ maxConcurrent: 1, markersDir: dir });
      const again = queueB.enqueue(payload(), async () => {
        runs += 1;
      });
      expect(again.enqueued).toBe(false);
      expect(again.reason).toBe("marker_completed");
      expect(runs).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
