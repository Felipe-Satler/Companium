import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

// Tema CLARO é o padrão do sistema (fundo #F4F6F7, sidebar branca, azul #1A73E9).
// A chave nova ("app-theme-v2") descarta a preferência antiga ("app-theme", quase sempre
// "dark") p/ que TODOS que logam comecem no tema claro; o modo escuro (mesma paleta azul,
// tons mais escuros) segue disponível pelo botão e passa a persistir sob a chave nova.
const THEME_STORAGE_KEY = "app-theme-v2";

const ThemeContext = createContext<ThemeContextType>({ theme: "light", toggleTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as Theme;
    return saved || "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
