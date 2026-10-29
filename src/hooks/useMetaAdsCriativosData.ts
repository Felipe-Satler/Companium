import { useState, useEffect, useMemo } from "react";
import { externalSupabase } from "@/integrations/external-supabase/client";
import { canonicalizeAdsClient, clientMatchKey, adsClientSearchCore, isExcludedClient, MEDICO_VAZIO, campaignMedicoRules, campaignMedicoFromName, accountMedicoRules } from "@/data/clienteAliases";

// Filtro PostgREST `.or(...)` casando o nome CRU do `Client` contra os sobrenomes das contas de
// um cliente agrupador (ADS_ACCOUNT_MEDICO_SPLIT). Em `.or()` o curinga do ilike é `*`. Espelha
// useMetaAdsClienteData — mantém a hierarquia de criativos com o mesmo escopo da tela de cards.
function accountOrFilter(rules: { match: string[] }[]): string {
  return rules.flatMap((r) => r.match.map((m) => `Client.ilike.*${m}*`)).join(",");
}
import { inRange } from "@/utils/crmCalculations";
import { CAPTACAO_FILTER, CAPTACAO_ILIKE, isCaptacaoClient } from "@/lib/captacao";
import { dedupedFetch, withRetry } from "./dataCache";
import { useClientesVisiveis } from "@/hooks/useClientesVisiveis";

// Coerção numérica DEFENSIVA. `Criativos Meta Ads` é tabela crua e o PostgREST devolve
// colunas numeric como STRING ("12.34"); somar sem coagir zera o agregado (mesmo bug que
// zerava Lead tráfego do Google). Ponto é sempre decimal aqui (número cru da API do Meta).
function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

// Chave canônica de campanha p/ casar o `Campanha` do Kommo com o `Nome_Campanha` do Meta.
// Os nomes acumulam sufixos de data (" - 10/02 - 18/02 - …") conforme a campanha é reeditada; o
// Kommo guarda um SNAPSHOT do nome no momento do lead (com menos datas) enquanto o Meta tem o
// nome atual (mais datas). O match exato falhava por isso — deixando Leads CRM/CPL/Consultas
// vazios em campanhas que na verdade têm CRM. Removemos os tokens de data do fim, colapsamos
// espaços e normalizamos caixa. (Renumerações reais — "GROOHUB 003" vs "004" — continuam sem
// casar, pois são campanhas diferentes de fato.)
export function normCampaignKey(s: unknown): string {
  let t = String(s ?? "").trim();
  let prev: string;
  do {
    prev = t;
    t = t.replace(/\s*[-–]\s*\d{1,2}\/\d{1,2}(\/\d{2,4})?\s*$/, "").trim();
  } while (t !== prev);
  return t.replace(/\s+/g, " ").toUpperCase();
}

// "Núcleo" da campanha: chave normalizada SEM o prefixo "GROOHUB <nº>" (e sem as datas). Casa
// campanhas renumeradas (o Kommo tem "GROOHUB 003 - …" e o Meta "GROOHUB 004 - …" mesma
// descrição). Só usado como fallback quando a chave normalizada não bate.
function coreCampaignKey(s: unknown): string {
  return normCampaignKey(s).replace(/^GROOHUB\s*\d+\s*[-–]\s*/, "").trim();
}

// Rótulos crus/legados → nome PT legível (espelha creatives.ts). Mantém robusto mesmo
// antes do backfill: linhas antigas gravadas com código cru continuam exibindo bonito.
// Códigos crus de action_type do Meta → nome PT legível. Cobre tanto o que a ingestão grava
// (já em PT) quanto os códigos crus da tabela principal (index.ts) e legados.
const TIPO_LABELS: Record<string, string> = {
  "onsite_conversion.messaging_conversation_started_7d": "Conversas iniciadas",
  messaging_conversation_started: "Conversas iniciadas",
  lead: "Cadastros",
  link_click: "Cliques no link",
  "offsite_conversion.fb_pixel_purchase": "Compras",
  purchase: "Compras",
  follow: "Seguidores",
  profile_visit: "Visitas ao perfil",
};

// Resolve o Tipo_de_resultado de UMA linha na MESMA prioridade da tabela principal (index.ts)
// e do Gerenciador do Meta: cadastros(lead) > conversa por mensagem > compra > clique no link.
// Prefere o rótulo já gravado (mapeando código cru p/ PT); só deriva quando vier vazio.
function resolveTipo(
  raw: string,
  m: { mensagens: number; leads: number; seguidores: number; visitas: number },
): string {
  const t = (raw || "").trim();
  if (t) return TIPO_LABELS[t] ?? t;
  if (m.leads > 0) return "Cadastros";
  if (m.mensagens > 0) return "Conversas iniciadas";
  if (m.visitas > 0) return "Cliques no link";
  return "";
}

// Agregado por nó da hierarquia (campanha / conjunto / anúncio). Espelha as métricas da
// tabela de campanhas do Companium para os números BATEREM com o resto do dashboard.
export interface Agg {
  status: "ativo" | "pausado";
  orcamento: number;
  gasto: number;
  resultado: number;
  tipoResultado: string;
  custoPorResultado: number;
  alcance: number;
  frequencia: number;
  // Alcance é métrica de pessoas ÚNICAS — NÃO é somável entre dias (a mesma pessoa
  // alcançada em vários dias é contada 1×/dia). Por padrão o agregado SOMA o alcance
  // diário (aproximado, superconta). No nível de CAMPANHA sobrepomos com o reach
  // deduplicado do Meta (via /api/meta-reach) e marcamos alcanceAprox=false.
  alcanceAprox: boolean;
  impressoes: number;
  video3s: number;
  hookRate: number;
  video95: number;
  holdRate: number;
  cpm: number;
  ctr: number;
  cpc: number;
  cliquesLink: number;
  bounceMsg: number;
  mensagensIniciadas: number;
  custoMensagem: number;
  bounceLead: number;
  leads: number;
  custoLead: number;
  // CRM (Kommo) — só existem no nível de CAMPANHA (atribuição por nome de campanha).
  // null nos níveis de conjunto/anúncio → a UI renderiza "—".
  leadsCrm: number | null;
  cplCrm: number | null;
  consultas: number | null;
  // Datas do Meta (ISO com timezone) da ENTIDADE do nível: criação e última edição.
  // Campanha usa as datas da campanha; conjunto usa as do ad set; anúncio usa as do ad.
  // null quando ainda não ingeridas (colunas novas / linhas antigas antes do backfill).
  criadoEm: string | null;
  editadoEm: string | null;
}

