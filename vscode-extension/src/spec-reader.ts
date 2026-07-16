import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

/** Confidence in [0, 1] only. Values > 1 are treated as 0–100 percentages. */
export type Confidence = number;

export interface SpecContract {
  preconditions: string[];
  postconditions: string[];
  invariants: string[];
  edgeCases?: string[];
  reasoning?: string;
}

/** On-disk shape under `.specsync/specs/{file}__{fn}.json` (matches root SpecStore). */
export interface StoredSpec {
  version: number;
  functionName: string;
  filePath: string;
  lineNumber?: number;
  acceptedAt: string;
  pr?: number;
  sha?: string;
  confidence: Confidence;
  contract: SpecContract;
  implementationHash?: string;
}

/** Flat view model used by CodeLens / hover / webviews. */
export interface SpecViewModel {
  functionName: string;
  filePath: string;
  confidence: Confidence;
  preconditions: string[];
  postconditions: string[];
  invariants: string[];
  edgeCases: string[];
  reasoning: string;
  storePath: string;
  acceptedAt?: string;
}

export const SPECSYNC_SPECS_DIR = path.join(".specsync", "specs");

export function normalizeConfidence(value: unknown, fallback = 0.5): Confidence {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  const scaled = value > 1 ? value / 100 : value;
  return Math.min(1, Math.max(0, scaled));
}

