import { useState, useEffect, useMemo } from "react";
import { externalSupabase } from "@/integrations/external-supabase/client";
import { startOfDayBRT, endOfDayBRT } from "@/utils/dateRange";
import { ClienteAdsData } from "./useClientesData";
import { GOOGLE_ADS_CAMPAIGN_ALIASES, GOOGLE_ADS_CRM_IGNORE } from "./googleAdsCampaignAliases";
import { inRange, parseBRL } from "@/utils/crmCalculations";
import { canonicalizeAdsClient, getRawClientNames, clientMatchKey, adsClientSearchCore, isExcludedClient, MEDICO_VAZIO } from "@/data/clienteAliases";
import { dedupedFetch, withRetry } from "./dataCache";
import { useClientesVisiveis } from "@/hooks/useClientesVisiveis";
import { CAPTACAO_FILTER, CAPTACAO_ILIKE, isCaptacaoClient } from "@/lib/captacao";

// Só as colunas lidas pelos agregados deste hook (substitui o `select("*")` de ~45
// colunas por linha) → payload menor, download mais rápido. "Impressões" tem acento
// e vai entre aspas.
const GOOGLE_ADS_SELECT =
  "id, Dia, Client, Valor_usado_BRL, Orcamento_diario, Lead, \"Impressões\", Cliques_no_link, Resultados, Nome_Campanha, Tipo_de_resultado, Conversao_de_landing_page, Parcela_de_impressao_na_rede_de_pesquisa, Por_falta_de_orcamento, Por_falta_de_classificacao";

// Valores de Consulta/Procedimento são parseados pelo parseBRL canônico de
// crmCalculations (ponto = decimal quando não é milhar, soma células multivalor).
// Fonte única da verdade — antes havia uma cópia local (parseValor) que arriscava drift.

// PostgREST serializa colunas `numeric` como STRING (p/ preservar precisão). As views
// do Google expõem `Resultados`/`Custo_*` como numeric → chegam como "1", "13.55"… Sem
// coerção, somas viram concatenação de string ("0"+"1"+"3" = "013") e zeram/poluem os
// totais de Lead tráfego. Espelha o `toNum` do useClientesData (que já faz isso p/ Meta).
const toNum = (v: unknown): number => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};
// Frações (share/conversão) precisam preservar null → "—"/skip na média ponderada;
// só converte string→número quando há valor.
const toNumN = (v: unknown): number | null => (v == null || v === "" ? null : toNum(v));

// "Lead tráfego" do Google = coluna "Lead" do banco (os leads de verdade). A coluna
// "Resultados" NÃO é lead — ela acompanha os cliques (~89% deles). Decisão do cliente
// (jun/2026): leads seguem "Lead", cliques seguem "Cliques_no_link".
function googleLeadTrafego(r: { Lead?: number }): number {
  return r.Lead || 0;
}

export interface GoogleMonthlyEvolution {
  month: string;
  label: string;
  leads: number;
  cpl: number;
  investimento: number;
  impressoes: number;
  cpm: number;
  cliques: number;
  cpc: number;
}

export interface GoogleCampaignSummary {
  campanha: string;
  investimento: number;
  orcamento: number;
  leads: number;
  cpl: number;
  // Lead tráfego = "Resultados" do banco (fallback p/ "Lead" em dias sem resultado);
  // custoLeadTrafego = spend / leadTráfego.
  leadsTrafego: number;
  custoLeadTrafego: number;
  impressoes: number;
  cpm: number;
  ctr: number;
  cpc: number;
  cliques: number;
  taxaConversao: number;
  // Métricas de share/conversão do Google: frações 0..1 (ou null quando não há
  // peso/dado). Agregadas por média ponderada — espelham os cards do painel.
  conversaoLP: number | null;
  parcelaImpressao: number | null;
  perdaOrcamento: number | null;
  perdaClassificacao: number | null;
  tipoResultado: string;
  resultados: number;
  custoResultado: number;
  consultasAgendadas: number;
  cac: number;
  faturamentoBruto: number;
  roas: number;
}

