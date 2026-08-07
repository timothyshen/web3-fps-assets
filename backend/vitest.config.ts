import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Boots anvil + deploys contracts + starts the backend, then provides
    // endpoints/addresses to the tests (see test/globalSetup.ts).
    globalSetup: ["./test/globalSetup.ts"],
    testTimeout: 40_000,
    hookTimeout: 180_000,
    // Integration tests share one chain + one backend; keep files serial.
    fileParallelism: false,
  },
});
