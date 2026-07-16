const path = require("path");
const { normalizeConfidence } = require("./types");

/** Output root for generated `.lean` files; must match Lake `specs/` (see `lakefile.lean`). */
const SPECS_DIR_DEFAULT = process.env.SPECS_DIR || "specs";

/** Match a standalone `sorry` token (not part of an identifier). */
const SORRY_TOKEN_RE = /(^|[^A-Za-z0-9_])sorry(?=[^A-Za-z0-9_]|$)/g;

type InputType = { name: string; type: string; required?: boolean };

type FormalPred =
  | { kind: "true" }
  | { kind: "nat_ge_zero"; name: string }
  | { kind: "nat_gt_zero"; name: string }
  | { kind: "nat_cmp"; name: string; op: ">" | ">=" | "<" | "<="; rhs: string }
  | { kind: "bool_eq"; name: string; value: boolean }
  | { kind: "str_nonempty"; name: string }
  | { kind: "str_empty"; name: string }
  | { kind: "ne_none"; name: string }
  | { kind: "eq_none"; name: string }
  | { kind: "raw"; text: string; reason: string };

/**
 * Lean 4 generator aligned with Std-only Lake (`lakefile.lean`).
 *
 * Strategy (honest, no fake proofs):
 * - Function under contract → `opaque` (builds without `sorry`).
 * - Smoke + decidable Nat/Bool/String fragments → real proofs (`trivial`, `Nat.zero_le`, …).
 * - LLM NL that cannot be checked from the opaque stub → labeled
 *   `/- SpecSync: unproved: <reason> -/` + `sorry` only.
 * - Security/performance/NL helpers → documentation comments, not invalid Lean.
 */
export class Lean4Generator {
  typeMap: Record<string, string>;
  complexTypeMap: Record<string, string>;
  auxiliaryDefinitions: Record<string, string>;

  constructor() {
    this.typeMap = {
      number: "Nat",
      int: "Int",
      float: "String",
      string: "String",
      boolean: "Bool",
      array: "List",
      object: "String",
      any: "String",
    };

    this.complexTypeMap = {
      Account: "Account",
      Money: "Money",
      Email: "Email",
      Date: "Date",
      User: "User",
      Transaction: "Transaction",
    };

    this.auxiliaryDefinitions = {
      Account: `
structure Account where
  id : Nat
  balance : Money
  owner : String
  isActive : Bool
  deriving Repr`,

      Money: `
structure Money where
  amount : Nat
  currency : String
  deriving Repr`,

      Email: `
structure Email where
  address : String
  isValid : Bool
  deriving Repr`,

      User: `
structure User where
  id : Nat
  name : String
  email : Email
  isVerified : Bool
  deriving Repr`,
    };
  }

  /**
   * Generate Lean4 theorem skeleton from specification
   */
  generateLean4Theorem(spec: any, context: any) {
    const { functionName, inputTypes, outputType } = context;
    const { preconditions, postconditions, invariants, edgeCases, complexity, security } = spec;

    const typeDefs = this.generateTypeDefinitions(functionName, inputTypes || [], outputType);
    const auxDefs = this.generateAuxiliaryDefinitions(inputTypes || [], outputType);
    const theorem = this.generateTheoremStatement(
      functionName,
      inputTypes || [],
      outputType,
      preconditions || [],
      postconditions || []
    );
    const lemmas = this.generateHelperLemmas(invariants || [], edgeCases || []);
    const proofSkeleton = this.generateProofSkeleton(functionName, inputTypes || [], outputType);
    const proofTactics = this.generateProofTactics(functionName, preconditions || [], postconditions || []);
    const securityLemmas = this.generateSecurityLemmas(security);
    const performanceLemmas = this.generatePerformanceLemmas(complexity);
    const closedLemmas = this.generateClosedLemmas(functionName, inputTypes || [], outputType, preconditions || []);

    return {
      typeDefinitions: typeDefs,
      auxiliaryDefinitions: auxDefs,
      theorem: theorem,
      helperLemmas: lemmas,
      closedLemmas,
      securityLemmas: securityLemmas,
      performanceLemmas: performanceLemmas,
      proofSkeleton: proofSkeleton,
      proofTactics: proofTactics,
      metadata: {
        functionName,
        confidence: spec.confidence,
        reasoning: spec.reasoning,
        complexity: complexity,
        security: security,
      },
    };
  }