interface KommoMini {
  client: string;
  medico: string;
  origem: string;
  campanha: string;
  createdAt: string | null;
  consultaAgendadaEm: string | null;
  diaConsultaRealizada: string | null;
  diaProcedimentoRealizado: string | null;
  valorConsulta: number;
  valorProcedimento: number;
}

// Normaliza nome de campanha p/ matching tolerante:
// minúsculas, sem acentos, sem espaços/pontuação. Ex:
// "Reinervação Peniana" → "reinervacaopeniana"
function normalizeCampaignKey(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function useGoogleAdsClienteData(clientFilter?: string, dateFrom?: string, dateTo?: string, medicoFilter?: string | string[]) {
  // Carteira visível: o filtro por ATIVO/ocultos roda DENTRO do fetch abaixo, então a
  // versão entra nas deps do efeito — quando as fontes chegam, o efeito repete (servido pelo
  // cache do dedupedFetch) e re-filtra o que já estava em tela.
  const visVersao = useClientesVisiveis();
  // Médicos selecionados (normalizado): [] = todos. Filtro compartilhado virou multi-seleção;
  // aceitamos array ou string única (retrocompat).
  const medicoSel = useMemo<string[]>(() => {
    if (!medicoFilter) return [];
    const arr = Array.isArray(medicoFilter) ? medicoFilter : [medicoFilter];
    return arr.filter((v) => v && v !== "all");
  }, [medicoFilter]);
  // Modo captação (mídia própria da Groohub): conta "Groohub" EXATA, sem CRM. Ver src/lib/captacao.ts.
  const captacao = clientFilter === CAPTACAO_FILTER;
  const [data, setData] = useState<ClienteAdsData[]>([]);
  const [kommoRows, setKommoRows] = useState<KommoMini[]>([]);
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
      try {
        const PAGE = 1000;
        // CONCURRENCY=4 espelha o useCRMClienteData: pagina em paralelo em vez de sequencial.
        const CONCURRENCY = 4;
        const MAX_ROWS = 100000;

        // Quando um cliente está selecionado, restringe o fetch a ELE no servidor via
        // `.ilike("Client", "%core%")` (core = nome sem título/sufixo) — casa todas as
        // variantes do nome da conta (Dr./Dra., renomeações) e mantém o resultado pequeno,
        // evitando o fetch gigante de vários meses que podia parar cedo e zerar meses antigos.
        const core = clientFilter && clientFilter !== "all" ? adsClientSearchCore(clientFilter) : "";

        // Uma página de Google Ads. withRetry cobre timeouts transitórios da view (57014).
        const fetchAdsRange = (from: number) =>
          withRetry(async () => {
            // ORDER BY estável (Dia + id único) é OBRIGATÓRIO com .range(): ordenar só por
            // "Dia" (não único) faz o PostgREST pular/duplicar linhas entre páginas quando o
            // resultado passa de 1000 linhas. O tiebreaker por id garante paginação completa.
            let q = externalSupabase
              .from("v_meta_google_ads")
              .select(GOOGLE_ADS_SELECT)
              .eq("Fonte_Ads", "Google")
              .order("Dia", { ascending: false })
              .order("id", { ascending: false })
              .range(from, from + PAGE - 1);
            // Captação: só as contas PRÓPRIAS da Groohub ("Groohub - CA X.X.X"), via prefixo
            // `Groohub%` — NÃO `%groohub%`, que casaria "X | Groohub".
            if (captacao) q = q.ilike("Client", CAPTACAO_ILIKE);
            else if (core.length >= 3) q = q.ilike("Client", `%${core}%`);
            if (dateFrom) q = q.gte("Dia", dateFrom);
            if (dateTo) q = q.lte("Dia", dateTo);
            const { data: rows, error: err } = await q;
            if (err) throw err;
            const batch = (rows as ClienteAdsData[]) || [];
            // Coage os numéricos vindos como string (numeric do PostgREST) ANTES de agregar.
            for (const r of batch) {
              r.Valor_usado_BRL = toNum(r.Valor_usado_BRL);
              r.Orcamento_diario = toNum(r.Orcamento_diario);
              r.Lead = toNum(r.Lead);
              r.Impressões = toNum(r.Impressões);
              r.Cliques_no_link = toNum(r.Cliques_no_link);
              r.Resultados = toNum(r.Resultados);
              r.Conversao_de_landing_page = toNumN(r.Conversao_de_landing_page);
              r.Parcela_de_impressao_na_rede_de_pesquisa = toNumN(r.Parcela_de_impressao_na_rede_de_pesquisa);
              r.Por_falta_de_orcamento = toNumN(r.Por_falta_de_orcamento);
              r.Por_falta_de_classificacao = toNumN(r.Por_falta_de_classificacao);
            }
            return batch;
          });

        // Cache (5 min) + coalescing por escopo+período: navegar de volta reaproveita o
        // resultado em memória em vez de refazer o fetch.
        const adsKey = `googleads:${captacao ? "captacao" : (core || "all")}:${dateFrom || ""}:${dateTo || ""}`;
        const adsAll: ClienteAdsData[] = await dedupedFetch(adsKey, async () => {
          const acc: ClienteAdsData[] = [];
          for (let from = 0; from < MAX_ROWS; from += PAGE * CONCURRENCY) {
            const offsets: number[] = [];
            for (let i = 0; i < CONCURRENCY; i++) {
              const o = from + i * PAGE;
              if (o < MAX_ROWS) offsets.push(o);
            }
            const batches = await Promise.all(offsets.map(fetchAdsRange));
            let stop = false;
            for (const b of batches) {
              acc.push(...b);
              if (b.length < PAGE) stop = true;
            }
            if (stop) break;
          }
          return acc;
        });

        // Fetch Kommo — alinhado com a fonte-da-verdade do CRM (useCRMClienteData):
        // conta consultas pela DATA DO EVENTO e faturamento por eventos realizados.
        // Ponte de nome: o dropdown passa o nome longo do Ads; o Kommo usa slug curto.
        const KOMMO_SELECT =
          "client, \"Médico\", \"Médicos\", Origem, Campanha, \"Consulta Agendada Em\", \"Dia da Consulta Realizada\", \"Dia do Procedimento Realizado\", \"Valor da Consulta\", \"Valor do Procedimento\", created_at";
        const kommoNames =
          captacao
            ? // Captação não tem pipeline de clientes no Kommo → nome que não casa nada (Leads CRM "—").
              ["__captacao_sem_crm__"]
            : clientFilter && clientFilter !== "all"
            ? getRawClientNames(canonicalizeAdsClient(clientFilter))
            : null;
        const applyKommoClient = (q: any) =>
          kommoNames ? (kommoNames.length > 1 ? q.in("client", kommoNames) : q.eq("client", kommoNames[0])) : q;
        const mapKommo = (r: any): KommoMini => ({
          client: r.client,
          medico: ((r["Médico"] || r["Médicos"] || "")).trim(),
          origem: (r.Origem || "").trim(),
          campanha: r.Campanha || "",
          createdAt: r.created_at,
          consultaAgendadaEm: r["Consulta Agendada Em"],
          diaConsultaRealizada: r["Dia da Consulta Realizada"],
          diaProcedimentoRealizado: r["Dia do Procedimento Realizado"],
          valorConsulta: parseBRL(r["Valor da Consulta"]),
          valorProcedimento: parseBRL(r["Valor do Procedimento"]),
        });

        const cutoff = startOfDayBRT(dateFrom);
        const upper = endOfDayBRT(dateTo);
        // Cache (5 min) + coalescing + retry (57014). Chave por cliente+período — o Kommo
        // do Google já é filtrado por cliente no servidor (applyKommoClient), então varia por
        // ambos. Reabrir a página dentro da janela reaproveita o resultado em memória.
        const kommoKey = `googleads-kommo:${clientFilter || "all"}:${dateFrom || ""}:${dateTo || ""}`;
        const kommoAll: KommoMini[] = await dedupedFetch(kommoKey, async () => {
          const acc: KommoMini[] = [];
          // (1) Leads criados no período.
          for (let from = 0; from < MAX_ROWS; from += PAGE) {
            const batch = await withRetry(async () => {
              let q = externalSupabase.from("v_kommo_completa").select(KOMMO_SELECT).range(from, from + PAGE - 1);
              q = applyKommoClient(q);
              if (cutoff) q = q.gte("created_at", cutoff);
              if (upper) q = q.lte("created_at", upper);
              const { data: rows, error: err } = await q;
              if (err) throw err;
              return (rows as any[]) || [];
            });
            for (const r of batch) acc.push(mapKommo(r));
            if (batch.length < PAGE) break;
          }
          // (2) Suplementar: leads criados ANTES do período mas com evento (consulta agendada/
          // realizada / procedimento realizado) DENTRO do período. Conjunto disjunto do (1)
          // (created_at < cutoff) → concatena sem dedup. Cobre consultas de leads antigos.
          if (cutoff && dateFrom) {
            const addOneDay = (d?: string): string | undefined => {
              if (!d) return undefined;
              const dt = new Date(`${d}T00:00:00Z`);
              if (isNaN(dt.getTime())) return undefined;
              dt.setUTCDate(dt.getUTCDate() + 1);
              return dt.toISOString().slice(0, 10);
            };
            const hi = addOneDay(dateTo) ?? "9999-12-31";
            const eventOr = ["Consulta Agendada Em", "Dia da Consulta Realizada", "Dia do Procedimento Realizado"]
              .map((c) => `and("${c}".gte.${dateFrom},"${c}".lt.${hi})`)
              .join(",");
            for (let from = 0; from < MAX_ROWS; from += PAGE) {
              const batch = await withRetry(async () => {
                let q = externalSupabase.from("v_kommo_completa").select(KOMMO_SELECT).range(from, from + PAGE - 1).lt("created_at", cutoff).or(eventOr);
                q = applyKommoClient(q);
                const { data: rows, error: err } = await q;
                if (err) throw err;
                return (rows as any[]) || [];
              });
              for (const r of batch) acc.push(mapKommo(r));
              if (batch.length < PAGE) break;
            }
          }
          return acc;
        });

        // Clientes encerrados não aparecem em lugar nenhum (totais, tabelas, filtros). EXCEÇÃO:
        // no modo captação as linhas são a conta PRÓPRIA da Groohub (Client="Groohub"), que NÃO
        // é cliente da carteira (projetos_lista). O filtro de carteira ATIVA (via isExcludedClient)
        // a excluiria por não constar na planilha — esvaziando a página de Captação. O fetch já
        // restringe a `Groohub%` e o scopedData reforça com isCaptacaoClient, então aqui não
        // reexcluímos em captação. Ver useMetaAdsClienteData (mesma correção).
        if (cancelled) return;
        // Guarda anti-zero: só no modo "all" (core vazio). Com cliente selecionado o fetch é
        // restrito a ELE e pode voltar legitimamente vazio (cliente sem Google no período); no
        // "all", vazio é quase sempre falha transitória da view → segura e re-tenta.
        if (!core && adsAll.length === 0 && scheduleRetry("empty")) return;
        setData(adsAll.filter((r) => captacao || !isExcludedClient(r.Client, "google")));
        setKommoRows(kommoAll.filter((r) => !isExcludedClient(r.client, "google")));
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
  }, [clientFilter, dateFrom, dateTo, visVersao]);

  // Slug canônico do cliente selecionado (unifica variantes do nome da conta, ex.: Dr./Dra.).
  const selectedClientKey = useMemo(
    () => (!captacao && clientFilter && clientFilter !== "all" ? clientMatchKey(canonicalizeAdsClient(clientFilter)) : null),
    [clientFilter, captacao]
  );

  // Linhas de Ads restritas ao cliente selecionado, casando pelo slug canônico — não pelo
  // nome cru — pra cobrir períodos sob nomes antigos da conta. Quando "all", usa tudo.
  // Captação: só as linhas da conta "Groohub" EXATA.
  const scopedData = useMemo(
    () =>
      captacao
        ? data.filter((r) => isCaptacaoClient(r.Client))
        : selectedClientKey
        ? data.filter((r) => clientMatchKey(canonicalizeAdsClient(r.Client)) === selectedClientKey)
        : data,
    [data, selectedClientKey, captacao]
  );

  // Lista de médicos do cliente atualmente filtrado
  const medicos = useMemo(() => {
    if (!clientFilter || clientFilter === "all") return [];
    const kommoSet = new Set(getRawClientNames(canonicalizeAdsClient(clientFilter)));
    const set = new Set<string>();
    for (const r of kommoRows) {
      if (!kommoSet.has(r.client)) continue;
      if (r.medico) set.add(r.medico);
    }
    return [...set].sort();
  }, [kommoRows, clientFilter]);

  // Agregação CRM por campanha (apenas leads com Origem = Google Ads)
  // Aplica aliases manuais (re-aponta slug do CRM para a campanha Ads correta)
  // e lista de ignore (slugs com Origem mal classificada).
  // Também guarda nome original do slug por norm_key (para exibir como "[CRM] {slug}"
  // quando não houver match com nenhuma campanha Ads).
  const { kommoByCampaign, crmTotals, kommoOriginalNames } = useMemo(() => {
    const byCamp = new Map<string, { leadsCRM: number; consultasAgen: number; fatBruto: number }>();
    const originalNames = new Map<string, string>(); // norm_key → primeiro nome encontrado
    let totalConsultas = 0;
    let totalFat = 0;
    // Ponte Ads→Kommo: o dropdown passa o nome longo do Ads; o Kommo usa slug curto.
    const kommoNames =
      clientFilter && clientFilter !== "all" ? getRawClientNames(canonicalizeAdsClient(clientFilter)) : null;
    const kommoSet = kommoNames ? new Set(kommoNames) : null;
    for (const r of kommoRows) {
      if (kommoSet && !kommoSet.has(r.client)) continue;
      if (medicoSel.length > 0 && !medicoSel.includes(r.medico ? r.medico : MEDICO_VAZIO)) continue;
      if (!/google/i.test(r.origem)) continue;

      const slugNorm = normalizeCampaignKey(r.campanha);

      // Lista de ignore: pula completamente (não soma totais nem agrega)
      const ignoreList = GOOGLE_ADS_CRM_IGNORE[r.client] || [];
      if (slugNorm && ignoreList.includes(slugNorm)) continue;

      // Consultas: contadas pela DATA do evento "Consulta Agendada Em" no período
      // (mesma regra de crmCalculations). Faturamento: por eventos REALIZADOS no período.
      const consultaNoPeriodo = inRange(r.consultaAgendadaEm, dateFrom, dateTo);
      const fat =
        (inRange(r.diaConsultaRealizada, dateFrom, dateTo) ? r.valorConsulta : 0) +
        (inRange(r.diaProcedimentoRealizado, dateFrom, dateTo) ? r.valorProcedimento : 0);
      if (consultaNoPeriodo) totalConsultas += 1;
      totalFat += fat;
      if (!slugNorm) continue;

      // Aplica alias se houver: re-aponta para a norm_key da campanha Ads
      const aliasMap = GOOGLE_ADS_CAMPAIGN_ALIASES[r.client] || {};
      const effectiveKey = aliasMap[slugNorm] || slugNorm;

      const ex = byCamp.get(effectiveKey) || { leadsCRM: 0, consultasAgen: 0, fatBruto: 0 };
      ex.leadsCRM += 1;
      if (consultaNoPeriodo) ex.consultasAgen += 1;
      ex.fatBruto += fat;
      byCamp.set(effectiveKey, ex);

      if (!originalNames.has(effectiveKey)) {
        originalNames.set(effectiveKey, r.campanha);
      }
    }
    return {
      kommoByCampaign: byCamp,
      kommoOriginalNames: originalNames,
      crmTotals: { consultasAgendadas: totalConsultas, faturamento: totalFat },
    };
  }, [kommoRows, clientFilter, medicoSel, dateFrom, dateTo]);

  const totals = useMemo(() => {
    const spend = scopedData.reduce((s, r) => s + (r.Valor_usado_BRL || 0), 0);
    const orcamento = scopedData.reduce((s, r) => s + (r.Orcamento_diario || 0), 0);
    const leads = scopedData.reduce((s, r) => s + (r.Lead || 0), 0);
    const impressions = scopedData.reduce((s, r) => s + (r.Impressões || 0), 0);
    const clicks = scopedData.reduce((s, r) => s + (r.Cliques_no_link || 0), 0);
    // "Resultados" do Google = leads (coluna "Lead"); a coluna "Resultados" da base
    // acompanha cliques e não deve ser exibida como resultado.
    const resultados = scopedData.reduce((s, r) => s + (r.Lead || 0), 0);
    // Lead tráfego = soma da coluna "Lead".
    const leadsTrafego = scopedData.reduce((s, r) => s + googleLeadTrafego(r), 0);

    // Métricas de share/conversão do Google são FRAÇÕES por linha (campanha×dia) —
    // somar não faz sentido. Agregamos por média ponderada:
    //  - parcela de impressão e as duas perdas (orçamento/classificação) ponderadas
    //    por impressões (são share-of-voice sobre impressões elegíveis);
    //  - conversão de landing page ponderada por cliques (conversões por sessão/clique).
    // Retorna null (→ "—" no card) quando não há peso/dado no período.
    const wavg = (val: (r: ClienteAdsData) => number | null | undefined, weight: (r: ClienteAdsData) => number): number | null => {
      let num = 0;
      let den = 0;
      for (const r of scopedData) {
        const v = val(r);
        if (v == null || !isFinite(Number(v))) continue;
        const w = weight(r) || 0;
        if (w <= 0) continue;
        num += Number(v) * w;
        den += w;
      }
      return den > 0 ? num / den : null;
    };
    const parcelaImpressao = wavg((r) => r.Parcela_de_impressao_na_rede_de_pesquisa, (r) => r.Impressões || 0);
    const perdaOrcamento = wavg((r) => r.Por_falta_de_orcamento, (r) => r.Impressões || 0);
    const perdaClassificacao = wavg((r) => r.Por_falta_de_classificacao, (r) => r.Impressões || 0);
    const conversaoLP = wavg((r) => r.Conversao_de_landing_page, (r) => r.Cliques_no_link || 0);

    // Total de leads no CRM (Kommo) com marcação de origem "Google Ads", respeitando os
    // mesmos filtros de cliente/médico/data da página (conta por created_at no período).
    // Mesma lógica do leadsCRMMeta no hook Meta, pra os dois baterem com o CRM.
    let leadsCRMGoogle = 0;
    for (const row of kommoRows) {
      if (!inRange(row.createdAt, dateFrom, dateTo)) continue;
      if (selectedClientKey && clientMatchKey(row.client) !== selectedClientKey) continue;
      if (medicoSel.length > 0 && !medicoSel.includes(row.medico ? row.medico : MEDICO_VAZIO)) continue;
      if (!/google/i.test(row.origem)) continue;
      leadsCRMGoogle += 1;
    }

    return {
      spend,
      orcamento,
      leadsCRMGoogle,
      custoLeadCRM: leadsCRMGoogle > 0 ? spend / leadsCRMGoogle : 0,
      leads,
      impressions,
      clicks,
      resultados,
      leadsTrafego,
      custoLeadTrafego: leadsTrafego > 0 ? spend / leadsTrafego : 0,
      cpl: leads > 0 ? spend / leads : 0,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      custoResultado: resultados > 0 ? spend / resultados : 0,
      // Taxa de conversão = conversões / cliques. No Google a conversão real é o Lead
      // tráfego (coluna "Resultados" da base); a coluna "Lead" é vazia. Por isso usa
      // leadsTrafego, não `leads`.
      taxaConversao: clicks > 0 ? (leadsTrafego / clicks) * 100 : 0,
      // Frações 0..1 (ou null). O painel formata como percentual.
      conversaoLP,
      parcelaImpressao,
      perdaOrcamento,
      perdaClassificacao,
    };
  }, [scopedData, kommoRows, selectedClientKey, medicoSel, dateFrom, dateTo]);

  const monthlyEvolution: GoogleMonthlyEvolution[] = useMemo(() => {
    const map = new Map<string, { leads: number; spend: number; impressoes: number; cliques: number }>();

    for (const row of scopedData) {
      if (!row.Dia) continue;
      const d = new Date(row.Dia);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const existing = map.get(key) || { leads: 0, spend: 0, impressoes: 0, cliques: 0 };
      // leads = coluna "Lead".
      existing.leads += googleLeadTrafego(row);
      existing.spend += row.Valor_usado_BRL || 0;
      existing.impressoes += row.Impressões || 0;
      existing.cliques += row.Cliques_no_link || 0;
      map.set(key, existing);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => {
        const [year, month] = key.split("-");
        const monthNames = ["jan.", "fev.", "mar.", "abr.", "maio", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];
        const leads = v.leads;
        return {
          month: key,
          label: `${monthNames[parseInt(month) - 1]}\n${year}`,
          leads,
          cpl: leads > 0 ? v.spend / leads : 0,
          investimento: v.spend,
          impressoes: v.impressoes,
          cpm: v.impressoes > 0 ? (v.spend / v.impressoes) * 1000 : 0,
          cliques: v.cliques,
          cpc: v.cliques > 0 ? v.spend / v.cliques : 0,
        };
      });
  }, [scopedData]);

  const campaignSummary: GoogleCampaignSummary[] = useMemo(() => {
    // Acumuladores de média ponderada por campanha para as métricas de share/conversão:
    //  - parcela/perdas ponderadas por impressões; conversão de LP ponderada por cliques.
    //    (mesma regra do `totals` que alimenta os cards).
    const map = new Map<string, { investimento: number; orcamento: number; leads: number; leadsTraf: number; impressoes: number; cliques: number; resultados: number; tiposCount: Map<string, number>; piNum: number; piDen: number; poNum: number; poDen: number; pcNum: number; pcDen: number; clpNum: number; clpDen: number }>();
    for (const row of scopedData) {
      const key = row.Nome_Campanha || "Sem nome";
      const existing = map.get(key) || { investimento: 0, orcamento: 0, leads: 0, leadsTraf: 0, impressoes: 0, cliques: 0, resultados: 0, tiposCount: new Map<string, number>(), piNum: 0, piDen: 0, poNum: 0, poDen: 0, pcNum: 0, pcDen: 0, clpNum: 0, clpDen: 0 };
      existing.investimento += row.Valor_usado_BRL || 0;
      existing.orcamento += row.Orcamento_diario || 0;
      existing.leads += row.Lead || 0;
      existing.leadsTraf += googleLeadTrafego(row);
      const imp = row.Impressões || 0;
      const clk = row.Cliques_no_link || 0;
      existing.impressoes += imp;
      existing.cliques += clk;
      // "Resultados" por campanha = leads (coluna "Lead"); a coluna "Resultados" da base
      // acompanha cliques e não representa resultado.
      existing.resultados += row.Lead || 0;
      if (row.Parcela_de_impressao_na_rede_de_pesquisa != null && imp > 0) { existing.piNum += row.Parcela_de_impressao_na_rede_de_pesquisa * imp; existing.piDen += imp; }
      if (row.Por_falta_de_orcamento != null && imp > 0) { existing.poNum += row.Por_falta_de_orcamento * imp; existing.poDen += imp; }
      if (row.Por_falta_de_classificacao != null && imp > 0) { existing.pcNum += row.Por_falta_de_classificacao * imp; existing.pcDen += imp; }
      if (row.Conversao_de_landing_page != null && clk > 0) { existing.clpNum += row.Conversao_de_landing_page * clk; existing.clpDen += clk; }
      const tipo = (row.Tipo_de_resultado || "").trim();
      if (tipo) existing.tiposCount.set(tipo, (existing.tiposCount.get(tipo) || 0) + 1);
      map.set(key, existing);
    }
    const totalLeads = Array.from(map.values()).reduce((s, v) => s + v.leads, 0);

    // Norm keys já consumidas por campanhas Ads (para detectar slugs CRM órfãos)
    const consumedKeys = new Set<string>();
    for (const camp of map.keys()) consumedKeys.add(normalizeCampaignKey(camp));

    const adsRows = Array.from(map.entries())
      .map(([campanha, v]) => {
        // Vínculo direto: nome de campanha (Google Ads) → Campanha do CRM (Kommo).
        // Se não houver match, todos os campos derivados ficam em 0.
        const k = normalizeCampaignKey(campanha);
        const crm = kommoByCampaign.get(k) || { leadsCRM: 0, consultasAgen: 0, fatBruto: 0 };
        const consultasAgendadas = crm.consultasAgen;
        const faturamentoBruto = crm.fatBruto;
        const cac = consultasAgendadas > 0 ? v.investimento / consultasAgendadas : 0;
        const roas = v.investimento > 0 ? faturamentoBruto / v.investimento : 0;
        let tipoResultado = "—";
        if (v.tiposCount.size > 0) {
          const sorted = [...v.tiposCount.entries()].sort((a, b) => b[1] - a[1]);
          tipoResultado = sorted[0][0];
        }
        return {
          campanha,
          investimento: v.investimento,
          orcamento: v.orcamento,
          leads: v.leads,
          cpl: v.leads > 0 ? v.investimento / v.leads : 0,
          leadsTrafego: v.leadsTraf,
          custoLeadTrafego: v.leadsTraf > 0 ? v.investimento / v.leadsTraf : 0,
          impressoes: v.impressoes,
          cpm: v.impressoes > 0 ? (v.investimento / v.impressoes) * 1000 : 0,
          ctr: v.impressoes > 0 ? (v.cliques / v.impressoes) * 100 : 0,
          cpc: v.cliques > 0 ? v.investimento / v.cliques : 0,
          cliques: v.cliques,
          taxaConversao: v.cliques > 0 ? (v.leadsTraf / v.cliques) * 100 : 0,
          conversaoLP: v.clpDen > 0 ? v.clpNum / v.clpDen : null,
          parcelaImpressao: v.piDen > 0 ? v.piNum / v.piDen : null,
          perdaOrcamento: v.poDen > 0 ? v.poNum / v.poDen : null,
          perdaClassificacao: v.pcDen > 0 ? v.pcNum / v.pcDen : null,
          tipoResultado,
          resultados: v.resultados,
          custoResultado: v.resultados > 0 ? v.investimento / v.resultados : 0,
          consultasAgendadas,
          cac,
          faturamentoBruto,
          roas,
        };
      })
      .sort((a, b) => b.investimento - a.investimento);

    // Linhas extras "[CRM] {slug}" para slugs do CRM que não casaram com nenhuma
    // campanha Ads (slugs ambíguos ou clientes sem Ads). Ordenadas por leads desc.
    const crmOnlyRows: GoogleCampaignSummary[] = [];
    for (const [normKey, crm] of kommoByCampaign.entries()) {
      if (consumedKeys.has(normKey)) continue;
      const original = kommoOriginalNames.get(normKey) || normKey;
      crmOnlyRows.push({
        campanha: `[CRM] ${original}`,
        investimento: 0,
        orcamento: 0,
        leads: 0,
        cpl: 0,
        leadsTrafego: 0,
        custoLeadTrafego: 0,
        impressoes: 0,
        cpm: 0,
        ctr: 0,
        cpc: 0,
        cliques: 0,
        taxaConversao: 0,
        conversaoLP: null,
        parcelaImpressao: null,
        perdaOrcamento: null,
        perdaClassificacao: null,
        tipoResultado: "—",
        resultados: 0,
        custoResultado: 0,
        consultasAgendadas: crm.consultasAgen,
        cac: 0,
        faturamentoBruto: crm.fatBruto,
        roas: 0,
      });
    }
    crmOnlyRows.sort((a, b) => b.consultasAgendadas - a.consultasAgendadas || b.faturamentoBruto - a.faturamentoBruto);

    return [...adsRows, ...crmOnlyRows];
  }, [scopedData, kommoByCampaign, kommoOriginalNames]);

  return { data: scopedData, totals, monthlyEvolution, campaignSummary, medicos, crmTotals, loading, error };
}
