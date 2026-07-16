/**
 * Lightweight in-process metrics counters.
 * Values are also emitted via structured logs; no external backend required.
 */
import { logger } from "./logger";

export type MetricName =
  | "specs_posted"
  | "specs_accepted"
  | "specs_ignored"
  | "specs_edited"
  | "drifts_detected"
  | "llm_failures"
  | "llm_mock"
  | "llm_live"
  | "analysis_jobs_completed"
  | "analysis_jobs_failed"
  | "commands_rate_limited";

const counters: Record<MetricName, number> = {
  specs_posted: 0,
  specs_accepted: 0,
  specs_ignored: 0,
  specs_edited: 0,
  drifts_detected: 0,
  llm_failures: 0,
  llm_mock: 0,
  llm_live: 0,
  analysis_jobs_completed: 0,
  analysis_jobs_failed: 0,
  commands_rate_limited: 0,
};

export function incr(metric: MetricName, by = 1): number {
  counters[metric] = (counters[metric] ?? 0) + by;
  return counters[metric];
}

export function getMetrics(): Readonly<Record<MetricName, number>> {
  return { ...counters };
}

export function resetMetricsForTests(): void {
  for (const key of Object.keys(counters) as MetricName[]) {
    counters[key] = 0;
  }
}

/** Log a counter snapshot (for /ready or job completion). */
export function logMetricsSnapshot(extra?: Record<string, unknown>): void {
  logger.info({ metrics: getMetrics(), ...extra }, "specsync.metrics");
}
