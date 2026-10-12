import { defineConfig, loadEnv } from "vite";
import path from "path";

export default defineConfig(({ mode }) => ({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: loadEnv("test", process.cwd(), ""),
    fileParallelism: false,
    testTimeout: 30000,
  },
}));
