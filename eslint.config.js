import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  /**
   * O JS do worker e o de `shared/`.
   *
   * **Não eram cobertos por bloco nenhum**, e em flat config arquivo sem bloco é simplesmente
   * ignorado: `npx eslint apps/ad-spy-worker/index.js` saía com zero problema por não ter nada a
   * checar. Foi assim que um `alvoValido is not defined` chegou em produção — `node --check` vê
   * sintaxe, não identificador indefinido, e o lint que deveria ver não estava olhando.
   *
   * `no-undef` é a regra que importa aqui. O resto do `recommended` vem junto porque já estava
   * configurado para os .ts e não custa nada.
   */
  {
    extends: [js.configs.recommended],
    // Escopo deliberadamente estreito: o worker e o `shared/`. O `openclaw-bridge` tem JS que
    // acusaria erro novo, e mudar o resultado de lint de outra aplicação sem pedido não é meu.
    files: ["apps/ad-spy-worker/**/*.js", "shared/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, fetch: "readonly" },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // O BOM UTF-8 dentro de template literal é intencional nos exports de CSV (é ele que faz o
      // Excel abrir o arquivo com acento certo). Sem `skipTemplates` a regra o trata como espaço
      // irregular e vira erro — e seria erro em cima de um byte que está ali de propósito.
      "no-irregular-whitespace": ["error", { skipTemplates: true, skipStrings: true }],
    },
  },
);
