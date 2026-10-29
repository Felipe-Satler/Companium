import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Valores de MENTIRA para o cliente do Supabase: desde 25/10/2026 ele se recusa a subir sem
    // URL e chave (a fonte é o arquivo central do servidor, injetado no build). Teste nenhum fala
    // com o Supabase de verdade — os que leem dados mockam o cliente —, então o domínio .invalid
    // garante que, se algum escapar, ele falha em vez de ir à rede.
    env: {
      VITE_SUPABASE_URL: "https://supabase-de-teste.invalid",
      VITE_SUPABASE_ANON_KEY: "chave-de-teste",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
