import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const codexPort = Number(env.LANTERNWOOD_CODEX_PORT ?? 8787);

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": `http://127.0.0.1:${codexPort}`,
      },
    },
  };
});