export interface AnuncioNode {
  id: string;
  nome: string;
  agg: Agg;
}
export interface ConjuntoNode {
  nome: string;
  // ID do conjunto (Adset_ID) — chave para buscar o reach dedup do período no Meta
  // (via /api/meta-reach?adsets=). Vazio quando o conjunto não tem Adset_ID numérico.
  adsetId: string;
  agg: Agg;
  anuncios: AnuncioNode[];
}
export interface CampanhaNode {
  nome: string;
  campaignId: string;
  agg: Agg;
  conjuntos: ConjuntoNode[];
}

// Linha crua já normalizada (números coagidos) — unidade de agregação.
export interface CriativoRow {
  campanha: string;
  // ID da campanha (Campaign_ID) — necessário p/ buscar o reach deduplicado do
  // período no Meta (via /api/meta-reach?campaigns=). O nome não serve como chave
  // de consulta ao Meta.
  campaignId: string;
  conjunto: string;
  // ID do conjunto (ad set). É a CHAVE de agrupamento — não o nome. Conjuntos pausados/
  // arquivados vêm sem Nome_Conjunto (READ_ADSETS só resolve ACTIVE/PAUSED) e colapsavam
  // todos em "Sem conjunto", fazendo a contagem de conjuntos divergir do Meta. Agrupando
  // por Adset_ID cada conjunto real fica separado mesmo sem nome resolvido.
  adsetId: string;
  anuncioId: string;
  anuncio: string;
  ativo: boolean;
  gasto: number;
  orcamento: number;
  impressoes: number;
  alcance: number;
  freq: number;
  cliques: number;
  v3s: number;
  v95: number;
  mensagens: number;
  leads: number;
  visitas: number;
  resultados: number;
  tipo: string;
  // tipo veio GRAVADO na coluna Tipo_de_resultado (derivado do optimization_goal do conjunto,
  // fonte autoritativa do "Resultado" que o Meta mostra) vs. DERIVADO por métrica quando a
  // coluna vinha vazia. Ao escolher o tipo do nó, o gravado tem prioridade sobre o derivado —
  // assim mensagens incidentais em dias sem tipo não reclassificam uma campanha de
  // Seguidores/Visitas como "Conversas iniciadas".
  tipoStored: boolean;
  // Campos p/ os cards de anúncio (criativo)
  dia: string;
  thumbnail: string | null;
  media: string | null;
  headline: string | null;
  seguidores: number;
  // Vídeo (colunas novas da tabela; undefined se ainda não populadas → tratado como null).
  videoUrl: string | null;
  videoPermalink: string | null;
  // Datas do Meta (ISO). Atributos de entidade repetidos por dia — colunas novas, null até
  // o backfill/ingestão popular. Ad = anúncio, conj = ad set, camp = campanha.
  adCriado: string | null;
  adEditado: string | null;
  conjCriado: string | null;
  conjEditado: string | null;
  campCriado: string | null;
  campEditado: string | null;
}

// Chave de AGRUPAMENTO de campanha. Preferimos o Campaign_ID: colapsa as variantes do NOME
// da MESMA campanha (o nome acumula sufixos de data " - DD/MM" a cada reedição, então uma
// campanha reeditada gera linhas com nomes diferentes p/ o mesmo Campaign_ID e aparecia
// DIVIDIDA em várias na hierarquia). Fallback p/ linhas antigas sem Campaign_ID: a chave
// normalizada (remove os sufixos de data) e, por fim, o nome cru. Mesma chave usada na
// hierarquia e na lista de anúncios p/ os dois baterem.
export function campaignGroupKey(r: CriativoRow): string {
  return r.campaignId || normCampaignKey(r.campanha) || r.campanha;
}

// Registro achatado por anúncio (agregado no período) para os cards "Insights dos Anúncios".
export interface AnuncioCardData {
  id: string;
  // ID do anúncio (Ad_ID) — chave para o reach dedup do período no Meta (via
  // /api/meta-reach?ads=). Vazio quando não há Ad_ID numérico.
  adId: string;
  posicao: number;
  nome: string;
  campanha: string;
  conjunto: string;
  status: "ativo" | "pausado";
  thumbnail: string | null;
  media: string | null;
  headline: string | null;
  // Vídeo do anúncio: videoUrl = mp4 tocável inline (Storage durável); videoPermalink = link
  // do Facebook (fallback). null quando o criativo não é vídeo ou a permissão ainda bloqueia.
  videoUrl: string | null;
  videoPermalink: string | null;
  objetivo: "geracao_demanda" | "seguidores";
  agg: Agg;
}

// Constrói o Agg a partir de um conjunto de linhas cruas. As fórmulas são IDÊNTICAS às do
// hook de campanhas (useMetaAdsClienteData): hook/hold = views/impressões, bounce = X/cliques−1,
// frequência ponderada por impressões, custo/resultado pelo tipo dominante.
// Datas da entidade (criação/edição). São atributos de ENTIDADE (não diários): a mesma
// campanha/conjunto/anúncio repete o valor em cada linha de dia. Escolhemos a menor data de
// criação e a maior data de edição do nó (a última edição vence quando muda entre ingestões).
function minDateOf(rows: CriativoRow[], key: "adCriado" | "conjCriado" | "campCriado"): string | null {
  let best: string | null = null;
  for (const r of rows) {
    const v = r[key];
    if (!v) continue;
    if (best === null || Date.parse(v) < Date.parse(best)) best = v;
  }
  return best;
}
function maxDateOf(rows: CriativoRow[], key: "adEditado" | "conjEditado" | "campEditado"): string | null {
  let best: string | null = null;
  for (const r of rows) {
    const v = r[key];
    if (!v) continue;
    if (best === null || Date.parse(v) > Date.parse(best)) best = v;
  }
  return best;
}

