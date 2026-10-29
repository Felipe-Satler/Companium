import { useCallback, useState } from "react";
import { startOfMonth } from "date-fns";

/**
 * Filtro de DATA compartilhado entre as três telas da aba Captação
 * (Metas, Meta Ads e Google Ads). O período escolhido é persistido em
 * localStorage: mudar em uma tela reflete nas outras (lido a cada montagem,
 * já que só uma rota fica montada por vez) e sobrevive à troca de página/aba
 * e a reloads. Enquanto o usuário não escolhe nada, cada tela usa o padrão
 * (mês corrente → hoje) sem gravar — só as datas ESCOLHIDAS persistem.
 */
const STORAGE_KEY = "companium.captacao.dateRange";

type StoredRange = { from: string | null; to: string | null };

function parseDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function loadInitial(): { from: Date | undefined; to: Date | undefined } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      // Se a chave existe, respeita o valor salvo — inclusive `null`
      // (filtro limpo pelo usuário na tela de Metas).
      const parsed = JSON.parse(raw) as StoredRange;
      return { from: parseDate(parsed.from), to: parseDate(parsed.to) };
    }
  } catch {
    /* JSON corrompido / storage indisponível — cai no padrão */
  }
  return { from: startOfMonth(new Date()), to: new Date() };
}

export function useCaptacaoDateRange() {
  const [range, setRangeState] = useState(loadInitial);

  const setRange = useCallback((from: Date | undefined, to: Date | undefined) => {
    setRangeState({ from, to });
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          from: from ? from.toISOString() : null,
          to: to ? to.toISOString() : null,
        } satisfies StoredRange),
      );
    } catch {
      /* quota / storage desabilitado */
    }
  }, []);

  return { dateFrom: range.from, dateTo: range.to, setRange };
}
