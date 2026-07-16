import { LLMClient } from "../src/llm-client";

// Mock the LLM SDKs
jest.mock("openai");
jest.mock("@anthropic-ai/sdk");
jest.mock("dotenv", () => ({
  config: jest.fn(),
}));

describe("LLMClient", () => {
  let llmClient;
  let mockOpenAI;
  let mockAnthropic;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Mock OpenAI
    mockOpenAI = {
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    };
    require("openai").mockImplementation(() => mockOpenAI);

    // Mock Anthropic
    mockAnthropic = {
      messages: {
        create: jest.fn(),
      },
    };
    require("@anthropic-ai/sdk").mockImplementation(() => mockAnthropic);

    // Clear environment variables
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    // Reset module cache to ensure fresh instances
    jest.resetModules();

    // Re-require the module after reset
    const { LLMClient: LLMClientFresh } = require("../src/llm-client");
    llmClient = new LLMClientFresh();
  });

  describe("initialization", () => {
    it("should initialize with no API keys", () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      llmClient = new LLMClient();

      expect(consoleSpy).toHaveBeenCalledWith("⚠️ No LLM API keys found. Using mock responses.");
      expect(llmClient.openai).toBeNull();
      expect(llmClient.anthropic).toBeNull();

      consoleSpy.mockRestore();
    });

    it("should initialize with OpenAI API key", () => {
      process.env.OPENAI_API_KEY = "test-openai-key";
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      llmClient = new LLMClient();

      expect(consoleSpy).toHaveBeenCalledWith("✅ OpenAI client initialized");
      expect(llmClient.openai).toBeDefined();
      expect(llmClient.anthropic).toBeNull();

      consoleSpy.mockRestore();
    });

    it("should initialize with Anthropic API key", () => {
      process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      llmClient = new LLMClient();

      expect(consoleSpy).toHaveBeenCalledWith("✅ Anthropic client initialized");
      expect(llmClient.openai).toBeNull();
      expect(llmClient.anthropic).toBeDefined();

      consoleSpy.mockRestore();
    });
  });

  describe("generateSpec", () => {
    beforeEach(() => {
      llmClient = new LLMClient();
    });

    it("should generate mock spec when no LLM clients available", async () => {
      const context = {
        functionName: "testFunction",
        functionBody: "function testFunction() { return true; }",
        inputTypes: [{ name: "param1", type: "string", required: true }],
        conditionalGuards: [{ condition: "param1.length > 0" }],
        earlyReturns: [],
        complexity: 2,
      };

      const result = await llmClient.generateSpec(context);

      expect(result).toHaveProperty("preconditions");
      expect(result).toHaveProperty("postconditions");
      expect(result).toHaveProperty("invariants");
      expect(result).toHaveProperty("edgeCases");
      expect(result).toHaveProperty("confidence");
      expect(result).toHaveProperty("reasoning");
      expect(result.isMock).toBe(true);
      expect(result.unavailable).toBeUndefined();
      expect(Array.isArray(result.preconditions)).toBe(true);
      expect(Array.isArray(result.postconditions)).toBe(true);
      expect(Array.isArray(result.invariants)).toBe(true);
      expect(Array.isArray(result.edgeCases)).toBe(true);
      expect(typeof result.confidence).toBe("number");
    });

    it("should return unavailable in production when mock LLM is denied", async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      const prevAllow = process.env.SPECSYNC_ALLOW_MOCK_LLM;
      process.env.NODE_ENV = "production";
      delete process.env.SPECSYNC_ALLOW_MOCK_LLM;
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      jest.resetModules();
      const { LLMClient: LLMClientFresh } = require("../src/llm-client");
      const client = new LLMClientFresh();

      const result = await client.generateSpec({
        functionName: "prodFn",
        functionBody: "function prodFn() {}",
        inputTypes: [],
        conditionalGuards: [],
        earlyReturns: [],
        complexity: 1,
      });

      expect(result.unavailable).toBe(true);
      expect(result.reason).toBe("llm_unavailable");
      expect(result.isMock).toBe(false);

      process.env.NODE_ENV = prevNodeEnv;
      if (prevAllow === undefined) {
        delete process.env.SPECSYNC_ALLOW_MOCK_LLM;
      } else {
        process.env.SPECSYNC_ALLOW_MOCK_LLM = prevAllow;
      }
    });

    it("should allow mock in production when SPECSYNC_ALLOW_MOCK_LLM=true", async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      const prevAllow = process.env.SPECSYNC_ALLOW_MOCK_LLM;
      process.env.NODE_ENV = "production";
      process.env.SPECSYNC_ALLOW_MOCK_LLM = "true";
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      jest.resetModules();
      const { LLMClient: LLMClientFresh } = require("../src/llm-client");
      const client = new LLMClientFresh();

      const result = await client.generateSpec({
        functionName: "allowedMock",
        functionBody: "function allowedMock() {}",
        inputTypes: [],
        conditionalGuards: [],
        earlyReturns: [],
        complexity: 1,
      });

      expect(result.unavailable).toBeUndefined();
      expect(result.isMock).toBe(true);
      expect(result).toHaveProperty("preconditions");

      process.env.NODE_ENV = prevNodeEnv;
      if (prevAllow === undefined) {
        delete process.env.SPECSYNC_ALLOW_MOCK_LLM;
      } else {
        process.env.SPECSYNC_ALLOW_MOCK_LLM = prevAllow;
      }
    });

    it("should return unavailable on API failure in production without mock allow", async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      const prevAllow = process.env.SPECSYNC_ALLOW_MOCK_LLM;
      process.env.NODE_ENV = "production";
      delete process.env.SPECSYNC_ALLOW_MOCK_LLM;
      process.env.OPENAI_API_KEY = "test-key";

      jest.resetModules();
      const { LLMClient: LLMClientFresh } = require("../src/llm-client");
      const client = new LLMClientFresh();
      client.openai = mockOpenAI;
      mockOpenAI.chat.completions.create.mockRejectedValue(new Error("API Error"));
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const result = await client.generateSpec({
        functionName: "failFn",
        functionBody: "function failFn() {}",
        inputTypes: [],
        conditionalGuards: [],
        earlyReturns: [],
        complexity: 1,
      });

      expect(result.unavailable).toBe(true);
      expect(result.isMock).toBe(false);

      consoleSpy.mockRestore();
      process.env.NODE_ENV = prevNodeEnv;
      if (prevAllow === undefined) {
        delete process.env.SPECSYNC_ALLOW_MOCK_LLM;
      } else {
        process.env.SPECSYNC_ALLOW_MOCK_LLM = prevAllow;
      }
    });

    it("should generate spec with OpenAI when available", async () => {
      // Set up environment and recreate client
      process.env.OPENAI_API_KEY = "test-key";
      delete process.env.ANTHROPIC_API_KEY;

      // Clear module cache to ensure fresh instance
      jest.resetModules();
      const { LLMClient: LLMClientFresh } = require("../src/llm-client");
      llmClient = new LLMClientFresh();

      const mockResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                preconditions: ["param1 is not null"],
                postconditions: ["function returns boolean"],
                invariants: ["no side effects"],
                edgeCases: ["empty string input"],
                confidence: 0.85,
                reasoning: "Analysis complete",
              }),
            },
          },
        ],
      };

      // Mock the OpenAI client directly on the instance
      llmClient.openai = mockOpenAI;
      mockOpenAI.chat.completions.create.mockResolvedValue(mockResponse);

      const context = {
        functionName: "testFunction",
        language: "JavaScript",
        functionBody: "function testFunction(param1) { return param1.length > 0; }",
        inputTypes: [{ name: "param1", type: "string", required: true }],
        outputType: "boolean",
        conditionalGuards: [],
        loops: [],
        earlyReturns: [],
        controlFlow: "linear",
        complexity: 1,
        comments: "Test function",
      };

      const result = await llmClient.generateSpec(context);

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalled();
      expect(result.preconditions).toContain("param1 is not null");
      expect(result.postconditions).toContain("function returns boolean");
      expect(result.confidence).toBe(0.85);
      expect(result.isMock).toBe(false);
    });

    it("should generate spec with Anthropic when OpenAI unavailable", async () => {
      // Set up environment and recreate client
      delete process.env.OPENAI_API_KEY;
      process.env.ANTHROPIC_API_KEY = "test-key";

      // Clear module cache to ensure fresh instance
      jest.resetModules();
      const { LLMClient: LLMClientFresh } = require("../src/llm-client");
      llmClient = new LLMClientFresh();

      const mockResponse = {
        content: [
          {
            text: JSON.stringify({
              preconditions: ["param1 is valid"],
              postconditions: ["function completes"],
              invariants: ["state consistent"],
              edgeCases: ["null input"],
              confidence: 0.9,
              reasoning: "Anthropic analysis",
            }),
          },
        ],
      };

      // Mock the Anthropic client directly on the instance
      llmClient.anthropic = mockAnthropic;
      mockAnthropic.messages.create.mockResolvedValue(mockResponse);

      const context = {
        functionName: "testFunction",
        language: "JavaScript",
        functionBody: "function testFunction(param1) { return param1; }",
        inputTypes: [{ name: "param1", type: "string", required: true }],
        outputType: "string",
        conditionalGuards: [],
        loops: [],
        earlyReturns: [],
        controlFlow: "linear",
        complexity: 1,
        comments: "Test function",
      };

      const result = await llmClient.generateSpec(context);

      expect(mockAnthropic.messages.create).toHaveBeenCalled();
      expect(result.preconditions).toContain("param1 is valid");
      expect(result.confidence).toBe(0.9);
    });

    it("should fallback to mock on LLM error", async () => {
      process.env.OPENAI_API_KEY = "test-key";
      llmClient = new LLMClient();

      mockOpenAI.chat.completions.create.mockRejectedValue(new Error("API Error"));

      const context = {
        functionName: "testFunction",
        functionBody: "function testFunction() { return true; }",
        inputTypes: [],
        conditionalGuards: [],
        earlyReturns: [],
        complexity: 1,
      };

      const result = await llmClient.generateSpec(context);

      expect(result).toHaveProperty("preconditions");
      expect(result).toHaveProperty("postconditions");
      expect(result.isMock).toBe(true);
    });
  });

  describe("parseLLMResponse", () => {
    beforeEach(() => {
      llmClient = new LLMClient();
    });

    it("should parse valid JSON response", () => {
      const response = JSON.stringify({
        preconditions: ["input is valid"],
        postconditions: ["output is correct"],
        invariants: ["state maintained"],
        edgeCases: ["edge case 1"],
        confidence: 0.85,
        reasoning: "Good analysis",
      });

      const result = llmClient.parseLLMResponse(response);

      expect(result.preconditions).toContain("input is valid");
      expect(result.postconditions).toContain("output is correct");
      expect(result.confidence).toBe(0.85);
    });

    it("should normalize legacy 0–100 confidence to 0–1", () => {
      const response = JSON.stringify({
        preconditions: ["input is valid"],
        postconditions: ["output is correct"],
        invariants: ["state maintained"],
        edgeCases: ["edge case 1"],
        confidence: 85,
        reasoning: "Good analysis",
      });

      const result = llmClient.parseLLMResponse(response);
      expect(result.confidence).toBe(0.85);
    });

    it("should handle invalid JSON response", () => {
      const response = "Invalid JSON response";
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const result = llmClient.parseLLMResponse(response);

      expect(consoleSpy).toHaveBeenCalledWith("Failed to parse LLM response:", expect.any(Error));
      expect(result).toHaveProperty("preconditions");
      expect(result).toHaveProperty("postconditions");

      consoleSpy.mockRestore();
    });

    it("should handle missing required fields", () => {
      const response = JSON.stringify({
        preconditions: ["test"],
        // Missing other required fields
        confidence: 0.5,
      });

      const result = llmClient.parseLLMResponse(response);

      expect(result).toHaveProperty("preconditions");
      expect(result).toHaveProperty("postconditions");
      expect(result).toHaveProperty("invariants");
      expect(result).toHaveProperty("edgeCases");
    });
  });

  describe("buildPrompt", () => {
    beforeEach(() => {
      llmClient = new LLMClient();
    });

    it("should build comprehensive prompt", () => {
      const context = {
        functionName: "calculateInterest",
        language: "JavaScript",
        functionBody:
          "function calculateInterest(principal, rate, time) { return principal * rate * time; }",
        inputTypes: [
          { name: "principal", type: "number", required: true },
          { name: "rate", type: "number", required: true },
          { name: "time", type: "number", required: true },
        ],
        outputType: "number",
        conditionalGuards: [{ condition: "principal > 0" }],
        loops: [],
        earlyReturns: [],
        controlFlow: "linear",
        complexity: 3,
        comments: "Calculate simple interest",
      };

      const prompt = llmClient.buildPrompt(context);

      expect(prompt).toContain("calculateInterest");
      expect(prompt).toContain("JavaScript");
      expect(prompt).toContain("principal * rate * time");
      expect(prompt).toContain("PRECONDITIONS");
      expect(prompt).toContain("POSTCONDITIONS");
      expect(prompt).toContain("INVARIANTS");
      expect(prompt).toContain("EDGE CASES");
      expect(prompt).toContain("CONFIDENCE");
    });
  });

  describe("testConnectivity", () => {
    beforeEach(() => {
      llmClient = new LLMClient();
    });

    it("should test OpenAI connectivity", async () => {
      process.env.OPENAI_API_KEY = "test-key";
      llmClient = new LLMClient();

      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: "Hello" } }],
      });

      const results = await llmClient.testConnectivity();

      expect(results.openai).toBe(true);
      expect(results.anthropic).toBe(false);
      expect(results.mock).toBe(true);
    });

    it("should test Anthropic connectivity", async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      llmClient = new LLMClient();

      mockAnthropic.messages.create.mockResolvedValue({
        content: [{ text: "Hello" }],
      });

      const results = await llmClient.testConnectivity();

      expect(results.openai).toBe(false);
      expect(results.anthropic).toBe(true);
      expect(results.mock).toBe(true);
    });

    it("should handle connectivity failures", async () => {
      process.env.OPENAI_API_KEY = "test-key";
      llmClient = new LLMClient();

      mockOpenAI.chat.completions.create.mockRejectedValue(new Error("API Error"));
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const results = await llmClient.testConnectivity();

      expect(results.openai).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith("OpenAI test failed:", expect.any(String));

      consoleSpy.mockRestore();
    });
  });
});
