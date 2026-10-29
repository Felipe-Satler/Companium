import { useState, useEffect, useMemo } from "react";
import { externalSupabase } from "@/integrations/external-supabase/client";
import {
  normalizeClientName,
  canonicalizeAdsClient,
  foldMergedAdsClient,
  buildClientCanonicalMap,
  ClientCanonicalMap,
} from "@/data/clienteAliases";
import { dedupedFetch, withRetry } from "./dataCache";
import { useClientesVisiveis, registrarCanonicalList } from "@/hooks/useClientesVisiveis";

// Tipo histórico — mantido porque outros hooks (Meta/Google ads de cliente) referenciam
// como type-only para tipar suas próprias linhas vindas da view bruta v_meta_google_ads.
export interface ClienteAdsData {
  id: number;
  Dia: string;
  Nome_Campanha: string;
  Valor_usado_BRL: number;
  Impressões: number;
  Cliques_no_link: number;
  CTR_taxa_de_cliques_no_link: number;
  CPM_custo_por_1000_impressões: number;
  CPC_custo_por_clique_no_link: number;
  Tipo_de_resultado: string | null;
  Resultados: number;
  Custo_por_resultado: number;
  // Valores nativos do Meta (resultado primário da campanha conforme o objetivo:
  // link_click, mensagem, lead, etc.) — expostos pela view sob alias `_meta`.
  // A tabela de campanhas usa estes; os cards (totals) seguem Lead+Conversa.
  Resultados_meta: number;
  Custo_por_resultado_meta: number;
  Lead: number;
  Custo_por_Lead: number;
  Client: string;
  Alcance: number;
  Frequencia: number;
  Fonte_Ads: string;
  Valor_conversao_BRL: number;
  ROAS: number;
  Video_views_3s: number;
  Video_views_95pct: number;
  Hook: number;
  Hold: number;
  Orcamento_diario: number | null;
  Mensagens_iniciadas: number | null;
  Custo_por_mensagem: number | null;
  Visitas_perfil: number | null;
  Custo_por_visita: number | null;
  Quality_ranking: string | null;
  Engagement_ranking: string | null;
  Conversion_ranking: string | null;
  // Métricas específicas do Google Ads (frações 0..1), expostas pela view
  // v_meta_google_ads. No raw vêm como texto; a view converte para numeric.
  Conversao_de_landing_page: number | null;
  Parcela_de_impressao_na_rede_de_pesquisa: number | null;
  Por_falta_de_orcamento: number | null;
  Por_falta_de_classificacao: number | null;
  Status_do_indice_de_qualidade_das_palavras: number | null;
}

// Linha já agregada server-side por (Dia, Client, Fonte_Ads). É o que /clientes consome —
// dropa de ~80k linhas/80 round-trips para <1k linhas/1 round-trip por filtro de data.
export interface ClienteAdsDaily {
  Dia: string;
  Client: string;
  Fonte_Ads: string;
  Valor_usado_BRL: number;
  Lead: number;
  Impressões: number;
  Cliques_no_link: number;
  Alcance: number;
  campaign_count: number;
  Conversa: number;
  Resultados: number;
  // Resultado NATIVO do Meta (soma do resultado primário por campanha) — usado na
  // coluna "Resultados" do Relatório, alinhado com a tabela de campanhas. O campo
  // `Resultados` acima (Lead+Conversa) é mantido para retrocompat.
  Resultados_meta: number;
  Spend_Lead: number;
  Spend_Conversa: number;
}

export interface ClienteSummary {
  client: string;
  totalSpend: number;
  totalLeads: number;
  totalConversas: number;
  totalResultados: number;
  totalSpendLead: number;
  totalSpendConversa: number;
  totalImpressions: number;
  totalClicks: number;
  totalReach: number;
  avgCPL: number;
  avgCPConversa: number;
  avgCPResultado: number;
  bounceLead: number;
  bounceConversa: number;
  avgCTR: number;
  avgCPC: number;
  campaigns: number;
  // Especialidades cadastradas do cliente (tabela `clientes`). Preenchido no /clientes.
  especialidades?: string[];
}

// Supabase devolve numerics como string. Conversão tolerante a null/"" → 0.
const toNum = (v: unknown): number => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

// Mapa vazio usado como default antes do fetch — evita undefined nos consumidores.
const EMPTY_CANONICAL_MAP: ClientCanonicalMap = {
  canonicalList: [],
  kommoVariantsByCanonical: new Map(),
  adsVariantsByCanonical: new Map(),
  canonicalByAdsName: new Map(),
  canonicalByKommoName: new Map(),
};

