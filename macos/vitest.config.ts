import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["macos/tests/**/*.test.{ts,tsx}"],
    environment: "./macos/tests/dom.ts",
  },
});
