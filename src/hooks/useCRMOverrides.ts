import { useState, useEffect, useCallback, useMemo } from "react";
import { externalSupabase } from "@/integrations/external-supabase/client";
import {
  CRMOverrideMetric,
  OverrideColumns,
  OverrideMetricValues,
  OVERRIDE_ALL_CLIENTS,
  sumProcOverridesByBase,
} from "@/utils/crmOverrides";

// Correções manuais dos números do CRM, persistidas em `crm_metric_overrides`
// (projeto companium-db), keyed por `filter_sig` (o filtro inteiro do view) × métrica.
//
// Leitura: liberada p/ authenticated — todo mundo VÊ o número corrigido (inclusive quem
// não pode editar). Usuário-cliente só enxerga o override do PRÓPRIO cliente (RLS
// RESTRICTIVE no banco). Escrita: só admin/crm_editor (has_crm_access) — a UI ainda esconde
// os controles p/ os demais, mas a trava REAL é a RLS.
//
// Falha de carga (tabela ausente / RLS / offline) → mapa vazio: os cards caem no valor
// CALCULADO, sem quebrar a tela.

// Recorte de UMA origem que compõe uma seleção de ≥2 origens: a assinatura daquela origem
// isolada + a contribuição CALCULADA (do banco) das 9 métricas p/ essa origem. Ver
// `componentValue`: o combinado soma, por origem, a correção OU o calculado — igual ao banco.
export interface OverrideComponent {
  sig: string;
  calc: OverrideMetricValues;
}

export interface CRMOverridesCtx {
  /**
   * Valor da métrica para o filtro atual — SE houver correção manual em jogo; senão undefined
   * (os cards caem no calculado). Regra "igual ao banco":
   *   1) correção própria deste recorte exato (o número foi digitado para exatamente este
   *      filtro), OU
   *   2) com ≥2 origens filtradas: a SOMA por origem, onde cada origem entra com a SUA
   *      correção (se tiver) ou com a SUA contribuição do banco — mas só quando ao menos uma
   *      origem tem correção (senão o total já é o calculado, e devolvemos undefined p/ não
   *      recomputar nada à toa).
   */
  get: (metric: CRMOverrideMetric) => number | undefined;
  has: (metric: CRMOverrideMetric) => boolean;
  /** Há correção gravada exatamente neste recorte (não a soma derivada por origem)? */
  hasExact: (metric: CRMOverrideMetric) => boolean;
  /**
   * Correção de UM sub-recorte (assinatura de origem/mês isolada) — correção direta dele OU
   * a soma das correções por procedimento dele (quando o calculado é 0). undefined se não há.
   * Usada p/ o breakdown por origem (Meta Ads/Google Ads) refletir a correção da origem
   * filtrada, mesmo quando o view atual não está recortado por aquela origem.
   */
  component: (sig: string, metric: CRMOverrideMetric, calc?: number) => number | undefined;
  save: (metric: CRMOverrideMetric, value: number) => Promise<void>;
  clear: (metric: CRMOverrideMetric) => Promise<void>;
  saving: boolean;
  loading: boolean;
}

