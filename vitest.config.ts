import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      obsidian: path.resolve(__dirname, "src/tests/setup/obsidian.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
