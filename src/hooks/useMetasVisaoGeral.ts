import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { MetaKey, useClientesMetas } from "@/hooks/useClientesMetas";
import { useClientesData } from "@/hooks/useClientesData";
import { useCRMClienteData } from "@/hooks/useCRMClienteData";
import { useFaturamentoConfig } from "@/hooks/useFaturamentoConfig";
import { externalSupabase } from "@/integrations/external-supabase/client";
import { CRMClientRow, FatBasis } from "@/utils/crmCalculations";
import {
  CRM_OVERRIDE_METRICS,
  isCurrencyMetric,
  OVERRIDE_TOTALS_FIELD,
  periodSignature,
  type OverrideMetricValues,
} from "@/utils/crmOverrides";
import {
  canonicalizeAdsClient,
  clientMatchKey,
  adsMedicoForClient,
  foldMergedAdsClient,
  isExcludedClient,
} from "@/data/clienteAliases";
import { MaturidadeId, clienteVisivel, faixaMaturidade, resolveProjeto } from "@/data/squads";
import { useProjetosLista } from "@/hooks/useProjetosLista";
import { incluirInativosLigado } from "@/data/clientesVisiveisStore";
import { useClientesVisiveis } from "@/hooks/useClientesVisiveis";
import { MetaClientRow, buildCells, compareClientRows } from "@/utils/metasStatus";

/**
 * Junta, para CADA cliente, o real do período (pipeline do CRM) com o planejado do período
 * (clientes_meta, já rateado por dias em useClientesMetas) e devolve as linhas prontas para
 * a tabela e para os dois gráficos da tela "Metas".
 *
 * O real vem do MESMO caminho da tela de CRM — useClientesData (Ads canonicalizados) +
 * useCRMClienteData sem filtro de cliente, cujo `clientTable` já traz um registro por
 * cliente. Reaproveitar isso é o que garante que um número aqui bata com o número que o
 * gestor vê ao abrir o CRM daquele cliente.
 *
 * Universo de clientes = a MESMA lista canônica das telas de CRM/Meta Ads/Google Ads, menos
 * os que a planilha de projetos marca como INATIVO. Não é filtrado pelo período: um cliente
 * ativo e parado no mês precisa aparecer como "fora da meta", não sumir da tela.
 */
/** Filtros da tela que não são o período. Vazio = sem restrição. */
export interface MetasFiltros {
  squads: string[];
  /** Origem do lead (mesma lista e mesmo efeito da tela de CRM). */
  origens: string[];
  /** "com" / "sem" CRM, conforme a planilha de projetos. */
  crm: string[];
  maturidades: MaturidadeId[];
}

// Overlay das correções manuais (crm_metric_overrides) sobre a linha calculada de UM cliente.
// Espelha applyTotalsOverrides, mas opera sobre CRMClientRow (o "real" que a tela de Metas lê).
// É o que faz um cliente SEM CRM (Kommo vazio → tudo 0) exibir aqui o mesmo número fixado à mão
// na tela de CRM, em vez de zero. Sem correção p/ o recorte → devolve a linha intacta.
function applyRowOverrides(row: CRMClientRow, ov: OverrideMetricValues, basis: FatBasis): CRMClientRow {
  let out = row;
  let currencyTouched = false;
  for (const metric of CRM_OVERRIDE_METRICS) {
    const v = ov[metric];
    if (v != null && Number.isFinite(v)) {
      if (out === row) out = { ...row };
      // OVERRIDE_TOTALS_FIELD mapeia p/ campos que CRMTotals e CRMClientRow compartilham por nome.
      (out as unknown as Record<string, number>)[OVERRIDE_TOTALS_FIELD[metric]] = v;
      if (isCurrencyMetric(metric)) currencyTouched = true;
    }
  }
  // Correção de VALOR (R$) recomputa Faturamento/ROAS pela base do cliente — igual ao CRM.
  if (currencyTouched && out !== row) {
    const c = basis.consulta === "agendadas" ? out.valorConsultasAgendadas : out.valorConsultasRealizadas;
    const p = basis.procedimento === "agendados" ? out.valorProcedimentosAgendados : out.valorProcedimentosRealizados;
    out.faturamentoBrutoRealizados = c + p;
    out.roas = out.investimento > 0 ? out.faturamentoBrutoRealizados / out.investimento : 0;
  }
  return out;
}

