import { useState, useEffect, useMemo, useCallback } from "react";
import { externalSupabase } from "@/integrations/external-supabase/client";
import {
  KommoRow,
  KommoAggRow,
  AdsRow,
  CRMTotals,
  CRMClientRow,
  FunnelStage,
  LeadTimeResult,
  OrigemFunnelRow,
  TagFunnelRow,
  mergeKommoAgg,
  calcTotals,
  calcFunnel,
  calcLeadTimes,
  calcClientTable,
  calcOrigemFunnelAgg,
  calcTagFunnelAgg,
  splitTags,
  calcMonthlyEvolutionAgg,
  calcOrcamentoParado,
  getOrcamentoSentDate,
  getMedico,
  canonicalOrigem,
  CANONICAL_ORIGENS,
  procedimentoKey,
  rawRowsToAggEvents,
  DEFAULT_FAT_BASIS,
} from "@/utils/crmCalculations";
import { normalizeClientName, getRawClientNames, clientMatchKey, isExcludedClient, isExcludedKommoId, MEDICO_VAZIO, canonicalizeAdsClient, foldMergedAdsClient, campaignMedicoRules, campaignMedicoFromName, campaignMedicoOptions, accountMedicoOptions, adsClientSearchCore } from "@/data/clienteAliases";
import { startOfDayBRT, endOfDayBRT } from "@/utils/dateRange";
import { dedupedFetch, withRetry } from "./dataCache";
import { useClientesVisiveis } from "@/hooks/useClientesVisiveis";
import { useFaturamentoConfig } from "./useFaturamentoConfig";
import { useCRMOverrides } from "./useCRMOverrides";
import { useCRMMonthlyOverrides } from "./useCRMMonthlyOverrides";
import { buildFilterSig, buildOrigemSig, monthCellsInRange, overrideValuesFromTotals, applyTotalsOverrides, applyEvolutionOverrides, OverrideMetricValues } from "@/utils/crmOverrides";

export type { CRMTotals, CRMClientRow, FunnelStage, LeadTimeResult, OrigemFunnelRow, TagFunnelRow };

// Origens-padrão do seletor quando o cliente selecionado não tem NENHUMA origem preenchida
// nos leads (ex.: Pablo Fonseca, cujas origens vivem só nas correções manuais). Sem isto o
// filtro ficaria vazio e a pessoa não conseguiria recortar/editar por origem. São rótulos
// CANÔNICOS, então casam com canonicalOrigem e com a assinatura das correções (buildFilterSig)
// — ao escolher uma, o valor vem do que foi preenchido naquela origem.
const ORIGENS_PADRAO = ["Meta Ads", "Google Ads", "Instagram", "Não tem Origem Definida"] as const;