  /**
   * Example/default values — never `sorry`. Omitted when empty inputs.
   */
  generateTypeDefinitions(functionName: string, inputTypes: InputType[], outputType: string) {
    if (!inputTypes || inputTypes.length === 0) {
      return "-- (no example bindings; parameters appear on the opaque declaration)";
    }

    const fn = this.sanitizeIdent(functionName || "fn");
    const definitions: string[] = [];
    for (const input of inputTypes) {
      const leanType = this.mapTypeToLean(input.type);
      const value = this.inhabitedValue(leanType);
      if (value === null) {
        definitions.push(`-- SpecSync: skip example binding for structured type ${leanType}`);
        continue;
      }
      definitions.push(
        `/-- SpecSync: example binding (Inhabited default, not a proof). -/\ndef ${fn}_${this.sanitizeIdent(input.name)}_example : ${leanType} :=\n  ${value}`
      );
    }

    const outputLeanType = this.mapTypeToLean(outputType);
    const outVal = this.inhabitedValue(outputLeanType);
    if (outVal === null) {
      definitions.push(`-- SpecSync: skip expected_output example for structured type ${outputLeanType}`);
    } else {
      definitions.push(
        `/-- SpecSync: example expected output binding. -/\ndef ${fn}_expected_output_example : ${outputLeanType} :=\n  ${outVal}`
      );
    }

    return definitions.join("\n\n");
  }

  generateAuxiliaryDefinitions(inputTypes: InputType[], outputType: string) {
    const definitions: string[] = [];
    const usedTypes = new Set<string>();

    (inputTypes || []).forEach((input) => {
      if (this.complexTypeMap[input.type]) {
        usedTypes.add(input.type);
      }
    });

    if (outputType && this.complexTypeMap[outputType]) {
      usedTypes.add(outputType);
    }

    usedTypes.forEach((type) => {
      if (this.auxiliaryDefinitions[type]) {
        definitions.push(this.auxiliaryDefinitions[type].trim());
      }
    });

    return definitions.length > 0
      ? definitions.join("\n\n")
      : "-- (no auxiliary structures for these types)";
  }

