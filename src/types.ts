/**
 * Shared SpecSync contracts. Confidence is always in [0, 1].
 */

/** Confidence score in [0, 1] only. Normalize at the LLM parse boundary. */
export type Confidence = number;

/**
 * GitHub pull-request review comment side.
 * LEFT = base/old file (pure deletions); RIGHT = head/new file (adds/modifies).
 */
export type DiffSide = "LEFT" | "RIGHT";

export interface SpecSuggestion {
  functionName: string;
  filePath: string;
  lineNumber: number;
  /** Review-comment side; defaults to RIGHT when omitted. */
  side?: DiffSide;
  preconditions: string[];
  postconditions: string[];
  invariants: string[];
  edgeCases?: string[];
  confidence: Confidence;
  reasoning: string;
  /** True when the suggestion came from the mock LLM fallback (not a live provider). */
  isMock?: boolean;
}

export interface ProofFunctionStatus {
  name: string;
  filePath: string;
  line: number;
  hasProof: boolean;
  theorem?: string;
  lastVerified?: string;
}

export interface ProofResult {
  theorem: string;
  file: string;
  valid: boolean;
}

export interface ProofStatus {
  coverage: number;
  totalFunctions: number;
  coveredFunctions: number;
  failedProofs: number;
  functions: ProofFunctionStatus[];
  proofs: ProofResult[];
}

export interface DriftFinding {
  functionName: string;
  filePath: string;
  reason: string;
  previousSpec?: string;
  currentImplementation?: string;
  confidence?: Confidence;
}

/** Payload for the analysis job queue (Phase 2). */
export interface AnalysisJobPayload {
  installationId: number;
  owner: string;
  repo: string;
  pr: number;
  headSha: string;
}

/** Soft LLM cost estimate logged per analysis job. */
export interface SoftCostEstimate {
  estimatedTokens: number;
  llmCalls: number;
  cappedAt: number;
  skippedByBudget?: number;
}

/**
 * Normalize a confidence value to [0, 1].
 * Values greater than 1 are treated as a 0–100 percentage scale.
 */
export function normalizeConfidence(value: unknown, fallback = 0.5): Confidence {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  const scaled = value > 1 ? value / 100 : value;
  return Math.min(1, Math.max(0, scaled));
}

/** Changed file metadata from GitHub pulls.listFiles / paginate. */
export interface ChangedFile {
  filename: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  patch?: string;
}

/** Diff-parser output for a single function change. */
export interface FunctionChange {
  filePath: string;
  functionName: string;
  functionBody: string;
  lineNumber: number;
  /** LEFT for pure deletions; RIGHT otherwise. */
  side: DiffSide;
  changeType: string;
  comments: Array<{ text: string; lineNumber: number; type: string }>;
  testFiles: string[];
}

/** Extracted function region inside a unified diff. */
export interface DiffFunction {
  name: string;
  body: string;
  lineNumber: number;
  /** LEFT when the function only exists on the base side (deletion). */
  side: DiffSide;
  changeType: string;
}

/** Context passed into the LLM for a single function. */
export interface LLMFunctionContext {
  functionName?: string;
  language?: string;
  functionBody?: string;
  inputTypes?: Array<{ name?: string; type?: string; required?: boolean }>;
  outputType?: string;
  conditionalGuards?: Array<{ condition?: string }>;
  loops?: unknown[];
  earlyReturns?: Array<{ value?: string }>;
  controlFlow?: string;
  complexity?: number;
  comments?: string;
}

/** Parsed / mock LLM specification payload (before SpecSuggestion enrichment). */
export interface GeneratedSpecPayload {
  preconditions: string[];
  postconditions: string[];
  invariants: string[];
  edgeCases: string[];
  complexity?: { time?: string; space?: string };
  security?: { vulnerabilities?: string[]; mitigations?: string[] };
  confidence: Confidence;
  reasoning: string;
  isMock?: boolean;
  unavailable?: boolean;
  reason?: string;
}
