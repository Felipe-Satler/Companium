import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { openClawDevStub } from "./openclaw-dev-stub";
import { adSpyDevStub } from "./ad-spy-dev-stub";

export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), openClawDevStub(), adSpyDevStub()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    target: "es2020",
    cssCodeSplit: true,
    sourcemap: false,
    // Vite preloada todos os chunks da árvore por padrão — recharts (446KB) ia
    // pesar no 1º paint mesmo só sendo usado em rotas internas. Excluímos
    // chunks pesados/condicionais: o navegador busca quando o lazy import dispara.
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter((d) => !/\/(charts|dates|forms)-[A-Za-z0-9_-]+\.js$/.test(d)),
    },
    rollupOptions: {
      // Duas páginas: o app e a de RENDER das artes estáticas (render.html), que o ad-spy-worker abre
      // num Chrome sem tela. A de render carrega só os templates — nem o app, nem o login.
      input: {
        main: path.resolve(__dirname, "index.html"),
        render: path.resolve(__dirname, "render.html"),
      },
      output: {
        // Vendor chunks: cache do browser segura libs grandes entre deploys,
        // e o bundle inicial não precisa parsear recharts/radix antes do 1º render.
        manualChunks: {
          "react-core": ["react", "react-dom", "react/jsx-runtime", "react-router-dom"],
          "query": ["@tanstack/react-query", "@tanstack/query-core"],
          "supabase": ["@supabase/supabase-js"],
          "charts": ["recharts"],
          "icons": ["lucide-react"],
          "dates": ["date-fns", "react-day-picker"],
          "forms": ["react-hook-form", "@hookform/resolvers", "zod"],
          "ui-radix": [
            "@radix-ui/react-accordion",
            "@radix-ui/react-alert-dialog",
            "@radix-ui/react-aspect-ratio",
            "@radix-ui/react-avatar",
            "@radix-ui/react-checkbox",
            "@radix-ui/react-collapsible",
            "@radix-ui/react-context-menu",
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-hover-card",
            "@radix-ui/react-label",
            "@radix-ui/react-menubar",
            "@radix-ui/react-navigation-menu",
            "@radix-ui/react-popover",
            "@radix-ui/react-progress",
            "@radix-ui/react-radio-group",
            "@radix-ui/react-scroll-area",
            "@radix-ui/react-select",
            "@radix-ui/react-separator",
            "@radix-ui/react-slider",
            "@radix-ui/react-slot",
            "@radix-ui/react-switch",
            "@radix-ui/react-tabs",
            "@radix-ui/react-toast",
            "@radix-ui/react-toggle",
            "@radix-ui/react-toggle-group",
            "@radix-ui/react-tooltip",
          ],
        },
      },
    },
  },
}));
