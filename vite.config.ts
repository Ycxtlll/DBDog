import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 2000,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    host: "127.0.0.1",
  },
}));
