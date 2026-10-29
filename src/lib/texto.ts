/**
 * Comparação de texto para busca na interface: ignora acento e caixa, para "harmonizacao" achar
 * "Harmonização". Existe num lugar só porque já havia três cópias idênticas espalhadas.
 */
export const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