function aggregate(
  rows: CriativoRow[],
  crm?: { leads: number; consultas: number } | null,
  dates?: { criadoEm: string | null; editadoEm: string | null },
): Agg {
  let gasto = 0, orcamento = 0, impressoes = 0, alcance = 0, cliques = 0;
  let v3s = 0, v95 = 0, mensagens = 0, leads = 0, visitas = 0, seguidores = 0;
  let freqWeighted = 0, freqWeight = 0;
  let anyAtivo = false;
  // tipo de resultado (já resolvido por linha via resolveTipo) → { resultados somados, nº de
  // linhas com tipo GRAVADO, nº de linhas com tipo DERIVADO }. O gravado (optimization_goal)
  // tem prioridade na escolha do tipo do nó.
  const byTipo = new Map<string, { res: number; storedCount: number; derivedCount: number }>();

  for (const r of rows) {
    gasto += r.gasto;
    orcamento += r.orcamento;
    impressoes += r.impressoes;
    alcance += r.alcance;
    cliques += r.cliques;
    v3s += r.v3s;
    v95 += r.v95;
    mensagens += r.mensagens;
    leads += r.leads;
    visitas += r.visitas;
    seguidores += r.seguidores;
    if (r.tipo && r.tipo !== "—") {
      const e = byTipo.get(r.tipo) ?? { res: 0, storedCount: 0, derivedCount: 0 };
      e.res += r.resultados;
      if (r.tipoStored) e.storedCount += 1;
      else e.derivedCount += 1;
      byTipo.set(r.tipo, e);
    }
    if (r.impressoes > 0 && r.freq > 0) {
      freqWeighted += r.freq * r.impressoes;
      freqWeight += r.impressoes;
    }
    if (r.ativo) anyAtivo = true;
  }

  // Tipo de resultado do nó, na fonte de verdade do Gerenciador do Meta (a meta de otimização
  // do conjunto, gravada em Tipo_de_resultado):
  //   1) Se ALGUMA linha tem tipo GRAVADO → escolhe o tipo gravado dominante (por nº de linhas).
  //      Assim mensagens incidentais em dias SEM tipo não reclassificam uma campanha de
  //      Seguidores/Visitas como "Conversas iniciadas" (bug reportado).
  //   2) Nenhum tipo gravado → tipo derivado dominante por métrica.
  //   3) Nenhum tipo → prioridade por métrica somada.
  let tipoResultado = "—";
  const hasStored = [...byTipo.values()].some((e) => e.storedCount > 0);
  if (hasStored) {
    let best = -1;
    for (const [t, e] of byTipo) {
      if (e.storedCount > best) { tipoResultado = t; best = e.storedCount; }
    }
  } else if (byTipo.size > 0) {
    let bestCount = -1, bestRes = -1;
    for (const [t, e] of byTipo) {
      if (e.derivedCount > bestCount || (e.derivedCount === bestCount && e.res > bestRes)) {
        tipoResultado = t; bestCount = e.derivedCount; bestRes = e.res;
      }
    }
  } else if (leads > 0) tipoResultado = "Cadastros";
  else if (mensagens > 0) tipoResultado = "Conversas iniciadas";
  else if (visitas > 0) tipoResultado = "Visitas ao perfil";
  else if (seguidores > 0) tipoResultado = "Seguidores";
  else if (cliques > 0) tipoResultado = "Cliques no link";

  // Resultado do nó = a MÉTRICA correspondente ao tipo escolhido, somada em TODO o nó (não só
  // nas linhas cujo tipo casou). Isso garante que o número de "Resultados" e o "Custo/Result."
  // (gasto/resultado) usem a MESMA base — corrige a inconsistência reportada (Resultado exibia
  // cliques no link enquanto o CPR era calculado sobre visitas). Compras/Engajamento/ThruPlays
  // etc. (sem métrica dedicada aqui) usam a coluna Resultados gravada, somada por tipo.
  let resultado = 0;
  switch (tipoResultado) {
    case "Cadastros": resultado = leads; break;
    case "Conversas iniciadas": resultado = mensagens; break;
    case "Visitas ao perfil": resultado = visitas; break;
    case "Cliques no link": resultado = cliques; break;
    case "Seguidores": resultado = seguidores; break;
    case "—": resultado = 0; break;
    default: resultado = byTipo.get(tipoResultado)?.res ?? 0;
  }

  const frequencia = freqWeight > 0 ? freqWeighted / freqWeight : alcance > 0 ? impressoes / alcance : 0;

  return {
    status: anyAtivo ? "ativo" : "pausado",
    orcamento,
    gasto,
    resultado,
    tipoResultado,
    custoPorResultado: resultado > 0 ? gasto / resultado : 0,
    alcance,
    frequencia,
    alcanceAprox: true, // soma diária (aproximada); sobreposto por dedup no nível de campanha
    impressoes,
    video3s: v3s,
    hookRate: impressoes > 0 ? (v3s / impressoes) * 100 : 0,
    video95: v95,
    holdRate: impressoes > 0 ? (v95 / impressoes) * 100 : 0,
    cpm: impressoes > 0 ? (gasto / impressoes) * 1000 : 0,
    ctr: impressoes > 0 ? (cliques / impressoes) * 100 : 0,
    cpc: cliques > 0 ? gasto / cliques : 0,
    cliquesLink: cliques,
    // Bounce = X/cliques − 1 (perda do clique pra conversão), em % — igual ao dashboard atual.
    bounceMsg: cliques > 0 ? (mensagens / cliques - 1) * 100 : 0,
    mensagensIniciadas: mensagens,
    custoMensagem: mensagens > 0 ? gasto / mensagens : 0,
    bounceLead: cliques > 0 ? (leads / cliques - 1) * 100 : 0,
    leads,
    custoLead: leads > 0 ? gasto / leads : 0,
    leadsCrm: crm ? crm.leads : null,
    cplCrm: crm && crm.leads > 0 ? gasto / crm.leads : null,
    consultas: crm ? crm.consultas : null,
    criadoEm: dates?.criadoEm ?? null,
    editadoEm: dates?.editadoEm ?? null,
  };
}

// Orçamento DIÁRIO (taxa por dia, R$/dia) de um nó — NÃO somado entre dias nem entre anúncios.
// `Orcamento_diario` é o orçamento diário do CONJUNTO (ABO) ou da CAMPANHA (CBO), e o robô
// copia o MESMO valor em cada linha de anúncio×dia. Somar (o que aggregate fazia) multiplicava
// pelo nº de anúncios e de dias, inflando o número. Aqui deduplicamos:
//   1) por conjunto, pegando o orçamento do dia MAIS RECENTE do conjunto na janela (taxa atual);
//   2) no nível da campanha: se todos os conjuntos têm o MESMO valor → é CBO (orçamento único da
//      campanha) → usa 1 valor; se divergem → é ABO → SOMA os conjuntos.
// Para um nó de conjunto (1 adset) retorna o próprio orçamento diário; para anúncio o chamador
// zera (orçamento não é por anúncio).
function dailyBudgetRate(rows: CriativoRow[]): number {
  if (!rows.length) return 0;
  // adsetKey → orçamento diário no dia mais recente daquele conjunto dentro da janela.
  const byAdset = new Map<string, { day: string; budget: number }>();
  for (const r of rows) {
    const k = r.adsetId || r.conjunto || "__";
    const cur = byAdset.get(k);
    if (!cur || (r.dia || "") > cur.day) byAdset.set(k, { day: r.dia || "", budget: r.orcamento || 0 });
  }
  const vals = [...byAdset.values()].map((x) => x.budget).filter((v) => v > 0);
  if (vals.length === 0) return 0;
  if (new Set(vals).size === 1) return vals[0]; // CBO / único conjunto / todos iguais
  return vals.reduce((s, v) => s + v, 0); // ABO: soma dos orçamentos diários dos conjuntos
}