// Linha zerada p/ um cliente sem NENHUM movimento no período (nem Ads nem Kommo): base sobre a
// qual as correções manuais são coladas, para o cliente sem CRM aparecer com o número fixado.
function zeroRow(client: string): CRMClientRow {
  return {
    client,
    especialidade: "",
    investimento: 0,
    leadsTrafego: 0,
    leadsTrafegoMeta: 0,
    leadsTrafegoGoogle: 0,
    leadsCRM: 0,
    consultasAgendadas: 0,
    cacGeral: 0,
    valorConsultasAgendadas: 0,
    consultasRealizadas: 0,
    valorConsultasRealizadas: 0,
    procedimentosAgendados: 0,
    valorProcedimentosAgendados: 0,
    procedimentosRealizados: 0,
    valorProcedimentosRealizados: 0,
    faturamentoBrutoRealizados: 0,
    roas: 0,
  };
}

// Uma fatia gravada em crm_metric_overrides p/ um cliente: a origem normalizada do recorte
// (ex.: "meta ads", "instagram,meta ads" ou "" p/ "todas as origens") + os valores por métrica.
interface OverrideSlice {
  origem: string;
  medico: string;
  metrics: Record<string, number>;
}

// Dentre fatias COMBINADAS (≥2 origens), o valor da métrica na fatia mais abrangente (desempate
// determinístico pela string). Fallback p/ quem só corrigiu com várias origens juntas.
function pickCombined(combined: OverrideSlice[], metric: string): number | undefined {
  const comb = combined.filter((s) => s.metrics[metric] != null);
  if (comb.length === 0) return undefined;
  const pick = comb.reduce((best, s) => {
    const nb = best.origem.split(",").length;
    const ns = s.origem.split(",").length;
    return ns > nb || (ns === nb && s.origem > best.origem) ? s : best;
  });
  return pick.metrics[metric];
}

// Reconstrói o "real" corrigido de um cliente a partir das fatias gravadas no CRM (o número é
// gravado POR ORIGEM filtrada, então não existe uma linha "sem origem" para casar direto). Em
// ambos os caminhos a regra por métrica é a MESMA (espelha o get() do CRM): correção exata do
// recorte → SOMA das fatias de origem única aplicáveis → fatia combinada mais abrangente. Fatias
// combinadas nunca entram na soma das únicas (evita dupla contagem de recortes sobrepostos).
//
//   • COM filtro de origem  → "aplicável" = a origem única está DENTRO da seleção; a soma dá o
//     total do cliente naquelas origens (ex.: IG+Google+Meta traz a fatia "meta ads" da Amanda),
//     igual a como o CRM soma por origem selecionada. A fatia combinada precisa ser subconjunto
//     da seleção. Sem isso, um cliente de entrada manual só aparecia com origem exata/sem filtro.
//   • SEM filtro de origem  → "aplicável" = qualquer origem única; a correção "sem origem" (recorte
//     gravado p/ todas as origens) tem prioridade quando existe.
function resolveOverride(slices: OverrideSlice[] | undefined, filtrosOrigens: string[]): OverrideMetricValues | undefined {
  if (!slices || slices.length === 0) return undefined;
  // Só recortes SEM médico — o card do cliente (e, portanto, a correção) é gravado com médico
  // vazio; recortes por médico pertencem a outra visão e não somam no total do cliente.
  const noMed = slices.filter((s) => s.medico === "");
  if (noMed.length === 0) return undefined;

  const singlesAll = noMed.filter((s) => s.origem !== "" && !s.origem.includes(","));
  const combinedAll = noMed.filter((s) => s.origem.includes(","));

  const selected = filtrosOrigens
    .map((x) => (x ?? "").trim().toLowerCase())
    .filter((x) => x && x !== "all");

  // Recortes aplicáveis à seleção atual.
  const selectedSet = new Set(selected);
  const exact = selected.length > 0 ? noMed.find((s) => s.origem === [...selected].sort().join(",")) : undefined;
  const singles = selected.length > 0 ? singlesAll.filter((s) => selectedSet.has(s.origem)) : singlesAll;
  const combined = selected.length > 0 ? combinedAll.filter((s) => s.origem.split(",").every((o) => selectedSet.has(o))) : combinedAll;
  // "Sem origem" (todas) só vale quando não há filtro de origem.
  const noOrigem = selected.length === 0 ? noMed.find((s) => s.origem === "") : undefined;

  const out: OverrideMetricValues = {};
  let any = false;
  for (const metric of CRM_OVERRIDE_METRICS) {
    if (noOrigem && noOrigem.metrics[metric] != null) {
      out[metric] = noOrigem.metrics[metric];
      any = true;
      continue;
    }
    if (exact && exact.metrics[metric] != null) {
      out[metric] = exact.metrics[metric];
      any = true;
      continue;
    }
    const withMetric = singles.filter((s) => s.metrics[metric] != null);
    if (withMetric.length > 0) {
      out[metric] = withMetric.reduce((sum, s) => sum + s.metrics[metric], 0);
      any = true;
      continue;
    }
    const cv = pickCombined(combined, metric);
    if (cv != null) {
      out[metric] = cv;
      any = true;
    }
  }
  return any ? out : undefined;
}

