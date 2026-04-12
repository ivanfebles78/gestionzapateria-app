import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 8080,
  },
  preview: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 8080,
    allowedHosts: [
      "frontend-production-1df5.up.railway.app",
      ".up.railway.app",
      "localhost",
      "127.0.0.1",
    ],
  },
});