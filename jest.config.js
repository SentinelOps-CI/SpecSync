/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.jest.json",
      },
    ],
  },
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  // Critical-path coverage. Exclude demo/CLI and unused Phase 4 leftovers not imported by index.
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/demo.ts",
    "!src/ui-demo.ts",
    "!src/ci-integration.ts",
    "!src/spec-coverage.ts",
  ],
  coveragePathIgnorePatterns: ["/node_modules/", "/dist/"],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },
  setupFilesAfterEnv: ["<rootDir>/test/setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testTimeout: 10000,
  verbose: true,
  clearMocks: true,
  restoreMocks: true,
};
