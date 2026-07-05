import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" — GitHub Pagesのサブパス（/dealscope/）配下でも動くように相対パスにする
export default defineConfig({
  plugins: [react()],
  base: "./",
});
