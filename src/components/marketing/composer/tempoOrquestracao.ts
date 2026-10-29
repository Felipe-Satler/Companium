import { useEffect, useState } from "react";

// O tempo de uma orquestração, para o trilho e para a página. Fora do arquivo do componente porque
// são função e hook, não componente — e o fast refresh só funciona em arquivo que exporta só isso.

/** "42 s", "3 min 05 s", "1 h 12 min". Nulo quando não dá para calcular. */
export function duracao(ms: number | null) {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

/** O relógio da tela: só bate enquanto há algo rodando. */
export function useAgora(ativo: boolean) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ativo]);
  return agora;
}