function sanitizePathSegment(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Same path convention as root `buildSpecStorePath`. */
export function buildSpecStorePath(filePath: string, functionName: string): string {
  const safeFile = sanitizePathSegment(filePath.replace(/\\/g, "/").replace(/\//g, "__"));
  const safeFn = sanitizePathSegment(functionName);
  return path.join(SPECSYNC_SPECS_DIR, `${safeFile}__${safeFn}.json`);
}

function toViewModel(stored: StoredSpec, storePath: string): SpecViewModel {
  const contract = stored.contract || {
    preconditions: [],
    postconditions: [],
    invariants: [],
    reasoning: "",
  };
  return {
    functionName: stored.functionName,
    filePath: stored.filePath,
    confidence: normalizeConfidence(stored.confidence, 0),
    preconditions: contract.preconditions || [],
    postconditions: contract.postconditions || [],
    invariants: contract.invariants || [],
    edgeCases: contract.edgeCases || [],
    reasoning: contract.reasoning || "",
    storePath,
    acceptedAt: stored.acceptedAt,
  };
}

function parseStoredSpec(raw: unknown, storePath: string): SpecViewModel | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;

  // Support legacy flat cache entries if present.
  if (!obj.contract && (obj.preconditions || obj.postconditions || obj.invariants)) {
    const legacy: StoredSpec = {
      version: 0,
      functionName: String(obj.functionName || ""),
      filePath: String(obj.filePath || ""),
      acceptedAt: String(obj.acceptedAt || ""),
      confidence: normalizeConfidence(obj.confidence, 0),
      contract: {
        preconditions: Array.isArray(obj.preconditions) ? (obj.preconditions as string[]) : [],
        postconditions: Array.isArray(obj.postconditions) ? (obj.postconditions as string[]) : [],
        invariants: Array.isArray(obj.invariants) ? (obj.invariants as string[]) : [],
        reasoning: String(obj.reasoning || ""),
      },
    };
    return toViewModel(legacy, storePath);
  }

  if (typeof obj.functionName !== "string" || !obj.contract) {
    return null;
  }

  return toViewModel(obj as unknown as StoredSpec, storePath);
}

function getSpecsRoot(workspaceRoot: string): string {
  const config = vscode.workspace.getConfiguration("specsync");
  const configured = config.get<string>("specsDir", SPECSYNC_SPECS_DIR);
  return path.isAbsolute(configured)
    ? configured
    : path.join(workspaceRoot, configured);
}

function getConfidenceThreshold(): number {
  const config = vscode.workspace.getConfiguration("specsync");
  return normalizeConfidence(config.get<number>("confidenceThreshold", 0.7), 0.7);
}

export function workspaceRootFor(filePath: string): string | null {
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
  return folder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

export function relativeSourcePath(workspaceRoot: string, absoluteFilePath: string): string {
  return path.relative(workspaceRoot, absoluteFilePath).replace(/\\/g, "/");
}

/** List all accepted specs under `.specsync/specs/`. */
export function listSpecs(workspaceRoot: string): SpecViewModel[] {
  const specsRoot = getSpecsRoot(workspaceRoot);
  if (!fs.existsSync(specsRoot)) {
    return [];
  }

  const results: SpecViewModel[] = [];
  for (const name of fs.readdirSync(specsRoot)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const full = path.join(specsRoot, name);
    try {
      const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
      const view = parseStoredSpec(parsed, full);
      if (view) {
        results.push(view);
      }
    } catch {
      // Skip corrupt files
    }
  }
  return results;
}

/**
 * Resolve a spec for a function in a source file.
 * Prefers exact `.specsync/specs/{file}__{fn}.json`, then any match by function name.
 */
export function getSpecForFunction(
  functionName: string,
  sourceFilePath: string,
  options?: { respectThreshold?: boolean }
): SpecViewModel | null {
  const workspaceRoot = workspaceRootFor(sourceFilePath);
  if (!workspaceRoot) {
    return null;
  }

  const respectThreshold = options?.respectThreshold !== false;
  const threshold = getConfidenceThreshold();
  const rel = relativeSourcePath(workspaceRoot, sourceFilePath);
  const exactRel = buildSpecStorePath(rel, functionName);
  const exactAbs = path.join(workspaceRoot, exactRel);

  const candidates: SpecViewModel[] = [];

  if (fs.existsSync(exactAbs)) {
    try {
      const view = parseStoredSpec(JSON.parse(fs.readFileSync(exactAbs, "utf8")), exactAbs);
      if (view) {
        candidates.push(view);
      }
    } catch {
      // fall through
    }
  }

  if (candidates.length === 0) {
    for (const spec of listSpecs(workspaceRoot)) {
      if (spec.functionName === functionName) {
        const pathMatch =
          !spec.filePath ||
          spec.filePath.replace(/\\/g, "/") === rel ||
          path.basename(spec.filePath) === path.basename(sourceFilePath);
        if (pathMatch) {
          candidates.push(spec);
        }
      }
    }
  }

  const match = candidates[0] ?? null;
  if (!match) {
    return null;
  }
  if (respectThreshold && match.confidence < threshold) {
    return null;
  }
  return match;
}

/** Persist an edited view model back to its `.specsync/specs/` JSON file. */
export function saveSpec(view: SpecViewModel): string {
  const workspaceRoot = workspaceRootFor(view.filePath)
    || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    throw new Error("No workspace folder found");
  }

  const storePath =
    view.storePath ||
    path.join(workspaceRoot, buildSpecStorePath(view.filePath, view.functionName));

  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let existing: Partial<StoredSpec> = {};
  if (fs.existsSync(storePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(storePath, "utf8")) as StoredSpec;
    } catch {
      existing = {};
    }
  }

  const stored: StoredSpec = {
    version: typeof existing.version === "number" ? existing.version : 1,
    functionName: view.functionName,
    filePath: view.filePath,
    lineNumber: existing.lineNumber,
    acceptedAt: existing.acceptedAt || new Date().toISOString(),
    pr: existing.pr,
    sha: existing.sha,
    confidence: normalizeConfidence(view.confidence, 0),
    contract: {
      preconditions: view.preconditions,
      postconditions: view.postconditions,
      invariants: view.invariants,
      edgeCases: view.edgeCases,
      reasoning: view.reasoning,
    },
    implementationHash: existing.implementationHash,
  };

  fs.writeFileSync(storePath, JSON.stringify(stored, null, 2) + "\n", "utf8");
  return storePath;
}

/** Append a clause to an existing or new spec file for a function. */
export function appendClauseToSpec(
  workspaceRoot: string,
  sourceRelPath: string,
  functionName: string,
  type: "precondition" | "postcondition" | "invariant",
  label: string
): string {
  const storeRel = buildSpecStorePath(sourceRelPath, functionName);
  const storePath = path.join(workspaceRoot, storeRel);
  const existing = getSpecForFunction(functionName, path.join(workspaceRoot, sourceRelPath), {
    respectThreshold: false,
  });

  const view: SpecViewModel = existing || {
    functionName,
    filePath: sourceRelPath,
    confidence: 0.5,
    preconditions: [],
    postconditions: [],
    invariants: [],
    edgeCases: [],
    reasoning: "",
    storePath,
  };

  if (type === "precondition") {
    view.preconditions = [...view.preconditions, label];
  } else if (type === "postcondition") {
    view.postconditions = [...view.postconditions, label];
  } else {
    view.invariants = [...view.invariants, label];
  }

  view.storePath = storePath;
  return saveSpec(view);
}
