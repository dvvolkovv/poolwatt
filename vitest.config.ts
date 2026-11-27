import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Load .env and .env.local so DATABASE_URL (in .env.local) is available
  // to integration tests that hit the real dev DB.
  const env = loadEnv(mode, process.cwd(), "");
  Object.assign(process.env, env);

  return {
    test: {
      environment: "node",
      setupFiles: ["./src/test-setup.ts"],
      clearMocks: true,
      // Nothing in a test run may post real mail: the box's own keys are in
      // this environment. `email.test.ts` turns it off for itself.
      env: { MAIL_STUB: "1" },
      exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "tests/e2e/**"],
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
      },
    },
  };
});