  /**
   * Main contract: opaque function + closed fragments + labeled sorry only when needed.
   */
  generateTheoremStatement(
    functionName: string,
    inputTypes: InputType[],
    outputType: string,
    preconditions: string[],
    postconditions: string[]
  ) {
    const fn = this.sanitizeIdent(functionName || "fn");
    const params = this.formatBinders(inputTypes);
    const args = this.formatArgs(inputTypes);
    const outputLeanType = this.mapTypeToLean(outputType);
    const opaqueDecl =
      params.length > 0
        ? `opaque ${fn} ${params.join(" ")} : ${outputLeanType}`
        : `opaque ${fn} : ${outputLeanType}`;

    const preFormal = (preconditions || []).map((p) => this.formalizePredicate(p, "precondition"));
    const postFormal = (postconditions || []).map((p) => this.formalizePredicate(p, "postcondition"));

    const preProp = this.joinProps(preFormal.map((p) => this.predToLean(p)));
    const call = args.length > 0 ? `${fn} ${args.join(" ")}` : fn;

    const parts: string[] = [];
    parts.push(`/-- SpecSync: function under contract; body not synthesized from source. -/`);
    parts.push(opaqueDecl);
    parts.push("");
    parts.push(`/-- Always-closed smoke obligation for Lake/CI. -/`);
    parts.push(`theorem ${fn}_specsync_smoke : True := trivial`);

    // Closed: Nat-returning functions are nonnegative regardless of opaque body.
    if (outputLeanType === "Nat") {
      const binders = params.length > 0 ? ` ${params.join(" ")}` : "";
      parts.push("");
      parts.push(`/-- Closed: Nat results are nonnegative. -/`);
      parts.push(
        `theorem ${fn}_result_nonneg${binders} :\n    ${call} >= 0 :=\n  Nat.zero_le (${call})`
      );
    }

    const proveablePosts = postFormal.filter((p) => this.isClosedFromOpaque(p, outputLeanType));
    const openPosts = postFormal.filter((p) => !this.isClosedFromOpaque(p, outputLeanType));

    proveablePosts.forEach((p, index) => {
      const goal = this.predToLean(this.bindResultPred(p, call, outputLeanType));
      if (!goal || goal === "True") return;
      const binders = params.length > 0 ? ` ${params.join(" ")}` : "";
      const proof = this.closedProofFor(p, call, outputLeanType);
      parts.push("");
      parts.push(`/-- Closed from type / decidable fragment. -/`);
      parts.push(`theorem ${fn}_post_closed_${index + 1}${binders} :\n    ${goal} :=\n  ${proof}`);
    });

    if (openPosts.length === 0 && proveablePosts.length === 0 && (postconditions || []).length === 0) {
      parts.push("");
      parts.push(`/-- No postconditions supplied; contract is documentation-only. -/`);
      parts.push(`theorem ${fn}_spec : True := trivial`);
      return parts.join("\n");
    }

    if (openPosts.length > 0) {
      const postProps = openPosts.map((p) => this.predToLean(this.bindResultPred(p, call, outputLeanType)));
      const postProp = this.joinProps(postProps);
      const reasons = openPosts.map((p) => (p.kind === "raw" ? p.reason : `undecided ${p.kind}`)).join("; ");
      const binders = params.length > 0 ? ` ${params.join(" ")}` : "";
      const preBinder =
        preProp && preProp !== "True"
          ? ` (_h_pre : ${preProp})`
          : "";

      parts.push("");
      // Never `sorry` a vacuous `True` goal — use an opaque Prop obligation instead.
      if (!postProp || postProp === "True") {
        parts.push(`/-- SpecSync: NL postconditions not yet a checkable Prop (see module doc). -/`);
        parts.push(`opaque ${fn}_contract_holds : Prop`);
        parts.push(
          `theorem ${fn}_spec${binders}${preBinder} :\n    ${fn}_contract_holds := by\n  ${this.unprovedSorry(reasons || "NL postconditions not autoformalized")}`
        );
      } else {
        parts.push(`/-- SpecSync contract fragment not autoformalizable from opaque stub. -/`);
        parts.push(
          `theorem ${fn}_spec${binders}${preBinder} :\n    ${postProp} := by\n  ${this.unprovedSorry(reasons || "postcondition depends on unimplemented body")}`
        );
      }
    } else {
      // All posts closed separately; emit a trivial umbrella theorem (no unused binders).
      parts.push("");
      parts.push(`/-- All supplied postcondition fragments were closed above. -/`);
      parts.push(`theorem ${fn}_spec : True := trivial`);
    }

    return parts.join("\n");
  }