export function useMetasVisaoGeral(
  dateFrom: Date | undefined,
  dateTo: Date | undefined,
  fields: MetaKey[],
  filtros: MetasFiltros,
) {
  const dateFromStr = dateFrom ? format(dateFrom, "yyyy-MM-dd") : undefined;
  // `dateTo` é inclusivo em todo o stack; sem `to` (dia único) colapsa para from..from.
  const dateToStr = dateTo ? format(dateTo, "yyyy-MM-dd") : dateFromStr;

  // Ads canonicalizados — mesma preparação da tela de CRM (sem isso os nomes de conta do
  // Ads não casam com o slug do Kommo e o investimento/CPL zeram).
  const { data: adsData, canonicalMap, clients: allClients, loading: adsLoading } = useClientesData(dateFromStr, dateToStr);
  const adsRows = useMemo(
    () =>
      adsData.map((r) => ({
        Client: canonicalMap.canonicalByAdsName.get(r.Client) || foldMergedAdsClient(canonicalizeAdsClient(r.Client)),
        Dia: r.Dia,
        Lead: r.Lead,
        Mensagens_iniciadas: r.Conversa,
        Valor_usado_BRL: r.Valor_usado_BRL,
        Fonte_Ads: r.Fonte_Ads,
        medico: adsMedicoForClient(r.Client),
      })),
    [adsData, canonicalMap],
  );

  // "all" = sem filtro de cliente: o clientTable devolve uma linha por cliente do período.
  // A origem entra AQUI (e não numa filtragem posterior) porque ela muda o próprio real:
  // é o mesmo caminho da tela de CRM, então "só Meta Ads" recalcula leads/investimento.
  const { clientTable, origens, loading: crmLoading, error } = useCRMClienteData(
    "all",
    dateFromStr,
    dateToStr,
    filtros.origens,
    undefined,
    adsRows,
  );

  const { resolveMeta, loading: metasLoading } = useClientesMetas();
  // Squad (= líder de RevOps), plano e tempo de casa vêm da planilha de projetos.
  const { index: projetos, squads, loading: projetosLoading } = useProjetosLista();
  // Versão do store: muda quando o botão Ativos/Histórico é trocado, e é o que faz as linhas
  // recalcularem (o `incluirInativosLigado` abaixo lê estado de módulo).
  const visVersao = useClientesVisiveis();

  const { resolveBasis } = useFaturamentoConfig();

  // Correções manuais dos números do CRM (crm_metric_overrides) — MESMA fonte da tela de CRM.
  // A correção é gravada POR ORIGEM filtrada (ex.: "meta ads"), então buscamos TODAS as fatias
  // do período corrente (qualquer cliente/origem) numa query só, casando o período pela mesma
  // assinatura normalizada (periodSignature: m:/mtd:/r:) que o CRM usa. Ficam indexadas por
  // client-matchkey p/ o `resolveOverride` recompor o total do cliente. Um cliente sem CRM
  // (Kommo vazio) passa a exibir aqui o número fixado à mão, em vez de 0. Falha de carga →
  // mapa vazio (cai no calculado; nada é zerado de propósito).
  const periodSig = useMemo(() => periodSignature(dateFromStr, dateToStr).sig, [dateFromStr, dateToStr]);

  const [overridesByClient, setOverridesByClient] = useState<Map<string, OverrideSlice[]>>(new Map());
  const [overridesLoading, setOverridesLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setOverridesLoading(true);
    (async () => {
      // Sufixo `|<periodSig>` = último segmento da filter_sig (cliente|médico|origem|período).
      const { data, error } = await externalSupabase
        .from("crm_metric_overrides")
        .select("filter_sig,metric,value")
        .like("filter_sig", `%|${periodSig}`);
      if (cancelled) return;
      const next = new Map<string, OverrideSlice[]>();
      if (!error && data) {
        // Agrupa por (clientKey, médico, origem) → uma OverrideSlice com as métricas daquele recorte.
        const byGroup = new Map<string, OverrideSlice>();
        for (const r of data as { filter_sig: string; metric: string; value: number | string }[]) {
          const n = Number(r.value); // PostgREST devolve numeric como string.
          if (!Number.isFinite(n)) continue;
          const parts = r.filter_sig.split("|");
          if (parts.length < 4) continue;
          const clientKey = parts[0];
          const medico = parts[1];
          // origem pode, em tese, conter separadores; período é sempre o último segmento.
          const origem = parts.slice(2, parts.length - 1).join("|");
          const gk = `${clientKey} ${medico} ${origem}`;
          let slice = byGroup.get(gk);
          if (!slice) {
            slice = { origem, medico, metrics: {} };
            byGroup.set(gk, slice);
            const arr = next.get(clientKey);
            if (arr) arr.push(slice);
            else next.set(clientKey, [slice]);
          }
          slice.metrics[r.metric] = n;
        }
      } else if (error) {
        console.warn("[useMetasVisaoGeral] não foi possível carregar correções do CRM:", error.message);
      }
      setOverridesByClient(next);
      setOverridesLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [periodSig]);

  const rows = useMemo<MetaClientRow[]>(() => {
    // Índice tolerante (caixa/acento/underscore) do real por cliente.
    const realByKey = new Map<string, CRMClientRow>();
    for (const r of clientTable) realByKey.set(clientMatchKey(r.client), r);

    // Universo = EXATAMENTE a lista canônica das outras telas de /clientes (o mesmo
    // `canonicalList` que alimenta o dropdown de CRM/Meta Ads/Google Ads, já sem os
    // encerrados e sem os slugs sem rótulo). Nada é acrescentado a partir do período: um
    // cliente que aparece no agregado mas não na lista é justamente o que as outras telas
    // escondem, e a de Metas tem de mostrar a mesma carteira.
    const universo = new Map<string, string>(); // matchKey → nome canônico exibido
    for (const c of allClients) universo.set(clientMatchKey(c), c);

    const out: MetaClientRow[] = [];
    for (const [key, client] of universo) {
      if (isExcludedClient(client, "crm")) continue; // cliente encerrado nunca aparece
      const proj = resolveProjeto(projetos, client);
      if (filtros.crm.length > 0) {
        // "Sem informação" na planilha não entra em nenhum dos dois lados do filtro.
        const chave = proj?.temCRM === true ? "com" : proj?.temCRM === false ? "sem" : null;
        if (chave == null || !filtros.crm.includes(chave)) continue;
      }
      if (filtros.maturidades.length > 0) {
        const faixa = faixaMaturidade(proj?.desde ?? null);
        if (faixa == null || !filtros.maturidades.includes(faixa)) continue;
      }
      // Cliente marcado como INATIVO na planilha de projetos sai da tela. Quem NÃO está na
      // planilha continua aparecendo: status desconhecido não é o mesmo que inativo, e sumir
      // com ele deixaria a carteira menor que a das outras telas.
      // No modo "Histórico" ninguém é filtrado por status — é o ponto do botão.
      if (!incluirInativosLigado() && !clienteVisivel(proj)) continue;
      const squad = proj?.squad ?? null;
      if (filtros.squads.length > 0 && (squad == null || !filtros.squads.includes(squad))) continue;
      // Real do cliente com a correção manual do CRM colada por cima (quando existe p/ o
      // recorte). `resolveOverride` recompõe o total a partir das fatias por origem; cliente
      // sem linha calculada + com correção parte de uma linha zerada.
      const baseRow = realByKey.get(key);
      const ov = resolveOverride(overridesByClient.get(key), filtros.origens);
      const realRow = ov ? applyRowOverrides(baseRow ?? zeroRow(client), ov, resolveBasis(client)) : baseRow;
      out.push({
        client,
        squad,
        plano: proj?.plano ?? null,
        desde: proj?.desde ?? null,
        cells: buildCells(realRow, resolveMeta(client, dateFrom, dateTo), fields),
      });
    }
    return out.sort(compareClientRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientTable, allClients, resolveMeta, projetos, dateFrom, dateTo, fields, filtros, visVersao, overridesByClient, resolveBasis]);

  return {
    rows,
    squads,
    origens,
    loading: adsLoading || crmLoading || metasLoading || projetosLoading || overridesLoading,
    error,
  };
}
