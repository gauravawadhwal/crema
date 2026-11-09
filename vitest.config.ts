import { defineConfig } from "vitest/config";

// Nested agent worktrees are separate checkouts, not this checkout's tests.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
