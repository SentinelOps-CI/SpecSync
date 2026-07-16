// Test setup file
// This file runs before each test file

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

// Mock fs-extra to avoid file system operations in tests
jest.mock("fs-extra", () => ({
  access: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  ensureDir: jest.fn(),
  copy: jest.fn(),
  move: jest.fn(),
  remove: jest.fn(),
  pathExists: jest.fn().mockResolvedValue(false),
  readJson: jest.fn().mockResolvedValue({}),
  readdir: jest.fn().mockResolvedValue([]),
}));

// Mock simple-git to avoid git operations in tests
jest.mock("simple-git", () => {
  return jest.fn().mockImplementation(() => ({
    clone: jest.fn(),
    pull: jest.fn(),
    checkout: jest.fn(),
    log: jest.fn(),
    status: jest.fn(),
  }));
});

// Mock tree-sitter parsers to avoid native dependencies in tests
jest.mock("tree-sitter-javascript", () => ({}));
jest.mock("tree-sitter-typescript", () => ({}));
jest.mock("tree-sitter-python", () => ({}));
jest.mock("tree-sitter-java", () => ({}));
jest.mock("tree-sitter-rust", () => ({}));

// Global test utilities
global.createMockContext = () => ({
  octokit: {
    pulls: {
      get: jest.fn(),
      listFiles: jest.fn(),
    },
    repos: {
      getContent: jest.fn(),
    },
    issues: {
      createComment: jest.fn(),
    },
  },
  payload: {
    repository: {
      owner: { login: "test-owner" },
      name: "test-repo",
    },
    pull_request: {
      number: 1,
      head: { sha: "test-sha" },
    },
  },
});

global.createMockDiff = () => `
diff --git a/src/app.js b/src/app.js
index 1234567..abcdefg 100644
--- a/src/app.js
+++ b/src/app.js
@@ -10,6 +10,10 @@
+function calculateInterest(principal, rate, time) {
+  if (principal <= 0 || rate < 0 || time <= 0) {
+    throw new Error('Invalid parameters');
+  }
+  return principal * rate * time;
+}
`;

global.createMockChangedFiles = () => [
  {
    filename: "src/app.js",
    status: "modified",
    additions: 5,
    deletions: 0,
  },
];
