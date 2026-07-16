/**
 * Durable spec store under `.specsync/` in the target repository.
 * In-memory cache is single-instance with TTL (not multi-tenant durable).
 */

import { createHash } from "crypto";
import type { Confidence, SpecSuggestion } from "./types";
import { normalizeConfidence } from "./types";

export const SPECSYNC_ROOT = ".specsync";
export const SPECSYNC_SPECS_DIR = `${SPECSYNC_ROOT}/specs`;
export const SPECSYNC_IGNORES_PATH = `${SPECSYNC_ROOT}/ignores.json`;

const SPECS_DIR = process.env.SPECS_DIR || "specs";
const CACHE_TTL_MS = Number(process.env.SPECSYNC_CACHE_TTL_MS || 3_600_000);

export interface SpecContract {
  preconditions: string[];
  postconditions: string[];
  invariants: string[];
  edgeCases?: string[];
  reasoning?: string;
}

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
  /** SHA-256 of implementation body at accept time (for drift). */
  implementationHash?: string;
}

export interface IgnoreEntry {
  functionName: string;
  filePath: string;
  ignoredAt: string;
  pr?: number;
  reason?: string;
}

export interface IgnoresFile {
  version: number;
  ignores: IgnoreEntry[];
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface RepoRef {
  owner: string;
  repo: string;
  /** Branch or commit SHA for reads/writes. */
  ref: string;
}

type OctokitLike = {
  repos: {
    getContent: (params: Record<string, unknown>) => Promise<{ data: unknown }>;
    createOrUpdateFileContents: (params: Record<string, unknown>) => Promise<{ data: unknown }>;
  };
};

function sanitizePathSegment(value: string): string {
  return value.replace(/\\/g, "/").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Path: `.specsync/specs/{filePath}__{functionName}.json` */
export function buildSpecStorePath(filePath: string, functionName: string): string {
  const safeFile = sanitizePathSegment(filePath.replace(/\\/g, "/").replace(/\//g, "__"));
  const safeFn = sanitizePathSegment(functionName);
  return `${SPECSYNC_SPECS_DIR}/${safeFile}__${safeFn}.json`;
}

/** Lake-known Lean path under SPECS_DIR (default `specs/`). */
export function buildLeanStorePath(functionName: string): string {
  return `${SPECS_DIR}/${sanitizePathSegment(functionName)}_spec.lean`;
}

export function hashImplementation(body: string): string {
  return createHash("sha256").update(body || "").digest("hex");
}

export function suggestionToStoredSpec(
  suggestion: SpecSuggestion & { implementationHash?: string },
  meta: { pr?: number; sha?: string }
): StoredSpec {
  return {
    version: 1,
    functionName: suggestion.functionName,
    filePath: suggestion.filePath,
    lineNumber: suggestion.lineNumber,
    acceptedAt: new Date().toISOString(),
    pr: meta.pr,
    sha: meta.sha,
    confidence: normalizeConfidence(suggestion.confidence, 0),
    contract: {
      preconditions: suggestion.preconditions || [],
      postconditions: suggestion.postconditions || [],
      invariants: suggestion.invariants || [],
      edgeCases: suggestion.edgeCases || [],
      reasoning: suggestion.reasoning || "",
    },
    implementationHash: suggestion.implementationHash,
  };
}

export class SpecStore {
  private cache = new Map<string, CacheEntry<unknown>>();

  private cacheKey(owner: string, repo: string, path: string, ref: string): string {
    return `${owner}/${repo}@${ref}:${path}`;
  }

  private getCached<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  private setCached<T>(key: string, value: T): void {
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  /** Invalidate cache entries for a repo path (any ref). */
  invalidate(owner: string, repo: string, path?: string): void {
    const prefix = `${owner}/${repo}`;
    for (const key of this.cache.keys()) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      if (!path || key.includes(`:${path}`)) {
        this.cache.delete(key);
      }
    }
  }

  async retrieveSpec(
    octokit: OctokitLike,
    repo: RepoRef,
    filePath: string,
    functionName: string
  ): Promise<StoredSpec | null> {
    const path = buildSpecStorePath(filePath, functionName);
    return this.readJsonFile<StoredSpec>(octokit, repo, path);
  }

  async storeSpec(
    octokit: OctokitLike,
    repo: RepoRef,
    stored: StoredSpec,
    message?: string
  ): Promise<{ path: string; sha?: string }> {
    const path = buildSpecStorePath(stored.filePath, stored.functionName);
    const content = JSON.stringify(stored, null, 2) + "\n";
    const result = await this.writeFile(
      octokit,
      repo,
      path,
      content,
      message || `specsync: accept spec for ${stored.functionName}`
    );
    this.invalidate(repo.owner, repo.repo, path);
    return { path, sha: result.sha };
  }

  async storeLeanFile(
    octokit: OctokitLike,
    repo: RepoRef,
    functionName: string,
    leanContent: string,
    message?: string
  ): Promise<{ path: string }> {
    const path = buildLeanStorePath(functionName);
    await this.writeFile(
      octokit,
      repo,
      path,
      leanContent,
      message || `specsync: add Lean stub for ${functionName}`
    );
    return { path };
  }

  async listStoredSpecs(octokit: OctokitLike, repo: RepoRef): Promise<StoredSpec[]> {
    const cacheKey = this.cacheKey(repo.owner, repo.repo, SPECSYNC_SPECS_DIR, repo.ref);
    const cached = this.getCached<StoredSpec[]>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const response = await octokit.repos.getContent({
        owner: repo.owner,
        repo: repo.repo,
        path: SPECSYNC_SPECS_DIR,
        ref: repo.ref,
      });

      const data = response.data;
      if (!Array.isArray(data)) {
        return [];
      }

      const specs: StoredSpec[] = [];
      for (const entry of data) {
        if (entry.type !== "file" || !entry.name?.endsWith(".json") || !entry.path) {
          continue;
        }
        const spec = await this.readJsonFile<StoredSpec>(octokit, repo, entry.path);
        if (spec?.functionName) {
          specs.push(spec);
        }
      }

      this.setCached(cacheKey, specs);
      return specs;
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status;
      if (status === 404) {
        return [];
      }
      throw error;
    }
  }

  async getIgnores(octokit: OctokitLike, repo: RepoRef): Promise<IgnoresFile> {
    const file = await this.readJsonFile<IgnoresFile>(octokit, repo, SPECSYNC_IGNORES_PATH);
    return file || { version: 1, ignores: [] };
  }

  async addIgnore(
    octokit: OctokitLike,
    repo: RepoRef,
    entry: IgnoreEntry,
    message?: string
  ): Promise<void> {
    const current = await this.getIgnores(octokit, repo);
    const withoutDup = current.ignores.filter(
      (i) => !(i.functionName === entry.functionName && i.filePath === entry.filePath)
    );
    withoutDup.push(entry);
    const next: IgnoresFile = { version: 1, ignores: withoutDup };
    await this.writeFile(
      octokit,
      repo,
      SPECSYNC_IGNORES_PATH,
      JSON.stringify(next, null, 2) + "\n",
      message || `specsync: ignore suggestion for ${entry.functionName}`
    );
    this.invalidate(repo.owner, repo.repo, SPECSYNC_IGNORES_PATH);
  }

  async isIgnored(
    octokit: OctokitLike,
    repo: RepoRef,
    filePath: string,
    functionName: string
  ): Promise<boolean> {
    const ignores = await this.getIgnores(octokit, repo);
    return ignores.ignores.some((i) => i.functionName === functionName && i.filePath === filePath);
  }

  /**
   * Coverage = accepted specs covering changed functions / eligible changed functions.
   */
  async computeCoverageForFunctions(
    octokit: OctokitLike,
    repo: RepoRef,
    changedFunctions: Array<{ functionName: string; filePath: string; lineNumber?: number }>
  ): Promise<{
    coverage: number;
    totalFunctions: number;
    coveredFunctions: number;
    formula: string;
    functions: Array<{
      name: string;
      filePath: string;
      line: number;
      hasProof: boolean;
      theorem?: string;
    }>;
  }> {
    const eligible = changedFunctions.filter((f) => f.functionName && f.filePath);
    const stored = await this.listStoredSpecs(octokit, repo);
    const storedKeys = new Set(stored.map((s) => `${s.filePath}::${s.functionName}`));

    const functions = eligible.map((f) => {
      const covered = storedKeys.has(`${f.filePath}::${f.functionName}`);
      const match = stored.find(
        (s) => s.filePath === f.filePath && s.functionName === f.functionName
      );
      return {
        name: f.functionName,
        filePath: f.filePath,
        line: f.lineNumber || 1,
        hasProof: covered,
        theorem: covered ? `${f.functionName}_spec` : undefined,
      };
    });

    const totalFunctions = functions.length;
    const coveredFunctions = functions.filter((f) => f.hasProof).length;
    const coverage =
      totalFunctions === 0 ? 100 : Math.round((coveredFunctions / totalFunctions) * 100);
    const formula =
      "coverage = (accepted .specsync specs matching changed functions) / (eligible changed functions) × 100";

    return { coverage, totalFunctions, coveredFunctions, formula, functions };
  }

  private async readJsonFile<T>(
    octokit: OctokitLike,
    repo: RepoRef,
    path: string
  ): Promise<T | null> {
    const cacheKey = this.cacheKey(repo.owner, repo.repo, path, repo.ref);
    const cached = this.getCached<T>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const response = await octokit.repos.getContent({
        owner: repo.owner,
        repo: repo.repo,
        path,
        ref: repo.ref,
      });
      const data = response.data as { content?: string; encoding?: string };
      if (!data.content) {
        return null;
      }
      const text = Buffer.from(data.content, "base64").toString("utf8");
      const parsed = JSON.parse(text) as T;
      this.setCached(cacheKey, parsed);
      return parsed;
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status;
      if (status === 404) {
        return null;
      }
      throw error;
    }
  }

  private async writeFile(
    octokit: OctokitLike,
    repo: RepoRef,
    path: string,
    content: string,
    message: string
  ): Promise<{ sha?: string }> {
    let existingSha: string | undefined;
    try {
      const existing = await octokit.repos.getContent({
        owner: repo.owner,
        repo: repo.repo,
        path,
        ref: repo.ref,
      });
      const data = existing.data as { sha?: string };
      existingSha = data.sha;
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status;
      if (status !== 404) {
        throw error;
      }
    }

    const result = await octokit.repos.createOrUpdateFileContents({
      owner: repo.owner,
      repo: repo.repo,
      path,
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch: repo.ref,
      ...(existingSha ? { sha: existingSha } : {}),
    });

    const data = result.data as { content?: { sha?: string } };
    return { sha: data.content?.sha };
  }
}

export const specStore = new SpecStore();
