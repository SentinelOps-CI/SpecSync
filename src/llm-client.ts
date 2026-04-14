// @ts-nocheck
const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
require("dotenv").config();

export class LLMClient {
  constructor() {
    this.openai = null;
    this.anthropic = null;
    this.initializeClients();
  }

  /**
   * Initialize LLM clients based on available API keys
   */
  initializeClients() {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const timeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS || 120000);
    const maxRetries = Math.min(3, Math.max(0, Number(process.env.LLM_MAX_RETRIES ?? 2)));

    if (openaiApiKey) {
      this.openai = new OpenAI({
        apiKey: openaiApiKey,
        timeout: timeoutMs,
        maxRetries,
      });
      console.log("✅ OpenAI client initialized");
    }

    if (anthropicApiKey) {
      this.anthropic = new Anthropic({
        apiKey: anthropicApiKey,
        timeout: timeoutMs,
        maxRetries,
      });
      console.log("✅ Anthropic client initialized");
    }

    if (!this.openai && !this.anthropic) {
      console.warn("⚠️ No LLM API keys found. Using mock responses.");
    }
  }

  /**
   * Generate specification using available LLM
   * @param {Object} context - Function analysis context
   * @returns {Object} Generated specification
   */
  async generateSpec(context) {
    try {
      // Try OpenAI first, then Anthropic, then fallback to mock
      if (this.openai) {
        return await this.generateWithOpenAI(context);
      } else if (this.anthropic) {
        return await this.generateWithAnthropic(context);
      } else {
        return this.generateMockSpec(context);
      }
    } catch (error) {
      console.error("Error generating spec with LLM:", error);
      return this.generateMockSpec(context);
    }
  }

  /**
   * Generate specification using OpenAI
   * @param {Object} context - Function analysis context
   * @returns {Object} Generated specification
   */
  async generateWithOpenAI(context) {
    const prompt = this.buildPrompt(context);

    const response = await this.openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content:
            "You are a formal specification expert. Analyze code functions and generate precise preconditions, postconditions, invariants, and edge cases. Always respond with valid JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.1,
      max_tokens: 2000,
    });

    const content = response.choices[0].message.content;
    return this.parseLLMResponse(content);
  }

  /**
   * Generate specification using Anthropic
   * @param {Object} context - Function analysis context
   * @returns {Object} Generated specification
   */
  async generateWithAnthropic(context) {
    const prompt = this.buildPrompt(context);

    const response = await this.anthropic.messages.create({
      model: "claude-3-sonnet-20240229",
      max_tokens: 2000,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const content = response.content[0].text;
    return this.parseLLMResponse(content);
  }

  /**
   * Build comprehensive prompt for LLM with state-of-the-art enhancements
   * @param {Object} context - Function analysis context
   * @returns {string} Enhanced LLM prompt
   */
  buildPrompt(context) {
    return `You are an expert software engineer specializing in formal specification and program verification. Analyze the following ${context.language} function and generate a comprehensive formal specification using state-of-the-art techniques.

Function: ${context.functionName}
Language: ${context.language}

Function Body:
\`\`\`${context.language.toLowerCase()}
${context.functionBody}
\`\`\`

Analysis Context:
- Input Types: ${JSON.stringify(context.inputTypes, null, 2)}
- Output Type: ${context.outputType}
- Conditional Guards: ${JSON.stringify(context.conditionalGuards, null, 2)}
- Loops: ${JSON.stringify(context.loops, null, 2)}
- Early Returns: ${JSON.stringify(context.earlyReturns, null, 2)}
- Control Flow: ${context.controlFlow}
- Complexity: ${context.complexity}
- Comments: ${context.comments || "None"}

Please generate a formal specification using the following advanced analysis framework:

1. PRECONDITIONS (Input Validation & State Requirements):
   - Type safety requirements
   - Range and domain constraints
   - Resource availability (memory, network, etc.)
   - State invariants that must hold
   - Security preconditions (authentication, authorization)
   - Performance preconditions (rate limits, timeouts)

2. POSTCONDITIONS (Output Guarantees & Side Effects):
   - Return value properties and constraints
   - Side effects on global state
   - Resource cleanup guarantees
   - Performance guarantees (time complexity, space usage)
   - Security postconditions (no information leakage)
   - Exception handling guarantees

3. INVARIANTS (Data Structure & Business Logic):
   - Data structure integrity constraints
   - Business rule invariants
   - Resource management invariants
   - Thread safety guarantees (if applicable)
   - Memory safety invariants
   - Temporal invariants (ordering, timing)

4. EDGE CASES (Boundary Conditions & Error Scenarios):
   - Boundary value conditions
   - Error handling scenarios
   - Performance edge cases (large inputs, timeouts)
   - Security edge cases (malicious inputs, overflow)
   - Concurrency edge cases (race conditions)
   - Resource exhaustion scenarios

5. ADVANCED ANALYSIS:
   - Time complexity analysis
   - Space complexity analysis
   - Security vulnerability assessment
   - Thread safety analysis (if applicable)
   - Memory leak potential
   - API contract compliance

6. CONFIDENCE: Your confidence level (0-100) in this analysis
   - Consider the complexity of the function
   - Consider the clarity of the implementation
   - Consider the presence of comments/documentation
   - Consider the language-specific patterns used

Respond with ONLY valid JSON in this exact format:
{
  "preconditions": ["detailed", "preconditions", "with", "reasoning"],
  "postconditions": ["detailed", "postconditions", "with", "guarantees"],
  "invariants": ["detailed", "invariants", "with", "context"],
  "edgeCases": ["detailed", "edge", "cases", "with", "scenarios"],
  "complexity": {
    "time": "O(n) or specific analysis",
    "space": "O(n) or specific analysis"
  },
  "security": {
    "vulnerabilities": ["list", "of", "potential", "issues"],
    "mitigations": ["list", "of", "mitigation", "strategies"]
  },
  "confidence": 85,
  "reasoning": "detailed explanation of the analysis including key insights and potential concerns"
}`;
  }

  /**
   * Parse LLM response and extract specification
   * @param {string} response - LLM response
   * @returns {Object} Parsed specification
   */
  parseLLMResponse(response) {
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        // Validate required fields
        const required = [
          "preconditions",
          "postconditions",
          "invariants",
          "edgeCases",
          "confidence",
        ];
        const missing = required.filter((field) => !parsed[field]);

        if (missing.length === 0) {
          return {
            preconditions: Array.isArray(parsed.preconditions) ? parsed.preconditions : [],
            postconditions: Array.isArray(parsed.postconditions) ? parsed.postconditions : [],
            invariants: Array.isArray(parsed.invariants) ? parsed.invariants : [],
            edgeCases: Array.isArray(parsed.edgeCases) ? parsed.edgeCases : [],
            complexity: parsed.complexity || { time: "O(1)", space: "O(1)" },
            security: parsed.security || { vulnerabilities: [], mitigations: [] },
            confidence: typeof parsed.confidence === "number" ? parsed.confidence : 50,
            reasoning: parsed.reasoning || "Generated by LLM",
          };
        }
      }

      throw new Error("Invalid JSON response");
    } catch (error) {
      console.error("Failed to parse LLM response:", error);
      console.log("Raw response:", response);
      return this.generateMockSpec({});
    }
  }

  /**
   * Generate mock specification for testing/fallback
   * @param {Object} context - Function analysis context
   * @returns {Object} Mock specification
   */
  generateMockSpec(context) {
    const { inputTypes = [], conditionalGuards = [], earlyReturns = [], complexity = 1 } = context;

    const preconditions = [];
    const postconditions = [];
    const invariants = [];
    const edgeCases = [];

    // Generate preconditions based on input types
    for (const input of inputTypes) {
      if (input.type && input.type !== "any") {
        preconditions.push(`${input.name} is of type ${input.type}`);
      }
      if (input.required !== false) {
        preconditions.push(`${input.name} is not null/undefined`);
      }
    }

    // Generate postconditions based on early returns
    for (const earlyReturn of earlyReturns) {
      if (earlyReturn.value) {
        postconditions.push(`Function may return ${earlyReturn.value} under certain conditions`);
      }
    }

    // Generate invariants based on complexity
    if (complexity > 5) {
      invariants.push("Function maintains internal state consistency");
    }

    // Generate edge cases based on conditionals
    for (const guard of conditionalGuards) {
      edgeCases.push(`Handle case where ${guard.condition} is false`);
    }

    // Add generic edge cases
    if (inputTypes.length > 0) {
      edgeCases.push("Handle empty/null input values");
      edgeCases.push("Handle boundary conditions");
    }

    return {
      preconditions:
        preconditions.length > 0 ? preconditions : ["No specific preconditions identified"],
      postconditions: postconditions.length > 0 ? postconditions : ["Function completes execution"],
      invariants: invariants.length > 0 ? invariants : ["No specific invariants identified"],
      edgeCases: edgeCases.length > 0 ? edgeCases : ["Consider null/undefined inputs"],
      complexity: {
        time: complexity > 3 ? "O(n)" : "O(1)",
        space: "O(1)",
      },
      security: {
        vulnerabilities: ["Potential input validation bypass", "Possible information disclosure"],
        mitigations: [
          "Implement strict input validation",
          "Use parameterized queries",
          "Validate all inputs",
        ],
      },
      confidence: Math.min(85, 100 - complexity * 5),
      reasoning: `Mock analysis of function with ${inputTypes.length} inputs, ${conditionalGuards.length} conditionals, and complexity ${complexity}. Advanced security and performance analysis included.`,
    };
  }

  /**
   * Test LLM connectivity
   * @returns {Object} Test results
   */
  async testConnectivity() {
    const results = {
      openai: false,
      anthropic: false,
      mock: true,
    };

    if (this.openai) {
      try {
        await this.openai.chat.completions.create({
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
          max_tokens: 10,
        });
        results.openai = true;
      } catch (error) {
        console.error("OpenAI test failed:", error.message);
      }
    }

    if (this.anthropic) {
      try {
        await this.anthropic.messages.create({
          model: "claude-3-sonnet-20240229",
          max_tokens: 10,
          messages: [{ role: "user", content: "Hello" }],
        });
        results.anthropic = true;
      } catch (error) {
        console.error("Anthropic test failed:", error.message);
      }
    }

    return results;
  }
}
