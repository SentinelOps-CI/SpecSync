export {};

declare global {
  var createMockContext: () => unknown;
  var createMockDiff: () => string;
  var createMockChangedFiles: () => unknown[];
}
