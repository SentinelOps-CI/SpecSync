import { normalizeConfidence } from "../src/types";

describe("normalizeConfidence", () => {
  it("keeps values already in [0, 1]", () => {
    expect(normalizeConfidence(0.85)).toBe(0.85);
    expect(normalizeConfidence(0)).toBe(0);
    expect(normalizeConfidence(1)).toBe(1);
  });

  it("scales 0–100 percentages into [0, 1]", () => {
    expect(normalizeConfidence(85)).toBe(0.85);
    expect(normalizeConfidence(100)).toBe(1);
  });

  it("clamps out-of-range values", () => {
    expect(normalizeConfidence(-0.5)).toBe(0);
    expect(normalizeConfidence(150)).toBe(1);
  });

  it("uses fallback for non-numbers", () => {
    expect(normalizeConfidence(undefined)).toBe(0.5);
    expect(normalizeConfidence("high", 0.3)).toBe(0.3);
  });
});
