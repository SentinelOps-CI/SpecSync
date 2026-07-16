/**
 * In-process analysis job queue with idempotency.
 * Shape is Redis/BullMQ-replaceable without rewriting callers.
 *
 * Durability:
 * - Default: in-memory only (single Probot instance).
 * - Optional: set SPECSYNC_JOB_MARKERS_DIR to a shared filesystem path so
 *   multiple instances on the same volume can skip already-completed keys.
 *   Markers are local process state — they are NOT written into the target repo.
 */

import * as fs from "fs";
import * as path from "path";
import type { AnalysisJobPayload } from "./types";

export type JobStatus = "pending" | "running" | "completed" | "superseded" | "failed";

export interface AnalysisJob {
  id: string;
  /** Idempotency key: pr:{owner}/{repo}/{number}:{headSha} */
  key: string;
  payload: AnalysisJobPayload;
  status: JobStatus;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export interface EnqueueResult {
  enqueued: boolean;
  jobId?: string;
  key: string;
  reason?: "duplicate" | "superseded_prior" | "in_flight" | "marker_completed";
}

export type AnalysisJobRunner = (job: AnalysisJob) => Promise<void>;

export function buildAnalysisJobKey(payload: AnalysisJobPayload): string {
  return `pr:${payload.owner}/${payload.repo}/${payload.pr}:${payload.headSha}`;
}

function prScopeKey(payload: AnalysisJobPayload): string {
  return `pr:${payload.owner}/${payload.repo}/${payload.pr}`;
}

/** Sanitize idempotency key for use as a filename. */
export function markerFileName(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]+/g, "_") + ".json";
}

export class AnalysisJobQueue {
  private jobs = new Map<string, AnalysisJob>();
  private byPr = new Map<string, Set<string>>();
  private running = 0;
  private readonly maxConcurrent: number;
  private readonly markersDir: string | null;

  constructor(options?: { maxConcurrent?: number; markersDir?: string | null }) {
    this.maxConcurrent = options?.maxConcurrent ?? 2;
    const fromEnv = process.env.SPECSYNC_JOB_MARKERS_DIR;
    this.markersDir =
      options?.markersDir !== undefined
        ? options.markersDir
        : fromEnv && fromEnv.trim()
          ? fromEnv.trim()
          : null;
  }

  /**
   * Enqueue analysis for a PR head SHA.
   * Skips if the same key is completed or in-flight (memory and optional marker file).
   * On a new SHA for the same PR, supersedes older pending/running jobs.
   */
  enqueue(payload: AnalysisJobPayload, runner: AnalysisJobRunner): EnqueueResult {
    const key = buildAnalysisJobKey(payload);
    const existing = this.jobs.get(key);

    if (existing && (existing.status === "completed" || existing.status === "running")) {
      return {
        enqueued: false,
        jobId: existing.id,
        key,
        reason: existing.status === "running" ? "in_flight" : "duplicate",
      };
    }

    if (existing && existing.status === "pending") {
      return { enqueued: false, jobId: existing.id, key, reason: "in_flight" };
    }

    if (this.readMarkerStatus(key) === "completed") {
      return { enqueued: false, key, reason: "marker_completed" };
    }

    const superseded = this.supersedeOlderShas(payload);
    const job: AnalysisJob = {
      id: `${key}:${Date.now()}`,
      key,
      payload,
      status: "pending",
      enqueuedAt: Date.now(),
    };

    this.jobs.set(key, job);
    const scope = prScopeKey(payload);
    if (!this.byPr.has(scope)) {
      this.byPr.set(scope, new Set());
    }
    this.byPr.get(scope)!.add(key);

    this.writeMarker(job, "pending");
    this.schedule(job, runner);

    return {
      enqueued: true,
      jobId: job.id,
      key,
      reason: superseded > 0 ? "superseded_prior" : undefined,
    };
  }

  /** Cancel/supersede jobs for the same PR with a different head SHA. */
  supersedeOlderShas(payload: AnalysisJobPayload): number {
    const scope = prScopeKey(payload);
    const keys = this.byPr.get(scope);
    if (!keys) {
      return 0;
    }

    let count = 0;
    const currentKey = buildAnalysisJobKey(payload);
    for (const key of keys) {
      if (key === currentKey) {
        continue;
      }
      const job = this.jobs.get(key);
      if (!job) {
        continue;
      }
      if (job.status === "pending" || job.status === "running") {
        job.status = "superseded";
        job.finishedAt = Date.now();
        this.writeMarker(job, "superseded");
        count += 1;
      }
    }
    return count;
  }

  getJob(key: string): AnalysisJob | undefined {
    return this.jobs.get(key);
  }

  /** Test helper — clears idempotency state between suites. */
  clearForTests(): void {
    this.jobs.clear();
    this.byPr.clear();
    this.running = 0;
  }

  /** Test/observability helper. */
  getStats(): { total: number; running: number; byStatus: Record<JobStatus, number> } {
    const byStatus: Record<JobStatus, number> = {
      pending: 0,
      running: 0,
      completed: 0,
      superseded: 0,
      failed: 0,
    };
    for (const job of this.jobs.values()) {
      byStatus[job.status] += 1;
    }
    return { total: this.jobs.size, running: this.running, byStatus };
  }

  private schedule(job: AnalysisJob, runner: AnalysisJobRunner): void {
    setImmediate(() => {
      void this.runWhenSlot(job, runner);
    });
  }

  private async runWhenSlot(job: AnalysisJob, runner: AnalysisJobRunner): Promise<void> {
    while (this.running >= this.maxConcurrent) {
      await sleep(25);
      if (job.status === "superseded") {
        return;
      }
    }

    if (job.status === "superseded") {
      return;
    }

    this.running += 1;
    job.status = "running";
    job.startedAt = Date.now();
    this.writeMarker(job, "running");

    try {
      await runner(job);
      // Status may have been flipped to superseded concurrently while running.
      if ((job.status as JobStatus) !== "superseded") {
        job.status = "completed";
        this.writeMarker(job, "completed");
      }
    } catch (error: unknown) {
      if ((job.status as JobStatus) !== "superseded") {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : String(error);
        this.writeMarker(job, "failed");
      }
      throw error;
    } finally {
      job.finishedAt = Date.now();
      this.running = Math.max(0, this.running - 1);
    }
  }

  private markerPath(key: string): string | null {
    if (!this.markersDir) {
      return null;
    }
    return path.join(this.markersDir, markerFileName(key));
  }

  private readMarkerStatus(key: string): JobStatus | null {
    const file = this.markerPath(key);
    if (!file) {
      return null;
    }
    try {
      if (!fs.existsSync(file)) {
        return null;
      }
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { status?: JobStatus };
      return raw.status ?? null;
    } catch {
      return null;
    }
  }

  private writeMarker(job: AnalysisJob, status: JobStatus): void {
    const file = this.markerPath(job.key);
    if (!file) {
      return;
    }
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify(
          {
            key: job.key,
            jobId: job.id,
            status,
            payload: job.payload,
            updatedAt: new Date().toISOString(),
            error: job.error,
          },
          null,
          2
        ),
        "utf8"
      );
    } catch (error: unknown) {
      // Markers are best-effort; never block analysis on FS errors.
      console.warn(
        "[SpecSync] failed to write job marker:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Shared singleton for the Probot process. */
export const analysisJobQueue = new AnalysisJobQueue();