export function useCRMOverrides(
  filterSig: string,
  columns: OverrideColumns,
  // Recortes por origem (só quando ≥2 origens filtradas) — cada um com a assinatura da origem
  // isolada e a contribuição calculada dela. Vazio quando 0/1 origem (sem decomposição).
  components: OverrideComponent[] = [],
  // Valores CALCULADOS do banco p/ o recorte ATUAL (totalsBase). Usado como "trava de
  // cálculo" do rollup por procedimento: a soma das correções por procedimento só PREENCHE
  // uma métrica cujo calculado é 0 (cliente sem dado real, ex.: Pablo Fonseca) — assim um
  // cliente COM pipeline real (ex.: Diego Rezende) nunca é subcontado pelo rollup.
  selfCalc: OverrideMetricValues = {}
): CRMOverridesCtx {
  const [map, setMap] = useState<Record<string, number>>({});
  // Correções por assinatura-componente: { filterSig da origem → { métrica → valor } }.
  const [compMaps, setCompMaps] = useState<Record<string, Record<string, number>>>({});
  // Soma das correções POR PROCEDIMENTO agrupada pela assinatura-pai (recorte sem
  // procedimento): { baseSig → { métrica → soma } }. Alimenta o total do view sem
  // procedimento filtrado. Ver sumProcOverridesByBase.
  const [procByBase, setProcByBase] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Chave estável das assinaturas-componente p/ deps do effect (ordem não importa).
  const componentSigs = useMemo(() => components.map((c) => c.sig), [components]);
  const compKey = useMemo(() => [...componentSigs].sort().join("§"), [componentSigs]);

  // Cliente do recorte atual (1º segmento da assinatura). O rollup por procedimento só faz
  // sentido p/ um cliente único (as correções por procedimento são gravadas só p/ Diego/Pablo
  // com 1 procedimento filtrado); no agregado (__ALL__) não há o que puxar.
  const clientKey = useMemo(() => filterSig.split("|")[0] ?? "", [filterSig]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      // filterSig (recorte atual) + componentSigs (por origem). Set p/ não repetir chaves.
      const allSigs = [...new Set([filterSig, ...componentSigs])];
      // Correções POR PROCEDIMENTO do cliente: todas as assinaturas que começam pelo cliente
      // (o filtro "|proc:" fica client-side em sumProcOverridesByBase). O "_" do clientKey é
      // curinga no LIKE do Postgres, então o padrão pode voltar um superconjunto — por isso
      // refinamos pelo prefixo EXATO aqui. Pulado no agregado (sem procedimento no __ALL__).
      const procQuery =
        clientKey && clientKey !== OVERRIDE_ALL_CLIENTS
          ? externalSupabase
              .from("crm_metric_overrides")
              .select("filter_sig,metric,value")
              .like("filter_sig", `${clientKey}|%`)
          : null;

      const [exactRes, procRes] = await Promise.all([
        externalSupabase
          .from("crm_metric_overrides")
          .select("filter_sig,metric,value")
          .in("filter_sig", allSigs),
        procQuery ?? Promise.resolve({ data: [], error: null }),
      ]);
      if (cancelled) return;
      const { data, error } = exactRes;
      if (!error && data) {
        const exact: Record<string, number> = {};
        const comps: Record<string, Record<string, number>> = {};
        for (const r of data as { filter_sig: string; metric: string; value: number | string }[]) {
          const n = Number(r.value); // PostgREST devolve numeric como string.
          if (!Number.isFinite(n)) continue;
          if (r.filter_sig === filterSig) {
            exact[r.metric] = n;
          } else {
            (comps[r.filter_sig] ??= {})[r.metric] = n;
          }
        }
        setMap(exact);
        setCompMaps(comps);
      } else if (error) {
        console.warn("[useCRMOverrides] não foi possível carregar correções:", error.message);
        setMap({});
        setCompMaps({});
      }
      // Rollup por procedimento: agrupa a soma das correções "|proc:" pela assinatura-pai.
      const procRows = ((procRes.data ?? []) as { filter_sig: string; metric: string; value: number | string }[]).filter(
        (r) => r.filter_sig.startsWith(`${clientKey}|`)
      );
      if (!procRes.error) setProcByBase(sumProcOverridesByBase(procRows));
      else setProcByBase({});
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSig, compKey, clientKey]);

  // Soma das correções POR PROCEDIMENTO lançadas sob o recorte `base`, quando o view NÃO
  // filtra procedimento. Só PREENCHE quando o calculado da métrica é 0 (cliente sem dado
  // real) — assim nunca sub-conta um recorte que já tem pipeline calculado > 0. undefined =
  // não há correção por procedimento aplicável (o caller usa o calculado/override direto).
  const procSumFor = useCallback(
    (base: string, metric: CRMOverrideMetric, calc?: number): number | undefined => {
      const s = procByBase[base]?.[metric];
      if (s == null || !Number.isFinite(s)) return undefined;
      if (calc != null && Number.isFinite(calc) && calc > 0) return undefined; // não mascara dado real
      return s;
    },
    [procByBase]
  );

  // Contribuição de UM sub-recorte (origem/mês) ao total combinado: correção direta dele →
  // soma das correções por procedimento dele (se calculado 0) → undefined (usa o calculado).
  const cellOverride = useCallback(
    (sig: string, metric: CRMOverrideMetric, calc?: number): number | undefined => {
      const direct = compMaps[sig]?.[metric];
      if (direct != null && Number.isFinite(direct)) return direct;
      return procSumFor(sig, metric, calc);
    },
    [compMaps, procSumFor]
  );

  // Recorte de ≥2 origens/meses: soma, por sub-recorte, a correção manual (direta OU a soma
  // por procedimento dele) OU (na falta dela) a contribuição calculada do banco — assim o
  // combinado casa com o que o banco somaria. Só devolve valor quando ALGUM sub-recorte tem
  // correção; sem nenhuma o total já é o calculado, então devolvemos undefined.
  const componentValue = useCallback(
    (metric: CRMOverrideMetric): number | undefined => {
      if (components.length < 2) return undefined;
      let any = false;
      let sum = 0;
      for (const c of components) {
        const ov = cellOverride(c.sig, metric, c.calc[metric]);
        if (ov != null && Number.isFinite(ov)) {
          any = true;
          sum += ov;
        } else {
          const cv = c.calc[metric];
          if (cv != null && Number.isFinite(cv)) sum += cv;
        }
      }
      return any ? sum : undefined;
    },
    [components, cellOverride]
  );

  const get = useCallback(
    (metric: CRMOverrideMetric) => {
      // 1) correção própria do recorte atual (vence sempre) →
      // 2) soma das correções por PROCEDIMENTO deste recorte (quando o calculado é 0) →
      // 3) soma por origem/mês (correção direta/por-procedimento OU calculado de cada).
      if (map[metric] != null) return map[metric];
      const selfProc = procSumFor(filterSig, metric, selfCalc[metric]);
      if (selfProc != null) return selfProc;
      return componentValue(metric);
    },
    [map, procSumFor, filterSig, selfCalc, componentValue]
  );
  const has = useCallback((metric: CRMOverrideMetric) => get(metric) != null, [get]);
  const hasExact = useCallback((metric: CRMOverrideMetric) => map[metric] != null, [map]);

  const save = useCallback(
    async (metric: CRMOverrideMetric, value: number) => {
      if (!Number.isFinite(value)) return;
      const prev = map;
      setMap((p) => ({ ...p, [metric]: value })); // otimista
      setSaving(true);
      try {
        const { error } = await externalSupabase.from("crm_metric_overrides").upsert(
          { filter_sig: filterSig, metric, value, ...columns, updated_at: new Date().toISOString() },
          { onConflict: "filter_sig,metric" }
        );
        if (error) throw error;
      } catch (e) {
        setMap(prev); // reverte
        console.error("[useCRMOverrides] falha ao salvar correção:", e);
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [map, filterSig, columns]
  );

  const clear = useCallback(
    async (metric: CRMOverrideMetric) => {
      const prev = map;
      setMap((p) => {
        const n = { ...p };
        delete n[metric];
        return n;
      });
      setSaving(true);
      try {
        const { error } = await externalSupabase
          .from("crm_metric_overrides")
          .delete()
          .eq("filter_sig", filterSig)
          .eq("metric", metric);
        if (error) throw error;
      } catch (e) {
        setMap(prev); // reverte
        console.error("[useCRMOverrides] falha ao remover correção:", e);
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [map, filterSig]
  );

  return { get, has, hasExact, component: cellOverride, save, clear, saving, loading };
}
