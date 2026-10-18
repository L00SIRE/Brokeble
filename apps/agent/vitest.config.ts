import { defineConfig } from "vitest/config";

// Unit tests must never touch a real database: DATABASE_URL points at TEST_DATABASE_URL when set
// (DB-gated tests check `process.env.TEST_DATABASE_URL`), else at a closed port so a stray query fails fast.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://unused@127.0.0.1:9/unused",
      MESSAGING_MODE: "mock",
      LLM_MODE: "mock",
      PLANNER_MODE: "mock",
      VENUE_MODE: "mock",
      LOG_LEVEL: "silent",
      CONSOLE_KEY: "test-console-key-not-a-secret",
    },
  },
});