// Sobrepõe alcance/frequência de UM nó com o reach DEDUPLICADO do Meta (do /api/meta-reach).
// Alcance não é somável entre dias; a frequência recalculada = impressões(período, já aditivas)
// ÷ reach dedup — preservando freq×reach = impressões exibidas. Marca alcanceAprox=false.
// Sem dedup disponível (ou reach 0) → devolve o agg original (soma diária, marcada como aprox).
function withDedupReach(agg: Agg, d: { reach: number; impressions: number } | undefined): Agg {
  if (!d || d.reach <= 0) return agg;
  const alcance = d.reach;
  const frequencia = alcance > 0 ? agg.impressoes / alcance : agg.frequencia;
  return { ...agg, alcance, frequencia, alcanceAprox: false };
}

// Monta a hierarquia Campanha → Conjunto → Anúncio com agregados em cada nível, a partir das
// linhas já escopadas (`scoped`, ordenadas por Dia desc) e do CRM já resolvido por nome. Função
// PURA (sem React) p/ ser testável isoladamente — a chave de campanha (campaignGroupKey) colapsa
// as variantes de nome da mesma campanha. CRM entra só no nível de campanha.
export function buildCampanhas(
  scoped: CriativoRow[],
  crmByCampaign: { byCampaign: Map<string, { leads: number; consultas: number }> },
): CampanhaNode[] {
  // Conjuntos são chaveados por Adset_ID (não pelo nome): conjuntos sem nome resolvido
  // (pausados/arquivados) não devem colapsar num único "Sem conjunto". `nome` guarda o
  // rótulo de exibição (nome real ou "Conjunto …id" enquanto o backfill não preenche).
  // Agrupa por Campaign_ID (via campaignGroupKey) — não pelo nome cru — p/ que variantes de
  // nome da mesma campanha (sufixos de data) colapsem numa linha só. `nome` guarda o rótulo
  // de EXIBIÇÃO: como `scoped` vem ordenado por Dia desc, a 1ª linha vista é a mais recente,
  // então mostramos o nome ATUAL da campanha.
  const campMap = new Map<string, { nome: string; conj: Map<string, { nome: string; ads: Map<string, { nome: string; rows: CriativoRow[] }> }> }>();
  for (const r of scoped) {
    const campKey = campaignGroupKey(r);
    let camp = campMap.get(campKey);
    if (!camp) {
      camp = { nome: r.campanha, conj: new Map() };
      campMap.set(campKey, camp);
    }
    const conjMap = camp.conj;
    const conjKey = r.adsetId || r.conjunto;
    let conj = conjMap.get(conjKey);
    if (!conj) {
      conj = { nome: r.conjunto, ads: new Map() };
      conjMap.set(conjKey, conj);
    }
    // Agrupa todas as linhas (dias) do mesmo anúncio.
    const adKey = r.anuncioId || r.anuncio;
    let ad = conj.ads.get(adKey);
    if (!ad) {
      ad = { nome: r.anuncio, rows: [] };
      conj.ads.set(adKey, ad);
    }
    ad.rows.push(r);
  }

  const result: CampanhaNode[] = [];
  for (const [, camp] of campMap.entries()) {
    const conjMap = camp.conj;
    const conjuntos: ConjuntoNode[] = [];
    const campRows: CriativoRow[] = [];
    for (const [conjKey, conj] of conjMap.entries()) {
      const anuncios: AnuncioNode[] = [];
      const conjRows: CriativoRow[] = [];
      for (const [adKey, ad] of conj.ads.entries()) {
        anuncios.push({
          id: adKey,
          nome: ad.nome,
          agg: {
            ...aggregate(ad.rows, null, {
              criadoEm: minDateOf(ad.rows, "adCriado"),
              editadoEm: maxDateOf(ad.rows, "adEditado"),
            }),
            // Orçamento é do conjunto/campanha, não do anúncio → "—" no nível de anúncio.
            orcamento: 0,
          },
        });
        conjRows.push(...ad.rows);
      }
      anuncios.sort((a, b) => b.agg.gasto - a.agg.gasto);
      // adsetId = a chave do conjunto quando é um Adset_ID numérico (chave de consulta ao Meta).
      const adsetId = /^\d+$/.test(conjKey) ? conjKey : "";
      conjuntos.push({
        nome: conj.nome,
        adsetId,
        agg: {
          ...aggregate(conjRows, null, {
            criadoEm: minDateOf(conjRows, "conjCriado"),
            editadoEm: maxDateOf(conjRows, "conjEditado"),
          }),
          // Orçamento diário do conjunto (taxa/dia), não a soma entre anúncios/dias.
          orcamento: dailyBudgetRate(conjRows),
        },
        anuncios,
      });
      campRows.push(...conjRows);
    }
    conjuntos.sort((a, b) => b.agg.gasto - a.agg.gasto);
    // CRM (Kommo) é atribuído por NOME de campanha do Meta. Como a campanha pode ter várias
    // variantes de nome (sufixos de data) e os leads podem ter caído em qualquer uma, somamos
    // o CRM de TODAS as variantes presentes nesta campanha. Fica null quando nenhuma variante
    // teve lead (aggregate → "—"), preservando o comportamento anterior.
    let crm: { leads: number; consultas: number } | null = null;
    for (const nm of new Set(campRows.map((r) => r.campanha))) {
      const c = crmByCampaign.byCampaign.get(nm);
      if (c) crm = { leads: (crm?.leads ?? 0) + c.leads, consultas: (crm?.consultas ?? 0) + c.consultas };
    }
    const campaignId = campRows.find((r) => r.campaignId)?.campaignId || "";
    result.push({
      nome: camp.nome,
      campaignId,
      agg: {
        ...aggregate(campRows, crm, {
          criadoEm: minDateOf(campRows, "campCriado"),
          editadoEm: maxDateOf(campRows, "campEditado"),
        }),
        // Orçamento diário da campanha: CBO = valor único; ABO = soma dos conjuntos.
        orcamento: dailyBudgetRate(campRows),
      },
      conjuntos,
    });
  }
  result.sort((a, b) => b.agg.gasto - a.agg.gasto);
  return result;
}