  /** Honest label for unfinished proofs (soft gate reports these). */
  unprovedSorry(reason: string = "obligation not discharged") {
    const safe = String(reason).replace(/\*\//g, "* /").replace(/\n/g, " ").slice(0, 200);
    return `/- SpecSync: unproved: ${safe} -/\n  sorry`;
  }

  /** Count labeled unproved markers in generated Lean source. */
  countUnproved(leanSource: string) {
    const matches = String(leanSource || "").match(/\/- SpecSync: unproved\b[\s\S]*?-\//g);
    return matches ? matches.length : 0;
  }

  /** Count actual `sorry` tokens outside comments (CI / strict gate). */
  countSorry(leanSource: string) {
    let text = String(leanSource || "");
    let prev: string | null = null;
    while (prev !== text) {
      prev = text;
      text = text.replace(/\/-[\s\S]*?-\//, " ");
    }
    text = text.replace(/--[^\n]*/g, " ");
    const matches = text.match(SORRY_TOKEN_RE);
    return matches ? matches.length : 0;
  }

  /**
   * Soft proof gate: report sorry count; fail only when SPECSYNC_PROOF_GATE=strict.
   * Strict fails on any `sorry` in generated/committed Lean source.
   */
  evaluateProofGate(leanSource: string) {
    const unproved = this.countUnproved(leanSource);
    const sorry = this.countSorry(leanSource);
    const mode = (process.env.SPECSYNC_PROOF_GATE || "soft").toLowerCase();
    const ok = mode !== "strict" || sorry === 0;
    return {
      unproved,
      sorry,
      mode,
      ok,
      message:
        sorry === 0
          ? "No sorry goals"
          : `${sorry} sorry goal(s) (${unproved} labeled SpecSync unproved); gate=${mode}`,
    };
  }

  /**
   * Proof tactics as comments only (never top-level invalid Lean / sorry).
   */
  generateProofTactics(functionName: string, preconditions: string[], postconditions: string[]) {
    const lines = [
      `-- Suggested proof outline for ${this.sanitizeIdent(functionName)} (comments only)`,
      `-- 1. intro hypotheses for preconditions`,
      `-- 2. unfold / cases on the implementation once extracted`,
      `-- 3. discharge decidable fragments with decide / simp / omega`,
    ];
    (preconditions || []).forEach((pre, index) => {
      lines.push(`-- precondition ${index + 1}: ${String(pre).replace(/\n/g, " ")}`);
    });
    (postconditions || []).forEach((post, index) => {
      lines.push(`-- postcondition ${index + 1}: ${String(post).replace(/\n/g, " ")}`);
    });
    return lines.join("\n");
  }

  /**
   * NL invariants / edge cases → documentation comments (not fake Prop + sorry).
   */
  generateHelperLemmas(invariants: string[], edgeCases: string[]) {
    const lemmas: string[] = [];

    (invariants || []).forEach((invariant, i) => {
      const formal = this.formalizePredicate(invariant, "invariant");
      if (formal.kind !== "raw" && this.canEmitStandaloneClosed(formal)) {
        const name = `invariant_${i + 1}_${this.sanitizeName(String(invariant))}`;
        lemmas.push(this.emitClosedStandaloneLemma(name, formal));
      } else {
        lemmas.push(
          `-- SpecSync invariant ${i + 1} (documentation only; not autoformalized):\n-- ${String(invariant).replace(/\n/g, " ")}`
        );
      }
    });

    (edgeCases || []).forEach((edgeCase, i) => {
      lemmas.push(
        `-- SpecSync edge case ${i + 1} (documentation only; not autoformalized):\n-- ${String(edgeCase).replace(/\n/g, " ")}`
      );
    });

    return lemmas;
  }

  sanitizeName(name: string) {
    return name
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .toLowerCase()
      .slice(0, 60);
  }

  sanitizeIdent(name: string) {
    const cleaned = String(name || "fn")
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    if (!cleaned) return "fn";
    if (/^[0-9]/.test(cleaned)) return `fn_${cleaned}`;
    return cleaned;
  }

  /**
   * Opaque declaration — no sorry (spec-as-contract).
   */
  generateProofSkeleton(functionName: string, inputTypes: InputType[], outputType: string) {
    const fn = this.sanitizeIdent(functionName);
    const params = this.formatBinders(inputTypes);
    const outputLeanType = this.mapTypeToLean(outputType);
    const binders = params.length > 0 ? ` ${params.join(" ")}` : "";
    return (
      `/-- SpecSync: opaque stub (spec-as-contract). Prefer this over unfinished proofs for missing bodies. -/\n` +
      `opaque ${fn}_impl${binders} : ${outputLeanType}`
    );
  }

  mapTypeToLean(type: string): string {
    if (!type) return "String";
    const normalizedType = String(type).toLowerCase();

    if (this.typeMap[normalizedType]) {
      return this.typeMap[normalizedType];
    }

    if (normalizedType.includes("array") || normalizedType.includes("[]")) {
      const elementType = normalizedType.replace(/array|\[\]/g, "").trim() || "Nat";
      return `List ${this.mapTypeToLean(elementType)}`;
    }

    if (normalizedType.includes("object") || normalizedType.includes("{}")) {
      return "String";
    }

    if (this.complexTypeMap[type]) {
      return this.complexTypeMap[type];
    }

    // Avoid unbound type variables in generated files — use String as safe default.
    return "String";
  }

  /**
   * Security notes as comments — prior lemmas referenced undefined types + sorry.
   */
  generateSecurityLemmas(security: any) {
    if (!security || !security.vulnerabilities || security.vulnerabilities.length === 0) {
      return [];
    }

    return security.vulnerabilities.map(
      (vuln: any, index: number) =>
        `-- SpecSync security note ${index + 1} (documentation only):\n-- ${String(vuln).replace(/\n/g, " ")}`
    );
  }

  /**
   * Performance notes as comments — prior lemmas were not valid Lean.
   */
  generatePerformanceLemmas(complexity: any) {
    if (!complexity) {
      return [];
    }

    const lemmas: string[] = [];
    if (complexity.time) {
      lemmas.push(`-- SpecSync performance note (time): ${String(complexity.time).replace(/\n/g, " ")}`);
    }
    if (complexity.space) {
      lemmas.push(`-- SpecSync performance note (space): ${String(complexity.space).replace(/\n/g, " ")}`);
    }
    return lemmas;
  }

  convertToLeanPredicates(predicates: any[]) {
    return (predicates || []).map((predicate) => {
      const formal = this.formalizePredicate(String(predicate), "predicate");
      return this.predToLean(formal);
    });
  }

  generateLean4File(spec: any, context: any) {
    const lean4Content = this.generateLean4Theorem(spec, context);
    const fn = context.functionName || "fn";
    const confidencePct = Math.round(normalizeConfidence(spec.confidence) * 100);

    const nlBlock = this.formatNlContractDoc(spec);

    return `-- SpecSync Generated Lean4 Specification
-- Function: ${fn}
-- Confidence: ${confidencePct}%
-- Generated: ${new Date().toISOString()}
-- Lake path: SPECS_DIR (default specs/) — Std only, no Mathlib
-- Mode: spec-as-contract (opaque stubs; unfinished goals use labeled unproved markers)
-- Unproved goals: /- SpecSync: unproved: <reason> -/

import Std

${nlBlock}

-- Auxiliary Definitions
${lean4Content.auxiliaryDefinitions}

-- Example Bindings (Inhabited defaults; not proofs)
${lean4Content.typeDefinitions}

-- Helper Notes / Closed Fragments
${(lean4Content.helperLemmas || []).join("\n\n") || "-- (none)"}

${(lean4Content.closedLemmas || []).join("\n\n")}

-- Security Notes
${(lean4Content.securityLemmas || []).join("\n") || "-- (none)"}

-- Performance Notes
${(lean4Content.performanceLemmas || []).join("\n") || "-- (none)"}

-- Main Contract
${lean4Content.theorem}

-- Proof Outline (comments only)
${lean4Content.proofTactics}

-- Alternate Opaque Impl Name (spec-as-contract)
${lean4Content.proofSkeleton}

-- End of SpecSync Generated Code`;
  }

  async generateCIReadyLean4File(spec: any, context: any, outputDir: string = SPECS_DIR_DEFAULT) {
    const { functionName } = context;
    const fs = require("fs-extra");
    await fs.ensureDir(outputDir);

    const fileName = `${this.sanitizeIdent(functionName)}_spec.lean`;
    const outputFilePath = path.join(outputDir, fileName);
    const content = this.generateLean4File(spec, context);

    const ciContent = `-- CI Integration: compile with Lake (Std only)
-- @[spec_coverage] tracks accept-path artifacts under .specsync/
${content}`;

    await fs.writeFile(outputFilePath, ciContent);
    return outputFilePath;
  }

  async generateCIReadyLean4Files(specs: any[], outputDir: string = SPECS_DIR_DEFAULT) {
    const filePaths = [];
    for (const { spec, context } of specs) {
      const filePath = await this.generateCIReadyLean4File(spec, context, outputDir);
      filePaths.push(filePath);
    }
    return filePaths;
  }

  async generateLean4FileForFunction(spec: any, context: any, outputDir: string = SPECS_DIR_DEFAULT) {
    const { functionName } = context;
    const fs = require("fs-extra");
    await fs.ensureDir(outputDir);

    const fileName = `${this.sanitizeIdent(functionName)}_spec.lean`;
    const outputFilePath = path.join(outputDir, fileName);
    const content = this.generateLean4File(spec, context);
    await fs.writeFile(outputFilePath, content);
    return outputFilePath;
  }

  async generateLean4Files(specs: any[], outputDir: string = SPECS_DIR_DEFAULT) {
    const filePaths = [];
    for (const { spec, context } of specs) {
      const filePath = await this.generateLean4FileForFunction(spec, context, outputDir);
      filePaths.push(filePath);
    }
    return filePaths;
  }

  // --- internals -----------------------------------------------------------

  formatBinders(inputTypes: InputType[]): string[] {
    return (inputTypes || []).map(
      (input) => `(${this.sanitizeIdent(input.name)} : ${this.mapTypeToLean(input.type)})`
    );
  }

  formatArgs(inputTypes: InputType[]): string[] {
    return (inputTypes || []).map((input) => this.sanitizeIdent(input.name));
  }

  inhabitedValue(leanType: string): string | null {
    if (leanType === "Nat" || leanType === "Int") return "0";
    if (leanType === "Bool") return "false";
    if (leanType === "String") return '""';
    if (leanType.startsWith("List ")) return "[]";
    // Structured types: skip example bindings (need well-typed mk; avoid fake default/sorry).
    if (leanType === "Account" || leanType === "Money" || leanType === "Email" || leanType === "User") {
      return null;
    }
    return '""';
  }

  formalizePredicate(raw: string, role: string): FormalPred {
    const text = String(raw || "").trim();
    if (!text) return { kind: "true" };

    let leanPred = text;
    leanPred = leanPred.replace(/is not null\/undefined/gi, "≠ none");
    leanPred = leanPred.replace(/is null\/undefined/gi, "= none");
    leanPred = leanPred.replace(/is of type (\w+)/gi, ": $1");
    leanPred = leanPred.replace(/(\w+)\.length\s*>\s*0/g, '¬($1 = "")');
    leanPred = leanPred.replace(/(\w+)\.length\s*===\s*0/g, '$1 = ""');
    leanPred = leanPred.replace(/\bis true\b/gi, "= true");
    leanPred = leanPred.replace(/\bis false\b/gi, "= false");
    leanPred = leanPred.replace(/(\w+)\s*>=\s*0/g, "$1 ≥ 0");
    leanPred = leanPred.replace(/(\w+)\s*<=\s*0/g, "$1 ≤ 0");

    const natGe = leanPred.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(≥|>=)\s*0$/);
    if (natGe) return { kind: "nat_ge_zero", name: natGe[1] };

    const natGt = leanPred.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*>\s*0$/);
    if (natGt) return { kind: "nat_gt_zero", name: natGt[1] };

    const natCmp = leanPred.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(>|>=|<|<=)\s*(\d+)$/);
    if (natCmp) {
      return {
        kind: "nat_cmp",
        name: natCmp[1],
        op: natCmp[2] as ">" | ">=" | "<" | "<=",
        rhs: natCmp[3],
      };
    }

    const boolEq = leanPred.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(true|false)$/i);
    if (boolEq) {
      return { kind: "bool_eq", name: boolEq[1], value: boolEq[2].toLowerCase() === "true" };
    }

