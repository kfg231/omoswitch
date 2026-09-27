import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig as defineVitestConfig } from "vitest/config";

export default defineVitestConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 1420, strictPort: true },
  test: { environment: "jsdom", globals: true },
});