/**
 * Hierarquia Campanha → Conjunto → Anúncio a partir da tabela `Criativos Meta Ads`.
 * Mesma semântica de escopo por cliente/data do `useMetaAdsClienteData` (para os dois baterem):
 * fetch restrito no servidor por `%core%`/`%groohub%` + refiltro canônico client-side.
 */
export function useMetaAdsCriativosData(
  clientFilter?: string,
  dateFrom?: string,
  dateTo?: string,
  medicoFilter?: string | string[],
) {
  // Carteira visível: o filtro por ATIVO/ocultos roda DENTRO do fetch abaixo, então a
  // versão entra nas deps do efeito — quando as fontes chegam, o efeito repete (servido pelo
  // cache do dedupedFetch) e re-filtra o que já estava em tela.
  const visVersao = useClientesVisiveis();
  // Médicos selecionados (normalizado): [] = todos. Filtro compartilhado é multi-seleção.
  const medicoSel = useMemo<string[]>(() => {
    if (!medicoFilter) return [];
    const arr = Array.isArray(medicoFilter) ? medicoFilter : [medicoFilter];
    return arr.filter((v) => v && v !== "all");
  }, [medicoFilter]);
  // Modo captação (mídia própria da Groohub): isola as contas cujo `Client` COMEÇA com
  // "Groohub" (contas próprias, sem canonicalização) e não atribui leads do CRM (não há
  // pipeline de clientes no Kommo para a captação). Ver src/lib/captacao.ts.
  const captacao = clientFilter === CAPTACAO_FILTER;
  const [rowsRaw, setRowsRaw] = useState<any[]>([]);
  const [kommoRaw, setKommoRaw] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const PAGE = 1000;
        const MAX_ROWS = 100000;
        const core = captacao ? "" : clientFilter && clientFilter !== "all" ? adsClientSearchCore(clientFilter) : "";
        // Cliente que agrupa várias contas (ex.: Instituto Aurum): `.or()` casa TODAS as contas
        // do grupo (um `%core%` só pegaria a 1ª). Refiltro canônico client-side mantém só este cliente.
        const acctRules = captacao ? [] : accountMedicoRules(clientFilter);
        const acctOr = acctRules.length ? accountOrFilter(acctRules) : "";
        const scopeKey = acctRules.length ? clientMatchKey(canonicalizeAdsClient(clientFilter)) : (core || "all");

        // Fetch paginado da tabela de criativos. ORDER BY estável (Dia + id) é OBRIGATÓRIO com
        // .range() senão o PostgREST pula/duplica linhas acima de 1000. Sem Fonte_Ads: a tabela
        // é só de Meta Ads.
        // Cache (5 min) + coalescing + retry (57014) por escopo+período. A tabela de criativos
        // é pesada (conteúdo/thumbnails), então evitar refetch ao navegar de volta pesa muito.
        const criativosKey = `criativos:${captacao ? "captacao" : scopeKey}:${dateFrom || ""}:${dateTo || ""}`;
        const fetchAllCriativos = (): Promise<any[]> =>
          dedupedFetch(criativosKey, async () => {
            const all: any[] = [];
            for (let from = 0; from < MAX_ROWS; from += PAGE) {
              const batch = await withRetry(async () => {
                let q = externalSupabase
                  .from("Criativos Meta Ads")
                  .select("*")
                  .order("Dia", { ascending: false })
                  .order("id", { ascending: false })
                  .range(from, from + PAGE - 1);
                // Captação: só as contas PRÓPRIAS da Groohub ("Groohub - CA X.X.X"), via
                // prefixo `Groohub%` — NÃO `%groohub%`, que casaria todo cliente "X | Groohub".
                if (captacao) q = q.ilike("Client", CAPTACAO_ILIKE);
                else if (acctOr) q = q.or(acctOr);
                else if (core.length >= 3) q = q.ilike("Client", `%${core}%`);
                else q = q.ilike("Client", "%groohub%");
                if (dateFrom) q = q.gte("Dia", dateFrom);
                if (dateTo) q = q.lte("Dia", dateTo);
                const { data, error } = await q;
                if (error) throw error;
                return (data as any[]) || [];
              });
              all.push(...batch);
              if (batch.length < PAGE) break;
            }
            return all;
          });

        // CRM (Kommo) — só para preencher Leads CRM / CPL CRM / Consultas Agendadas por campanha.
        // Independe do cliente (match client-side) → chave só por período, compartilhada no cache.
        const kommoKey = `criativos-kommo:${dateFrom || ""}:${dateTo || ""}`;
        const fetchAllKommo = (): Promise<any[]> =>
          dedupedFetch(kommoKey, async () => {
            const all: any[] = [];
            for (let from = 0; from < MAX_ROWS; from += PAGE) {
              const batch = await withRetry(async () => {
                let q = externalSupabase
                  .from("v_kommo_completa")
                  .select("id, Campanha, client, \"Médico\", \"Médicos\", \"Consulta Agendada Em\", created_at")
                  .order("id", { ascending: true })
                  .range(from, from + PAGE - 1);
                const createdAtGte = dateFrom ? `${dateFrom}T00:00:00.000+00:00` : undefined;
                const createdAtLte = dateTo ? `${dateTo}T23:59:59.999+00:00` : undefined;
                if (createdAtGte) q = q.gte("created_at", createdAtGte);
                if (createdAtLte) q = q.lte("created_at", createdAtLte);
                const { data, error } = await q;
                if (error) throw error;
                return (data as any[]) || [];
              });
              all.push(...batch);
              if (batch.length < PAGE) break;
            }
            return all;
          });

        const [criativos, kommo] = await Promise.all([fetchAllCriativos(), fetchAllKommo()]);
        if (cancelled) return;
        // Captação: as contas próprias da Groohub ("Groohub - CA X.X.X") não são clientes da
        // carteira (projetos_lista); o filtro de carteira ATIVA (via isExcludedClient) as
        // excluiria, esvaziando a hierarquia/insights. O fetch já restringe a `Groohub%` e o
        // scoped reforça com isCaptacaoClient — em captação não reexcluímos aqui.
        setRowsRaw(criativos.filter((r) => captacao || !isExcludedClient(r.Client, "meta")));
        setKommoRaw(kommo.filter((r) => !isExcludedClient(r.client, "meta")));
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Erro ao buscar dados de criativos");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, clientFilter, visVersao]);

  // Chave canônica do cliente selecionado (unifica variantes do nome da conta).
  const selectedClientKey = useMemo(
    () => (!captacao && clientFilter && clientFilter !== "all" ? clientMatchKey(canonicalizeAdsClient(clientFilter)) : null),
    [clientFilter, captacao],
  );

  // Split de campanhas por médico via NOME da campanha (ex.: Dra. Carla Gouveia: uma conta só,
  // dividida em "DRA. CARLA" / "CLÍN. ÚNICA" / "DRA. ISADORA"). Vazio = cliente não participa.
  const campRules = useMemo(() => (captacao ? [] : campaignMedicoRules(clientFilter)), [captacao, clientFilter]);
  // Split por CONTA (cliente agrupador, ex.: Instituto Aurum): médico = qual conta (nome cru
  // do Client) a campanha pertence. Espelha useMetaAdsClienteData.
  const acctRules = useMemo(() => (captacao ? [] : accountMedicoRules(clientFilter)), [captacao, clientFilter]);

  // Linhas cruas normalizadas + escopo canônico client-side.
  const scoped = useMemo<CriativoRow[]>(() => {
    const out: CriativoRow[] = [];
    for (const r of rowsRaw) {
      // Captação: só linhas das contas PRÓPRIAS da Groohub (reforço client-side do fetch).
      if (captacao) {
        if (!isCaptacaoClient(r.Client)) continue;
      } else if (selectedClientKey && clientMatchKey(canonicalizeAdsClient(r.Client)) !== selectedClientKey) {
        continue;
      }
      // Split por médico (nome da campanha). Só filtra quando o cliente participa E há médico
      // selecionado; sem seleção mostra tudo. Campanha sem token de médico = MEDICO_VAZIO
      // (fica fora de qualquer seleção, só aparece sem filtro).
      if (acctRules.length && medicoSel.length > 0) {
        // Split por conta: casa o médico pelo nome CRU do Client (a conta).
        if (!medicoSel.includes(campaignMedicoFromName(acctRules, r.Client) ?? MEDICO_VAZIO)) continue;
      } else if (campRules.length && medicoSel.length > 0) {
        const med = campaignMedicoFromName(campRules, r.Nome_Campanha);
        if (!medicoSel.includes(med ?? MEDICO_VAZIO)) continue;
      }
      const mensagens = num(r.Mensagens_iniciadas);
      const leads = num(r.Lead);
      const visitas = num(r.Visitas_perfil);
      const seguidores = num(r.Seguidores);
      const tipoStored = !!(r.Tipo_de_resultado && String(r.Tipo_de_resultado).trim());
      // Resultado da linha derivado do tipo resolvido — garante número correto mesmo
      // quando a coluna Resultados ainda não foi reprocessada (backfill).
      const tipo = resolveTipo(r.Tipo_de_resultado, { mensagens, leads, seguidores, visitas });
      const resultados =
        tipo === "Cadastros" ? leads
        : tipo === "Conversas iniciadas" ? mensagens
        : tipo === "Cliques no link" ? num(r.Cliques_no_link)
        : tipo === "Seguidores" ? seguidores
        : tipo === "Visitas ao perfil" ? visitas
        : num(r.Resultados);
      const adsetId = String(r.Adset_ID ?? "");
      out.push({
        campanha: r.Nome_Campanha || "Sem nome",
        campaignId: String(r.Campaign_ID ?? ""),
        // Nome de exibição do conjunto. Quando o nome não foi resolvido (conjunto pausado/
        // arquivado fora do READ_ADSETS) mas há Adset_ID, mostra um rótulo distinto por ID
        // em vez de jogar tudo em "Sem conjunto" — mantém a contagem certa até o backfill
        // preencher o nome real.
        conjunto: r.Nome_Conjunto || (adsetId ? `Conjunto ${adsetId.slice(-6)}` : "Sem conjunto"),
        adsetId,
        anuncioId: String(r.Ad_ID ?? r.id ?? ""),
        anuncio: r.Nome_Anuncio || "Sem nome",
        ativo: String(r.Status ?? "").toUpperCase() === "ACTIVE",
        gasto: num(r.Valor_usado_BRL),
        orcamento: num(r.Orcamento_diario),
        impressoes: num(r.Impressões),
        alcance: num(r.Alcance),
        freq: num(r.Frequencia),
        cliques: num(r.Cliques_no_link),
        v3s: num(r.Video_views_3s),
        v95: num(r.Video_views_95pct),
        mensagens,
        leads,
        visitas,
        resultados,
        tipo,
        tipoStored,
        dia: r.Dia || "",
        thumbnail: r.Thumbnail_URL || null,
        media: r.Media_URL || null,
        headline: r.Headline || null,
        seguidores,
        videoUrl: r.Video_URL || null,
        videoPermalink: r.Video_Permalink || null,
        adCriado: r.Ad_Criado_Em || null,
        adEditado: r.Ad_Editado_Em || null,
        conjCriado: r.Conjunto_Criado_Em || null,
        conjEditado: r.Conjunto_Editado_Em || null,
        campCriado: r.Campanha_Criado_Em || null,
        campEditado: r.Campanha_Editado_Em || null,
      });
    }
    return out;
  }, [rowsRaw, selectedClientKey, captacao, campRules, acctRules, medicoSel]);

  // Nomes de campanha do Meta presentes neste escopo (para casar o CRM por PARTE do nome).
  const metaCampaignNames = useMemo(() => [...new Set(scoped.map((r) => r.campanha))], [scoped]);

  // CRM agregado POR CAMPANHA DO META (leads + consultas agendadas), respeitando cliente/médico/
  // data. O Kommo guarda o nome da campanha (snapshot no lead) que pode divergir do nome atual do
  // Meta. Casamos em camadas, do mais forte ao mais fraco (cada lead vai p/ a MELHOR campanha, sem
  // dupla contagem):
  //   1) chave normalizada idêntica (ignora sufixo de datas) — snapshot antigo × nome atual;
  //   2) núcleo idêntico (ignora "GROOHUB Nº" + datas) — campanha renumerada;
  //   3) contenção ("parte do nome"): uma chave normalizada contém a outra → escolhe a de maior
  //      sobreposição (mín. 8 chars p/ evitar match espúrio de prefixo genérico).
  // Leads do Kommo SEM campanha (ou cujo nome não bate parte alguma) ficam sem atribuição — não há
  // como saber a campanha (o dado de origem não traz; conjunto/anúncio vêm vazios nesses leads).
  const crmByCampaign = useMemo(() => {
    // Captação não tem pipeline de clientes no Kommo: nenhuma atribuição de CRM (Leads CRM /
    // CPL CRM / Consultas ficam "—" na hierarquia, igual ao comportamento da tabela plana).
    if (captacao) return { byCampaign: new Map<string, { leads: number; consultas: number }>(), semCampanha: { leads: 0, consultas: 0 } };
    const metas = metaCampaignNames.map((name) => ({
      name,
      norm: normCampaignKey(name),
      core: coreCampaignKey(name),
    }));
    const byNorm = new Map<string, string>();
    const byCore = new Map<string, string>();
    for (const m of metas) {
      if (!byNorm.has(m.norm)) byNorm.set(m.norm, m.name);
      if (m.core.length >= 10 && !byCore.has(m.core)) byCore.set(m.core, m.name);
    }
    const MIN_OVERLAP = 8;
    const pick = (kNorm: string, kCore: string): string | null => {
      const exact = byNorm.get(kNorm);
      if (exact) return exact;
      if (kCore.length >= 10) {
        const core = byCore.get(kCore);
        if (core) return core;
      }
      let best: string | null = null;
      let bestLen = 0;
      for (const m of metas) {
        let overlap = 0;
        if (m.norm.includes(kNorm)) overlap = kNorm.length;
        else if (kNorm.includes(m.norm)) overlap = m.norm.length;
        if (overlap >= MIN_OVERLAP && overlap > bestLen) {
          best = m.name;
          bestLen = overlap;
        }
      }
      return best;
    };

    const map = new Map<string, { leads: number; consultas: number }>();
    // Leads que passam nos filtros (cliente/médico/data) mas NÃO caem em nenhuma campanha —
    // sem Campanha no Kommo ou com nome que não bate parte alguma. Mostrados à parte na UI.
    let semLeads = 0;
    let semConsultas = 0;
    for (const row of kommoRaw) {
      if (!inRange(row.created_at, dateFrom, dateTo)) continue;
      if (selectedClientKey && clientMatchKey(row.client) !== selectedClientKey) continue;
      if (medicoSel.length > 0) {
        const m = ((row["Médico"] || row["Médicos"] || "") as string).trim();
        if (!medicoSel.includes(m === "" ? MEDICO_VAZIO : m)) continue;
      }
      const name = row.Campanha
        ? pick(normCampaignKey(row.Campanha), coreCampaignKey(row.Campanha))
        : null;
      if (!name) {
        semLeads += 1;
        if (row["Consulta Agendada Em"]) semConsultas += 1;
        continue;
      }
      const e = map.get(name) || { leads: 0, consultas: 0 };
      e.leads += 1;
      if (row["Consulta Agendada Em"]) e.consultas += 1;
      map.set(name, e);
    }
    return { byCampaign: map, semCampanha: { leads: semLeads, consultas: semConsultas } };
  }, [kommoRaw, metaCampaignNames, selectedClientKey, medicoSel, dateFrom, dateTo, captacao]);

  // Monta a hierarquia com agregados em cada nível. CRM entra só no nível de campanha.
  const campanhas = useMemo<CampanhaNode[]>(
    () => buildCampanhas(scoped, crmByCampaign),
    [scoped, crmByCampaign],
  );

  // ---- Reach DEDUPLICADO por campanha (via /api/meta-reach) ----------------
  // Alcance/frequência não podem ser somados entre dias; o valor exato vem de UMA
  // consulta ao Meta por campanha no período. Busca sob demanda p/ as campanhas
  // exibidas; enquanto não chega (ou se falhar), a UI usa o valor somado com aviso
  // (alcanceAprox=true). Cacheado no serviço (range fechado = eterno).
  const [reachByCampaign, setReachByCampaign] = useState<Map<string, { reach: number; impressions: number }>>(new Map());
  useEffect(() => {
    let cancelled = false;
    const ids = [...new Set(campanhas.map((c) => c.campaignId).filter(Boolean))];
    if (!ids.length || !dateFrom || !dateTo || ids.length > 150) { setReachByCampaign(new Map()); return; }
    (async () => {
      try {
        const url = `/api/meta-reach?since=${dateFrom}&until=${dateTo}&campaigns=${encodeURIComponent(JSON.stringify(ids))}`;
        const { data: { session } } = await externalSupabase.auth.getSession();
        const res = await fetch(url, { headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}, signal: AbortSignal.timeout(85_000) });
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        const results: Array<{ campaign?: string; matched?: boolean; reach?: number; impressions?: number }> =
          Array.isArray(json?.results) ? json.results : [];
        const map = new Map<string, { reach: number; impressions: number }>();
        for (const r of results) {
          if (r.matched && r.campaign && (r.reach || 0) > 0) {
            map.set(String(r.campaign), { reach: r.reach || 0, impressions: r.impressions || 0 });
          }
        }
        if (!cancelled) setReachByCampaign(map);
      } catch {
        if (!cancelled) setReachByCampaign(new Map()); // fallback silencioso: mantém soma diária (aprox)
      }
    })();
    return () => { cancelled = true; };
  }, [campanhas, dateFrom, dateTo]);

  // ---- Reach DEDUPLICADO por CONJUNTO e ANÚNCIO (via /api/meta-reach) -------
  // Mesma lógica da campanha, agora nos níveis mais fundos da hierarquia (o alcance
  // também não é somável entre dias em conjunto/anúncio — foi o bug reportado: a linha
  // "001" de um cliente somava o alcance diário). Uma consulta ao Meta por nó
  // (level=adset/ad), cacheada no serviço (range fechado = eterno). Gate por teto: em
  // visões com nós demais (ex.: "todos os clientes") cai no fallback ~somado em vez de
  // disparar muitas chamadas — o valor exato aparece ao focar um cliente.
  const [reachByAdset, setReachByAdset] = useState<Map<string, { reach: number; impressions: number }>>(new Map());
  const [reachByAd, setReachByAd] = useState<Map<string, { reach: number; impressions: number }>>(new Map());
  const adsetIds = useMemo(
    () => [...new Set(scoped.map((r) => r.adsetId).filter((id) => /^\d+$/.test(id)))],
    [scoped],
  );
  const adIds = useMemo(
    () => [...new Set(scoped.map((r) => r.anuncioId).filter((id) => /^\d+$/.test(id)))],
    [scoped],
  );
  useEffect(() => {
    let cancelled = false;
    const ADSET_CAP = 400, AD_CAP = 600;
    const wantAdsets = adsetIds.length > 0 && adsetIds.length <= ADSET_CAP;
    const wantAds = adIds.length > 0 && adIds.length <= AD_CAP;
    if (!dateFrom || !dateTo || (!wantAdsets && !wantAds)) {
      setReachByAdset(new Map());
      setReachByAd(new Map());
      return;
    }
    const empty = () => new Map<string, { reach: number; impressions: number }>();
    const fetchLevel = async (param: "adsets" | "ads", ids: string[]) => {
      const url = `/api/meta-reach?since=${dateFrom}&until=${dateTo}&${param}=${encodeURIComponent(JSON.stringify(ids))}`;
      const { data: { session } } = await externalSupabase.auth.getSession();
      const res = await fetch(url, { headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}, signal: AbortSignal.timeout(85_000) });
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      const results: Array<{ id?: string; matched?: boolean; reach?: number; impressions?: number }> =
        Array.isArray(json?.results) ? json.results : [];
      const map = empty();
      for (const r of results) {
        if (r.matched && r.id && (r.reach || 0) > 0) {
          map.set(String(r.id), { reach: r.reach || 0, impressions: r.impressions || 0 });
        }
      }
      return map;
    };
    (async () => {
      try {
        const [aset, ad] = await Promise.all([
          wantAdsets ? fetchLevel("adsets", adsetIds) : Promise.resolve(empty()),
          wantAds ? fetchLevel("ads", adIds) : Promise.resolve(empty()),
        ]);
        if (!cancelled) {
          setReachByAdset(aset);
          setReachByAd(ad);
        }
      } catch {
        if (!cancelled) {
          setReachByAdset(empty()); // fallback silencioso: mantém soma diária (~)
          setReachByAd(empty());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adsetIds, adIds, dateFrom, dateTo]);

  // Sobrepõe alcance/frequência da hierarquia (campanha + conjunto + anúncio) com o reach
  // deduplicado do Meta quando disponível; cada nível usa seu próprio id. Frequência =
  // impressões(período) ÷ reach(dedup) — mantém freq×reach = impressões exibidas. Sem match
  // em um nível → aquele nó mantém a soma diária marcada como aproximada (~).
  const campanhasFinal = useMemo<CampanhaNode[]>(() => {
    if (!reachByCampaign.size && !reachByAdset.size && !reachByAd.size) return campanhas;
    return campanhas.map((c) => {
      const conjuntos = c.conjuntos.map((cj) => {
        const anuncios = cj.anuncios.map((a) => {
          const dAd = reachByAd.get(a.id);
          return dAd ? { ...a, agg: withDedupReach(a.agg, dAd) } : a;
        });
        return { ...cj, agg: withDedupReach(cj.agg, reachByAdset.get(cj.adsetId)), anuncios };
      });
      return { ...c, agg: withDedupReach(c.agg, reachByCampaign.get(c.campaignId)), conjuntos };
    });
  }, [campanhas, reachByCampaign, reachByAdset, reachByAd]);

  // Lista achatada por anúncio (agregado no período) para os cards "Insights dos Anúncios".
  const anuncios = useMemo<AnuncioCardData[]>(() => {
    const map = new Map<string, { nome: string; campanha: string; conjunto: string; rows: CriativoRow[] }>();
    for (const r of scoped) {
      // Chaveia pela campanha AGRUPADA (Campaign_ID) + conjunto (Adset_ID) + anúncio (Ad_ID)
      // — não pelo nome cru da campanha — senão o mesmo anúncio, visto sob variantes de nome
      // da campanha (sufixos de data), viraria dois cards. `campanha` exibida vem da 1ª linha
      // (Dia desc = nome atual).
      const key = `${campaignGroupKey(r)}::${r.adsetId || r.conjunto}::${r.anuncioId || r.anuncio}`;
      let e = map.get(key);
      if (!e) {
        e = { nome: r.anuncio, campanha: r.campanha, conjunto: r.conjunto, rows: [] };
        map.set(key, e);
      }
      e.rows.push(r);
    }
    const list: AnuncioCardData[] = [];
    for (const [key, e] of map.entries()) {
      const agg = aggregate(e.rows, null, {
        criadoEm: minDateOf(e.rows, "adCriado"),
        editadoEm: maxDateOf(e.rows, "adEditado"),
      });
      // Ad_ID numérico do anúncio (chave p/ o reach dedup do Meta via /api/meta-reach?ads=).
      const adId = e.rows.find((r) => /^\d+$/.test(r.anuncioId))?.anuncioId ?? "";
      // Thumbnail/mídia/headline: pega a linha mais recente (maior Dia) que tenha o campo.
      const byRecent = [...e.rows].sort((a, b) => (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : 0));
      const thumbnail = byRecent.find((r) => r.thumbnail)?.thumbnail ?? null;
      const media = byRecent.find((r) => r.media)?.media ?? null;
      const headline = byRecent.find((r) => r.headline)?.headline ?? null;
      const videoUrl = byRecent.find((r) => r.videoUrl)?.videoUrl ?? null;
      const videoPermalink = byRecent.find((r) => r.videoPermalink)?.videoPermalink ?? null;
      // Filtro objetivo pelo tipo de resultado: campanhas de perfil/engajamento — "Cliques no
      // link" (tráfego p/ o perfil do IG), "Seguidores" e "Visitas ao perfil" → aba Seguidores.
      // Mensagens/Cadastros/Compras e o resto → Geração de Demanda (padrão).
      const objetivo: "geracao_demanda" | "seguidores" =
        agg.tipoResultado === "Cliques no link" ||
        agg.tipoResultado === "Seguidores" ||
        agg.tipoResultado === "Visitas ao perfil"
          ? "seguidores"
          : "geracao_demanda";
      list.push({
        id: key,
        adId,
        posicao: 0,
        nome: e.nome,
        campanha: e.campanha,
        conjunto: e.conjunto,
        status: agg.status,
        thumbnail,
        media,
        headline,
        videoUrl,
        videoPermalink,
        objetivo,
        agg,
      });
    }
    list.sort((a, b) => b.agg.gasto - a.agg.gasto);
    list.forEach((a, i) => (a.posicao = i + 1));
    return list;
  }, [scoped]);

  // Cards "Insights dos Anúncios" com alcance/frequência deduplicados do Meta quando
  // disponível (mesmo reach por Ad_ID usado na hierarquia). Sem match → soma diária.
  const anunciosFinal = useMemo<AnuncioCardData[]>(() => {
    if (!reachByAd.size) return anuncios;
    return anuncios.map((a) => {
      const d = reachByAd.get(a.adId);
      return d ? { ...a, agg: withDedupReach(a.agg, d) } : a;
    });
  }, [anuncios, reachByAd]);

  // Tipos de resultado presentes (para o filtro da tela).
  const tiposResultado = useMemo(() => {
    const set = new Set<string>();
    for (const c of campanhas) if (c.agg.tipoResultado && c.agg.tipoResultado !== "—") set.add(c.agg.tipoResultado);
    return [...set].sort();
  }, [campanhas]);

  return {
    campanhas: campanhasFinal,
    anuncios: anunciosFinal,
    tiposResultado,
    crmSemCampanha: crmByCampaign.semCampanha,
    loading,
    error,
  };
}