    const strNonempty = leanPred.match(/^¬\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*""\s*\)$/);
    if (strNonempty) return { kind: "str_nonempty", name: strNonempty[1] };

    const strEmpty = leanPred.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*""$/);
    if (strEmpty) return { kind: "str_empty", name: strEmpty[1] };

    if (/≠\s*none/.test(leanPred) || /!=\s*none/.test(leanPred)) {
      const m = leanPred.match(/([A-Za-z_][A-Za-z0-9_]*)/);
      if (m) return { kind: "ne_none", name: m[1] };
    }
    if (/=\s*none/.test(leanPred)) {
      const m = leanPred.match(/([A-Za-z_][A-Za-z0-9_]*)/);
      if (m) return { kind: "eq_none", name: m[1] };
    }

    // "result is positive" / "result is boolean" style — try result > 0
    if (/result\s+is\s+positive/i.test(text) || /is\s+positive/i.test(text)) {
      return { kind: "nat_gt_zero", name: "result" };
    }
    if (/result\s+is\s+boolean/i.test(text)) {
      return { kind: "true" };
    }

    return {
      kind: "raw",
      text: leanPred,
      reason: `${role} not decidable/autoformalizable: ${text.slice(0, 120)}`,
    };
  }

  predToLean(pred: FormalPred): string {
    switch (pred.kind) {
      case "true":
        return "True";
      case "nat_ge_zero":
        return `${pred.name} >= 0`;
      case "nat_gt_zero":
        return `${pred.name} > 0`;
      case "nat_cmp":
        return `${pred.name} ${pred.op} ${pred.rhs}`;
      case "bool_eq":
        return `${pred.name} = ${pred.value}`;
      case "str_nonempty":
        return `¬(${pred.name} = "")`;
      case "str_empty":
        return `${pred.name} = ""`;
      case "ne_none":
        // Option not modeled for plain params — keep as documentation-strength True? Prefer raw.
        return "True";
      case "eq_none":
        return "True";
      case "raw":
        // Do not inject free-form NL into Lean Prop — use True placeholder in conjunctions
        // and keep the real obligation behind labeled sorry at theorem level.
        return `(True : Prop)`;
      default:
        return "True";
    }
  }

  joinProps(props: string[]): string {
    const cleaned = props.filter((p) => p && p !== "True" && p !== "(True : Prop)");
    if (cleaned.length === 0) return "True";
    return cleaned.join(" ∧ ");
  }

  bindResultPred(pred: FormalPred, call: string, outputLeanType: string): FormalPred {
    if (pred.kind === "nat_ge_zero" && pred.name === "result") {
      return { kind: "nat_ge_zero", name: `(${call})` };
    }
    if (pred.kind === "nat_gt_zero" && pred.name === "result") {
      return { kind: "nat_gt_zero", name: `(${call})` };
    }
    if (pred.kind === "nat_cmp" && pred.name === "result") {
      return { ...pred, name: `(${call})` };
    }
    if (pred.kind === "bool_eq" && pred.name === "result") {
      return { ...pred, name: `(${call})` };
    }
    if (pred.kind === "true" && outputLeanType === "Bool") {
      return { kind: "true" };
    }
    return pred;
  }

  /**
   * Obligations we can close without knowing the opaque body.
   */
  isClosedFromOpaque(pred: FormalPred, outputLeanType: string): boolean {
    if (pred.kind === "true") return true;
    if (pred.kind === "nat_ge_zero") {
      // ∀ n, n ≥ 0 on Nat — including opaque Nat results and Nat params
      if (pred.name === "result" && outputLeanType === "Nat") return true;
      // Parameter nonneg: only if we know it's Nat — assume when name is a binder we emit Nat
      return pred.name !== "result";
    }
    return false;
  }

  closedProofFor(pred: FormalPred, call: string, outputLeanType: string): string {
    if (pred.kind === "true") return "trivial";
    if (pred.kind === "nat_ge_zero") {
      const target = pred.name === "result" || pred.name.startsWith("(") ? call : pred.name;
      if (outputLeanType === "Nat" || pred.name !== "result") {
        return `Nat.zero_le (${target})`;
      }
    }
    return "trivial";
  }

  canEmitStandaloneClosed(pred: FormalPred): boolean {
    return pred.kind === "nat_ge_zero" || pred.kind === "true";
  }

  emitClosedStandaloneLemma(name: string, pred: FormalPred): string {
    if (pred.kind === "true") {
      return `theorem ${name} : True := trivial`;
    }
    if (pred.kind === "nat_ge_zero") {
      return (
        `theorem ${name} (${pred.name} : Nat) :\n` +
        `    ${pred.name} >= 0 :=\n` +
        `  Nat.zero_le ${pred.name}`
      );
    }
    return `-- skipped ${name}`;
  }

  generateClosedLemmas(
    functionName: string,
    inputTypes: InputType[],
    _outputType: string,
    preconditions: string[]
  ): string[] {
    const fn = this.sanitizeIdent(functionName);
    const lemmas: string[] = [];
    const natParams = (inputTypes || []).filter((i) => this.mapTypeToLean(i.type) === "Nat");

    natParams.forEach((input) => {
      const n = this.sanitizeIdent(input.name);
      lemmas.push(
        `/-- Closed: Nat parameters are nonnegative. -/\n` +
          `theorem ${fn}_param_${n}_nonneg (${n} : Nat) :\n` +
          `    ${n} >= 0 :=\n` +
          `  Nat.zero_le ${n}`
      );
    });

    // If a precondition is exactly `x > 0`, emit a closed lemma x ≠ 0 from that hyp.
    (preconditions || []).forEach((pre, index) => {
      const formal = this.formalizePredicate(pre, "precondition");
      if (formal.kind === "nat_gt_zero") {
        const n = this.sanitizeIdent(formal.name);
        lemmas.push(
          `/-- Closed: positivity implies inequality with zero. -/\n` +
            `theorem ${fn}_pre_${index + 1}_pos_ne (${n} : Nat) (h : ${n} > 0) :\n` +
            `    ${n} ≠ 0 :=\n` +
            `  Nat.pos_iff_ne_zero.mp h`
        );
      }
    });

    return lemmas;
  }

  formatNlContractDoc(spec: any): string {
    const lines = ["/-!", "  ## Natural-language contract (not all formalized)", ""];
    const section = (title: string, items: any[]) => {
      lines.push(`  ### ${title}`);
      if (!items || items.length === 0) {
        lines.push("  - (none)");
      } else {
        items.forEach((item) => lines.push(`  - ${String(item).replace(/\n/g, " ")}`));
      }
      lines.push("");
    };
    section("Preconditions", spec.preconditions || spec.contract?.preconditions);
    section("Postconditions", spec.postconditions || spec.contract?.postconditions);
    section("Invariants", spec.invariants || spec.contract?.invariants);
    section("Edge cases", spec.edgeCases || spec.contract?.edgeCases);
    if (spec.reasoning) {
      lines.push("  ### Reasoning");
      lines.push(`  ${String(spec.reasoning).replace(/\n/g, " ")}`);
      lines.push("");
    }
    lines.push("-/");
    return lines.join("\n");
  }
}
