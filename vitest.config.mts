import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const DB_TESTS = ["src/services/__tests__/**/*.test.ts", "tests/db/**/*.test.ts"];

export default defineConfig({
  resolve: {
    alias: {
      "@tests": fileURLToPath(new URL("./tests", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["src/**/*.test.ts", "tests/**/*.test.ts"], exclude: [...DB_TESTS, "**/node_modules/**"] },
      },
      {
        extends: true,
        // each worker has its own cloned database, so files run in parallel (fileParallelism stays on)
        test: {
          name: "db",
          include: DB_TESTS,
          globalSetup: ["tests/global-setup.ts"],
          setupFiles: ["tests/setup-db.ts"],
          testTimeout: 15_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
