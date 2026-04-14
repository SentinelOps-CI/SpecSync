import { Lean4Generator } from "../src/lean4-generator";

describe("Lean4Generator", () => {
  let generator;

  beforeEach(() => {
    generator = new Lean4Generator();
  });

  describe("type mapping", () => {
    it("should map JavaScript types to Lean4 types", () => {
      expect(generator.mapTypeToLean("number")).toBe("ℕ");
      expect(generator.mapTypeToLean("string")).toBe("String");
      expect(generator.mapTypeToLean("boolean")).toBe("Bool");
      expect(generator.mapTypeToLean("array")).toBe("List");
      expect(generator.mapTypeToLean("object")).toBe("Object");
      expect(generator.mapTypeToLean("any")).toBe("α");
    });

    it("should handle array types", () => {
      expect(generator.mapTypeToLean("number[]")).toBe("List ℕ");
      expect(generator.mapTypeToLean("string[]")).toBe("List String");
    });

    it("should handle unknown types", () => {
      expect(generator.mapTypeToLean("customType")).toBe("α");
    });
  });

  describe("predicate conversion", () => {
    it("should convert null checks", () => {
      const predicates = ["param1 is not null/undefined"];
      const result = generator.convertToLeanPredicates(predicates);
      expect(result[0]).toBe("param1 ≠ none");
    });

    it("should convert type checks", () => {
      const predicates = ["param1 is of type number"];
      const result = generator.convertToLeanPredicates(predicates);
      expect(result[0]).toBe("param1 : number");
    });

    it("should convert comparisons", () => {
      const predicates = ["value > 0", "rate < 0"];
      const result = generator.convertToLeanPredicates(predicates);
      expect(result[0]).toBe("value > 0");
      expect(result[1]).toBe("rate < 0");
    });

    it("should convert string operations", () => {
      const predicates = ["email.length > 0"];
      const result = generator.convertToLeanPredicates(predicates);
      expect(result[0]).toBe('¬(email = "")');
    });
  });

  describe("theorem generation", () => {
    it("should generate basic theorem", () => {
      const spec = {
        preconditions: ["principal > 0", "rate >= 0"],
        postconditions: ["result > 0"],
        invariants: ["result is positive"],
        edgeCases: ["handle zero rate"],
        confidence: 85,
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

      expect(result.theorem).toContain("@[spec]");
      expect(result.theorem).toContain("calculateInterest_spec");
      expect(result.theorem).toContain("principal : ℕ");
      expect(result.theorem).toContain("rate : ℕ");
      expect(result.theorem).toContain("time : ℕ");
      expect(result.theorem).toContain("calculateInterest principal rate time");
    });

    it("should generate type definitions", () => {
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
        confidence: 90,
        reasoning: "Email validation",
      };

      const result = generator.generateLean4Theorem(spec, context);

      expect(result.typeDefinitions).toContain("def email : String := sorry");
      expect(result.typeDefinitions).toContain("def expected_output : Bool := sorry");
    });

    it("should generate helper lemmas", () => {
      const spec = {
        preconditions: ["input > 0"],
        postconditions: ["output > 0"],
        invariants: ["state is maintained"],
        edgeCases: ["handle edge case"],
        confidence: 75,
        reasoning: "Test function",
      };

      const context = {
        functionName: "testFunction",
        inputTypes: [{ name: "input", type: "number", required: true }],
        outputType: "number",
      };

      const result = generator.generateLean4Theorem(spec, context);

      expect(result.helperLemmas).toHaveLength(2);
      expect(result.helperLemmas[0]).toContain("invariant_1");
      expect(result.helperLemmas[1]).toContain("edge_case_1");
    });
  });

  describe("file generation", () => {
    it("should generate complete Lean4 file", () => {
      const spec = {
        preconditions: ["x > 0"],
        postconditions: ["result > 0"],
        invariants: ["invariant holds"],
        edgeCases: ["edge case"],
        confidence: 80,
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
      expect(content).toContain("import Mathlib.Data.Nat.Basic");
      expect(content).toContain("import Mathlib.Data.String.Basic");
      expect(content).toContain("import Mathlib.Logic.Basic");
      expect(content).toContain("@[spec]");
      expect(content).toContain("theorem testFunction_spec");
      expect(content).toContain("def testFunction");
    });
  });

  describe("proof skeleton", () => {
    it("should generate proof skeleton", () => {
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

      expect(result).toContain("def add (a : ℕ b : ℕ) : ℕ := by");
      expect(result).toContain("-- TODO: Implement function body");
      expect(result).toContain("sorry");
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
        confidence: 95,
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
      expect(result.theorem).toContain("principal : ℕ");
      expect(result.theorem).toContain("rate : ℕ");
      expect(result.theorem).toContain("time : ℕ");
      expect(result.theorem).toContain("compounds : ℕ");
      expect(result.helperLemmas).toHaveLength(5); // 2 invariants + 3 edge cases
    });
  });
});
