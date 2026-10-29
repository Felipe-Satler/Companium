import { useState, useEffect, useMemo, useCallback } from "react";
import { externalSupabase } from "@/integrations/external-supabase/client";
import {
  CRMOverrideMetric,
  OverrideScope,
  buildMonthlyFilterSig,
} from "@/utils/crmOverrides";

// Correções manuais dos números do CRM aplicadas à EVOLUÇÃO MENSAL (gráficos).
//
// Para cada mês exibido nos gráficos montamos a MESMA assinatura de filtro que os cards
// de totais gerariam se o usuário tivesse filtrado exatamente aquele mês (ver
// `buildMonthlyFilterSig`). Buscamos todas essas assinaturas de uma vez em
// `crm_metric_overrides` e expomos `getMonth(mês, métrica)` → valor corrigido ou undefined.
//
// Assim as barras acompanham a correção feita nos cards, e REMOVER a correção (a chave
// some do banco) faz a barra voltar sozinha ao valor calculado — sem tratamento especial.
//
// Leitura liberada p/ authenticated (mesma RLS de useCRMOverrides); usuário-cliente só
// enxerga o override do próprio cliente. Falha de carga → mapa vazio (gráficos no
// calculado, sem quebrar).
export interface CRMMonthlyOverridesCtx {
  getMonth: (month: string, metric: CRMOverrideMetric) => number | undefined;
  loading: boolean;
}

export function useCRMMonthlyOverrides(
  monthKeys: string[], // "AAAA-MM" presentes na evolução
  scope: Omit<OverrideScope, "from" | "to">,
  from?: string, // yyyy-MM-dd (range do filtro atual)
  to?: string,
): CRMMonthlyOverridesCtx {
  const [map, setMap] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(true);

  // Assinatura por mês (herda cliente/médico/origem + recorta o mês ao range do filtro).
  const scopeSig = `${scope.client ?? ""}|${JSON.stringify(scope.medico ?? "")}|${JSON.stringify(scope.origem ?? "")}|${scope.procedimento ?? ""}`;
  const monthSigs = useMemo(() => {
    const out: Record<string, string> = {};
    for (const mk of monthKeys) {
      const sig = buildMonthlyFilterSig(mk, scope, from, to);
      if (sig) out[mk] = sig;
    }
    return out;
    // scopeSig/from/to/monthKeys cobrem todas as entradas de buildMonthlyFilterSig.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKeys.join(","), scopeSig, from, to]);

  // Chave estável do conjunto de assinaturas p/ deps do effect (ordem não importa).
  const sigsKey = useMemo(
    () => [...new Set(Object.values(monthSigs))].sort().join("§"),
    [monthSigs]
  );

  useEffect(() => {
    const sigs = [...new Set(Object.values(monthSigs))];
    if (sigs.length === 0) {
      setMap({});
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await externalSupabase
        .from("crm_metric_overrides")
        .select("filter_sig,metric,value")
        .in("filter_sig", sigs);
      if (cancelled) return;
      if (!error && data) {
        const bySig: Record<string, Record<string, number>> = {};
        for (const r of data as { filter_sig: string; metric: string; value: number | string }[]) {
          const n = Number(r.value); // PostgREST devolve numeric como string.
          if (!Number.isFinite(n)) continue;
          (bySig[r.filter_sig] ??= {})[r.metric] = n;
        }
        setMap(bySig);
      } else if (error) {
        console.warn("[useCRMMonthlyOverrides] não foi possível carregar correções:", error.message);
        setMap({});
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigsKey]);

  const getMonth = useCallback(
    (month: string, metric: CRMOverrideMetric): number | undefined => {
      const sig = monthSigs[month];
      if (!sig) return undefined;
      const v = map[sig]?.[metric];
      return v != null && Number.isFinite(v) ? v : undefined;
    },
    [monthSigs, map]
  );

  return { getMonth, loading };
}