// `adsScopeNames` (opcional): quando presente (usuário-cliente), restringe o fetch diário às
// contas de Ads do cliente no SERVIDOR via `.in("Client", ...)` — os MESMOS nomes crus que a
// RLS usa (ads_names), garantindo que casa exatamente as linhas que a tela Meta já mostra.
// Sem ele o fetch traz TODOS os clientes (comportamento normal da equipe). Escopar pelo slug
// não servia: o slug (nome_identificador) pode diferir do nome da conta de Ads.
export function useClientesData(dateFrom?: string, dateTo?: string, adsScopeNames?: string[]) {
  // Carteira visível (projetos_lista ATIVO + clientes_ocultos). A versão entra nas deps
  // abaixo porque isExcludedClient consulta esse store — sem ela, a lista ficaria a de antes
  // do carregamento.
  const visVersao = useClientesVisiveis();
  const [data, setData] = useState<ClienteAdsDaily[]>([]);
  const [adsClients, setAdsClients] = useState<string[]>([]);
  const [kommoClients, setKommoClients] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      try {
        // PostgREST cap em 1000 rows/response; CONCURRENCY=3 — pool do PostgREST
        // tem ~10 slots, e este hook compete com useCRMClienteData (4). Total
        // simultâneo fica dentro do orçamento e evita queueing/saturação no DB.
        const PAGE = 1000;
        const CONCURRENCY = 3;
        const MAX_ROWS = 200000;

        // 1) Listas canônicas de clientes — INDEPENDENTES do filtro de data.
        //    `list_ads_clients` retorna os nomes longos (estilo "Dr. Gustavo Nobre - CA 1.1.1 | Groohub")
        //    e `list_kommo_clients` retorna os slugs curtos (estilo "Gustavo_Nobre"). Combinamos
        //    os dois client-side via buildClientCanonicalMap pra gerar a lista canônica única
        //    consumida pelo dropdown do /clientes.
        const fetchAdsClientsRaw = (): Promise<string[]> =>
          dedupedFetch<string[]>("ads:clients:raw", () =>
            withRetry(async () => {
              const { data: rows, error: err } = await externalSupabase
                .rpc("list_ads_clients");
              if (err) throw err;
              const set = new Set<string>();
              for (const r of (rows as { client: string | null }[]) || []) {
                if (r.client) set.add(r.client);
              }
              return [...set];
            }),
          );

        const fetchKommoClientsRaw = (): Promise<string[]> =>
          dedupedFetch<string[]>("kommo:clients:raw", () =>
            withRetry(async () => {
              const { data: rows, error: err } = await externalSupabase
                .rpc("list_kommo_clients");
              if (err) throw err;
              const set = new Set<string>();
              for (const r of (rows as { client: string | null }[]) || []) {
                if (r.client) set.add(r.client);
              }
              return [...set];
            }),
          );

        // 2) Linhas diárias filtradas pelo intervalo. Inclui as datas no cache key
        //    para que mudar filtro de data não retorne dados velhos.
        const fetchRange = (from: number) =>
          withRetry(async () => {
            let q = externalSupabase
              .from("v_meta_google_ads_daily")
              .select(
                'Dia,Client,Fonte_Ads,Valor_usado_BRL,Lead,"Impressões",Cliques_no_link,Alcance,campaign_count,Conversa,Resultados,Spend_Lead,Spend_Conversa,Resultados_meta',
              )
              // ORDER BY estável é OBRIGATÓRIO com .range(): a view diária tem grão único
              // (Dia, Client, Fonte_Ads); ordenar só por "Dia" (não único) faria o PostgREST
              // pular/duplicar linhas entre páginas quando o range passa de 1000 (2+ meses).
              .order("Dia", { ascending: false })
              .order("Client", { ascending: true })
              .order("Fonte_Ads", { ascending: true })
              .range(from, from + PAGE - 1);
            // Usuário-cliente: restringe às contas do cliente (nomes crus exatos = RLS ads_names).
            if (adsScopeNames && adsScopeNames.length) q = q.in("Client", adsScopeNames);
            if (dateFrom) q = q.gte("Dia", dateFrom);
            if (dateTo) q = q.lte("Dia", dateTo);
            const { data: rows, error: err } = await q;
            if (err) throw err;
            return (rows as unknown as ClienteAdsDaily[]) || [];
          });

        const dailyKey = `ads:daily:${adsScopeNames?.join("|") || ""}:${dateFrom || ""}:${dateTo || ""}`;
        const fetchAllDaily = (): Promise<ClienteAdsDaily[]> =>
          dedupedFetch(dailyKey, async () => {
            const acc: ClienteAdsDaily[] = [];
            // Concorrência: dispara `CONCURRENCY` ranges em paralelo, para reduzir
            // tempo de wall-clock a ~ceil(N/PAGE/CONCURRENCY) round-trips.
            for (let baseFrom = 0; baseFrom < MAX_ROWS; baseFrom += PAGE * CONCURRENCY) {
              const offsets: number[] = [];
              for (let i = 0; i < CONCURRENCY; i++) {
                const o = baseFrom + i * PAGE;
                if (o < MAX_ROWS) offsets.push(o);
              }
              const batches = await Promise.all(offsets.map(fetchRange));
              let stop = false;
              for (const batch of batches) {
                for (const r of batch) {
                  r.Client = normalizeClientName(r.Client);
                  r.Valor_usado_BRL = toNum(r.Valor_usado_BRL);
                  r.Lead = toNum(r.Lead);
                  r.Impressões = toNum(r.Impressões);
                  r.Cliques_no_link = toNum(r.Cliques_no_link);
                  r.Alcance = toNum(r.Alcance);
                  r.Conversa = toNum(r.Conversa);
                  r.Resultados = toNum(r.Resultados);
                  r.Resultados_meta = toNum(r.Resultados_meta);
                  r.Spend_Lead = toNum(r.Spend_Lead);
                  r.Spend_Conversa = toNum(r.Spend_Conversa);
                  acc.push(r);
                }
                if (batch.length < PAGE) stop = true;
              }
              if (stop) break;
            }
            return acc;
          });

        // Usuário-cliente: NÃO enumera a lista de todos os clientes (o dropdown é escondido) —
        // evita puxar nomes de outros clientes e corta 2 round-trips. canonicalMap fica vazio;
        // o mapeamento de Client→canônico em adsRowsForCRM cai no fallback (canonicalizeAdsClient).
        const scoped = !!(adsScopeNames && adsScopeNames.length);
        const [adsRaw, kommoRaw, daily] = await Promise.all([
          scoped ? Promise.resolve<string[]>([]) : fetchAdsClientsRaw(),
          scoped ? Promise.resolve<string[]>([]) : fetchKommoClientsRaw(),
          fetchAllDaily(),
        ]);
        if (cancelled) return;
        // `daily` vazio aqui quase sempre é falha transitória (timeout da view sob carga),
        // não ausência real de dados → segura o skeleton e reprograma o refetch em vez de
        // pintar a tela com 0 (ex.: leads tráfego/CPL do CRM). Só desiste depois de algumas
        // tentativas, pois vazio TAMBÉM pode ser legítimo (recorte sem dados).
        if (daily.length === 0 && scheduleRetry("empty")) return;
        setAdsClients(adsRaw);
        setKommoClients(kommoRaw);
        setData(daily);
        setError(null);
        setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        // Erro (ex.: 57014 statement timeout após os retries internos) → continua tentando
        // sozinho, com o skeleton no ar, até o banco responder — sem exigir reload manual.
        if (scheduleRetry("error")) return;
        setError(e.message || "Erro ao buscar dados");
        setLoading(false);
      }
    }

    // Reprograma fetchData com backoff exponencial (cap 15s) enquanto o componente está
    // montado. Retorna true se agendou (aí quem chamou mantém o loading). Tetos separados:
    // erro tenta mais (banco lento volta); vazio tenta pouco (pode ser recorte genuíno).
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
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, adsScopeNames?.join("|")]);

  // Mapa canônico: une Ads + Kommo num único conjunto de slugs (estilo Kommo).
  // Reconstrói apenas quando as listas raw mudam.
  const canonicalMap: ClientCanonicalMap = useMemo(() => {
    if (!adsClients.length && !kommoClients.length) return EMPTY_CANONICAL_MAP;
    // Aplica normalizeClientName antes de canonicalizar Kommo (resolve aliases internos)
    const kommoNormalized = kommoClients.map((c) => normalizeClientName(c));
    return buildClientCanonicalMap({ kommoNames: kommoNormalized, adsNames: adsClients });
    // visVersao NÃO aparece no corpo de propósito: ela é o sinal de que o store de
    // clientes visíveis mudou (isExcludedClient lê estado de módulo, que o lint não
    // enxerga). Tirar a dep faz a lista congelar na versão pré-carregamento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adsClients, kommoClients, visVersao]);

  // Lista canônica (slugs Kommo) — alimenta o dropdown do Relatório.
  const clients = canonicalMap.canonicalList;

  // Publica a união CRUA (Kommo + Ads, antes de qualquer filtro) p/ o diagnóstico
  // `__carteira()`. Tem de ser a crua: `canonicalList` já sai de dentro do
  // buildClientCanonicalMap com isExcludedClient aplicado, então perguntar a ela quem foi
  // escondido devolve sempre "ninguém".
  useEffect(() => {
    const bruta = new Set<string>([
      ...canonicalMap.kommoVariantsByCanonical.keys(),
      ...canonicalMap.adsVariantsByCanonical.keys(),
    ]);
    registrarCanonicalList([...bruta]);
  }, [canonicalMap]);

  // Summary por cliente (sem filtros de página — a página aplica os seus em cima).
  // Agrupa por canonical (não pelo nome longo do Ads) — assim "Dr. Gustavo Nobre - CA 1.1.1 | Groohub"
  // e "Dr. Gustavo Nobre - CA 1.1.1" caem numa só linha "Gustavo_Nobre".
  const summaryByClient: ClienteSummary[] = useMemo(() => {
    const map = new Map<string, ClienteSummary>();
    for (const row of data) {
      const rawKey = row.Client;
      if (!rawKey) continue;
      const key = canonicalMap.canonicalByAdsName.get(rawKey) || foldMergedAdsClient(canonicalizeAdsClient(rawKey));
      const existing = map.get(key) || {
        client: key,
        totalSpend: 0,
        totalLeads: 0,
        totalConversas: 0,
        totalResultados: 0,
        totalSpendLead: 0,
        totalSpendConversa: 0,
        totalImpressions: 0,
        totalClicks: 0,
        totalReach: 0,
        avgCPL: 0,
        avgCPConversa: 0,
        avgCPResultado: 0,
        bounceLead: 0,
        bounceConversa: 0,
        avgCTR: 0,
        avgCPC: 0,
        campaigns: 0,
      };
      existing.totalSpend += row.Valor_usado_BRL;
      existing.totalLeads += row.Lead;
      existing.totalConversas += row.Conversa;
      existing.totalResultados += row.Resultados_meta;
      existing.totalSpendLead += row.Spend_Lead;
      existing.totalSpendConversa += row.Spend_Conversa;
      existing.totalImpressions += row.Impressões;
      existing.totalClicks += row.Cliques_no_link;
      existing.totalReach += row.Alcance;
      existing.campaigns += row.campaign_count;
      map.set(key, existing);
    }
    return Array.from(map.values())
      .map((c) => ({
        ...c,
        avgCPL: c.totalLeads > 0 ? c.totalSpend / c.totalLeads : 0,
        avgCPConversa: c.totalConversas > 0 ? c.totalSpend / c.totalConversas : 0,
        avgCPResultado: c.totalResultados > 0 ? c.totalSpend / c.totalResultados : 0,
        bounceLead: c.totalClicks > 0 ? c.totalLeads / c.totalClicks : 0,
        bounceConversa: c.totalClicks > 0 ? c.totalConversas / c.totalClicks : 0,
        avgCTR: c.totalImpressions > 0 ? (c.totalClicks / c.totalImpressions) * 100 : 0,
        avgCPC: c.totalClicks > 0 ? c.totalSpend / c.totalClicks : 0,
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend);
  }, [data]);

  const totals = useMemo(
    () => ({
      spend: data.reduce((s, r) => s + r.Valor_usado_BRL, 0),
      leads: data.reduce((s, r) => s + r.Lead, 0),
      conversas: data.reduce((s, r) => s + r.Conversa, 0),
      resultados: data.reduce((s, r) => s + r.Resultados_meta, 0),
      spendLead: data.reduce((s, r) => s + r.Spend_Lead, 0),
      spendConversa: data.reduce((s, r) => s + r.Spend_Conversa, 0),
      impressions: data.reduce((s, r) => s + r.Impressões, 0),
      clicks: data.reduce((s, r) => s + r.Cliques_no_link, 0),
      reach: data.reduce((s, r) => s + r.Alcance, 0),
      clients: summaryByClient.length,
    }),
    [data, summaryByClient.length],
  );

  return { data, clients, canonicalMap, summaryByClient, totals, loading, error };
}
