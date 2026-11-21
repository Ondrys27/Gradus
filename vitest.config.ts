import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    // The schema tests apply every migration to PGlite in beforeAll (about 9 s
    // alone, much more when all files run at once), and a few tests import or
    // scan much of the app: the defaults (10 s / 5 s) fail them on a busy machine.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
