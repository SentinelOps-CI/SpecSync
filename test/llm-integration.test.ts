import { LLMClient } from "../src/llm-client";

describe("LLM Integration", () => {
  let llmClient;

  beforeEach(() => {
    // Clear environment variables
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    llmClient = new LLMClient();
  });

  describe("Mock LLM Generation", () => {
    it("should generate specifications with mock LLM", async () => {
      const context = {
        functionName: "calculateInterest",
        language: "JavaScript",
        functionBody: `
function calculateInterest(principal, rate, time) {
  if (principal <= 0 || rate < 0 || time <= 0) {
    throw new Error('Invalid parameters');
  }
  return principal * rate * time;
}`,
        inputTypes: [
          { name: "principal", type: "number", required: true },
          { name: "rate", type: "number", required: true },
          { name: "time", type: "number", required: true },
        ],
        outputType: "number",
        conditionalGuards: [
          { condition: "principal <= 0" },
          { condition: "rate < 0" },
          { condition: "time <= 0" },
        ],
        loops: [],
        earlyReturns: [],
        controlFlow: "linear",
        complexity: 3,
        comments: "Calculate simple interest",
      };

      const result = await llmClient.generateSpec(context);

      // Verify the structure
      expect(result).toHaveProperty("preconditions");
      expect(result).toHaveProperty("postconditions");
      expect(result).toHaveProperty("invariants");
      expect(result).toHaveProperty("edgeCases");
      expect(result).toHaveProperty("confidence");
      expect(result).toHaveProperty("reasoning");

      // Verify data types
      expect(Array.isArray(result.preconditions)).toBe(true);
      expect(Array.isArray(result.postconditions)).toBe(true);
      expect(Array.isArray(result.invariants)).toBe(true);
      expect(Array.isArray(result.edgeCases)).toBe(true);
      expect(typeof result.confidence).toBe("number");
      expect(typeof result.reasoning).toBe("string");

      // Verify confidence is in valid range
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(100);

      // Verify we have some content
      expect(result.preconditions.length).toBeGreaterThan(0);
      expect(result.postconditions.length).toBeGreaterThan(0);
    });

    it("should handle complex functions with multiple inputs", async () => {
      const context = {
        functionName: "validateEmail",
        language: "JavaScript",
        functionBody: `
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}`,
        inputTypes: [{ name: "email", type: "string", required: true }],
        outputType: "boolean",
        conditionalGuards: [{ condition: "!email" }, { condition: "typeof email !== 'string'" }],
        loops: [],
        earlyReturns: [{ value: "false", condition: "!email || typeof email !== 'string'" }],
        controlFlow: "conditional",
        complexity: 2,
        comments: "Validate email format",
      };

      const result = await llmClient.generateSpec(context);

      expect(result.preconditions.length).toBeGreaterThan(0);
      expect(result.postconditions.length).toBeGreaterThan(0);
      expect(result.edgeCases.length).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(50);
    });
  });

  describe("Prompt Building", () => {
    it("should build comprehensive prompts", () => {
      const context = {
        functionName: "testFunction",
        language: "JavaScript",
        functionBody: "function testFunction() { return true; }",
        inputTypes: [],
        outputType: "boolean",
        conditionalGuards: [],
        loops: [],
        earlyReturns: [],
        controlFlow: "linear",
        complexity: 1,
        comments: "Test function",
      };

      const prompt = llmClient.buildPrompt(context);

      expect(prompt).toContain("testFunction");
      expect(prompt).toContain("JavaScript");
      expect(prompt).toContain("PRECONDITIONS");
      expect(prompt).toContain("POSTCONDITIONS");
      expect(prompt).toContain("INVARIANTS");
      expect(prompt).toContain("EDGE CASES");
      expect(prompt).toContain("CONFIDENCE");
      expect(prompt).toContain("JSON");
    });
  });

  describe("Response Parsing", () => {
    it("should parse valid JSON responses", () => {
      const validResponse = JSON.stringify({
        preconditions: ["input is valid"],
        postconditions: ["output is correct"],
        invariants: ["state maintained"],
        edgeCases: ["edge case 1"],
        confidence: 85,
        reasoning: "Good analysis",
      });

      const result = llmClient.parseLLMResponse(validResponse);

      expect(result.preconditions).toContain("input is valid");
      expect(result.postconditions).toContain("output is correct");
      expect(result.confidence).toBe(85);
      expect(result.reasoning).toBe("Good analysis");
    });

    it("should handle malformed responses gracefully", () => {
      const invalidResponse = "This is not JSON at all";

      const result = llmClient.parseLLMResponse(invalidResponse);

      // Should fallback to mock spec
      expect(result).toHaveProperty("preconditions");
      expect(result).toHaveProperty("postconditions");
      expect(result).toHaveProperty("invariants");
      expect(result).toHaveProperty("edgeCases");
      expect(result).toHaveProperty("confidence");
    });
  });

  describe("Connectivity Testing", () => {
    it("should test connectivity without API keys", async () => {
      const results = await llmClient.testConnectivity();

      expect(results).toHaveProperty("openai");
      expect(results).toHaveProperty("anthropic");
      expect(results).toHaveProperty("mock");
      expect(results.openai).toBe(false);
      expect(results.anthropic).toBe(false);
      expect(results.mock).toBe(true);
    });
  });
});
