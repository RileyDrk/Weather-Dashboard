import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on all interfaces so phones on the same Wi‑Fi can hit http://YOUR_PC_IP:5173
    host: true,
  },
});
