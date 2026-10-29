import { useTheme } from "@/contexts/ThemeContext";
import { USAGE_SECTIONS } from "@/lib/usage/screens";

// Paleta categórica validada (contraste + daltonismo, pares adjacentes) em claro e escuro.
// A cor segue a ENTIDADE (seção / tela na ordem do registro), nunca a posição no gráfico,
// então filtrar não repinta o que sobrou. Máximo de 8: além disso, agrupa em "Demais".
const CAT_CLARO = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const CAT_ESCURO = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

/** Azul sequencial (heatmaps): opacidade sobre a superfície — perto de zero some no card. */
export const AZUL_SEQ = "42, 120, 214";

export const MAX_SERIES = 8;

export function useCoresUso() {
  const { theme } = useTheme();
  const cat = theme === "dark" ? CAT_ESCURO : CAT_CLARO;
  const idxSecao = new Map(USAGE_SECTIONS.map((s, i) => [s.key, i]));
  return {
    cat,
    corSecao: (key: string) => cat[(idxSecao.get(key) ?? MAX_SERIES - 1) % MAX_SERIES],
    corSlot: (i: number) => cat[Math.min(i, MAX_SERIES - 1)],
  };
}

export const EIXO = {
  tick: { fill: "hsl(var(--muted-foreground))", fontSize: 11 },
  grade: "hsl(var(--border))",
};
