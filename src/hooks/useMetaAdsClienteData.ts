import { useState, useEffect, useMemo } from "react";
import { externalSupabase } from "@/integrations/external-supabase/client";
import { startOfDayBRT, endOfDayBRT } from "@/utils/dateRange";
import { canonicalizeAdsClient, clientMatchKey, adsClientSearchCore, isExcludedClient, MEDICO_VAZIO, normalizeClientName, foldMergedAdsClient, adsMedicoForClient, campaignMedicoRules, campaignMedicoFromName, campaignMedicoOptions, accountMedicoRules, accountMedicoOptions } from "@/data/clienteAliases";

// Monta o filtro PostgREST `.or(...)` que casa o nome CRU do `Client` contra os sobrenomes das
// contas de um cliente agrupador (ADS_ACCOUNT_MEDICO_SPLIT). Em `.or()` o curinga do ilike é `*`
// (não `%`). Ex.: `Client.ilike.*davi*,Client.ilike.*colares*,Client.ilike.*kato*`. Usado
// quando o cliente selecionado reúne 2+ contas (uma por médico) — um `%core%` só pegaria uma.
function accountOrFilter(rules: { match: string[] }[]): string {
  return rules
    .flatMap((r) => r.match.map((m) => `Client.ilike.*${m}*`))
    .join(",");
}
import { inRange, origemKey, parseBRL } from "@/utils/crmCalculations";
import { ClienteAdsData } from "./useClientesData";
import { dedupedFetch, withRetry } from "./dataCache";
import { useClientesVisiveis } from "@/hooks/useClientesVisiveis";
import { CAPTACAO_FILTER, CAPTACAO_ILIKE, isCaptacaoClient } from "@/lib/captacao";

// Só as colunas realmente lidas pelos agregados deste hook. Substitui o `select("*")`
// (que trazia ~45 colunas por linha, incl. campos de Google e ROAS não usados aqui) →
// payload menor e download mais rápido. "Impressões" tem acento, então vai entre aspas.
const META_ADS_SELECT =
  "id, Dia, Client, Valor_usado_BRL, Lead, \"Impressões\", Cliques_no_link, Alcance, Frequencia, Video_views_3s, Video_views_95pct, Orcamento_diario, Mensagens_iniciadas, Custo_por_Lead, Custo_por_mensagem, Resultados_meta, Nome_Campanha, Visitas_perfil, Tipo_de_resultado, Quality_ranking, Engagement_ranking, Conversion_ranking";

// Desloca uma data civil "YYYY-MM-DD" por n dias (undefined → undefined).
function shiftDays(dateStr: string | undefined, n: number): string | undefined {
  if (!dateStr) return undefined;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(d.getTime())) return undefined;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface MonthlyEvolution {
  month: string;
  label: string;
  leads: number;
  cpl: number;
  // "Lead tráfego" = Lead + Mensagens iniciadas (mesma definição dos cards e do relatório
  // Telegram). cplTrafego = investimento / leadsTráfego. O gráfico de evolução usa estes.
  leadsTrafego: number;
  cplTrafego: number;
  investimento: number;
  impressoes: number;
  cpm: number;
  cliques: number;
  cpc: number;
  alcance: number;
}

export interface CampaignSummary {
  campanha: string;
  investimento: number;
  leadsTrafico: number;
  cplTrafico: number;
  alcance: number;
  frequencia: number;
  impressoes: number;
  cpm: number;
  ctr: number;
  cpc: number;
  cliques: number;
  tipoResultado: string;
  resultados: number;
  custoResultado: number;
  bounceLead: number;
  bounceConversa: number;
  // Vídeo vindo direto da API do Meta (via Composio → Supabase)
  videoViews3s: number;
  videoViews95pct: number;
  hook: number;
  hold: number;
  // Campos adicionais coletados pelo bot (preenchem o relatório Telegram tb)
  orcamento: number;
  mensagens: number;
  custoMensagem: number;
  visitas: number;
  custoVisita: number;
  qualityRanking: string | null;
  engagementRanking: string | null;
  conversionRanking: string | null;
  // Campos que dependem de outra tabela (placeholder)
  leadsCRM: number | null;
  cplCRM: number | null;
  consultasAgen: number | null;
  cac: number | null;
  fatBruto: number | null;
  roas: number | null;
}