export function useCRMClienteData(
  clientFilter?: string,
  dateFrom?: string,
  dateTo?: string,
  origemFilter?: string | string[],
  medicoFilter?: string | string[],
  externalAdsRows?: AdsRow[],
  clientList?: string[],
  // Filtro por TIPO de procedimento ("Rinoplastia" / "Transplante Capilar"). Só faz sentido
  // com UM cliente selecionado (os nomes de procedimento são por cliente). [] / undefined =
  // todos → caminho agregado normal (comportamento intocado). Ver procedimentos/procRows.
  procedimentoFilter?: string | string[],
  // Escopo do PLANEJADO/OVERRIDE por procedimento — token "proc:<key>" quando o cliente é
  // Diego Rezende/Pablo Fonseca com EXATAMENTE 1 procedimento filtrado; "" caso contrário. Vindo
  // da página (gate por cliente). Quando presente, as correções manuais passam a ser
  // chaveadas por procedimento (e aplicadas mesmo com procActive); vazio = comportamento
  // antigo (procedimento desativa correções).
  procedimentoScope?: string,
  // Lead-times (gráfico "Tempo Médio entre Etapas") exigem um fetch CRU na v_kommo_completa (OR
  // em 4 colunas de data, ~150k linhas, paginação SEQUENCIAL) — caro e lento. Só a tela CRM o
  // renderiza, então fica FORA do gate de primeiro paint e só dispara quando o consumidor pede
  // (needsLeadTimes=true). Default false: os demais consumidores não pagam por um dado que ignoram.
  needsLeadTimes = false,
  // JANELA DE MATURIDADE POR CLIENTE. Quando presente (filtro de maturidade ativo na tela CRM),
  // o período global deixa de valer e cada cliente é recortado pela SUA fatia de maturidade
  // (ex.: "Primeiros 3 meses" = os 3 primeiros meses de casa daquele cliente). Mapa
  // canônico(ou cru)→{from,to} em YYYY-MM-DD. O fetch vem por HISTÓRICO INTEIRO (datas globais
  // nulas) e este mapa recorta client-side cada métrica (evento/dia) à janela do cliente.
  // null/undefined = sem janela (comportamento normal, dirigido pelo período global).
  maturityWindows?: Map<string, { from: string; to: string }> | null,
  // TAGS = etiquetas do Kommo, dimensão POR LEAD (vêm em r.tags da v_kommo_crm_tag_agg, lista por
  // vírgula). `tagsFilter` = nomes selecionados no select ([] = todas). "include" = o lead PRECISA
  // ter uma das tags; "exclude" = NÃO pode ter nenhuma delas (leads sem tag passam no exclude).
  tagsFilter?: string[],
  tagsMode: "include" | "exclude" = "include"
) {
  // Carteira visível (projetos_lista ATIVO + clientes_ocultos). A versão entra nas deps
  // abaixo porque isExcludedClient consulta esse store — sem ela, a lista ficaria a de antes
  // do carregamento.
  const visVersao = useClientesVisiveis();
  // Métricas do funil/faturamento vêm AGREGADAS da view v_kommo_crm_agg (centenas de
  // linhas), no lugar de baixar/varrer ~150k leads crus no navegador. Paridade com o
  // caminho antigo garantida por crmAggParity.test.ts.
  const [aggRows, setAggRows] = useState<KommoAggRow[]>([]);
  // Lead-times precisa de datas pareadas POR LEAD (mediana) → fetch cru pequeno,
  // escopado aos leads com evento no período (OR nas 4 colunas de data).
  const [leadTimeRows, setLeadTimeRows] = useState<KommoRow[]>([]);
  const [internalAdsRows, setInternalAdsRows] = useState<AdsRow[]>([]);
  // Leads atualmente na etapa "Orçamento" — busca SEPARADA (status_nome atual), só
  // respeitando o cliente (empurrado ao DB) + filtros client-side de origem/médico/
  // especialidade. O filtro de PERÍODO (por created_at) é aplicado depois, em
  // calcOrcamentoParado, para o card "Leads enviados orçamento" seguir a data.
  const [orcamentoRows, setOrcamentoRows] = useState<KommoRow[]>([]);
  // Leads CRUS do cliente selecionado, com a coluna "Procedimento" — base do filtro por tipo
  // de procedimento. Buscados SÓ quando há 1 cliente selecionado (conjunto pequeno). Quando
  // o filtro de procedimento está ativo, estes leads viram eventos (rawRowsToAggEvents) e
  // substituem o agregado do cliente — replicando a lógica da MV, então batem com o funil.
  const [procRows, setProcRows] = useState<KommoRow[]>([]);
  // Origens que o cliente tem SÓ nas correções manuais (crm_metric_overrides), não nos leads
  // (ex.: Pablo Fonseca, cujos números por origem foram preenchidos à mão). Entram no seletor
  // de origem para a pessoa conseguir recortar/editar por elas — o valor de cada uma vem da
  // própria correção (via filterSig). Carregadas só quando há 1 cliente selecionado.
  const [overrideOrigens, setOverrideOrigens] = useState<string[]>([]);
  // Clientes cuja conta de Ads é ÚNICA mas cujas campanhas carregam o médico no NOME
  // (ex.: Dra. Carla Gouveia). O agregado diário (v_meta_google_ads_daily) que alimenta o
  // CRM COLAPSA as campanhas (grão Dia×Client×Fonte) e com isso perde o médico — por isso
  // o filtro de médico não dividia o leads tráfego/investimento dela. Para esses clientes
  // buscamos as linhas CAMPANHA-A-CAMPANHA (v_meta_google_ads tem Nome_Campanha) com o médico
  // já atribuído pelo nome da campanha, espelhando useMetaAdsClienteData. Vazio = cliente sem
  // split selecionado → caminho agregado normal, intocado.
  const [splitAdsRows, setSplitAdsRows] = useState<AdsRow[]>([]);
  const campRules = useMemo(() => campaignMedicoRules(clientFilter), [clientFilter]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Quando o consumidor passa `externalAdsRows`, reaproveitamos o fetch já feito por
  // useClientesData (evita um segundo download da view v_meta_google_ads). Caso contrário,
  // baixamos os ads aqui mesmo (compatibilidade com páginas que usam só este hook).
  const usingExternalAds = externalAdsRows !== undefined;

  // Set de clientes da especialidade (filtro client-side). null = "sem filtro".
  // Tratamos array vazio como null para não zerar silenciosamente os totais.
  const clientListSet = useMemo<Set<string> | null>(() => {
    if (!clientList || clientList.length === 0) return null;
    return new Set(clientList.map((c) => normalizeClientName(c)));
  }, [clientList]);

  // Janela de maturidade POR CLIENTE, reindexada pela chave NORMALIZADA (igual às linhas dos
  // dados). null quando não há maturidade ativa → `inMatWindow` vira no-op (passa tudo).
  // null = maturidade DESLIGADA (no-op, período global manda). Um Map (mesmo VAZIO) = maturidade
  // ligada → `inMatWindow` passa a exigir que o cliente+data caiam numa janela; mapa vazio exclui
  // tudo (a faixa não tem nenhum cliente com janela válida), em vez de liberar o histórico inteiro.
  const matWindowMap = useMemo<Map<string, { from: string; to: string }> | null>(() => {
    if (!maturityWindows) return null;
    const m = new Map<string, { from: string; to: string }>();
    for (const [c, w] of maturityWindows) m.set(normalizeClientName(c), w);
    return m;
  }, [maturityWindows]);
  const matWindowActive = matWindowMap != null;
  // A data (evento/dia) do cliente cai na janela de maturidade dele? Sem janela ativa, sempre
  // true (no-op). Com janela: o cliente precisa estar no mapa (coorte) E a data dentro do
  // [from,to] DELE. Data ausente com janela ativa → fora (não dá pra posicionar na janela).
  const inMatWindow = useCallback(
    (client: string, dateStr?: string | null): boolean => {
      if (!matWindowMap) return true;
      const w = matWindowMap.get(normalizeClientName(client));
      if (!w || !dateStr) return false;
      const d = dateStr.slice(0, 10);
      return d >= w.from && d <= w.to;
    },
    [matWindowMap],
  );

  const adsRows = useMemo<AdsRow[]>(() => {
    // Cliente com split por NOME de campanha (ex.: Carla): usa as linhas campanha-a-campanha,
    // que trazem o médico atribuído pelo nome da campanha. O agregado diário não serve aqui —
    // colapsa as campanhas e perde o médico. O fetch escopa por ilike de núcleo (pode, em tese,
    // casar outra conta homônima) → reforçamos o recorte pela chave canônica do cliente, e ainda
    // aplicamos o filtro de especialidade (clientListSet), raríssimo com 1 cliente.
    if (campRules.length && splitAdsRows.length) {
      const targetKey = clientFilter && clientFilter !== "all" ? clientMatchKey(clientFilter) : null;
      let rows = targetKey ? splitAdsRows.filter((r) => clientMatchKey(r.Client) === targetKey) : splitAdsRows;
      if (clientListSet) rows = rows.filter((r) => clientListSet.has(r.Client));
      return rows;
    }
    const source = usingExternalAds ? externalAdsRows! : internalAdsRows;
    let rows = source;
    if (clientFilter && clientFilter !== "all") {
      const rawNames = new Set(getRawClientNames(clientFilter));
      // Match TOLERANTE (clientMatchKey: caixa/acento/underscore-insensível), somado ao exato.
      // Sem isto, o usuário-cliente (clientFilter = slug em minúsculo "vasculare") não casava os
      // Ads que chegam com o canônico "VascuLare" → leads tráfego/investimento zeravam no CRM.
      const targetKey = clientMatchKey(clientFilter);
      const rawKeySet = new Set([...rawNames].map((n) => clientMatchKey(n)));
      rows = rows.filter(
        (r) =>
          rawNames.has(r.Client) ||
          r.Client === clientFilter ||
          clientMatchKey(r.Client) === targetKey ||
          rawKeySet.has(clientMatchKey(r.Client)),
      );
    }
    if (clientListSet) {
      rows = rows.filter((r) => clientListSet.has(r.Client));
    }
    return rows;
  }, [usingExternalAds, externalAdsRows, internalAdsRows, clientFilter, clientListSet, campRules, splitAdsRows]);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      try {
        // Cache (5 min) por chave + coalescing + retry em 57014.
        // PostgREST do projeto cap em 1000 rows/response (project.max_rows), então
        // PAGE > 1000 dispara early-stop falso. CONCURRENCY=4 — Supabase free/small
        // tier tem ~10 conexões no pool do PostgREST; passar disso enfileira queries
        // e PIORA o wall-clock total (verificado empiricamente: 12 → 50s, 4 → ~5s).
        const PAGE = 1000;
        const CONCURRENCY = 4;
        const MAX_ROWS = 500000;

        // ---- Kommo: MÉTRICAS AGREGADAS (view v_kommo_crm_agg) ----
        // Funil/faturamento vêm PRÉ-AGREGADOS (client × médico × origem × especialidade
        // × event_type × event_date, com qtd + valor). Filtra por event_date no período —
        // cada evento tem sua própria data, então "missed events" de leads antigos entram
        // nativamente (sem lookback de 90 dias). NÃO filtramos por cliente no DB (filtro
        // client-side, listas não colapsam + cache por período). qtd/valor vêm como texto
        // (PostgREST numeric) → coerção. Paridade com o caminho antigo em crmAggParity.test.
        const dFrom = dateFrom ? dateFrom.slice(0, 10) : undefined;
        const dTo = dateTo ? dateTo.slice(0, 10) : undefined;
        // Fonte = v_kommo_crm_tag_agg (espelha v_kommo_crm_agg + dimensão `tags` = etiquetas do
        // Kommo por lead). Somar sobre `tags` reproduz a agg sem tag (GROUP BY refinado), então os
        // cards/funil/tabela ficam idênticos; o `tags` extra alimenta o select/funil/filtro por tag.
        const AGG_SELECT = "client,medico,medicos,origem,especialidade,tags,event_type,event_date,qtd,valor";
        const fetchAggRange = (from: number) =>
          withRetry(async () => {
            let q = externalSupabase
              .from("v_kommo_crm_tag_agg")
              .select(AGG_SELECT)
              // Ordem estável = chave única da MV (evita skip/dup com .range acima de 1000).
              .order("event_date", { ascending: true })
              .order("client", { ascending: true })
              .order("event_type", { ascending: true })
              .order("medico", { ascending: true })
              .order("medicos", { ascending: true })
              .order("origem", { ascending: true })
              .order("especialidade", { ascending: true })
              .order("tags", { ascending: true })
              .range(from, from + PAGE - 1);
            if (dFrom) q = q.gte("event_date", dFrom);
            if (dTo) q = q.lte("event_date", dTo);
            const { data, error } = await q;
            if (error) throw error;
            return (data as Record<string, unknown>[]) || [];
          });

        const aggKey = `crmtagagg:${dFrom || ""}:${dTo || ""}`;
        const fetchAllAgg = (): Promise<KommoAggRow[]> =>
          dedupedFetch(aggKey, async () => {
            const raw: Record<string, unknown>[] = [];
            for (let from = 0; from < MAX_ROWS; from += PAGE * CONCURRENCY) {
              const offsets: number[] = [];
              for (let i = 0; i < CONCURRENCY; i++) {
                const o = from + i * PAGE;
                if (o < MAX_ROWS) offsets.push(o);
              }
              const batches = await Promise.all(offsets.map(fetchAggRange));
              let stop = false;
              for (const b of batches) {
                raw.push(...b);
                if (b.length < PAGE) stop = true;
              }
              if (stop) break;
            }
            return raw.map((r): KommoAggRow => ({
              client: normalizeClientName(String(r.client ?? "")),
              medico: (r.medico as string | null) ?? null,
              medicos: (r.medicos as string | null) ?? null,
              origem: (r.origem as string | null) ?? null,
              especialidade: (r.especialidade as string | null) ?? null,
              tags: (r.tags as string | null) ?? null,
              event_type: String(r.event_type),
              event_date: String(r.event_date).slice(0, 10),
              qtd: Number(r.qtd) || 0,
              valor: Number(r.valor) || 0,
            }));
          });

        // ---- Ads ----
        const fetchAdsRange = (from: number) =>
          withRetry(async () => {
            let q = externalSupabase
              .from("v_meta_google_ads")
              .select("Client, Lead, Mensagens_iniciadas, Valor_usado_BRL, Fonte_Ads")
              .range(from, from + PAGE - 1);
            if (clientFilter && clientFilter !== "all") {
              const rawNames = getRawClientNames(clientFilter);
              q = rawNames.length > 1 ? q.in("Client", rawNames) : q.eq("Client", clientFilter);
            }
            if (dateFrom) q = q.gte("Dia", dateFrom);
            if (dateTo) q = q.lte("Dia", dateTo);
            const { data, error } = await q;
            if (error) throw error;
            return ((data as unknown) as AdsRow[]) || [];
          });

        const adsKey = `crmads:${clientFilter || "all"}:${dateFrom || ""}:${dateTo || ""}`;
        const fetchAllAds = (): Promise<AdsRow[]> =>
          dedupedFetch(adsKey, async () => {
            const all: AdsRow[] = [];
            for (let from = 0; from < MAX_ROWS; from += PAGE * CONCURRENCY) {
              const offsets: number[] = [];
              for (let i = 0; i < CONCURRENCY; i++) {
                const o = from + i * PAGE;
                if (o < MAX_ROWS) offsets.push(o);
              }
              const batches = await Promise.all(offsets.map(fetchAdsRange));
              let stop = false;
              for (const b of batches) {
                all.push(...b);
                if (b.length < PAGE) stop = true;
              }
              if (stop) break;
            }
            for (const r of all) r.Client = normalizeClientName(r.Client);
            return all;
          });

        const [aggRes, adsRes] = await Promise.all([
          fetchAllAgg(),
          usingExternalAds ? Promise.resolve([] as AdsRow[]) : fetchAllAds(),
        ]);
        if (cancelled) return;
        // Guarda anti-zero: a agregada do Kommo (v_kommo_crm_agg) alimenta TODOS os cards
        // do CRM (leads/consultas/procedimentos). Vazia aqui quase sempre é falha transitória
        // — timeout da view sob carga ou corrida no primeiro load — e não ausência real de
        // dados (o fetch NÃO filtra por cliente no DB, então só zera se o período inteiro,
        // em todos os clientes, não tiver evento: praticamente nunca). Em vez de pintar a tela
        // com 0, segura o skeleton e reprograma o refetch. Só desiste após algumas tentativas,
        // pois vazio TAMBÉM pode ser legítimo (recorte genuinamente sem eventos).
        if (aggRes.length === 0 && scheduleRetry("empty")) return;
        setAggRows(aggRes);
        if (!usingExternalAds) setInternalAdsRows(adsRes || []);
        setError(null);
        setLoading(false);
      } catch (e: unknown) {
        if (cancelled) return;
        // Erro (ex.: 57014 statement timeout após os retries internos do withRetry) →
        // continua tentando sozinho, com o skeleton no ar, até o banco responder — sem
        // exigir reload manual (mesma política do useClientesData).
        if (scheduleRetry("error")) return;
        const msg = e instanceof Error ? e.message : "Erro ao buscar dados do CRM";
        console.error("[useCRMClienteData] Falha ao buscar dados do CRM:", e);
        setError(msg);
        setLoading(false);
      }
    }

    // Reprograma fetchData com backoff exponencial (cap 15s) enquanto montado. Retorna true
    // se agendou (quem chamou mantém o loading/skeleton). Tetos separados: erro tenta mais
    // (banco lento volta); vazio tenta pouco (pode ser recorte genuíno sem eventos).
    let attempt = 0;
    let emptyTries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function scheduleRetry(reason: "error" | "empty"): boolean {
      if (cancelled) return false;
      if (reason === "empty" && ++emptyTries > 3) return false;
      if (attempt >= 8) return false;
      const delay = Math.min(1500 * 2 ** attempt, 15000) + Math.random() * 400;
      attempt++;
      timer = setTimeout(() => { if (!cancelled) void fetchData(); }, delay);
      return true;
    }

    void fetchData();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [clientFilter, dateFrom, dateTo, usingExternalAds]);

  // ── Split por NOME de campanha (ex.: Dra. Carla Gouveia) — fetch campanha-a-campanha ──
  // Só dispara quando um cliente COM split está selecionado (campRules não-vazio). Busca as
  // linhas de Ads do cliente na v_meta_google_ads (grão de campanha, com Nome_Campanha) e
  // atribui o médico pelo NOME da campanha — campanha sem token (genérica/ERRO/Post) vira
  // MEDICO_VAZIO, então só entra com "Sem médico" selecionado (ou sem filtro = tudo). Espelha
  // useMetaAdsClienteData.scopedData, para o CRM bater exatamente com a tela de Meta Ads.
  useEffect(() => {
    if (!campRules.length || !clientFilter || clientFilter === "all") { setSplitAdsRows([]); return; }
    let cancelled = false;
    async function fetchSplitAds() {
      try {
        const PAGE = 1000;
        const CONCURRENCY = 4;
        const MAX_ROWS = 200000;
        const rawNames = getRawClientNames(clientFilter!);
        // `clientFilter` aqui é o SLUG canônico ("Carla_Gouveia"), NÃO o nome cru da conta
        // ("Dra. Carla Gouveia - CA 1.1.1 | Groohub"). Um `.eq("Client", slug)` nunca casa →
        // fetch vazio → split cai no agregado → o filtro de médico não mexe em investimento/
        // leads tráfego (o bug relatado). Escopamos como a tela Meta Ads: ilike por NÚCLEO do
        // nome (sufixos/título removidos), que casa todas as variantes da conta no banco.
        const core = adsClientSearchCore(clientFilter!.replace(/_/g, " "));
        const dFrom = dateFrom ? dateFrom.slice(0, 10) : undefined;
        const dTo = dateTo ? dateTo.slice(0, 10) : undefined;
        const SPLIT_SELECT = "Client, Nome_Campanha, Dia, Lead, Mensagens_iniciadas, Valor_usado_BRL, Fonte_Ads";
        const fetchRange = (from: number) =>
          withRetry(async () => {
            let q = externalSupabase
              .from("v_meta_google_ads")
              .select(SPLIT_SELECT)
              // Ordem estável (grão único Dia×Nome_Campanha×Client) p/ a paginação .range não
              // pular/duplicar quando passa de 1000 linhas.
              .order("Dia", { ascending: true })
              .order("Nome_Campanha", { ascending: true })
              .order("Client", { ascending: true })
              .range(from, from + PAGE - 1);
            if (rawNames.length > 1) q = q.in("Client", rawNames);
            else if (core.length >= 3) q = q.ilike("Client", `%${core}%`);
            else q = q.eq("Client", clientFilter!);
            if (dFrom) q = q.gte("Dia", dFrom);
            if (dTo) q = q.lte("Dia", dTo);
            const { data, error } = await q;
            if (error) throw error;
            return (data as Record<string, unknown>[]) || [];
          });
        const key = `crmsplitads:${clientFilter}:${dFrom || ""}:${dTo || ""}`;
        const raw = await dedupedFetch(key, async () => {
          const acc: Record<string, unknown>[] = [];
          for (let base = 0; base < MAX_ROWS; base += PAGE * CONCURRENCY) {
            const offsets: number[] = [];
            for (let i = 0; i < CONCURRENCY; i++) { const o = base + i * PAGE; if (o < MAX_ROWS) offsets.push(o); }
            const batches = await Promise.all(offsets.map(fetchRange));
            let stop = false;
            for (const b of batches) { acc.push(...b); if (b.length < PAGE) stop = true; }
            if (stop) break;
          }
          return acc;
        });
        if (cancelled) return;
        const toNum = (v: unknown): number => { const n = parseFloat(String(v ?? "")); return Number.isFinite(n) ? n : 0; };
        const mapped: AdsRow[] = raw.map((r) => ({
          Client: foldMergedAdsClient(canonicalizeAdsClient(String(r.Client ?? ""))),
          Dia: r.Dia ? String(r.Dia).slice(0, 10) : undefined,
          Lead: toNum(r.Lead),
          Mensagens_iniciadas: toNum(r.Mensagens_iniciadas),
          Valor_usado_BRL: toNum(r.Valor_usado_BRL),
          Fonte_Ads: (r.Fonte_Ads as string | undefined) ?? undefined,
          medico: campaignMedicoFromName(campRules, r.Nome_Campanha as string | null) ?? MEDICO_VAZIO,
        }));
        setSplitAdsRows(mapped);
      } catch (e) {
        if (cancelled) return;
        // Secundário: falha não quebra a tela, só deixa o split sem dados (cai no agregado).
        console.error("[useCRMClienteData] Falha ao buscar split de campanha:", e);
        setSplitAdsRows([]);
      }
    }
    void fetchSplitAds();
    return () => { cancelled = true; };
  }, [campRules, clientFilter, dateFrom, dateTo]);

  // ── Lead-times (gráfico "Tempo Médio entre Etapas") — FORA do gate de primeiro paint ──
  // Fetch CRU caro na v_kommo_completa (OR em 4 colunas de data, paginação sequencial). O
  // conjunto é escopado só pelo PERÍODO (não pelo cliente — o recorte por cliente é client-side
  // em filteredLeadTime), então as deps são só as datas + o opt-in. Enquanto não chega,
  // `leadTimeRows` fica vazio e o CRMTempoEtapas não renderiza (sem flash de número errado).
  useEffect(() => {
    if (!needsLeadTimes || !dateFrom) { setLeadTimeRows([]); return; }
    let cancelled = false;
    async function fetchLeadTimes() {
      try {
        const PAGE = 1000;
        const MAX_ROWS = 500000;
        const dFrom = dateFrom ? dateFrom.slice(0, 10) : undefined;
        const dTo = dateTo ? dateTo.slice(0, 10) : undefined;
        const addOneDay = (d?: string): string | undefined => {
          if (!d) return undefined;
          const dt = new Date(`${d}T00:00:00Z`);
          if (isNaN(dt.getTime())) return undefined;
          dt.setUTCDate(dt.getUTCDate() + 1);
          return dt.toISOString().slice(0, 10);
        };
        const eventHi = addOneDay(dateTo) ?? "9999-12-31";
        const EVENT_DATE_COLS = [
          "Consulta Agendada Em",
          "Dia da Consulta Realizada",
          "Procedimento Agendado Em",
          "Dia do Procedimento Realizado",
        ];
        const eventOr = EVENT_DATE_COLS
          .map((c) => `and("${c}".gte.${dFrom},"${c}".lt.${eventHi})`)
          .join(",");
        const LEADTIME_SELECT =
          "id, client, Origem, \"Médico\", \"Médicos\", \"Procedimento\", \"Consulta Agendada Em\", \"Dia da Consulta Realizada\", \"Procedimento Agendado Em\", \"Dia do Procedimento Realizado\", created_at";
        const fetchLeadTimeRange = (from: number) =>
          withRetry(async () => {
            const q = externalSupabase
              .from("v_kommo_completa")
              .select(LEADTIME_SELECT)
              .order("id", { ascending: true })
              .range(from, from + PAGE - 1)
              .or(eventOr);
            const { data, error } = await q;
            if (error) throw error;
            return ((data as unknown) as KommoRow[]) || [];
          });
        const leadTimeKey = `crmleadtime:${dFrom || ""}:${dTo || ""}`;
        const rows = await dedupedFetch(leadTimeKey, async () => {
          const all: KommoRow[] = [];
          for (let from = 0; from < MAX_ROWS; from += PAGE) {
            const batch = await fetchLeadTimeRange(from);
            all.push(...batch);
            if (batch.length < PAGE) break;
          }
          for (const r of all) r.client = normalizeClientName(r.client);
          return all;
        });
        if (cancelled) return;
        // Cards de teste (ids) já são excluídos na MV; o conjunto cru precisa do filtro por id aqui.
        setLeadTimeRows(rows.filter((r) => !isExcludedKommoId((r as { id?: number }).id)));
      } catch (e) {
        if (cancelled) return;
        // Lead-times é secundário (gráfico abaixo da dobra) — falha não quebra a tela; só deixa
        // o card sem dados. Loga e segue (sem o retry agressivo do fetch principal).
        console.error("[useCRMClienteData] Falha ao buscar lead-times:", e);
      }
    }
    void fetchLeadTimes();
    return () => { cancelled = true; };
  }, [dateFrom, dateTo, needsLeadTimes]);

  // ── Busca dos leads na etapa "Orçamento" (status atual, sem filtro de data no fetch) ──
  // Depende só do cliente (empurrado ao DB). Conjunto pequeno (centenas de linhas),
  // então paginação sequencial simples. Cacheado por cliente. O recorte por período
  // (created_at) é feito client-side em calcOrcamentoParado.
  useEffect(() => {
    let cancelled = false;
    async function fetchOrcamento() {
      try {
        const PAGE = 1000;
        const MAX_ROWS = 50000;
        const fetchRange = (from: number) =>
          withRetry(async () => {
            let q = externalSupabase
              .from("v_kommo_completa")
              .select("id, client, Origem, \"Médico\", \"Médicos\", \"Procedimento\", \"Valor do Procedimento\", \"Valor da Consulta\", \"Orçamento Enviado Em\", metadata, status_nome, created_at")
              .ilike("status_nome", "orçamento")
              .order("id", { ascending: true })
              .range(from, from + PAGE - 1);
            if (clientFilter && clientFilter !== "all") {
              const rawNames = getRawClientNames(clientFilter);
              q = rawNames.length > 1 ? q.in("client", rawNames) : q.eq("client", clientFilter);
            }
            const { data, error } = await q;
            if (error) throw error;
            return ((data as unknown) as KommoRow[]) || [];
          });

        const key = `orcamento:${clientFilter || "all"}`;
        const rows = await dedupedFetch(key, async () => {
          const all: KommoRow[] = [];
          for (let from = 0; from < MAX_ROWS; from += PAGE) {
            const batch = await fetchRange(from);
            all.push(...batch);
            if (batch.length < PAGE) break;
          }
          for (const r of all) r.client = normalizeClientName(r.client);
          return all;
        });
        if (cancelled) return;
        setOrcamentoRows(rows.filter((r) => !isExcludedKommoId((r as { id?: number }).id)));
      } catch (e) {
        console.error("[useCRMClienteData] Falha ao buscar leads em Orçamento:", e);
        if (!cancelled) setOrcamentoRows([]);
      }
    }
    // Adia o início para DEPOIS do primeiro paint. Este fetch alimenta só o card "Orçamento"
    // (pode chegar um pouco depois) e, quando dispara no mesmo instante do load, disputa o pool
    // do PostgREST com as queries que SEGURAM o skeleton — piorando o wall-clock do primeiro
    // paint. requestIdleCallback (fallback setTimeout) tira-o da janela crítica.
    const ric: (cb: () => void) => number =
      typeof window !== "undefined" && typeof (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback === "function"
        ? (cb) => (window as unknown as { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback(cb, { timeout: 2000 })
        : (cb) => setTimeout(cb, 400) as unknown as number;
    const cic = (id: number) => {
      if (typeof window !== "undefined" && typeof (window as unknown as { cancelIdleCallback?: unknown }).cancelIdleCallback === "function") {
        (window as unknown as { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(id);
      } else {
        clearTimeout(id);
      }
    };
    const handle = ric(() => { void fetchOrcamento(); });
    return () => { cancelled = true; cic(handle); };
  }, [clientFilter]);

  // ── Busca dos leads CRUS do cliente selecionado (com "Procedimento") ──
  // Base do filtro por tipo de procedimento. Só roda com UM cliente selecionado (o conjunto
  // é pequeno — centenas/poucos milhares de leads). SEM filtro de data no fetch: a lista de
  // procedimentos independe do período e o recorte por data é aplicado depois (nos eventos).
  // Colunas = tudo que rawRowsToAggEvents precisa + as dims de filtro (origem/médico).
  useEffect(() => {
    let cancelled = false;
    // Sem cliente único selecionado, o filtro de procedimento não se aplica → não busca.
    if (!clientFilter || clientFilter === "all") {
      setProcRows([]);
      return () => { cancelled = true; };
    }
    async function fetchProc() {
      try {
        const PAGE = 1000;
        const MAX_ROWS = 50000;
        const PROC_SELECT =
          "id, client, created_at, Origem, \"Médico\", \"Médicos\", \"Especialidade\", \"Procedimento\", \"Consulta Agendada Em\", \"Dia da Consulta Realizada\", \"Procedimento Agendado Em\", \"Dia do Procedimento Realizado\", \"Valor da Consulta\", \"Valor do Procedimento\"";
        const fetchRange = (from: number) =>
          withRetry(async () => {
            let q = externalSupabase
              .from("v_kommo_completa")
              .select(PROC_SELECT)
              .order("id", { ascending: true })
              .range(from, from + PAGE - 1);
            // Empurra o cliente ao DB (conjunto pequeno). Tolera variação espaço↔underscore
            // no nome cru (ex.: "Diego_Rezende" vs "Diego Rezende") pra não voltar vazio por causa
            // do formato do slug. A caixa/acento é resolvida depois pelo clientMatchKey.
            const rawNames = getRawClientNames(clientFilter!);
            const candidates = new Set<string>();
            for (const n of rawNames) {
              candidates.add(n);
              candidates.add(n.replace(/_/g, " "));
              candidates.add(n.replace(/ /g, "_"));
            }
            const list = [...candidates];
            q = list.length > 1 ? q.in("client", list) : q.eq("client", list[0]);
            const { data, error } = await q;
            if (error) throw error;
            return ((data as unknown) as KommoRow[]) || [];
          });

        const key = `procrows:${clientFilter}`;
        const rows = await dedupedFetch(key, async () => {
          const all: KommoRow[] = [];
          for (let from = 0; from < MAX_ROWS; from += PAGE) {
            const batch = await fetchRange(from);
            all.push(...batch);
            if (batch.length < PAGE) break;
          }
          for (const r of all) r.client = normalizeClientName(r.client);
          return all;
        });
        if (cancelled) return;
        setProcRows(rows.filter((r) => !isExcludedKommoId((r as { id?: number }).id)));
      } catch (e) {
        console.error("[useCRMClienteData] Falha ao buscar leads p/ filtro de procedimento:", e);
        if (!cancelled) setProcRows([]);
      }
    }
    fetchProc();
    return () => { cancelled = true; };
  }, [clientFilter]);

  const clients = useMemo(() => {
    const set = new Set<string>();
    for (const r of aggRows) if (r.client) set.add(r.client);
    return [...set].sort();
  }, [aggRows]);

  // Carrega as origens que o cliente selecionado tem nas CORREÇÕES manuais (não só nos leads).
  // A tabela é pequena; trazemos client_scope+origem e filtramos por cliente no cliente (match
  // tolerante a caixa/underscore). A coluna `origem` guarda as origens canônicas em minúsculo,
  // vírgula-separadas (ex.: "google ads,instagram,meta ads") → split + canonicalOrigem.
  useEffect(() => {
    let cancelled = false;
    const selKey = clientFilter && clientFilter !== "all" ? clientMatchKey(clientFilter) : null;
    if (!selKey) { setOverrideOrigens([]); return; }
    (async () => {
      try {
        const { data, error } = await externalSupabase
          .from("crm_metric_overrides")
          .select("client_scope,origem");
        if (cancelled) return;
        if (error || !data) { setOverrideOrigens([]); return; }
        const set = new Set<string>();
        for (const r of data as { client_scope: string | null; origem: string | null }[]) {
          if (!r.client_scope || clientMatchKey(r.client_scope) !== selKey) continue;
          if (!r.origem) continue;
          for (const piece of r.origem.split(",")) {
            const c = canonicalOrigem(piece);
            if (c) set.add(c);
          }
        }
        setOverrideOrigens([...set]);
      } catch {
        if (!cancelled) setOverrideOrigens([]);
      }
    })();
    return () => { cancelled = true; };
  }, [clientFilter]);

  // Origens do filtro, para o CLIENTE selecionado:
  //   • BASELINE: as 4 origens-padrão (ORIGENS_PADRAO) aparecem SEMPRE, para todo cliente ter
  //     o conjunto padrão por padrão — é o que o usuário pediu p/ clientes sem origem definida
  //     (ex.: Pablo Fonseca, cujas origens vivem nas correções). Uma origem-padrão sem dado
  //     fica disponível e retorna 0 até ser preenchida/corrigida.
  //   • + as origens REAIS do cliente: dos leads (≥1 evento) e das correções manuais.
  // Recorta por cliente — senão o seletor mostrava a UNIÃO das origens de TODOS os clientes (o
  // fetch não filtra por cliente no DB). Sem cliente (carteira) NÃO aplica baseline: mostra só
  // as origens realmente presentes nos leads do período.
  // As canônicas conhecidas vêm primeiro (ordem oficial); as customizadas do cliente
  // (ex.: "Instagram Dra. Carla"), que o canonicalOrigem preserva, entram em ordem alfabética.
  const origens = useMemo(() => {
    const selKey = clientFilter && clientFilter !== "all" ? clientMatchKey(clientFilter) : null;
    const present = new Set<string>();
    // Baseline padrão: só para um cliente selecionado (não para a carteira).
    if (selKey) for (const o of ORIGENS_PADRAO) present.add(o);
    for (const r of aggRows) {
      if (selKey && clientMatchKey(r.client) !== selKey) continue;
      const c = canonicalOrigem(r.origem);
      if (c) present.add(c);
    }
    // Origens só das correções manuais do cliente (sem lead correspondente).
    if (selKey) for (const o of overrideOrigens) present.add(o);
    const canon = CANONICAL_ORIGENS.filter((o) => present.has(o));
    const extras = [...present]
      .filter((o) => !CANONICAL_ORIGENS.includes(o as (typeof CANONICAL_ORIGENS)[number]))
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    const list = [...canon, ...extras];
    // Cliente sem NENHUMA origem preenchida nos leads (ex.: Pablo Fonseca) ficaria com o
    // seletor vazio. Cai no conjunto padrão para a pessoa poder recortar/editar por origem;
    // o valor de cada uma vem da correção manual lançada naquela origem (via filterSig).
    if (list.length === 0) return [...ORIGENS_PADRAO];
    return list;
  }, [aggRows, clientFilter, overrideOrigens]);

  // Opções do SELECT de TAG: tags distintas presentes nos leads (do cliente selecionado, ou da
  // carteira inteira sem cliente). Espelha `origens`. splitTags separa a lista por vírgula.
  const tags = useMemo(() => {
    const selKey = clientFilter && clientFilter !== "all" ? clientMatchKey(clientFilter) : null;
    const present = new Set<string>();
    for (const r of aggRows) {
      if (selKey && clientMatchKey(r.client) !== selKey) continue;
      for (const t of splitTags(r.tags)) present.add(t);
    }
    return [...present].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [aggRows, clientFilter]);

  // Chave de match do cliente selecionado (tolerante a caixa/acento/underscore).
  const selectedClientKey = useMemo(
    () => (clientFilter && clientFilter !== "all" ? clientMatchKey(clientFilter) : null),
    [clientFilter]
  );

  // Lista de médicos do cliente atualmente filtrado (apenas faz sentido com 1 cliente
  // selecionado). Inclui a opção "Sem médico" (MEDICO_VAZIO) quando há leads sem o campo
  // Médico preenchido — assim dá pra marcá-la (sozinha ou junto com outros) no filtro.
  const medicos = useMemo(() => {
    if (!selectedClientKey) return [];
    const set = new Set<string>();
    let hasVazio = false;
    for (const r of aggRows) {
      if (clientMatchKey(r.client) !== selectedClientKey) continue;
      const m = getMedico({ "Médico": r.medico, "Médicos": r.medicos });
      if (m) set.add(m);
      else hasVazio = true;
    }
    // Médicos que COMPARTILHAM o mesmo cliente pelo lado do Ads (ex.: "Dr. Moacir" e
    // "Dra. Lia" na Clínica Bellucci → cliente "Lia Garrido", via ADS_MEDICO_BY_CLIENT).
    // O Kommo nem sempre distingue esses médicos (os leads podem cair todos sob UM médico
    // ou sem médico preenchido), então sem esta união o seletor de médico NÃO aparecia para
    // a Lia — e sem ele era impossível escolher o Dr. Moacir para editar o planejado dele.
    // `adsRows` já vem escopado ao cliente selecionado e traz o médico-dono de cada conta.
    let hasAdsMedico = false;
    for (const r of adsRows) {
      // MEDICO_VAZIO (campanhas sem token, no split por nome) NÃO entra como opção aqui — ele
      // é oferecido só pelo push condicional abaixo, senão duplicaria na lista.
      if (r.medico && r.medico !== MEDICO_VAZIO) { set.add(r.medico); hasAdsMedico = true; }
    }
    // Clientes com split por NOME de campanha (ex.: Dra. Carla Gouveia) não têm pipeline no
    // Kommo — as opções de médico vêm das regras de campanha (espelha a tela de Meta Ads).
    for (const m of campaignMedicoOptions(clientFilter)) set.add(m);
    // Clientes que AGRUPAM várias contas, uma por médico (ex.: Instituto Aurum): as opções de
    // médico vêm das regras de split por CONTA — garante o dropdown mesmo sem pipeline no Kommo.
    for (const m of accountMedicoOptions(clientFilter)) set.add(m);
    const list = [...set].sort();
    // "Sem médico" (MEDICO_VAZIO) = leads/investimento SEM médico atribuído. Entra quando:
    // (a) o Kommo tem leads sem o campo Médico (hasVazio), OU (b) o cliente é dividido por
    // médico pelo lado Ads (ex.: Lia/Moacir) — aí o usuário precisa poder filtrar e editar
    // o planejado também do segmento sem médico (leads da clínica não atribuídos a Moacir/Lia).
    if (hasVazio || hasAdsMedico) list.push(MEDICO_VAZIO);
    return list;
  }, [aggRows, adsRows, selectedClientKey, clientFilter]);

  // Médicos selecionados (normalizado): array sem "all"/vazios. [] = todos.
  const medicoSelected = useMemo<string[]>(() => {
    if (!medicoFilter) return [];
    const arr = Array.isArray(medicoFilter) ? medicoFilter : [medicoFilter];
    return arr.filter((v) => v && v !== "all");
  }, [medicoFilter]);

  // Normaliza origemFilter para array de origens selecionadas.
  // [] ou ["all"] = sem filtro (todas).
  const origemSelected = useMemo<string[]>(() => {
    if (!origemFilter) return [];
    const arr = Array.isArray(origemFilter) ? origemFilter : [origemFilter];
    const cleaned = arr.filter((v) => v && v !== "all");
    return cleaned;
  }, [origemFilter]);

  // Tags selecionadas (nomes). [] = sem filtro de tag.
  const tagsSelected = useMemo<string[]>(
    () => (tagsFilter ?? []).filter((v) => v && v !== "all"),
    [tagsFilter],
  );

  // Lista de procedimentos (por tipo) do cliente selecionado — opções do filtro. Junta
  // variantes de caixa/acento sob uma chave (procedimentoKey) e mostra o rótulo mais "rico"
  // (com letras maiúsculas) de cada grupo, ordenado por frequência. Só faz sentido com 1
  // cliente selecionado; a tela só renderiza o filtro quando há ≥2 procedimentos.
  const procedimentos = useMemo<string[]>(() => {
    if (!selectedClientKey) return [];
    const byKey = new Map<string, { label: string; count: number }>();
    for (const r of procRows) {
      // Defensivo: só o cliente selecionado (o .in tolerante pode trazer um vizinho).
      if (clientMatchKey(r.client) !== selectedClientKey) continue;
      const raw = String(r["Procedimento"] ?? "").trim();
      if (!raw) continue;
      const k = procedimentoKey(raw);
      if (!k) continue;
      const e = byKey.get(k);
      if (!e) {
        byKey.set(k, { label: raw, count: 1 });
      } else {
        e.count++;
        // Prefere o rótulo com MAIS letras maiúsculas ("Transplante Capilar" > "transplante
        // capilar"), pra opção do filtro ficar apresentável de forma determinística.
        const ups = (s: string) => (s.match(/[A-ZÀ-Ý]/g) || []).length;
        if (ups(raw) > ups(e.label)) e.label = raw;
      }
    }
    return [...byKey.values()].sort((a, b) => b.count - a.count).map((v) => v.label);
  }, [procRows, selectedClientKey]);

  // Chaves normalizadas dos procedimentos marcados no filtro. Set vazio = todos (sem filtro).
  const procSelectedKeys = useMemo<Set<string>>(() => {
    if (!procedimentoFilter) return new Set();
    const arr = Array.isArray(procedimentoFilter) ? procedimentoFilter : [procedimentoFilter];
    return new Set(arr.filter((v) => v && v !== "all").map((v) => procedimentoKey(v)));
  }, [procedimentoFilter]);

  // Filtro de procedimento ativo? Só quando há um cliente selecionado E ≥1 procedimento
  // marcado. Fora disso, tudo segue o caminho agregado normal (comportamento intocado).
  const procActive = selectedClientKey != null && procSelectedKeys.size > 0;

  // Modo "override/planejado por procedimento": só quando a página mandou um escopo de
  // procedimento (Diego/Pablo com exatamente 1 procedimento). Nesse modo a coorte do
  // `filteredAgg` já é a do procedimento (ver bloco abaixo), então as correções manuais
  // podem ser aplicadas normalmente — só que chaveadas pela sig com segmento "proc:".
  const procScope = (procedimentoScope ?? "").trim();
  const procScoped = procActive && procScope !== "";

  // Predicado do procedimento: aceita a linha se o filtro está inativo, ou se o
  // "Procedimento" da linha casa (por chave normalizada) com algum marcado.
  const matchesProcedimento = useCallback(
    (procRaw: string | null | undefined) => {
      if (procSelectedKeys.size === 0) return true;
      const k = procedimentoKey(procRaw);
      return k !== "" && procSelectedKeys.has(k);
    },
    [procSelectedKeys]
  );

  // Predicado client-side compartilhado: cliente + origem + médico + lista de clients
  // da especialidade (+ exclusão de clientes encerrados). NÃO filtra por data.
  const matchesFilters = useCallback((r: KommoRow) => {
    if (isExcludedClient(r.client, "crm")) return false; // cliente encerrado — nunca aparece
    if (selectedClientKey && clientMatchKey(r.client) !== selectedClientKey) return false;
    if (clientListSet && !clientListSet.has(r.client)) return false;
    if (origemSelected.length > 0) {
      const c = canonicalOrigem(r.Origem);
      if (!c || !origemSelected.includes(c)) return false;
    }
    if (medicoSelected.length > 0) {
      const m = getMedico(r);
      const key = m === "" ? MEDICO_VAZIO : m;
      if (!medicoSelected.includes(key)) return false;
    }
    // (Tag não se aplica no caminho CRU: KommoRow não carrega etiqueta. O recorte por tag vive no
    // caminho agregado, matchesFiltersAgg. O caminho cru só roda sob filtro de procedimento.)
    // Filtro por tipo de procedimento (só afeta quando ≥1 procedimento marcado).
    if (!matchesProcedimento(r["Procedimento"])) return false;
    return true;
    // visVersao NÃO aparece no corpo de propósito: ela é o sinal de que o store de
    // clientes visíveis mudou (isExcludedClient lê estado de módulo, que o lint não
    // enxerga). Tirar a dep faz a lista congelar na versão pré-carregamento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origemSelected, medicoSelected, clientListSet, selectedClientKey, matchesProcedimento, visVersao]);

  // Mesmo predicado, para linhas AGREGADas (dims cruas da MV). Mantém a canonicalização
  // JS (origem/médico/cliente) idêntica ao caminho cru — ver crmAggParity.test.
  const matchesFiltersAgg = useCallback((r: KommoAggRow) => {
    if (isExcludedClient(r.client, "crm")) return false;
    if (selectedClientKey && clientMatchKey(r.client) !== selectedClientKey) return false;
    if (clientListSet && !clientListSet.has(r.client)) return false;
    // Maturidade: cada evento só entra se cair na janela de maturidade do SEU cliente.
    if (!inMatWindow(r.client, r.event_date)) return false;
    if (origemSelected.length > 0) {
      const c = canonicalOrigem(r.origem);
      if (!c || !origemSelected.includes(c)) return false;
    }
    if (medicoSelected.length > 0) {
      const m = getMedico({ "Médico": r.medico, "Médicos": r.medicos });
      const key = m === "" ? MEDICO_VAZIO : m;
      if (!medicoSelected.includes(key)) return false;
    }
    // Tag do lead (etiqueta Kommo, em r.tags). "include": precisa ter uma das tags selecionadas;
    // "exclude": não pode ter nenhuma delas (lead sem tag passa no exclude).
    if (tagsSelected.length > 0) {
      const has = splitTags(r.tags).some((x) => tagsSelected.includes(x));
      if (tagsMode === "exclude" ? has : !has) return false;
    }
    return true;
    // visVersao NÃO aparece no corpo de propósito: ela é o sinal de que o store de
    // clientes visíveis mudou (isExcludedClient lê estado de módulo, que o lint não
    // enxerga). Tirar a dep faz a lista congelar na versão pré-carregamento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origemSelected, medicoSelected, tagsSelected, tagsMode, clientListSet, selectedClientKey, inMatWindow, visVersao]);

  // Métricas do funil/faturamento: linhas agregadas filtradas (cliente client-side).
  // Com o filtro de procedimento ATIVO (1 cliente + ≥1 procedimento marcado), o agregado da
  // MV não serve (ele não tem a dimensão "procedimento"): geramos os eventos a partir dos
  // leads CRUS do cliente (procRows), já filtrados por procedimento + origem/médico, e
  // recortados pelo período. rawRowsToAggEvents replica a lógica da MV, então o funil, os
  // cards, a evolução mensal e o funil por origem — todos derivados de filteredAgg — ficam
  // consistentes entre si (a coorte do procedimento selecionado). Sem o filtro: caminho
  // agregado normal, 100% intocado.
  const dFromKey = dateFrom ? dateFrom.slice(0, 10) : undefined;
  const dToKey = dateTo ? dateTo.slice(0, 10) : undefined;
  const filteredAgg = useMemo(() => {
    if (procActive) {
      const events = rawRowsToAggEvents(procRows.filter(matchesFilters));
      return events.filter(
        (e) =>
          (!dFromKey || e.event_date >= dFromKey) &&
          (!dToKey || e.event_date <= dToKey) &&
          // Maturidade: recorta os eventos do procedimento à janela do cliente também.
          inMatWindow(e.client, e.event_date)
      );
    }
    return aggRows.filter(matchesFiltersAgg);
  }, [procActive, procRows, matchesFilters, aggRows, matchesFiltersAgg, dFromKey, dToKey, inMatWindow]);
  // Lead-times: linhas cruas escopadas ao período, mesmos filtros client-side. Com maturidade
  // ativa, recorta pelo created_at do lead dentro da janela do cliente.
  const filteredLeadTime = useMemo(
    () => leadTimeRows.filter((r) => matchesFilters(r) && inMatWindow(r.client, (r as { created_at?: string }).created_at)),
    [leadTimeRows, matchesFilters, inMatWindow]
  );

  // Investimento (spend) só faz sentido para Meta Ads e Google Ads.
  // Quando o filtro de origem está ativo: incluir spend apenas das origens Ads selecionadas.
  const filteredAds = useMemo(() => {
    let base = adsRows.filter((r) => !isExcludedClient(r.Client, "crm")); // cliente encerrado
    // Maturidade: investimento/leads tráfego recortados ao Dia dentro da janela do cliente.
    if (matWindowActive) base = base.filter((r) => inMatWindow(r.Client, r.Dia));
    // Split de "leads tráfego" por médico. Dois casos:
    //  (a) contas SEPARADAS por médico (Lia/Moacir) → r.medico vem de adsMedicoForClient; só
    //      entra quando o médico está selecionado. Contas sem médico (r.medico == null) não se
    //      dividem — seguem o comportamento antigo (o filtro não mexe no leads tráfego delas).
    //  (b) conta ÚNICA dividida por NOME de campanha (Carla) → r.medico vem do nome da campanha
    //      (campaignMedicoFromName em splitAdsRows), nunca null: campanha genérica = MEDICO_VAZIO,
    //      então só entra com "Sem médico" selecionado. Ambos passam pelo mesmo predicado.
    if (medicoSelected.length > 0) {
      base = base.filter((r) => r.medico == null || medicoSelected.includes(r.medico));
    }
    if (origemSelected.length === 0) return base;
    const wantsMeta = origemSelected.includes("Meta Ads");
    const wantsGoogle = origemSelected.includes("Google Ads");
    if (!wantsMeta && !wantsGoogle) return [];
    return base.filter((r) => {
      if (wantsMeta && (r.Fonte_Ads === "Meta" || r.Fonte_Ads === "Facebook")) return true;
      if (wantsGoogle && r.Fonte_Ads === "Google") return true;
      // fallback interno (sem Fonte_Ads): aceitar se alguma das duas Ads selecionada
      if (!usingExternalAds && r.Fonte_Ads === undefined && (wantsMeta || wantsGoogle)) return true;
      return false;
    });
    // visVersao NÃO aparece no corpo de propósito: ela é o sinal de que o store de
    // clientes visíveis mudou (isExcludedClient lê estado de módulo, que o lint não
    // enxerga). Tirar a dep faz a lista congelar na versão pré-carregamento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adsRows, origemSelected, usingExternalAds, medicoSelected, matWindowActive, inMatWindow, visVersao]);

  // Base do Faturamento Bruto escolhida por cliente (persistida, compartilhada entre
  // contas). resolveBasis aplica a escolha de cada cliente no agregado.
  const { resolveBasis, setBasis, saving: savingBasis } = useFaturamentoConfig();

  const merged = useMemo(
    () => mergeKommoAgg(filteredAgg, filteredAds),
    [filteredAgg, filteredAds]
  );
  const totalsBase = useMemo(() => calcTotals(merged, resolveBasis), [merged, resolveBasis]);

  // Correções manuais dos números do CRM (Leads/Consultas/Procedimentos) por VIEW filtrado.
  // A assinatura é o FILTRO INTEIRO que afeta os totais (cliente + médico + origem + período),
  // então a correção só se aplica exatamente ao view editado. O valor gravado SUBSTITUI o
  // calculado e cola no recorte (regra "sempre fixo"), até ser removido.
  const { filterSig, columns: overrideCols } = useMemo(
    () =>
      buildFilterSig({
        client: clientFilter,
        medico: medicoSelected,
        origem: origemSelected,
        from: dateFrom,
        to: dateTo,
        procedimento: procScope, // "" quando não é recorte por procedimento → sig inalterada
      }),
    [clientFilter, medicoSelected, origemSelected, dateFrom, dateTo, procScope]
  );

  // Decomposição do recorte atual em sub-recortes "atômicos" cuja correção manual OU
  // contribuição calculada do banco é somada para formar o total — comportando-se IGUAL ao
  // banco (total = soma das partes). Dois eixos, que se combinam (produto cartesiano):
  //   • MÊS  — quando o período abrange ≥2 meses (ex.: filtro por ANO). Cada mês fechado casa
  //            com a chave "m:AAAA-MM" em que o preenchimento manual por mês foi gravado; o
  //            mês corrente vira "mtd:AAAA-MM". Sem isto, filtrar o ano gera uma chave "r:..."
  //            que não bate com nenhum mês → o total manual "some".
  //   • ORIGEM — quando ≥2 origens filtradas (comportamento que já existia).
  // Cada célula entra com a SUA correção (se houver) ou com a SUA contribuição do banco; o
  // combinado só rende valor quando ALGUMA célula tem correção (ver componentValue). Uma só
  // célula (mês único + <2 origens) → [] (a própria filterSig já é o recorte). Filtro de
  // procedimento SEM escopo (procActive && !procScoped: p.ex. ≥2 procedimentos, ou cliente
  // fora de Diego/Pablo) desativa correções; COM escopo (procScoped) decompomos igual, só que
  // cada sub-sig leva o segmento "proc:" (a coorte do `filteredAgg` já é a do procedimento).
  const overrideComponents = useMemo(() => {
    // Maturidade ativa: o recorte é a janela POR cliente (não um período único) → as correções
    // manuais, assinadas pelo período global, não se aplicam. Desliga como no procedimento.
    if ((procActive && !procScoped) || matWindowActive) return [];
    const monthCells = monthCellsInRange(dFromKey, dToKey);
    const multiMonth = monthCells.length >= 2;
    const multiOrigin = origemSelected.length >= 2;
    // SEM origem marcada = "puxa tudo": o total combina TODAS as origens. Para as correções
    // manuais lançadas POR ORIGEM (ex.: Instagram, Meta Ads) aparecerem nesse total combinado,
    // decompomos por todas as origens candidatas e somamos, por origem, a correção manual OU o
    // calculado do banco — igual ao banco (total = soma das partes). Um cliente SEM dado no
    // Kommo (ex.: Pablo Fonseca) só tem as origens nas próprias correções, então além das
    // origens presentes nos dados incluímos as canônicas (as sem correção entram com 0).
    const noOrigin = origemSelected.length === 0;
    const decomposeOrigin = multiOrigin || noOrigin;
    if (!multiMonth && !decomposeOrigin) return [];

    // Eixo período: por mês (multi-mês) ou o período inteiro como uma peça só.
    const periods: { from?: string; to?: string }[] = multiMonth
      ? monthCells.map((c) => ({ from: c.from, to: c.to }))
      : [{ from: dateFrom, to: dateTo }];
    // Eixo origem: as ≥2 selecionadas; ou (sem origem marcada) todas as candidatas
    // (presentes nos dados + canônicas); ou o filtro atual como uma peça só.
    const origins: (string | null)[] = multiOrigin
      ? origemSelected
      : noOrigin
      ? [...new Set([...origens, ...CANONICAL_ORIGENS])]
      : [null];

    const cells: { sig: string; calc: OverrideMetricValues }[] = [];
    for (const p of periods) {
      for (const o of origins) {
        const sig = buildFilterSig({
          client: clientFilter,
          medico: medicoSelected,
          origem: o != null ? [o] : origemSelected,
          from: p.from,
          to: p.to,
          procedimento: procScope,
        }).filterSig;
        let sub = filteredAgg;
        if (o != null) sub = sub.filter((r) => canonicalOrigem(r.origem) === o);
        if (multiMonth) sub = sub.filter((r) => r.event_date >= p.from! && r.event_date <= p.to!);
        const totalsCell = calcTotals(mergeKommoAgg(sub, []), resolveBasis);
        cells.push({ sig, calc: overrideValuesFromTotals(totalsCell) });
      }
    }
    return cells;
  }, [procActive, procScoped, matWindowActive, procScope, dFromKey, dToKey, origemSelected, origens, clientFilter, medicoSelected, dateFrom, dateTo, filteredAgg, resolveBasis]);

  // Valores calculados do recorte atual — passados ao override como "trava de cálculo" do
  // rollup por procedimento (a soma por procedimento só preenche métrica com calculado 0).
  const selfCalc = useMemo(() => overrideValuesFromTotals(totalsBase), [totalsBase]);
  const overrides = useCRMOverrides(filterSig, overrideCols, overrideComponents, selfCalc);

  // `totals` = calculado com as correções aplicadas. Como funnelData/clientTable também
  // derivam de `totals`/`merged`, o funil de conversão acompanha a correção (consistente).
  // Com o filtro de procedimento ativo NÃO aplicamos correções manuais: a assinatura do
  // override (buildFilterSig) só considera cliente/médico/origem/período — não o
  // procedimento — então colar um override do cliente inteiro sobre a coorte de um
  // procedimento daria número errado. Sem procedimento, comportamento intocado.
  // Base efetiva p/ recomputar o Faturamento quando um VALOR é corrigido: com 1 cliente
  // filtrado usamos a base salva dele; no agregado, a base padrão (realizadas+realizados).
  const overrideBasis = useMemo(
    () => (clientFilter && clientFilter !== "all" ? resolveBasis(clientFilter) : DEFAULT_FAT_BASIS),
    [clientFilter, resolveBasis]
  );
  const totals = useMemo(
    () => {
      if ((procActive && !procScoped) || matWindowActive) return totalsBase;
      const out = applyTotalsOverrides(totalsBase, overrides.get, overrideBasis);
      // Breakdown por origem (Meta Ads / Google Ads, sob "Leads CRM"): quando há correção
      // manual salva para a origem ISOLADA, ela manda no número do detalhamento — mesmo que o
      // view atual não esteja recortado por aquela origem (ex.: página do cliente sem filtro de
      // origem). A correção de "todas as origens" (overrides.get) fica no total; a de cada
      // origem fica no seu sub-número. Só aplicamos a uma origem que esteja no escopo (sem
      // filtro de origem = todas; senão só as marcadas) p/ não injetar número em origem oculta.
      const scope = {
        client: clientFilter,
        medico: medicoSelected,
        origem: origemSelected,
        from: dateFrom,
        to: dateTo,
        procedimento: procScope,
      };
      const applyMeta = origemSelected.length === 0 || origemSelected.includes("Meta Ads");
      const applyGoogle = origemSelected.length === 0 || origemSelected.includes("Google Ads");
      const metaOv = applyMeta
        ? overrides.component(buildOrigemSig(scope, "Meta Ads"), "leads", out.leadsCRMMeta)
        : undefined;
      const googleOv = applyGoogle
        ? overrides.component(buildOrigemSig(scope, "Google Ads"), "leads", out.leadsCRMGoogle)
        : undefined;
      if (metaOv == null && googleOv == null) return out;
      const withBreakdown = out === totalsBase ? { ...out } : out;
      if (metaOv != null) withBreakdown.leadsCRMMeta = metaOv;
      if (googleOv != null) withBreakdown.leadsCRMGoogle = googleOv;
      return withBreakdown;
    },
    [procActive, procScoped, matWindowActive, totalsBase, overrides, overrideBasis, clientFilter, medicoSelected, origemSelected, dateFrom, dateTo, procScope]
  );
  const funnelData = useMemo(() => calcFunnel(totals), [totals]);
  const leadTimes = useMemo(
    () => calcLeadTimes(filteredLeadTime, dateFrom, dateTo),
    [filteredLeadTime, dateFrom, dateTo]
  );
  const clientTable = useMemo(() => calcClientTable(merged, resolveBasis), [merged, resolveBasis]);
  const origemFunnel = useMemo(() => calcOrigemFunnelAgg(filteredAgg), [filteredAgg]);
  // Funil por TAG de cliente (só rende quando há atribuições). filteredAgg já respeita o recorte
  // de tag selecionado; a contagem herda as tags do cliente de cada linha agregada.
  const tagFunnel = useMemo<TagFunnelRow[]>(() => calcTagFunnelAgg(filteredAgg), [filteredAgg]);
  // Evolução mensal: eventos do CRM (leads/consultas/procedimentos + faturamento por base)
  // + Ads por Dia (investimento/leads tráfego). Usa os MESMOS filteredAgg/filteredAds/basis
  // dos cards, então cada mês bate com os totais do período.
  const monthlyEvolutionBase = useMemo(
    () => calcMonthlyEvolutionAgg(filteredAgg, filteredAds, resolveBasis),
    [filteredAgg, filteredAds, resolveBasis]
  );
  // Correções manuais dos números do CRM aplicadas POR MÊS na evolução — para as barras
  // acompanharem as correções feitas nos cards de totais (e voltarem ao banco quando a
  // correção é removida). Herdam o MESMO cliente/médico/origem do recorte atual; cada mês
  // recorta o período ao próprio mês (interseção com o range). Com filtro de procedimento
  // ativo NÃO aplicamos correções (idêntico aos totais em `totals`).
  const monthKeys = useMemo(() => monthlyEvolutionBase.map((m) => m.month), [monthlyEvolutionBase]);
  const monthlyOverrides = useCRMMonthlyOverrides(
    monthKeys,
    { client: clientFilter, medico: medicoSelected, origem: origemSelected, procedimento: procScope },
    dFromKey,
    dToKey,
  );
  const monthlyEvolution = useMemo(
    () =>
      (procActive && !procScoped) || matWindowActive
        ? monthlyEvolutionBase
        : monthlyEvolutionBase.map((m) =>
            applyEvolutionOverrides(m, (metric) => monthlyOverrides.getMonth(m.month, metric), overrideBasis)
          ),
    [procActive, procScoped, matWindowActive, monthlyEvolutionBase, monthlyOverrides, overrideBasis]
  );
  // Leads enviados orçamento (status atual = "Orçamento"), aplicando os filtros
  // client-side de cliente/médico/origem E o filtro de período pela DATA DE ORÇAMENTO
  // ENVIADO (com fallback p/ created_at) — mesma data usada dentro de calcOrcamentoParado,
  // para a janela de maturidade não divergir do recorte de período. Sem data → total geral.
  const orcamentoParado = useMemo(
    () =>
      calcOrcamentoParado(
        orcamentoRows.filter(
          (r) =>
            matchesFilters(r) &&
            inMatWindow(r.client, getOrcamentoSentDate(r) ?? (r as { created_at?: string }).created_at)
        ),
        dateFrom,
        dateTo
      ),
    [orcamentoRows, matchesFilters, inMatWindow, dateFrom, dateTo]
  );

  return { totals, computedTotals: totalsBase, funnelData, leadTimes, origemFunnel, tagFunnel, monthlyEvolution, orcamentoParado, origens, tags, medicos, procedimentos, procActive, clients, clientTable, loading, error, resolveBasis, setBasis, savingBasis, overrides, overridePeriodLabel: overrideCols.period_label };
}
