import { Lean4Generator } from "../src/lean4-generator";

describe("Lean4Generator", () => {
  let generator: Lean4Generator;
  const prevGate = process.env.SPECSYNC_PROOF_GATE;

  beforeEach(() => {
    generator = new Lean4Generator();
    delete process.env.SPECSYNC_PROOF_GATE;
  });

  afterAll(() => {
    if (prevGate === undefined) {
      delete process.env.SPECSYNC_PROOF_GATE;
    } else {
      process.env.SPECSYNC_PROOF_GATE = prevGate;
    }
  });

  describe("type mapping", () => {
    it("should map JavaScript types to Lean4 types", () => {
      expect(generator.mapTypeToLean("number")).toBe("Nat");
      expect(generator.mapTypeToLean("string")).toBe("String");
      expect(generator.mapTypeToLean("boolean")).toBe("Bool");
      expect(generator.mapTypeToLean("array")).toBe("List");
      expect(generator.mapTypeToLean("object")).toBe("String");
      expect(generator.mapTypeToLean("any")).toBe("String");
    });

    it("should handle array types", () => {
      expect(generator.mapTypeToLean("number[]")).toBe("List Nat");
      expect(generator.mapTypeToLean("string[]")).toBe("List String");
    });

    it("should handle unknown types as String (no free α)", () => {
      expect(generator.mapTypeToLean("customType")).toBe("String");
    });
  });

  describe("predicate conversion", () => {
    it("should convert null checks", () => {
      const predicates = ["param1 is not null/undefined"];
      const result = generator.convertToLeanPredicates(predicates);
      // Optionality is not modeled; maps to vacuous True rather than invalid Lean.
      expect(result[0]).toBe("True");
    });

    it("should convert comparisons", () => {
      const predicates = ["value > 0", "rate >= 0"];
      const result = generator.convertToLeanPredicates(predicates);
      expect(result[0]).toBe("value > 0");
      expect(result[1]).toBe("rate >= 0");
    });

    it("should convert string operations", () => {
      const predicates = ["email.length > 0"];
      const result = generator.convertToLeanPredicates(predicates);
      expect(result[0]).toBe('¬(email = "")');
    });
  });

  describe("theorem generation", () => {
    it("should generate opaque contract with closed smoke", () => {
      const spec = {
        preconditions: ["principal > 0", "rate >= 0"],
        postconditions: ["result > 0"],
        invariants: ["result is positive"],
        edgeCases: ["handle zero rate"],
        confidence: 0.85,
        reasoning: "Simple interest calculation",
      };

      const context = {
        functionName: "calculateInterest",
        inputTypes: [
          { name: "principal", type: "number", required: true },
          { name: "rate", type: "number", required: true },
          { name: "time", type: "number", required: true },
        ],
        outputType: "number",
      };

      const result = generator.generateLean4Theorem(spec, context);

      expect(result.theorem).toContain("opaque calculateInterest");
      expect(result.theorem).toContain("calculateInterest_specsync_smoke");
      expect(result.theorem).toContain(":= trivial");
      expect(result.theorem).toContain("principal : Nat");
      expect(result.theorem).toContain("rate : Nat");
      expect(result.theorem).toContain("time : Nat");
      expect(result.theorem).toContain("calculateInterest_result_nonneg");
      expect(result.theorem).toContain("Nat.zero_le");
      expect(result.theorem).toContain("calculateInterest_spec");
      expect(result.theorem).toContain("/- SpecSync: unproved:");
    });

    it("should generate example bindings without sorry", () => {
      const context = {
        functionName: "validateEmail",
        inputTypes: [{ name: "email", type: "string", required: true }],
        outputType: "boolean",
      };

      const spec = {
        preconditions: ["email is not null/undefined"],
        postconditions: ["result is boolean"],
        invariants: [],
        edgeCases: [],
        confidence: 0.9,
        reasoning: "Email validation",
      };

      const result = generator.generateLean4Theorem(spec, context);

      expect(result.typeDefinitions).toContain("def validateEmail_email_example : String :=");
      expect(result.typeDefinitions).toContain('""');
      expect(result.typeDefinitions).not.toContain("sorry");
      expect(result.typeDefinitions).toContain("def validateEmail_expected_output_example : Bool :=");
    });

    it("should document helper lemmas without unnecessary sorry", () => {
      const spec = {
        preconditions: ["input > 0"],
        postconditions: ["output > 0"],
        invariants: ["state is maintained"],
        edgeCases: ["handle edge case"],
        confidence: 0.75,
        reasoning: "Test function",
      };

      const context = {
        functionName: "testFunction",
        inputTypes: [{ name: "input", type: "number", required: true }],
        outputType: "number",
      };

      const result = generator.generateLean4Theorem(spec, context);

      expect(result.helperLemmas).toHaveLength(2);
      expect(result.helperLemmas[0]).toContain("invariant 1");
      expect(result.helperLemmas[1]).toContain("edge case 1");
      expect(result.helperLemmas.join("\n")).not.toContain("sorry");
    });

    it("closes smoke and Nat nonneg without sorry when posts are all closed", () => {
      const spec = {
        preconditions: [],
        postconditions: ["result >= 0"],
        invariants: [],
        edgeCases: [],
        confidence: 0.8,
        reasoning: "nonneg",
      };
      const context = {
        functionName: "idNat",
        inputTypes: [{ name: "x", type: "number", required: true }],
        outputType: "number",
      };
      const result = generator.generateLean4Theorem(spec, context);
      expect(result.theorem).toContain("idNat_specsync_smoke");
      expect(result.theorem).toContain("idNat_result_nonneg");
      // Umbrella spec is trivial when posts closed separately
      expect(result.theorem).toMatch(/theorem idNat_spec[\s\S]*:= trivial/);
      const sorryInOpenContract = /theorem idNat_spec[\s\S]*sorry/;
      expect(result.theorem).not.toMatch(sorryInOpenContract);
    });
  });

  describe("file generation", () => {
    it("should generate complete Lean4 file without Mathlib", () => {
      const spec = {
        preconditions: ["x > 0"],
        postconditions: ["result > 0"],
        invariants: ["invariant holds"],
        edgeCases: ["edge case"],
        confidence: 0.8,
        reasoning: "Test reasoning",
      };

      const context = {
        functionName: "testFunction",
        inputTypes: [{ name: "x", type: "number", required: true }],
        outputType: "number",
      };

      const content = generator.generateLean4File(spec, context);

      expect(content).toContain("-- SpecSync Generated Lean4 Specification");
      expect(content).toContain("-- Function: testFunction");
      expect(content).toContain("-- Confidence: 80%");
      expect(content).toContain("import Std");
      expect(content).not.toContain("import Mathlib");
      expect(content).toContain("opaque testFunction");
      expect(content).toContain("testFunction_specsync_smoke");
      expect(content).toContain(":= trivial");
      expect(content).toContain("/- SpecSync: unproved:");
      expect(content).toContain("theorem testFunction_spec");
      expect(content).not.toContain("@[spec]");
    });

    it("evaluateProofGate is soft by default and reports sorry", () => {
      const content = generator.generateLean4File(
        {
          preconditions: ["x > 0"],
          postconditions: ["result > 0"],
          invariants: [],
          edgeCases: [],
          confidence: 0.8,
          reasoning: "r",
        },
        {
          functionName: "f",
          inputTypes: [{ name: "x", type: "number", required: true }],
          outputType: "number",
        }
      );
      const gate = generator.evaluateProofGate(content);
      expect(gate.sorry).toBeGreaterThan(0);
      expect(gate.unproved).toBeGreaterThan(0);
      expect(gate.mode).toBe("soft");
      expect(gate.ok).toBe(true);
    });

    it("evaluateProofGate strict fails when sorry remain", () => {
      process.env.SPECSYNC_PROOF_GATE = "strict";
      const content = generator.generateLean4File(
        {
          preconditions: ["x > 0"],
          postconditions: ["result > 0"],
          invariants: [],
          edgeCases: [],
          confidence: 0.8,
          reasoning: "r",
        },
        {
          functionName: "f",
          inputTypes: [{ name: "x", type: "number", required: true }],
          outputType: "number",
        }
      );
      const gate = generator.evaluateProofGate(content);
      expect(gate.mode).toBe("strict");
      expect(gate.ok).toBe(false);
    });

    it("does not emit sorry for smoke-only / closed Nat templates", () => {
      const content = generator.generateLean4File(
        {
          preconditions: [],
          postconditions: ["result >= 0"],
          invariants: [],
          edgeCases: [],
          confidence: 1,
          reasoning: "closed",
        },
        {
          functionName: "nonnegId",
          inputTypes: [{ name: "n", type: "number", required: true }],
          outputType: "number",
        }
      );
      expect(content).toContain("nonnegId_specsync_smoke");
      expect(content).toContain("Nat.zero_le");
      expect(generator.countSorry(content)).toBe(0);
      expect(generator.evaluateProofGate(content).ok).toBe(true);
    });
  });

  describe("proof skeleton", () => {
    it("uses opaque stub instead of sorry", () => {
      const context = {
        functionName: "add",
        inputTypes: [
          { name: "a", type: "number", required: true },
          { name: "b", type: "number", required: true },
        ],
        outputType: "number",
      };

      const result = generator.generateProofSkeleton(
        context.functionName,
        context.inputTypes,
        context.outputType
      );

      expect(result).toContain("opaque add_impl");
      expect(result).toContain("(a : Nat)");
      expect(result).toContain("(b : Nat)");
      expect(result).not.toContain("sorry");
    });
  });

  describe("security and performance", () => {
    it("emits documentation comments without sorry", () => {
      const security = generator.generateSecurityLemmas({
        vulnerabilities: ["injection"],
      });
      const perf = generator.generatePerformanceLemmas({ time: "O(n)", space: "O(1)" });
      expect(security.join("\n")).toContain("security note");
      expect(security.join("\n")).not.toContain("sorry");
      expect(perf.join("\n")).toContain("performance note");
      expect(perf.join("\n")).not.toContain("sorry");
    });
  });

  describe("complex examples", () => {
    it("should handle complex function with multiple inputs", () => {
      const spec = {
        preconditions: [
          "principal > 0",
          "rate >= 0",
          "time > 0",
          "principal is not null/undefined",
        ],
        postconditions: ["result > 0", "result = principal * rate * time"],
        invariants: ["result maintains precision", "calculation is accurate"],
        edgeCases: ["handle zero rate", "handle very large numbers", "handle decimal precision"],
        confidence: 0.95,
        reasoning: "Complex interest calculation with validation",
      };

      const context = {
        functionName: "calculateCompoundInterest",
        inputTypes: [
          { name: "principal", type: "number", required: true },
          { name: "rate", type: "number", required: true },
          { name: "time", type: "number", required: true },
          { name: "compounds", type: "number", required: false },
        ],
        outputType: "number",
      };

      const result = generator.generateLean4Theorem(spec, context);

      expect(result.theorem).toContain("calculateCompoundInterest_spec");
      expect(result.theorem).toContain("opaque calculateCompoundInterest");
      expect(result.theorem).toContain("principal : Nat");
      expect(result.helperLemmas.length).toBeGreaterThanOrEqual(5);
      expect(result.closedLemmas.some((l: string) => l.includes("pos_ne"))).toBe(true);
    });
  });
});