// `kommoScopeNames` (opcional): quando presente (usuário-cliente), restringe o fetch de Kommo
// (v_kommo_completa) a esses slugs no SERVIDOR via `.in("client", ...)`. Sem ele o fetch traz
// TODOS os leads do período e filtra client-side (comportamento normal da equipe). Para o
// usuário-cliente é essencial: sem o filtro, a varredura completa sob a condição de escopo (RLS)
// estoura o statement timeout → Leads CRM/CPL da tela Meta vêm 0. A RLS segue como trava.
export function useMetaAdsClienteData(clientFilter?: string, dateFrom?: string, dateTo?: string, medicoFilter?: string | string[], kommoScopeNames?: string[]) {
  // Carteira visível: o filtro por ATIVO/ocultos roda DENTRO do fetch abaixo, então a
  // versão entra nas deps do efeito — quando as fontes chegam, o efeito repete (servido pelo
  // cache do dedupedFetch) e re-filtra o que já estava em tela.
  const visVersao = useClientesVisiveis();
  // Médicos selecionados (normalizado): [] = todos. O filtro é compartilhado entre telas e
  // virou multi-seleção; aqui aceitamos array ou string única (retrocompat).
  const medicoSel = useMemo<string[]>(() => {
    if (!medicoFilter) return [];
    const arr = Array.isArray(medicoFilter) ? medicoFilter : [medicoFilter];
    return arr.filter((v) => v && v !== "all");
  }, [medicoFilter]);
  // Modo captação (mídia própria da Groohub): isola a conta cujo `Client` é exatamente
  // "Groohub" (sem canonicalização) e não atribui leads do CRM. Ver src/lib/captacao.ts.
  const captacao = clientFilter === CAPTACAO_FILTER;
  const [data, setData] = useState<ClienteAdsData[]>([]);
  const [reachMensal, setReachMensal] = useState<Array<{ Client: string; Mes: string; Alcance: number }>>([]);
  // Reach ON-DEMAND do período EXATO selecionado (busca no Meta via /api/meta-reach). null =
  // indisponível → cai no reach mensal (reachDedup) e depois na soma diária. Reach não é aditivo:
  // só o Meta calcula o reach único de um range arbitrário; isto faz a frequência bater com o
  // Meta em QUALQUER período (não só no mês fechado). Ver reach-service.ts no meta-ads-bot.
  const [reachOnDemand, setReachOnDemand] = useState<number | null>(null);
  const [kommoRaw, setKommoRaw] = useState<any[]>([]);
  const [kommoData, setKommoData] = useState<{ Campanha: string; count: number; fatBruto: number; consultasAgen: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Reprograma com backoff (cap 15s) em vez de pintar a tela com 0 quando um fetch
    // transitório falha/volta vazio — mesma política do useClientesData/useCRMClienteData.
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
    async function fetchData() {
      setLoading(true);
      try {
        const PAGE = 1000;
        // CONCURRENCY=4 espelha o useCRMClienteData: pagina em paralelo (4 requests por
        // rodada) em vez de sequencial, cortando o wall-clock do fetch "all"; acima de ~4
        // o pool do PostgREST enfileira e PIORA o total.
        const CONCURRENCY = 4;
        const MAX_ROWS = 100000;

        // Quando um cliente está selecionado, restringimos o fetch a ELE no servidor via
        // `.ilike("Client", "%core%")` (core = nome sem título/sufixo). Casa todas as
        // variantes do nome da conta (ex.: "Dr." e "Dra."), inclusive períodos antigos após
        // renomeação, e mantém o resultado pequeno (1 cliente) em vez de puxar TODOS os
        // clientes do período — evita o fetch gigante de vários meses (10+ páginas) que era
        // frágil e podia parar cedo, zerando meses antigos. Quando "all", puxa tudo.
        const core = clientFilter && clientFilter !== "all" ? adsClientSearchCore(clientFilter) : "";
        // Cliente que AGRUPA várias contas (uma por médico), ex.: "Instituto Aurum" → contas
        // do Davi + Kato. O `%core%` só casaria UMA (o nome cru passado pela página é o da
        // 1ª conta), então usamos um `.or()` que casa TODAS as contas do grupo. O refiltro
        // canônico client-side (scopedData) mantém só as linhas deste cliente. Vazio = não agrupa.
        const acctRules = captacao ? [] : accountMedicoRules(clientFilter);
        const acctOr = acctRules.length ? accountOrFilter(acctRules) : "";
        // Chave de cache/escopo: canônico quando agrupa contas (o core só reflete a 1ª conta).
        const scopeKey = acctRules.length
          ? clientMatchKey(canonicalizeAdsClient(clientFilter))
          : (core || "all");

        // Uma página de Ads. withRetry cobre timeouts transitórios da view (57014).
        const fetchAdsRange = (from: number) =>
          withRetry(async () => {
            // ORDER BY estável (Dia + id único) é OBRIGATÓRIO com .range(): ordenar só por
            // "Dia" (não único) faz o PostgREST pular/duplicar linhas entre páginas, perdendo
            // dados quando o resultado passa de 1000 linhas. O tiebreaker por id garante
            // paginação determinística e completa.
            let q = externalSupabase
              .from("v_meta_google_ads")
              .select(META_ADS_SELECT)
              .in("Fonte_Ads", ["Meta", "Facebook"])
              .order("Dia", { ascending: false })
              .order("id", { ascending: false })
              .range(from, from + PAGE - 1);
            // Com cliente selecionado, o escopo é o nome-núcleo (`%core%`), que casa TODAS as
            // variantes da conta — inclusive períodos sob nome ANTIGO sem "groohub" após a conta
            // ser renomeada no Meta (ex.: "Bruno Moura" → "Dr. Bruno Moura - CA 1.1.1 | Groohub";
            // os meses antigos ficavam zerados porque o `%groohub%` hardcoded os excluía). O
            // `scopedData` (filtro canônico client-side abaixo) garante que só fiquem as linhas
            // DESTE cliente. Sem cliente ("all"), mantém o escopo da agência via `%groohub%`,
            // excluindo contas legadas não-groohub do agregado.
            // Captação: só as contas PRÓPRIAS da Groohub ("Groohub - CA X.X.X"), via prefixo
            // `Groohub%` — NÃO `%groohub%`, que casaria todos os clientes "X | Groohub".
            if (captacao) q = q.ilike("Client", CAPTACAO_ILIKE);
            else if (acctOr) q = q.or(acctOr);
            else if (core.length >= 3) q = q.ilike("Client", `%${core}%`);
            else q = q.ilike("Client", "%groohub%");
            if (dateFrom) q = q.gte("Dia", dateFrom);
            if (dateTo) q = q.lte("Dia", dateTo);
            const { data, error } = await q;
            if (error) throw error;
            return ((data as unknown) as ClienteAdsData[]) || [];
          });

        // Cache (5 min) + coalescing por escopo+período: reabrir a página / navegar de volta
        // dentro da janela reaproveita o resultado em memória em vez de refazer todo o fetch.
        const adsKey = `metaads:${captacao ? "captacao" : scopeKey}:${dateFrom || ""}:${dateTo || ""}`;
        const fetchAllAds = (): Promise<ClienteAdsData[]> =>
          dedupedFetch(adsKey, async () => {
            const all: ClienteAdsData[] = [];
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
            return all;
          });

        const createdAtGte = dateFrom ? `${dateFrom}T00:00:00.000+00:00` : undefined;
        const createdAtLte = dateTo ? `${dateTo}T23:59:59.999+00:00` : undefined;
        // Uma página de Kommo. NÃO filtra por `client` no DB: no Kommo o `client` é o slug
        // (ex.: "Vasculare"), enquanto o clientFilter desta página é o nome longo da conta do Ads
        // ("VascuLare - CA 1.1.1 | Groohub"). O match é feito client-side via clientMatchKey
        // (ver selectedClientKey). O escopo já é groohub (CRM inteiro é groohub).
        const fetchKommoRange = (from: number) =>
          withRetry(async () => {
            let q = externalSupabase
              .from("v_kommo_completa")
              .select("id, Campanha, client, Origem, \"Médico\", \"Médicos\", \"Valor da Consulta\", \"Valor do Procedimento\", \"Consulta Agendada Em\", created_at")
              // ORDER BY estável é OBRIGATÓRIO com .range() — sem ele o PostgREST pode
              // repetir/pular linhas entre páginas, duplicando leads e inflando a contagem.
              .order("id", { ascending: true })
              .range(from, from + PAGE - 1);
            // Janela = exatamente o intervalo de datas em UTC (created_at é UTC), igual à
            // semântica de toDateKey/inRange usada no CRM — assim os dois contam o mesmo set.
            if (createdAtGte) q = q.gte("created_at", createdAtGte);
            if (createdAtLte) q = q.lte("created_at", createdAtLte);
            // Usuário-cliente: restringe ao(s) slug(s) do cliente no servidor (query pequena →
            // sem timeout que zerava Leads CRM/CPL). Equipe não passa isso → traz tudo (igual).
            if (kommoScopeNames && kommoScopeNames.length) {
              q = kommoScopeNames.length > 1 ? q.in("client", kommoScopeNames) : q.eq("client", kommoScopeNames[0]);
            }
            const { data, error } = await q;
            if (error) throw error;
            return (data as any[]) || [];
          });

        // Kommo: normalmente independe do cliente (match client-side) → chave só por período.
        // Com escopo de usuário-cliente, a chave inclui o(s) slug(s) p/ não misturar no cache.
        const kommoKey = `metaads-kommo:${kommoScopeNames?.join(",") || ""}:${dateFrom || ""}:${dateTo || ""}`;
        const fetchAllKommo = (): Promise<any[]> =>
          dedupedFetch(kommoKey, async () => {
            const all: any[] = [];
            for (let from = 0; from < MAX_ROWS; from += PAGE * CONCURRENCY) {
              const offsets: number[] = [];
              for (let i = 0; i < CONCURRENCY; i++) {
                const o = from + i * PAGE;
                if (o < MAX_ROWS) offsets.push(o);
              }
              const batches = await Promise.all(offsets.map(fetchKommoRange));
              let stop = false;
              for (const b of batches) {
                all.push(...b);
                if (b.length < PAGE) stop = true;
              }
              if (stop) break;
            }
            return all;
          });

        // Alcance (reach) DEDUPLICADO por mês — a Meta só devolve reach único consultando o
        // período inteiro; somar o Alcance diário superconta a mesma pessoa. Lido da tabela
        // meta_ads_reach_mensal (ingestor reach-mensal.ts). Tabela ausente/erro → [] → o total
        // cai no fallback da soma diária (comportamento antigo, sem quebrar).
        const firstOfMonth = (d?: string) => (d ? `${d.slice(0, 7)}-01` : undefined);
        const fetchReachMensal = () =>
          dedupedFetch(`reachmensal:${captacao ? "captacao" : scopeKey}:${dateFrom || ""}:${dateTo || ""}`, async () => {
            try {
              let q = externalSupabase.from("meta_ads_reach_mensal").select("Client, Mes, Alcance");
              if (captacao) q = q.ilike("Client", CAPTACAO_ILIKE);
              else if (acctOr) q = q.or(acctOr);
              else if (core.length >= 3) q = q.ilike("Client", `%${core}%`);
              else q = q.ilike("Client", "%groohub%");
              if (dateFrom) q = q.gte("Mes", firstOfMonth(dateFrom)!);
              if (dateTo) q = q.lte("Mes", dateTo);
              const { data, error } = await q;
              if (error) return [];
              return (data as any[]) || [];
            } catch {
              return [];
            }
          });

        const [adsData, kommoData, reachData] = await Promise.all([fetchAllAds(), fetchAllKommo(), fetchReachMensal()]);
        if (cancelled) return;
        // Guarda anti-zero: só no modo "all" (core vazio). Com cliente selecionado o fetch é
        // restrito a ELE e pode voltar legitimamente vazio (cliente sem Meta no período); no
        // "all", vazio é quase sempre falha transitória da view → segura o skeleton e re-tenta.
        if (!core && adsData.length === 0 && scheduleRetry("empty")) return;
        // Clientes encerrados não aparecem em lugar nenhum (totais, tabelas, filtros). EXCEÇÃO:
        // no modo captação as linhas são as contas PRÓPRIAS da Groohub ("Groohub - CA X.X.X"),
        // que NÃO são clientes da carteira (projetos_lista). O filtro de carteira ATIVA
        // (clienteAtivoPelaPlanilha, via isExcludedClient) as excluiria por não constarem na
        // planilha — esvaziando a página de Captação. O fetch já restringe a `Groohub%` e o
        // scopedData reforça com isCaptacaoClient, então aqui não reexcluímos em captação.
        const keepAds = (client: string | null | undefined) => captacao || !isExcludedClient(client, "meta");
        setData(adsData.filter((r) => keepAds(r.Client)));
        setReachMensal((reachData as any[]).filter((r) => keepAds(r.Client)) as any);
        setKommoRaw(kommoData.filter((r) => !isExcludedClient(r.client, "meta")));
        setError(null);
        setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        // Erro transitório (57014 após os retries internos) → segue tentando com skeleton.
        if (scheduleRetry("error")) return;
        setError(e.message || "Erro ao buscar dados");
        setLoading(false);
      }
    }
    void fetchData();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // Refaz quando muda a janela de datas OU o cliente (o fetch de Ads agora é restrito ao
    // cliente no servidor via core, então precisa refazer ao trocar de cliente). `kommoScope`
    // via string estável (join) p/ não recriar o efeito a cada render por nova referência.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, clientFilter, kommoScopeNames?.join(","), visVersao]);

  // Chave de match do cliente selecionado (nome longo do Ads → slug canônico → matchKey),
  // pra cruzar com o `client` (slug) do Kommo de forma tolerante a caixa/acento/underscore.
  const selectedClientKey = useMemo(
    () => (!captacao && clientFilter && clientFilter !== "all" ? clientMatchKey(canonicalizeAdsClient(clientFilter)) : null),
    [clientFilter, captacao]
  );

  // Linhas de Ads já restritas ao cliente selecionado, casando pelo slug canônico
  // (unifica variantes do nome da conta, ex.: "Dr." vs "Dra."). Quando "all", usa tudo.
  // Captação: só as linhas da conta "Groohub" EXATA (o fetch já as restringe; reforçamos aqui).
  // Split de campanhas por médico via NOME da campanha (ex.: Dra. Carla Gouveia). Vazio quando o
  // cliente não participa — aí `scopedData` não aplica nenhum filtro extra de médico.
  const campRules = useMemo(() => (captacao ? [] : campaignMedicoRules(clientFilter)), [captacao, clientFilter]);
  // Split por CONTA (cliente que agrupa várias contas, ex.: Instituto Aurum): o médico é
  // definido por qual conta (nome cru do Client) a campanha pertence, não pelo nome da campanha.
  const acctRules = useMemo(() => (captacao ? [] : accountMedicoRules(clientFilter)), [captacao, clientFilter]);
  const scopedData = useMemo(() => {
    let rows = captacao
      ? data.filter((r) => isCaptacaoClient(r.Client))
      : selectedClientKey
      ? data.filter((r) => clientMatchKey(canonicalizeAdsClient(r.Client)) === selectedClientKey)
      : data;
    // Cliente com split por médico + médico selecionado → só as linhas daquele médico (totais,
    // cards e resumo acompanham a hierarquia). Sem seleção = tudo. Split por CONTA (acctRules)
    // casa o nome da conta; split por CAMPANHA (campRules) casa o nome da campanha.
    if (acctRules.length && medicoSel.length > 0) {
      rows = rows.filter((r) => medicoSel.includes(campaignMedicoFromName(acctRules, r.Client) ?? MEDICO_VAZIO));
    } else if (campRules.length && medicoSel.length > 0) {
      rows = rows.filter((r) => medicoSel.includes(campaignMedicoFromName(campRules, r.Nome_Campanha) ?? MEDICO_VAZIO));
    }
    return rows;
  }, [data, selectedClientKey, captacao, campRules, acctRules, medicoSel]);

  // Alcance DEDUPLICADO do período (reach de gente única, da Meta). Soma o reach mensal só dos
  // pares (Client, mês) que realmente aparecem no scopedData — assim respeita cliente/período
  // sem contar meses sem entrega. Mês único/fechado → EXATO (bate com o Meta Ads Manager).
  // Multi-mês → soma dos meses (aproxima; a Meta só dedup dentro de cada consulta de período).
  // Sem dados na tabela (ainda não ingerido) → null → o total cai no fallback da soma diária.
  const reachDedup = useMemo<number | null>(() => {
    if (!reachMensal.length || !scopedData.length) return null;
    // Casa por chave CANÔNICA do cliente (não nome cru) + mês — assim meses antigos sob nome
    // antigo (conta renomeada Dr.→Dra.) também batem com o reach gravado sob o nome atual.
    const ck = (c: string) => clientMatchKey(canonicalizeAdsClient(c));
    const monthsInData = new Set(scopedData.map((r) => `${ck(r.Client)}|${String(r.Dia).slice(0, 7)}`));
    let sum = 0, any = false;
    for (const rr of reachMensal) {
      if (monthsInData.has(`${ck(rr.Client)}|${String(rr.Mes).slice(0, 7)}`)) { sum += rr.Alcance || 0; any = true; }
    }
    return any ? sum : null;
  }, [reachMensal, scopedData]);

  // Busca o reach EXATO do período selecionado no Meta (endpoint read-only /api/meta-reach).
  // GARANTIA de não-regressão: só adota o valor on-demand quando TODAS as contas do escopo
  // casaram (consistência total); qualquer falha/parcial/timeout → reachOnDemand=null e o card
  // segue no fallback (reachDedup mensal → soma diária). Guardado contra respostas obsoletas.
  useEffect(() => {
    let cancelled = false;
    if (!dateFrom || !dateTo || !scopedData.length) { setReachOnDemand(null); return; }
    const names = [...new Set(scopedData.map((r) => r.Client).filter(Boolean))] as string[];
    if (!names.length || names.length > 60) { setReachOnDemand(null); return; }
    (async () => {
      try {
        const url = `/api/meta-reach?since=${dateFrom}&until=${dateTo}&clients=${encodeURIComponent(JSON.stringify(names))}`;
        const { data: { session } } = await externalSupabase.auth.getSession();
        const res = await fetch(url, { headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}, signal: AbortSignal.timeout(85_000) });
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        const results: Array<{ matched?: boolean; reach?: number }> = Array.isArray(json?.results) ? json.results : [];
        const allMatched = results.length === names.length && results.every((x) => x.matched);
        const sum = results.reduce((s, x) => s + (x.reach || 0), 0);
        if (!cancelled) setReachOnDemand(allMatched && sum > 0 ? sum : null);
      } catch {
        if (!cancelled) setReachOnDemand(null); // fallback silencioso — nunca quebra o card
      }
    })();
    return () => { cancelled = true; };
  }, [scopedData, dateFrom, dateTo]);

  // Chave de match do cliente para o CRM/Kommo. DIFERE da selectedClientKey (usada nos Ads):
  // no CRM contas de médicos que dividem o mesmo cliente são FUNDIDAS (foldMergedAdsClient),
  // ex.: "Dr. Moacir Vitório" (conta de Ads própria) → cliente "Lia Garrido" (Clínica Bellucci).
  // Sem a fusão a conta do Moacir não casaria NENHUM lead do CRM (o Kommo dele vive sob o
  // slug do cliente compartilhado). No lado do Kommo aplicamos normalizeClientName para
  // resolver o alias (Clínica_Bellucci → Lia_Garrido), igual ao useCRMClienteData.
  const crmClientKey = useMemo(
    () =>
      captacao
        ? // Captação não tem pipeline de clientes no Kommo: uma chave que não casa nenhum
          // lead zera Leads CRM/CPL CRM (igual ao protótipo, que mostra "—").
          "__captacao_sem_crm__"
        : clientFilter && clientFilter !== "all"
        ? clientMatchKey(foldMergedAdsClient(canonicalizeAdsClient(clientFilter)))
        : null,
    [clientFilter, captacao]
  );

  // Médico "dono" da conta de Ads selecionada (Lia → "Dra. Lia", Moacir → "Dr. Moacir").
  // Quando várias contas de Ads compartilham o mesmo cliente do CRM, é o ÚNICO jeito de
  // separar os leads de cada médico dentro do Kommo. null = a conta não participa de split
  // (nenhuma restrição extra de médico é aplicada). Escopa os "Leads CRM"/"CPL CRM" da tela.
  const autoMedico = useMemo(() => adsMedicoForClient(clientFilter), [clientFilter]);

  // Re-agrega kommoData filtrado por médico
  useEffect(() => {
    // Usa o parseBRL canônico (crmCalculations) — trata ponto como decimal quando
    // não é milhar (PostgREST numeric→"350.00") e soma células multivalor. Evita o
    // ×100 que inflava o Faturamento Bruto.
    const campMap = new Map<string, { count: number; fatBruto: number; consultasAgen: number }>();
    for (const row of kommoRaw) {
      if (!row.Campanha) continue;
      // Filtra por dia (data civil) igual ao CRM — a janela do fetch é alargada ±1 dia.
      if (!inRange(row.created_at, dateFrom, dateTo)) continue;
      if (crmClientKey && clientMatchKey(normalizeClientName(row.client)) !== crmClientKey) continue;
      const medicoRow = ((row["Médico"] || row["Médicos"] || "")).trim();
      // Escopo automático por médico-dono da conta: na tela da Lia só entram os leads da
      // Lia; na do Moacir só os do Moacir — separando os dois dentro do cliente compartilhado.
      if (autoMedico && medicoRow !== autoMedico) continue;
      if (medicoSel.length > 0) {
        if (!medicoSel.includes(medicoRow === "" ? MEDICO_VAZIO : medicoRow)) continue;
      }
      const existing = campMap.get(row.Campanha) || { count: 0, fatBruto: 0, consultasAgen: 0 };
      existing.count += 1;
      existing.fatBruto += parseBRL(row["Valor da Consulta"]) + parseBRL(row["Valor do Procedimento"]);
      if (row["Consulta Agendada Em"]) existing.consultasAgen += 1;
      campMap.set(row.Campanha, existing);
    }
    setKommoData(Array.from(campMap.entries()).map(([Campanha, v]) => ({ Campanha, count: v.count, fatBruto: v.fatBruto, consultasAgen: v.consultasAgen })));
  }, [kommoRaw, medicoSel, crmClientKey, autoMedico, dateFrom, dateTo]);

  // Lista de médicos (apenas com cliente filtrado)
  const medicos = useMemo(() => {
    if (!clientFilter || clientFilter === "all") return [];
    const set = new Set<string>();
    for (const r of kommoRaw) {
      if (crmClientKey && clientMatchKey(normalizeClientName(r.client)) !== crmClientKey) continue;
      const m = ((r["Médico"] || r["Médicos"] || "")).trim();
      // Em cliente compartilhado, restringe ao médico-dono da conta selecionada.
      if (autoMedico && m !== autoMedico) continue;
      if (m) set.add(m);
    }
    // Clientes com split por NOME de campanha (ex.: Dra. Carla Gouveia) não têm pipeline no
    // Kommo — as opções de médico vêm das regras de campanha. Para quem tem Kommo, soma.
    for (const m of campaignMedicoOptions(clientFilter)) set.add(m);
    // Cliente que agrupa várias contas (ex.: Instituto Aurum): opções de médico = as contas.
    for (const m of accountMedicoOptions(clientFilter)) set.add(m);
    return [...set].sort();
  }, [kommoRaw, clientFilter, crmClientKey, autoMedico]);

  // Total de leads no CRM (Kommo) com marcação de origem "Meta Ads", respeitando os
  // mesmos filtros de cliente/médico/data da página. Conta por dia (data civil) com
  // inRange e casa a origem por chave normalizada — idêntico ao CRM, pra os dois baterem.
  const metaOrigemKey = origemKey("Meta Ads");
  const leadsCRMMeta = useMemo(() => {
    let count = 0;
    for (const row of kommoRaw) {
      if (!inRange(row.created_at, dateFrom, dateTo)) continue;
      if (crmClientKey && clientMatchKey(normalizeClientName(row.client)) !== crmClientKey) continue;
      const medicoRow = ((row["Médico"] || row["Médicos"] || "")).trim();
      if (autoMedico && medicoRow !== autoMedico) continue;
      if (medicoSel.length > 0) {
        if (!medicoSel.includes(medicoRow === "" ? MEDICO_VAZIO : medicoRow)) continue;
      }
      if (origemKey(row.Origem) === metaOrigemKey) count += 1;
    }
    return count;
  }, [kommoRaw, crmClientKey, autoMedico, medicoSel, dateFrom, dateTo, metaOrigemKey]);

  const totals = useMemo(() => {
    const spend = scopedData.reduce((s, r) => s + (r.Valor_usado_BRL || 0), 0);
    const leads = scopedData.reduce((s, r) => s + (r.Lead || 0), 0);
    const impressions = scopedData.reduce((s, r) => s + (r.Impressões || 0), 0);
    const clicks = scopedData.reduce((s, r) => s + (r.Cliques_no_link || 0), 0);
    // Reach NÃO é aditivo: usamos o alcance deduplicado do mês (Meta) quando disponível;
    // só caímos na soma diária (reachSum) como fallback enquanto a tabela não tiver o dado.
    const reachSum = scopedData.reduce((s, r) => s + (r.Alcance || 0), 0);
    // Prioridade: reach EXATO do período (on-demand Meta) → reach dedup mensal → soma diária.
    const reach = reachOnDemand ?? reachDedup ?? reachSum;
    // Frequência agregada = impressões / alcance (mesma fórmula do Meta UI). Com o reach do
    // período exato, a frequência bate com o Meta em qualquer intervalo selecionado.
    const frequency = reach > 0 ? impressions / reach : 0;
    const videoViews3s = scopedData.reduce((s, r) => s + (r.Video_views_3s || 0), 0);
    const videoViews95pct = scopedData.reduce((s, r) => s + (r.Video_views_95pct || 0), 0);
    const orcamento = scopedData.reduce((s, r) => s + (r.Orcamento_diario || 0), 0);
    const mensagens = scopedData.reduce((s, r) => s + (r.Mensagens_iniciadas || 0), 0);
    const metaResultados = scopedData.reduce((s, r) => s + (r.Resultados_meta || 0), 0);
    // Spend alocado a Lead/Conversa (numeradores do blended cost por Resultado)
    const spendLead = scopedData.reduce((s, r) => s + ((r.Lead || 0) * (r.Custo_por_Lead || 0)), 0);
    const spendConversa = scopedData.reduce((s, r) => s + ((r.Mensagens_iniciadas || 0) * (r.Custo_por_mensagem || 0)), 0);
    const resultados = leads + mensagens;
    // Visitas no perfil = Resultados nativos do Meta − conversas − leads (mesmo cálculo
    // do relatório Telegram). Custo das visitas = investimento − custo de leads − custo
    // de conversa (a sobra do spend não atribuída a Lead/Conversa).
    const visitas = Math.max(0, metaResultados - mensagens - leads);
    const custoVisitasTotal = Math.max(0, spend - spendLead - spendConversa);
    const modeFromCounts = (key: keyof ClienteAdsData): string | null => {
      const counts = new Map<string, number>();
      for (const r of scopedData) {
        const v = (r as any)[key];
        if (v) counts.set(String(v), (counts.get(String(v)) || 0) + 1);
      }
      if (counts.size === 0) return null;
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    };

    return {
      spend,
      leads,
      impressions,
      clicks,
      reach,
      frequency,
      // Todos os custos usam totalSpend / count (mesma definição do Meta UI):
      // Custo/Resultado = Valor_usado / (Lead + Conversa). Quando só um tipo
      // existe (ex.: Gustavo Nobre com Lead=0), Custo/Resultado == Custo/Conversa.
      cpl: leads > 0 ? spend / leads : 0,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      videoViews3s,
      videoViews95pct,
      hook: impressions > 0 ? (videoViews3s / impressions) * 100 : 0,
      hold: impressions > 0 ? (videoViews95pct / impressions) * 100 : 0,
      retencao95: videoViews3s > 0 ? (videoViews95pct / videoViews3s) * 100 : 0,
      orcamento,
      mensagens,
      custoMensagem: mensagens > 0 ? spend / mensagens : 0,
      visitas,
      custoVisita: visitas > 0 ? custoVisitasTotal / visitas : 0,
      resultados,
      custoResultado: resultados > 0 ? spend / resultados : 0,
      // Bounce = (X / cliques) - 1 — perda do clique pra conversão (negativo).
      bounceLead: clicks > 0 ? leads / clicks - 1 : 0,
      bounceConversa: clicks > 0 ? mensagens / clicks - 1 : 0,
      qualityRanking: modeFromCounts("Quality_ranking" as any),
      engagementRanking: modeFromCounts("Engagement_ranking" as any),
      conversionRanking: modeFromCounts("Conversion_ranking" as any),
    };
  }, [scopedData, reachDedup, reachOnDemand]);

  const monthlyEvolution: MonthlyEvolution[] = useMemo(() => {
    const map = new Map<string, { leads: number; mensagens: number; spend: number; impressoes: number; cliques: number; alcance: number; rows: number; freqSum: number }>();

    for (const row of scopedData) {
      if (!row.Dia) continue;
      const d = new Date(row.Dia);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const existing = map.get(key) || { leads: 0, mensagens: 0, spend: 0, impressoes: 0, cliques: 0, alcance: 0, rows: 0, freqSum: 0 };
      existing.leads += row.Lead || 0;
      existing.mensagens += row.Mensagens_iniciadas || 0;
      existing.spend += row.Valor_usado_BRL || 0;
      existing.impressoes += row.Impressões || 0;
      existing.cliques += row.Cliques_no_link || 0;
      existing.alcance += row.Alcance || 0;
      existing.rows += 1;
      existing.freqSum += row.Frequencia || 0;
      map.set(key, existing);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => {
        const [year, month] = key.split("-");
        const monthNames = ["jan.", "fev.", "mar.", "abr.", "maio", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];
        const label = `${monthNames[parseInt(month) - 1]}\n${year}`;
        const leadsTrafego = v.leads + v.mensagens;
        return {
          month: key,
          label,
          leads: v.leads,
          cpl: v.leads > 0 ? v.spend / v.leads : 0,
          leadsTrafego,
          cplTrafego: leadsTrafego > 0 ? v.spend / leadsTrafego : 0,
          investimento: v.spend,
          impressoes: v.impressoes,
          cpm: v.impressoes > 0 ? (v.spend / v.impressoes) * 1000 : 0,
          cliques: v.cliques,
          cpc: v.cliques > 0 ? v.spend / v.cliques : 0,
          alcance: v.alcance,
        };
      });
  }, [scopedData]);

  const campaignSummary: CampaignSummary[] = useMemo(() => {
    // Build Kommo lookups by campaign name
    const kommoLeadsMap = new Map<string, number>();
    const kommoFatMap = new Map<string, number>();
    const kommoConsultasMap = new Map<string, number>();
    for (const k of kommoData) {
      kommoLeadsMap.set(k.Campanha, k.count);
      kommoFatMap.set(k.Campanha, k.fatBruto);
      kommoConsultasMap.set(k.Campanha, k.consultasAgen);
    }

    type CampAcc = {
      investimento: number; leads: number; impressoes: number; cliques: number;
      alcance: number; rows: number; freqWeighted: number; freqWeight: number;
      spendLead: number; spendConversa: number;
      v3s: number; v95: number; orcamento: number; mensagens: number;
      visitas: number;
      // Soma de Resultados_meta agrupada por Tipo_de_resultado. Resultado/Custo-Resultado
      // seguem o objetivo dominante (um único tipo), igual à coluna "Resultados" do Meta —
      // ver comentário no .map() abaixo.
      resultsByType: Map<string, number>;
      qrk: Map<string, number>; erk: Map<string, number>; crk: Map<string, number>;
    };
    const map = new Map<string, CampAcc>();
    for (const row of scopedData) {
      const key = row.Nome_Campanha || "Sem nome";
      const existing: CampAcc = map.get(key) || {
        investimento: 0, leads: 0, impressoes: 0, cliques: 0, alcance: 0, rows: 0,
        freqWeighted: 0, freqWeight: 0, spendLead: 0, spendConversa: 0,
        v3s: 0, v95: 0, orcamento: 0, mensagens: 0,
        visitas: 0,
        resultsByType: new Map(), qrk: new Map(), erk: new Map(), crk: new Map(),
      };
      existing.investimento += row.Valor_usado_BRL || 0;
      existing.leads += row.Lead || 0;
      existing.impressoes += row.Impressões || 0;
      existing.cliques += row.Cliques_no_link || 0;
      existing.alcance += row.Alcance || 0;
      existing.rows += 1;
      // Frequência ponderada por impressões — média simples distorce quando
      // dias com pouco volume puxam o agregado pra baixo/cima.
      if ((row.Impressões || 0) > 0 && (row.Frequencia || 0) > 0) {
        existing.freqWeighted += (row.Frequencia || 0) * (row.Impressões || 0);
        existing.freqWeight += (row.Impressões || 0);
      }
      existing.spendLead += (row.Lead || 0) * (row.Custo_por_Lead || 0);
      existing.spendConversa += (row.Mensagens_iniciadas || 0) * (row.Custo_por_mensagem || 0);
      existing.v3s += row.Video_views_3s || 0;
      existing.v95 += row.Video_views_95pct || 0;
      existing.orcamento += row.Orcamento_diario || 0;
      existing.mensagens += row.Mensagens_iniciadas || 0;
      existing.visitas += row.Visitas_perfil || 0;
      const addRk = (m: Map<string, number>, v: string | null | undefined) => {
        if (!v) return;
        m.set(v, (m.get(v) || 0) + 1);
      };
      addRk(existing.qrk, row.Quality_ranking);
      addRk(existing.erk, row.Engagement_ranking);
      addRk(existing.crk, row.Conversion_ranking);
      // Resultado NATIVO do Meta agrupado pelo seu tipo. Não somar entre tipos:
      // dias de "lead" + dias de "mensagem" viram um número que o Meta nunca mostra.
      const tipo = (row.Tipo_de_resultado || "").trim();
      if (tipo) existing.resultsByType.set(tipo, (existing.resultsByType.get(tipo) || 0) + (row.Resultados_meta || 0));
      map.set(key, existing);
    }
    return Array.from(map.entries())
      .map(([campanha, v]) => {
        const leadsCRM = kommoLeadsMap.get(campanha) ?? null;
        const cplCRM = leadsCRM && leadsCRM > 0 ? v.investimento / leadsCRM : null;
        const fatBruto = kommoFatMap.get(campanha) ?? null;
        const consultasAgen = kommoConsultasMap.has(campanha) ? (kommoConsultasMap.get(campanha) ?? 0) : null;
        const cac = consultasAgen && consultasAgen > 0 ? v.investimento / consultasAgen : null;
        const roas = fatBruto && fatBruto > 0 && v.investimento > 0 ? fatBruto / v.investimento : null;
        // Objetivo dominante = tipo com maior volume de resultados no período. A coluna
        // "Resultados" do Meta reflete UM objetivo; somamos só as linhas desse tipo e o
        // Custo/Resultado = investimento total ÷ resultados desse tipo (igual ao Meta).
        let tipoResultado = "—";
        let resultados = 0;
        if (v.resultsByType.size > 0) {
          const sorted = [...v.resultsByType.entries()].sort((a, b) => b[1] - a[1]);
          tipoResultado = sorted[0][0];
          resultados = sorted[0][1];
        }
        return {
          campanha,
          investimento: v.investimento,
          leadsTrafico: v.leads,
          cplTrafico: v.leads > 0 ? v.investimento / v.leads : 0,
          alcance: v.alcance,
          frequencia: v.freqWeight > 0 ? v.freqWeighted / v.freqWeight : 0,
          impressoes: v.impressoes,
          cpm: v.impressoes > 0 ? (v.investimento / v.impressoes) * 1000 : 0,
          ctr: v.impressoes > 0 ? (v.cliques / v.impressoes) * 100 : 0,
          cpc: v.cliques > 0 ? v.investimento / v.cliques : 0,
          cliques: v.cliques,
          tipoResultado,
          resultados,
          custoResultado: resultados > 0 ? v.investimento / resultados : 0,
          bounceLead: v.cliques > 0 ? v.leads / v.cliques - 1 : 0,
          bounceConversa: v.cliques > 0 ? v.mensagens / v.cliques - 1 : 0,
          videoViews3s: v.v3s,
          videoViews95pct: v.v95,
          hook: v.impressoes > 0 ? (v.v3s / v.impressoes) * 100 : 0,
          hold: v.impressoes > 0 ? (v.v95 / v.impressoes) * 100 : 0,
          orcamento: v.orcamento,
          mensagens: v.mensagens,
          custoMensagem: v.mensagens > 0 ? v.investimento / v.mensagens : 0,
          visitas: v.visitas,
          custoVisita: v.visitas > 0 ? v.investimento / v.visitas : 0,
          qualityRanking: v.qrk.size > 0 ? [...v.qrk.entries()].sort((a, b) => b[1] - a[1])[0][0] : null,
          engagementRanking: v.erk.size > 0 ? [...v.erk.entries()].sort((a, b) => b[1] - a[1])[0][0] : null,
          conversionRanking: v.crk.size > 0 ? [...v.crk.entries()].sort((a, b) => b[1] - a[1])[0][0] : null,
          leadsCRM,
          cplCRM,
          consultasAgen,
          cac,
          fatBruto,
          roas,
        };
      })
      .sort((a, b) => b.investimento - a.investimento);
  }, [scopedData, kommoData]);

  // Totais CRM (Kommo) consolidados — útil para CAC/ROAS na página Performance
  const crmTotals = useMemo(() => {
    let consultasAgendadas = 0;
    let faturamento = 0;
    for (const k of kommoData) {
      consultasAgendadas += k.consultasAgen;
      faturamento += k.fatBruto;
    }
    return { consultasAgendadas, faturamento };
  }, [kommoData]);

  return { data: scopedData, totals, leadsCRMMeta, monthlyEvolution, campaignSummary, medicos, crmTotals, loading, error };
}
