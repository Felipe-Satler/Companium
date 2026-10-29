import * as React from "react";
import { externalSupabase } from "@/integrations/external-supabase/client";
import { dedupedFetch, withRetry } from "./dataCache";
import { CAPTACAO_ILIKE, isCaptacaoClient } from "@/lib/captacao";

/**
 * Investimento REAL da captação (mídia própria da Groohub) por mês (AAAA-MM),
 * calculado direto do banco = soma de Meta Ads + Google Ads. Substitui o antigo
 * `investimento_real` MANUAL de `captacao_metas` na tela /captacao/meta.
 *
 * Fonte: view `v_meta_google_ads` (mesma dos hooks de Ads), restrita às contas
 * PRÓPRIAS da Groohub via prefixo `Groohub%` (CAPTACAO_ILIKE). Somamos TODAS as
 * linhas dessas contas independentemente de `Fonte_Ads` — a view só contém Meta
 * (Meta/Facebook) e Google, então o total já é "Meta Ads + Google Ads".
 *
 * Só o investimento real vem daqui; o resto dos indicadores da tela continua
 * manual (`captacao_metas`). Ver metaIndicadores/useCaptacaoMetas.
 */

// Só as colunas necessárias para somar por mês (payload mínimo).
const SELECT = "id, Dia, Client, Fonte_Ads, Valor_usado_BRL";

// PostgREST serializa `numeric` como string → coage antes de somar (senão vira
// concatenação e zera/polui o total). Mesmo `toNum` dos hooks de Ads.
const toNum = (v: unknown): number => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

type AdRow = { Dia?: string | null; Client?: string | null; Valor_usado_BRL?: unknown };

export function useCaptacaoInvestimentoReal(dateFrom?: string, dateTo?: string) {
  // Mapa AAAA-MM → investimento real (Meta + Google) do mês.
  const [porMes, setPorMes] = React.useState<Map<string, number>>(new Map());
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelado = false;

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const PAGE = 1000;
        const CONCURRENCY = 4;
        const MAX_ROWS = 100000;

        // Uma página das contas próprias da Groohub. withRetry cobre timeouts (57014).
        const fetchRange = (from: number) =>
          withRetry(async () => {
            // ORDER BY estável (Dia + id) é OBRIGATÓRIO com .range() p/ não pular/duplicar
            // linhas quando o resultado passa de 1000 (igual aos hooks de Ads).
            let q = externalSupabase
              .from("v_meta_google_ads")
              .select(SELECT)
              .ilike("Client", CAPTACAO_ILIKE)
              .order("Dia", { ascending: false })
              .order("id", { ascending: false })
              .range(from, from + PAGE - 1);
            if (dateFrom) q = q.gte("Dia", dateFrom);
            if (dateTo) q = q.lte("Dia", dateTo);
            const { data: rows, error: err } = await q;
            if (err) throw err;
            return (rows as AdRow[]) || [];
          });

        const key = `captacao-invest-real:${dateFrom || ""}:${dateTo || ""}`;
        const all: AdRow[] = await dedupedFetch(key, async () => {
          const acc: AdRow[] = [];
          for (let from = 0; from < MAX_ROWS; from += PAGE * CONCURRENCY) {
            const offsets: number[] = [];
            for (let i = 0; i < CONCURRENCY; i++) {
              const o = from + i * PAGE;
              if (o < MAX_ROWS) offsets.push(o);
            }
            const batches = await Promise.all(offsets.map(fetchRange));
            let stop = false;
            for (const b of batches) {
              acc.push(...b);
              if (b.length < PAGE) stop = true;
            }
            if (stop) break;
          }
          return acc;
        });

        // Agrega por mês (AAAA-MM). Reforço client-side isCaptacaoClient (mesmo que o
        // servidor já filtre por prefixo) para descartar qualquer conta de cliente.
        const mapa = new Map<string, number>();
        for (const r of all) {
          if (!isCaptacaoClient(r.Client)) continue;
          const mes = String(r.Dia ?? "").slice(0, 7);
          if (mes.length !== 7) continue;
          mapa.set(mes, (mapa.get(mes) ?? 0) + toNum(r.Valor_usado_BRL));
        }

        if (!cancelado) setPorMes(mapa);
      } catch (e) {
        if (!cancelado) {
          setError(e instanceof Error ? e.message : "Erro ao calcular investimento real.");
          setPorMes(new Map());
        }
      } finally {
        if (!cancelado) setLoading(false);
      }
    }

    fetchData();
    return () => {
      cancelado = true;
    };
  }, [dateFrom, dateTo]);

  return { porMes, loading, error };
}
