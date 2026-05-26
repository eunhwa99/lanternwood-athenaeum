import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const agentsPort = Number(env.LANTERNWOOD_AGENTS_PORT ?? 8787);

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": `http://127.0.0.1:${agentsPort}`,
      },
    },
  };
});
