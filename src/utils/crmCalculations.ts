import { getEspecialidade } from "@/data/clienteEspecialidades";
import { stripAccents, clientMatchKey } from "@/data/clienteAliases";

// ── Investimento + Imposto ─────────────────────────────
// Imposto sobre o investimento em mídia: 12,5% do valor investido. O "Investimento + Imposto"
// mostrado nos cards (Meta Ads e CRM) é o investimento acrescido desse imposto. Centralizado
// aqui para as duas telas usarem exatamente a mesma taxa/fórmula.
export const INVESTIMENTO_IMPOSTO_RATE = 0.125;

export function investimentoComImposto(investimento: number): number {
  return investimento * (1 + INVESTIMENTO_IMPOSTO_RATE);
}

// ── Types ──────────────────────────────────────────────

export interface KommoRow {
  id: unknown;
  client: string;
  Campanha: string;
  Especialidade: string | null;
  Origem: string | null;
  "Médico": string | null;
  // Algumas contas (ex: Fábio_Morais) usam o campo plural "Médicos" no Kommo.
  "Médicos"?: string | null;
  "Consulta Agendada Em": string | null;
  "Dia da Consulta Realizada": string | null;
  "Procedimento Agendado Em": string | null;
  "Dia do Procedimento Realizado": string | null;
  // Nome/tipo do procedimento (campo "Procedimento" do Kommo). Presente só quando o
  // consumidor seleciona a coluna (ex.: o fetch por-cliente do filtro de procedimento na
  // tela CRM). Cada lead carrega no máximo UM procedimento (ex.: "Rinoplastia" ou
  // "Transplante Capilar"), então serve de dimensão para o filtro por tipo de procedimento.
  "Procedimento"?: string | null;
  "Valor da Consulta": unknown;
  "Valor do Procedimento": unknown;
  // Data em que o orçamento foi enviado (campo Kommo "Orçamento Enviado Em", ISO em UTC;
  // 03:00Z = 00:00 BRT). Usado p/ cair no período na etapa "Orçamento". Nem todo lead preenche,
  // e cada conta nomeia esse campo de um jeito — ver getOrcamentoSentDate / ORCAMENTO_DATE_FIELDS.
  "Orçamento Enviado Em"?: string | null;
  // Metadata JSONB cru do lead (passthrough da view v_kommo_completa). Lido p/ pegar variantes
  // de nome de campo que a view NÃO expõe como coluna própria (ex.: "Data do Orçamento enviado").
  metadata?: Record<string, unknown> | null;
  // Etapa atual do funil no Kommo (ex.: "Orçamento", "Consulta Agendada", "Venda Ganha").
  status_nome?: string | null;
  created_at: string | null;
}

// Variantes de NOME do campo Kommo "data em que o orçamento foi enviado", em ordem de
// preferência. Cada conta batiza esse campo de um jeito (e muitas nem preenchem): a maioria
// usa "Orçamento Enviado Em", mas há contas como Aurelio_Oliveira que gravam em
// "Data do Orçamento enviado". Todas carregam ISO em UTC (03:00Z = 00:00 BRT).
export const ORCAMENTO_DATE_FIELDS = [
  "Orçamento Enviado Em",
  "Data do Orçamento enviado",
  "Data do Orçamento",
  "Dia do Orçamento Enviado",
] as const;

// Data de orçamento enviado de um lead, coalescendo todas as variantes conhecidas: primeiro a
// coluna nomeada "Orçamento Enviado Em" (quando o consumidor a seleciona) e, na falta dela, as
// variantes lidas do metadata cru. Retorna null quando a conta não registra a data em campo
// algum (aí o chamador cai em created_at). Centraliza a regra p/ card e janela de maturidade
// usarem EXATAMENTE a mesma data e não divergirem.
export function getOrcamentoSentDate(row: KommoRow): string | null {
  const direct = row["Orçamento Enviado Em"];
  if (typeof direct === "string" && direct.trim()) return direct;
  const md = row.metadata;
  if (md && typeof md === "object") {
    for (const field of ORCAMENTO_DATE_FIELDS) {
      const v = md[field];
      if (typeof v === "string" && v.trim()) return v;
    }
  }
  return null;
}

export function getMedico(row: { "Médico"?: string | null; "Médicos"?: string | null }): string {
  return (row["Médico"]?.trim() || row["Médicos"]?.trim() || "");
}

export interface OrigemFunnelRow {
  origem: string;
  leads: number;
  consultasAgendadas: number;
  consultasRealizadas: number;
  procedimentosAgendados: number;
  procedimentosRealizados: number;
}

// Linha do funil por TAG de cliente. Mesma forma do funil por origem, só muda a chave.
export interface TagFunnelRow {
  tag: string;
  leads: number;
  consultasAgendadas: number;
  consultasRealizadas: number;
  procedimentosAgendados: number;
  procedimentosRealizados: number;
}

export interface AdsRow {
  Client: string;
  // Dia (YYYY-MM-DD) da linha de Ads. Presente quando o consumidor passa externalAdsRows
  // com a coluna (ex.: a tela CRM). Usado só para a evolução mensal (investimento/leads
  // tráfego por mês). O fetch interno do hook não seleciona esta coluna (retrocompat).
  Dia?: string;
  Lead: number;
  // Conversas (mensagens iniciadas). Compõe o "Leads tráfego" junto com Lead,
  // igual à seção Meta Ads (leads + conversas). Pode vir da coluna raw
  // `Mensagens_iniciadas` (fetch interno) ou da coluna agregada `Conversa`
  // (externalAdsRows), que representam o mesmo total de conversas.
  Mensagens_iniciadas?: number;
  Valor_usado_BRL: number;
  // Opcional: presente quando o consumidor passa externalAdsRows com a coluna.
  // O fetch interno do hook não seleciona esta coluna (retrocompat).
  Fonte_Ads?: string;
  // Médico (string do Kommo) dono desta conta de Ads, quando ela participa de um split de
  // leads tráfego dentro de um cliente compartilhado (ex.: "Dr. Moacir" / "Dra. Lia").
  // null/undefined = conta não se divide por médico (leads tráfego não é afetado pelo
  // filtro de médico). Ver adsMedicoForClient / ADS_MEDICO_BY_CLIENT.
  medico?: string | null;
}

export interface MergedClient {
  client: string;
  leadsTrafego: number;
  // Quebra de "Leads tráfego" por fonte. leadsTrafegoMeta + leadsTrafegoGoogle === leadsTrafego.
  leadsTrafegoMeta: number;
  leadsTrafegoGoogle: number;
  spend: number;
  leadsCRM: number;
  // Quebra dos Leads CRM por origem (Kommo). Não somam ao total: leads de outras
  // origens (Indicação, Instagram, etc.) ficam de fora dessas duas.
  leadsCRMMeta: number;
  leadsCRMGoogle: number;
  consultasAgendadas: number;
  valorConsultasAgendadas: number;
  consultasRealizadas: number;
  valorConsultasRealizadas: number;
  procedimentosAgendados: number;
  valorProcedimentosAgendados: number;
  procedimentosRealizados: number;
  valorProcedimentosRealizados: number;
  fatRealizados: number;
}

export interface CRMTotals {
  leadsTrafego: number;
  leadsTrafegoMeta: number;
  leadsTrafegoGoogle: number;
  leadsCRM: number;
  leadsCRMMeta: number;
  leadsCRMGoogle: number;
  consultasAgendadas: number;
  valorConsultasAgendadas: number;
  consultasRealizadas: number;
  valorConsultasRealizadas: number;
  procedimentosAgendados: number;
  valorProcedimentosAgendados: number;
  procedimentosRealizados: number;
  valorProcedimentosRealizados: number;
  investimentoTotal: number;
  faturamentoBruto: number;
  roas: number;
}

export interface CRMClientRow {
  client: string;
  especialidade: string;
  investimento: number;
  leadsTrafego: number;
  leadsTrafegoMeta: number;
  leadsTrafegoGoogle: number;
  leadsCRM: number;
  consultasAgendadas: number;
  cacGeral: number;
  valorConsultasAgendadas: number;
  consultasRealizadas: number;
  valorConsultasRealizadas: number;
  procedimentosAgendados: number;
  valorProcedimentosAgendados: number;
  procedimentosRealizados: number;
  valorProcedimentosRealizados: number;
  faturamentoBrutoRealizados: number;
  roas: number;
}

// ── Faturamento Bruto: base configurável por cliente ───
// O Faturamento Bruto de cada cliente é a soma de UM valor de consulta + UM valor
// de procedimento. A pessoa escolhe, por cliente, se a base é "agendadas/agendados"
// ou "realizadas/realizados". A escolha é persistida (tabela crm_faturamento_config)
// e vale para todas as contas. Sem config salva → default abaixo (= comportamento
// histórico: realizadas + realizados).
export type FatConsultaBasis = "agendadas" | "realizadas";
export type FatProcedimentoBasis = "agendados" | "realizados";
export interface FatBasis {
  consulta: FatConsultaBasis;
  procedimento: FatProcedimentoBasis;
}
export const DEFAULT_FAT_BASIS: FatBasis = { consulta: "realizadas", procedimento: "realizados" };

// Resolve a base de um cliente (recebe o `client` cru de MergedClient). Default p/ os
// consumidores que não passam config — preserva o faturamento histórico.
export type FatBasisResolver = (client: string) => FatBasis;

/** Faturamento Bruto de um cliente segundo sua base escolhida. */
export function faturamentoBrutoFor(m: MergedClient, basis: FatBasis = DEFAULT_FAT_BASIS): number {
  const c = basis.consulta === "agendadas" ? m.valorConsultasAgendadas : m.valorConsultasRealizadas;
  const p = basis.procedimento === "agendados" ? m.valorProcedimentosAgendados : m.valorProcedimentosRealizados;
  return c + p;
}

export interface FunnelStage {
  label: string;
  count: number;
  rate: number | null; // conversion vs previous stage; null for first
}

export interface LeadTimeResult {
  label: string;
  avgDays: number | null;
  medianDays: number | null;
  n: number;
}

// ── Helpers ────────────────────────────────────────────

/**
 * Chave de dedup/match de origem: trim + colapsa espaços internos + lowercase.
 * Usada para agrupar variações ("Meta Ads", "Meta  Ads", "meta ads") sob uma só
 * entrada em dropdowns e para casar o filtro de origem com as linhas.
 */
export function origemKey(o: string | null | undefined): string {
  return (o || "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Origens canônicas conhecidas — recebem rótulo/ordem oficiais e consolidam suas
 * variantes/typos conhecidos. NÃO são mais a única lista possível: origens
 * customizadas preenchidas no Kommo (ex.: "Instagram Dra. Carla") são preservadas
 * pelo canonicalOrigem (passthrough) e aparecem no funil e no filtro depois destas.
 * Só origem vazia é ignorada.
 */
export const CANONICAL_ORIGENS = [
  "Meta Ads",
  "Google Ads",
  "Indicação",
  "Não tem Origem Definida",
  "Instagram",
  "Youtube",
  "TikTok",
  "Linkedin",
  "Pinterest",
  "Google Meu Negocio",
  "Link Bio",
] as const;

// Chave de match de origem: sem acento + trim + colapsa espaços + lowercase.
function origemMatchKey(s: string | null | undefined): string {
  return stripAccents(String(s ?? "")).trim().replace(/\s+/g, " ").toLowerCase();
}

// chave normalizada → origem canônica (inclui aliases/variantes conhecidas).
const ORIGEM_CANONICAL_BY_KEY: Map<string, string> = (() => {
  const m = new Map<string, string>();
  const add = (canonical: string, variants: string[] = []) => {
    for (const v of [canonical, ...variants]) m.set(origemMatchKey(v), canonical);
  };
  // acento é ignorado por origemMatchKey, então só listo variantes "de texto".
  add("Meta Ads", ["Meta Ads - Groohub", "Meta Ads Groohub"]);
  add("Google Ads", ["Google Ads - Groohub"]);
  add("Indicação");
  add("Não tem Origem Definida", ["Não tem Origem Denifida", "Origem Não Definida", "Sem Origem"]);
  add("Instagram");
  add("Youtube", ["You Tube"]);
  add("TikTok", ["Tik Tok"]);
  add("Linkedin");
  add("Pinterest");
  add("Google Meu Negocio", ["GMN", "Google Meu Negocio (GMN)"]);
  add("Link Bio", [
    "Link na Bio",
    "Link da Bio",
    "Linkbio",
    "Link Bio Instagram",
    "Link da Bio do Instagram",
    "Bio Instagram",
  ]);
  return m;
})();

/**
 * Mapeia um valor bruto de Origem para uma das origens canônicas, ou null se não
 * pertencer à whitelist (typo desconhecido, origem solta, vazio).
 */
export function canonicalOrigem(raw: string | null | undefined): string | null {
  const key = origemMatchKey(raw);
  if (!key) return null;
  const mapped = ORIGEM_CANONICAL_BY_KEY.get(key);
  if (mapped) return mapped;
  // Família "link na bio": o Kommo grava esse valor com redações variadas
  // ("Link Bio", "Link da Bio", "Link na Bio do Instagram", …). Consolida
  // qualquer variante que mencione "bio" na origem canônica "Link Bio".
  if (key.includes("bio")) return "Link Bio";
  // Passthrough: origens CUSTOMIZADAS preenchidas no Kommo (ex.: "Instagram Dra.
  // Carla") não estão na whitelist canônica. Em vez de descartá-las — o que fazia
  // esses leads sumirem do funil por origem E do filtro —, preserva o rótulo
  // original (só trim + colapsa espaços) para que TODA origem preenchida apareça
  // no Companium. Origem vazia continua caindo no `!key` acima (não vira linha).
  return String(raw).trim().replace(/\s+/g, " ");
}

// "Valor da Consulta"/"Valor do Procedimento" vêm do CRM em formatos variados:
//  - número puro (350), numeric-as-string do PostgREST ("350.00", "1500.00"),
//    "1.500" (milhar BR), "R$ 1.500,00", " 350 ", "350,00" (decimal BR), etc.
//  - multivalor numa só célula: "17.700 + 2.016 (opcional)", "15.400/15.800" → soma.
//
// REGRA CRÍTICA do ponto: ponto NÃO é sempre separador de milhar. PostgREST
// serializa colunas `numeric` como STRING com PONTO DECIMAL ("350.00"). Tratar o
// ponto sempre como milhar (replace(/\./g,"")) inflava "350.00" → 35000 (×100):
// era a causa do "Faturamento Bruto" da Vasculare bater R$ 1 milhão. Por isso só
// removemos o ponto quando o último grupo tem 3 dígitos (milhar real, ex "1.500");
// caso contrário ele é decimal (ex "350.00", "1500.5"). Arredonda no fim.
export function parseBRL(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? Math.round(v) : 0;
  const raw = String(v).trim();
  if (!raw) return 0;
  // Remove parênteses e seu conteúdo (ex: "(opcional)").
  const noParen = raw.replace(/\([^)]*\)/g, " ");
  // Tokeniza por separadores entre valores: / + ; e/ou/mais, espaços.
  const tokens = noParen.split(/[\/+;]|\s+(?:e|ou|mais)\s+|\s+/i).filter(Boolean);
  let sum = 0;
  for (const tok of tokens) {
    // Mantém apenas dígitos, pontos, vírgulas e sinal (descarta "R$" e texto).
    let s = tok.replace(/[^\d.,-]/g, "");
    if (!s || !/\d/.test(s)) continue;
    const hasComma = s.includes(",");
    const hasDot = s.includes(".");
    if (hasComma && hasDot) {
      // BR: pontos = milhar, vírgula = decimal.
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (hasComma) {
      // só vírgula → decimal BR.
      s = s.replace(",", ".");
    } else if (hasDot) {
      // só ponto: milhar (ex "1.500") apenas se o último grupo tiver 3 dígitos
      // sem decimais; senão é decimal (ex "350.00", "1500.5").
      const parts = s.split(".");
      const last = parts[parts.length - 1];
      if (parts.length > 1 && last.length === 3) {
        s = parts.join(""); // milhar BR
      }
      // senão, mantém como decimal US.
    }
    const n = parseFloat(s);
    if (!isNaN(n) && isFinite(n)) sum += n;
  }
  return Math.round(sum);
}

export function safeParseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function daysDiff(a: Date, b: Date): number | null {
  const ms = b.getTime() - a.getTime();
  const days = ms / (1000 * 60 * 60 * 24);
  if (days < 0 || days > 365) return null;
  return Math.round(days * 10) / 10;
}

/**
 * Extrai a parte YYYY-MM-DD de um timestamp/string sem aplicar conversão de timezone.
 * Ex.: "2026-01-31T23:30:00" → "2026-01-31".
 * Evita o bug em que `new Date("2026-01-31")` é interpretado como UTC e cai no dia anterior em GMT-3.
 */
export function toDateKey(s: string | null | undefined): string | null {
  if (!s) return null;
  const str = String(s).trim();
  // ISO: 2026-04-23 ou 2026-04-23T...
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // BR: 27/03/2026
  const br = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  // Qualquer outro formato (ex.: "7443198000") é tratado como inválido
  // para não inflar métricas com lixo proveniente da fonte externa.
  return null;
}

/**
 * Dia (YYYY-MM-DD) de um timestamp NO FUSO DE BRASÍLIA. Espelha exatamente o
 * `(created_at AT TIME ZONE 'America/Sao_Paulo')::date` que a MV mv_kommo_crm_agg usa no
 * ramo 'lead' (migration 20260901). Só o lead precisa disso: os demais eventos guardam a
 * data já como texto local e usam toDateKey. `created_at` é `timestamptz`, então `new Date`
 * respeita o offset e o Intl converte pro fuso certo. Sem isso, o caminho cru do filtro de
 * procedimento reintroduziria o bug UTC→BRT que a MV corrigiu.
 */
export function toDateKeyBRT(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = new Date(String(s));
  if (isNaN(d.getTime())) return toDateKey(s);
  try {
    // 'en-CA' formata como YYYY-MM-DD.
    return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  } catch {
    return toDateKey(s);
  }
}

/**
 * Chave de match/dedup de um nome de procedimento: sem acento + trim + colapsa espaços +
 * lowercase. Junta variantes só de caixa/acento ("Transplante Capilar" ≡ "transplante
 * capilar") sob a mesma opção de filtro. "" = procedimento vazio (não vira opção).
 */
export function procedimentoKey(s: string | null | undefined): string {
  return stripAccents(String(s ?? "")).trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Verifica se uma data cai no intervalo [from, to] — ambos os lados inclusivos.
 * Comparação feita em string YYYY-MM-DD (fuso "civil" — combina com a UI, que
 * pensa em dias inteiros no horário de Brasília). Se from/to forem vazios,
 * considera sem restrição daquele lado.
 */
export function inRange(
  dateStr: string | null | undefined,
  from?: string,
  to?: string
): boolean {
  const key = toDateKey(dateStr);
  if (!key) return false;
  if (from) {
    const f = toDateKey(from);
    if (f && key < f) return false;
  }
  if (to) {
    const t = toDateKey(to);
    if (t && key > t) return false;
  }
  return true;
}

// ── mergeByClient — SINGLE SOURCE OF TRUTH ─────────────

export function mergeByClient(
  kommoRows: KommoRow[],
  adsRows: AdsRow[],
  dateFrom?: string,
  dateTo?: string
): Map<string, MergedClient> {
  // Agrupa por `clientMatchKey` (sem acento/caixa, espaço/underscore unificados), NÃO pela
  // string crua — assim variantes visualmente iguais do mesmo cliente (ex.: "Clínica Prisma"
  // vs "Clinica Prisma", ou 2 grafias do Kommo) caem numa ÚNICA linha em vez de duplicar.
  // O rótulo exibido (`entry.client`) fica com a forma de mais diacríticos. O faturamento
  // config já é chaveado por clientMatchKey (resolveBasis), então não quebra.
  const map = new Map<string, MergedClient>();

  // Mais diacríticos vence; empate mantém o que já está (estável).
  const richerLabel = (a: string, b: string): string =>
    (b.length - stripAccents(b).length) > (a.length - stripAccents(a).length) ? b : a;

  const getOrCreate = (client: string): MergedClient => {
    const key = clientMatchKey(client);
    let entry = map.get(key);
    if (!entry) {
      entry = {
        client,
        leadsTrafego: 0,
        leadsTrafegoMeta: 0,
        leadsTrafegoGoogle: 0,
        spend: 0,
        leadsCRM: 0,
        leadsCRMMeta: 0,
        leadsCRMGoogle: 0,
        consultasAgendadas: 0,
        valorConsultasAgendadas: 0,
        consultasRealizadas: 0,
        valorConsultasRealizadas: 0,
        procedimentosAgendados: 0,
        valorProcedimentosAgendados: 0,
        procedimentosRealizados: 0,
        valorProcedimentosRealizados: 0,
        fatRealizados: 0,
      };
      map.set(key, entry);
    } else if (entry.client !== client) {
      entry.client = richerLabel(entry.client, client);
    }
    return entry;
  };

  // Ads já vem filtrado por "Dia" (data do evento) no hook.
  for (const r of adsRows) {
    if (!r.Client) continue;
    const m = getOrCreate(r.Client);
    // Leads tráfego = leads + conversas (mesma definição da seção Meta Ads).
    const lt = (r.Lead || 0) + (r.Mensagens_iniciadas || 0);
    m.leadsTrafego += lt;
    // Quebra por fonte: Google é explícito; todo o resto (Meta/Facebook e o fallback
    // sem Fonte_Ads do fetch interno, historicamente Meta) entra em Meta. Assim
    // leadsTrafegoMeta + leadsTrafegoGoogle === leadsTrafego.
    if (r.Fonte_Ads === "Google") m.leadsTrafegoGoogle += lt;
    else m.leadsTrafegoMeta += lt;
    m.spend += r.Valor_usado_BRL || 0;
  }

  const hasDateFilter = !!(dateFrom || dateTo);

  for (const row of kommoRows) {
    if (!row.client) continue;
    const m = getOrCreate(row.client);

    // Leads CRM = filtra por created_at
    if (!hasDateFilter || inRange(row.created_at, dateFrom, dateTo)) {
      m.leadsCRM++;
      // Quebra por origem do CRM: quantos desses leads são Meta vs Google.
      const origem = canonicalOrigem(row.Origem);
      if (origem === "Meta Ads") m.leadsCRMMeta++;
      else if (origem === "Google Ads") m.leadsCRMGoogle++;
    }

    const valC = parseBRL(row["Valor da Consulta"]);
    const valP = parseBRL(row["Valor do Procedimento"]);

    // Cada métrica de evento usa sua própria data
    if (row["Consulta Agendada Em"] && (!hasDateFilter || inRange(row["Consulta Agendada Em"], dateFrom, dateTo))) {
      m.consultasAgendadas++;
      m.valorConsultasAgendadas += valC;
    }
    if (row["Dia da Consulta Realizada"] && (!hasDateFilter || inRange(row["Dia da Consulta Realizada"], dateFrom, dateTo))) {
      m.consultasRealizadas++;
      m.valorConsultasRealizadas += valC;
      m.fatRealizados += valC;
    }
    if (row["Procedimento Agendado Em"] && (!hasDateFilter || inRange(row["Procedimento Agendado Em"], dateFrom, dateTo))) {
      m.procedimentosAgendados++;
      m.valorProcedimentosAgendados += valP;
    }
    if (row["Dia do Procedimento Realizado"] && (!hasDateFilter || inRange(row["Dia do Procedimento Realizado"], dateFrom, dateTo))) {
      m.procedimentosRealizados++;
      m.valorProcedimentosRealizados += valP;
      m.fatRealizados += valP;
    }
  }

  return map;
}

// ── mergeKommoAgg — mesma verdade, a partir da view agregada ────────────
// Consome linhas AGREGADAS da MV `v_kommo_crm_agg` (grão: client × médico ×
// médicos × origem × especialidade × event_type × event_date, com qtd + valor)
// e produz o MESMO Map<MergedClient> que mergeByClient(kommo, ads) — só que sem
// baixar/varrer os leads crus no navegador. A paridade é garantida por teste
// (crmAggParity.test.ts): a MV agrega por dims CRUAS e o parse de data/valor
// espelha toDateKey/parseBRL, então cada métrica bate 1:1.
//
// PRÉ-CONDIÇÕES (aplicadas pelo hook, iguais ao caminho cru):
//  • aggRows já vem filtrado por período (event_date ∈ [dateFrom,dateTo]) e pelos
//    filtros client-side (cliente/origem/médico/especialidade/exclusões);
//  • adsRows idêntico ao mergeByClient (leads tráfego + spend).
export interface KommoAggRow {
  client: string;
  medico: string | null;
  medicos: string | null;
  origem: string | null;
  especialidade: string | null;
  // Conjunto de TAGS (etiquetas do Kommo) do lead, normalizado e separado por ", " (ex.:
  // "QUALIFICADO, TRAFEGO"). Vem da v_kommo_crm_tag_agg. "" / null = lead sem tag. Dimensão por
  // lead (igual origem), multivalorada → usar splitTags() p/ obter cada tag.
  tags?: string | null;
  event_type: string; // lead | consulta_agendada | consulta_realizada | proc_agendado | proc_realizado
  event_date: string; // YYYY-MM-DD
  qtd: number;
  valor: number;
}

// Separa o campo `tags` (lista por vírgula) nos nomes individuais já normalizados (UPPER/TRIM).
export function splitTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  return tags.split(",").map((t) => t.trim()).filter(Boolean);
}

export function mergeKommoAgg(
  aggRows: KommoAggRow[],
  adsRows: AdsRow[]
): Map<string, MergedClient> {
  const map = new Map<string, MergedClient>();

  const richerLabel = (a: string, b: string): string =>
    (b.length - stripAccents(b).length) > (a.length - stripAccents(a).length) ? b : a;

  const getOrCreate = (client: string): MergedClient => {
    const key = clientMatchKey(client);
    let entry = map.get(key);
    if (!entry) {
      entry = {
        client,
        leadsTrafego: 0,
        leadsTrafegoMeta: 0,
        leadsTrafegoGoogle: 0,
        spend: 0,
        leadsCRM: 0,
        leadsCRMMeta: 0,
        leadsCRMGoogle: 0,
        consultasAgendadas: 0,
        valorConsultasAgendadas: 0,
        consultasRealizadas: 0,
        valorConsultasRealizadas: 0,
        procedimentosAgendados: 0,
        valorProcedimentosAgendados: 0,
        procedimentosRealizados: 0,
        valorProcedimentosRealizados: 0,
        fatRealizados: 0,
      };
      map.set(key, entry);
    } else if (entry.client !== client) {
      entry.client = richerLabel(entry.client, client);
    }
    return entry;
  };

  // Ads — idêntico a mergeByClient.
  for (const r of adsRows) {
    if (!r.Client) continue;
    const m = getOrCreate(r.Client);
    const lt = (r.Lead || 0) + (r.Mensagens_iniciadas || 0);
    m.leadsTrafego += lt;
    if (r.Fonte_Ads === "Google") m.leadsTrafegoGoogle += lt;
    else m.leadsTrafegoMeta += lt;
    m.spend += r.Valor_usado_BRL || 0;
  }

  // Kommo — a partir dos eventos agregados. Cada linha já é um evento com sua data.
  for (const r of aggRows) {
    if (!r.client) continue;
    const m = getOrCreate(r.client);
    const q = r.qtd || 0;
    const v = r.valor || 0;
    switch (r.event_type) {
      case "lead": {
        m.leadsCRM += q;
        const origem = canonicalOrigem(r.origem);
        if (origem === "Meta Ads") m.leadsCRMMeta += q;
        else if (origem === "Google Ads") m.leadsCRMGoogle += q;
        break;
      }
      case "consulta_agendada":
        m.consultasAgendadas += q;
        m.valorConsultasAgendadas += v;
        break;
      case "consulta_realizada":
        m.consultasRealizadas += q;
        m.valorConsultasRealizadas += v;
        m.fatRealizados += v;
        break;
      case "proc_agendado":
        m.procedimentosAgendados += q;
        m.valorProcedimentosAgendados += v;
        break;
      case "proc_realizado":
        m.procedimentosRealizados += q;
        m.valorProcedimentosRealizados += v;
        m.fatRealizados += v;
        break;
    }
  }

  return map;
}

// ── rawRowsToAggEvents — leads crus → linhas no formato da MV ────────────
// Converte KommoRow[] cru (um por lead) em KommoAggRow[] (um por EVENTO), replicando
// VERBATIM a lógica da mv_kommo_crm_agg (migration 20260901): lead usa a data em Brasília
// de created_at; consulta/procedimento usam toDateKey das respectivas colunas e parseBRL
// dos valores. Não agrupa (qtd=1 por evento) — mergeKommoAgg/calc*Agg somam depois. Serve
// para o filtro de procedimento da tela CRM: escopa a UM cliente, aplica o predicado de
// procedimento e alimenta o MESMO pipeline agregado (paridade garantida com o caminho da
// view, já que a fonte — v_kommo_completa aprovada — é a mesma do _v_kommo_completa_raw).
export function rawRowsToAggEvents(rows: KommoRow[]): KommoAggRow[] {
  const out: KommoAggRow[] = [];
  for (const r of rows) {
    if (!r.client) continue;
    const base = {
      client: r.client,
      medico: r["Médico"] ?? null,
      medicos: r["Médicos"] ?? null,
      origem: r.Origem ?? null,
      especialidade: r.Especialidade ?? null,
    };
    const leadDate = toDateKeyBRT(r.created_at);
    if (leadDate) out.push({ ...base, event_type: "lead", event_date: leadDate, qtd: 1, valor: 0 });
    const vC = parseBRL(r["Valor da Consulta"]);
    const vP = parseBRL(r["Valor do Procedimento"]);
    const ca = toDateKey(r["Consulta Agendada Em"]);
    if (ca) out.push({ ...base, event_type: "consulta_agendada", event_date: ca, qtd: 1, valor: vC });
    const cr = toDateKey(r["Dia da Consulta Realizada"]);
    if (cr) out.push({ ...base, event_type: "consulta_realizada", event_date: cr, qtd: 1, valor: vC });
    const pa = toDateKey(r["Procedimento Agendado Em"]);
    if (pa) out.push({ ...base, event_type: "proc_agendado", event_date: pa, qtd: 1, valor: vP });
    const pr = toDateKey(r["Dia do Procedimento Realizado"]);
    if (pr) out.push({ ...base, event_type: "proc_realizado", event_date: pr, qtd: 1, valor: vP });
  }
  return out;
}

// ── calcTotals — consumes merged ───────────────────────

export function calcTotals(
  merged: Map<string, MergedClient>,
  resolveBasis?: FatBasisResolver
): CRMTotals {
  let leadsTrafego = 0,
    leadsTrafegoMeta = 0,
    leadsTrafegoGoogle = 0,
    leadsCRM = 0,
    leadsCRMMeta = 0,
    leadsCRMGoogle = 0,
    consultasAgendadas = 0,
    valorConsultasAgendadas = 0,
    consultasRealizadas = 0,
    valorConsultasRealizadas = 0,
    procedimentosAgendados = 0,
    valorProcedimentosAgendados = 0,
    procedimentosRealizados = 0,
    valorProcedimentosRealizados = 0,
    investimentoTotal = 0,
    faturamentoBruto = 0;

  for (const m of merged.values()) {
    leadsTrafego += m.leadsTrafego;
    leadsTrafegoMeta += m.leadsTrafegoMeta;
    leadsTrafegoGoogle += m.leadsTrafegoGoogle;
    leadsCRM += m.leadsCRM;
    leadsCRMMeta += m.leadsCRMMeta;
    leadsCRMGoogle += m.leadsCRMGoogle;
    consultasAgendadas += m.consultasAgendadas;
    valorConsultasAgendadas += m.valorConsultasAgendadas;
    consultasRealizadas += m.consultasRealizadas;
    valorConsultasRealizadas += m.valorConsultasRealizadas;
    procedimentosAgendados += m.procedimentosAgendados;
    valorProcedimentosAgendados += m.valorProcedimentosAgendados;
    procedimentosRealizados += m.procedimentosRealizados;
    valorProcedimentosRealizados += m.valorProcedimentosRealizados;
    investimentoTotal += m.spend;
    // Faturamento Bruto respeita a base escolhida por cada cliente (soma agregada
    // = soma das escolhas individuais). Sem resolver → default realizadas+realizados.
    faturamentoBruto += faturamentoBrutoFor(m, resolveBasis ? resolveBasis(m.client) : DEFAULT_FAT_BASIS);
  }

  return {
    leadsTrafego,
    leadsTrafegoMeta,
    leadsTrafegoGoogle,
    leadsCRM,
    leadsCRMMeta,
    leadsCRMGoogle,
    consultasAgendadas,
    valorConsultasAgendadas,
    consultasRealizadas,
    valorConsultasRealizadas,
    procedimentosAgendados,
    valorProcedimentosAgendados,
    procedimentosRealizados,
    valorProcedimentosRealizados,
    investimentoTotal,
    faturamentoBruto,
    roas: investimentoTotal > 0 ? faturamentoBruto / investimentoTotal : 0,
  };
}

// ── calcFunnel ─────────────────────────────────────────

export function calcFunnel(totals: CRMTotals): FunnelStage[] {
  const stages = [
    { label: "Leads Tráfego", count: totals.leadsTrafego },
    { label: "Leads CRM", count: totals.leadsCRM },
    { label: "Consultas Agendadas", count: totals.consultasAgendadas },
    { label: "Consultas Realizadas", count: totals.consultasRealizadas },
    { label: "Proced. Agendados", count: totals.procedimentosAgendados },
    { label: "Proced. Realizados", count: totals.procedimentosRealizados },
  ];

  return stages.map((s, i) => ({
    label: s.label,
    count: s.count,
    rate:
      i === 0
        ? null
        : stages[i - 1].count > 0
          ? (s.count / stages[i - 1].count) * 100
          : null,
  }));
}

// ── calcMonthlyEvolution ───────────────────────────────
// Evolução mensal das métricas do funil (leads, consultas, procedimentos), no
// mesmo espírito do `monthlyEvolution` das seções Meta/Google Ads: agrupa por mês
// a partir da data de CADA evento (created_at p/ leads, "… Em"/"Dia …" p/ os demais),
// respeitando o filtro de período. Assim a soma dos meses bate com o funil.

export interface CRMMonthlyEvolution {
  month: string; // "2026-06"
  label: string; // "jun.\n/26"
  leads: number;
  consultasAgendadas: number;
  consultasRealizadas: number;
  procedimentosAgendados: number;
  procedimentosRealizados: number;
  // Séries derivadas dos Ads (por Dia) + faturamento do CRM (por base do cliente).
  // Ficam em 0 quando o consumidor não passa adsRows/resolveBasis (ex.: o caminho cru
  // calcMonthlyEvolution, usado só no teste de paridade). roas/cpl são derivados.
  investimento: number; // soma de Valor_usado_BRL (Ads) no mês
  faturamento: number;  // faturamento bruto do mês, conforme a base de cada cliente
  roas: number;         // faturamento / investimento (0 quando investimento = 0)
  leadsTrafego: number; // Lead + conversas (Ads) no mês
  cpl: number;          // investimento / leads CRM (0 quando leads CRM = 0)
  // Parcelas de valor (R$) por mês — as 4 bases possíveis do Faturamento. Só são
  // preenchidas quando `resolveBasis` é passado (idem faturamento); ficam em 0 no
  // caminho cru (paridade). Servem p/ recomputar o faturamento do mês quando um VALOR
  // é corrigido manualmente (correção do CRM propagada p/ a evolução).
  valorConsultasAgendadas: number;
  valorConsultasRealizadas: number;
  valorProcedimentosAgendados: number;
  valorProcedimentosRealizados: number;
}

// Campos derivados dos Ads/faturamento zerados — base comum aos dois buckets, mantendo
// a paridade cru↔agg (o caminho cru não recebe Ads/base, então segue tudo em 0).
const ZERO_EVOLUTION_EXTRAS = {
  investimento: 0,
  faturamento: 0,
  roas: 0,
  leadsTrafego: 0,
  cpl: 0,
  valorConsultasAgendadas: 0,
  valorConsultasRealizadas: 0,
  valorProcedimentosAgendados: 0,
  valorProcedimentosRealizados: 0,
} as const;

const MONTH_NAMES_PT = ["jan.", "fev.", "mar.", "abr.", "maio", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];

// Chave YYYY-MM de um evento, respeitando o filtro de período (mesma semântica de inRange).
function monthKeyInRange(dateStr: string | null | undefined, from?: string, to?: string): string | null {
  const key = toDateKey(dateStr);
  if (!key) return null;
  if (!inRange(key, from, to)) return null;
  return key.slice(0, 7); // YYYY-MM
}

export function calcMonthlyEvolution(
  kommoRows: KommoRow[],
  dateFrom?: string,
  dateTo?: string
): CRMMonthlyEvolution[] {
  const map = new Map<string, CRMMonthlyEvolution>();
  const bucket = (mk: string): CRMMonthlyEvolution => {
    let e = map.get(mk);
    if (!e) {
      const [y, m] = mk.split("-");
      e = {
        month: mk,
        label: `${MONTH_NAMES_PT[parseInt(m, 10) - 1]}\n/${y.slice(2)}`,
        leads: 0,
        consultasAgendadas: 0,
        consultasRealizadas: 0,
        procedimentosAgendados: 0,
        procedimentosRealizados: 0,
        ...ZERO_EVOLUTION_EXTRAS,
      };
      map.set(mk, e);
    }
    return e;
  };

  for (const row of kommoRows) {
    const mkLead = monthKeyInRange(row.created_at, dateFrom, dateTo);
    if (mkLead) bucket(mkLead).leads++;

    const mkCa = monthKeyInRange(row["Consulta Agendada Em"], dateFrom, dateTo);
    if (mkCa) bucket(mkCa).consultasAgendadas++;

    const mkCr = monthKeyInRange(row["Dia da Consulta Realizada"], dateFrom, dateTo);
    if (mkCr) bucket(mkCr).consultasRealizadas++;

    const mkPa = monthKeyInRange(row["Procedimento Agendado Em"], dateFrom, dateTo);
    if (mkPa) bucket(mkPa).procedimentosAgendados++;

    const mkPr = monthKeyInRange(row["Dia do Procedimento Realizado"], dateFrom, dateTo);
    if (mkPr) bucket(mkPr).procedimentosRealizados++;
  }

  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

// Versão agregada: consome KommoAggRow[] já filtrado por período. Cada linha é um
// evento com sua data → agrupa por mês de event_date. Paridade coberta em teste.
// `adsRows` (com Dia) e `resolveBasis` são opcionais: quando ausentes (ex.: o teste de
// paridade), investimento/faturamento/leads tráfego ficam em 0 — idêntico ao caminho cru.
// A tela CRM passa os dois, então os oito gráficos ganham as séries de Ads + faturamento.
export function calcMonthlyEvolutionAgg(
  aggRows: KommoAggRow[],
  adsRows: AdsRow[] = [],
  resolveBasis?: FatBasisResolver
): CRMMonthlyEvolution[] {
  const map = new Map<string, CRMMonthlyEvolution>();
  const bucket = (mk: string): CRMMonthlyEvolution => {
    let e = map.get(mk);
    if (!e) {
      const [y, m] = mk.split("-");
      e = {
        month: mk,
        label: `${MONTH_NAMES_PT[parseInt(m, 10) - 1]}\n/${y.slice(2)}`,
        leads: 0,
        consultasAgendadas: 0,
        consultasRealizadas: 0,
        procedimentosAgendados: 0,
        procedimentosRealizados: 0,
        ...ZERO_EVOLUTION_EXTRAS,
      };
      map.set(mk, e);
    }
    return e;
  };
  for (const r of aggRows) {
    const mk = r.event_date.slice(0, 7); // YYYY-MM
    const b = bucket(mk);
    const q = r.qtd || 0;
    const v = r.valor || 0;
    // Faturamento por mês seguindo a base de CADA cliente (idêntico a faturamentoBrutoFor):
    // soma o valor do evento apenas quando ele é a base escolhida (consulta E procedimento).
    const basis = resolveBasis ? resolveBasis(r.client) : null;
    switch (r.event_type) {
      case "lead": b.leads += q; break;
      case "consulta_agendada":
        b.consultasAgendadas += q;
        if (basis) {
          b.valorConsultasAgendadas += v;
          if (basis.consulta === "agendadas") b.faturamento += v;
        }
        break;
      case "consulta_realizada":
        b.consultasRealizadas += q;
        if (basis) {
          b.valorConsultasRealizadas += v;
          if (basis.consulta === "realizadas") b.faturamento += v;
        }
        break;
      case "proc_agendado":
        b.procedimentosAgendados += q;
        if (basis) {
          b.valorProcedimentosAgendados += v;
          if (basis.procedimento === "agendados") b.faturamento += v;
        }
        break;
      case "proc_realizado":
        b.procedimentosRealizados += q;
        if (basis) {
          b.valorProcedimentosRealizados += v;
          if (basis.procedimento === "realizados") b.faturamento += v;
        }
        break;
    }
  }
  // Ads por mês (só linhas com Dia): investimento = spend, leads tráfego = Lead + conversas.
  for (const r of adsRows) {
    if (!r.Dia) continue;
    const b = bucket(r.Dia.slice(0, 7));
    b.investimento += r.Valor_usado_BRL || 0;
    b.leadsTrafego += (r.Lead || 0) + (r.Mensagens_iniciadas || 0);
  }
  const out = [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  // Derivados por mês: ROAS = faturamento/investimento; CPL (CRM) = investimento/leads CRM
  // — mesmas fórmulas dos cards (calcTotals.roas e CRMMetricsPanel.cplCRM).
  for (const e of out) {
    e.roas = e.investimento > 0 ? e.faturamento / e.investimento : 0;
    e.cpl = e.leads > 0 ? e.investimento / e.leads : 0;
  }
  return out;
}

// ── calcOrcamentoParado ────────────────────────────────
// Leads atualmente PARADOS na etapa "Orçamento" do funil (status_nome) e o valor
// (soma de "Valor do Procedimento") represado nesses leads. Segue o MESMO filtro de
// período das demais métricas: conta apenas os leads criados (created_at) dentro de
// [dateFrom, dateTo]. Sem filtro de data (ou período que cobre tudo) → total geral.
// Os filtros de cliente/médico/origem já vêm aplicados em `kommoRows`.

export interface OrcamentoParado {
  count: number;
  valor: number;
}

// Etapa "Orçamento" tolerante a caixa/acento (mesma ideia de origemMatchKey).
function isOrcamentoStage(status: string | null | undefined): boolean {
  return stripAccents(String(status ?? "")).trim().toLowerCase() === "orcamento";
}

export function calcOrcamentoParado(
  kommoRows: KommoRow[],
  dateFrom?: string,
  dateTo?: string
): OrcamentoParado {
  let count = 0;
  let valor = 0;
  for (const row of kommoRows) {
    if (!isOrcamentoStage(row.status_nome)) continue;
    // Cai no período pela DATA DE ORÇAMENTO ENVIADO (todas as variantes de campo, ver
    // getOrcamentoSentDate); se o lead não tiver a data em campo algum, usa a criação do lead
    // como fallback — assim clientes que não registram a data (ex.: IUC) não somem do card.
    if (dateFrom || dateTo) {
      const key = toDateKey(getOrcamentoSentDate(row)) ?? toDateKey(row.created_at);
      if (!key || !inRange(key, dateFrom, dateTo)) continue;
    }
    count++;
    // Valor do orçamento: usa "Valor do Procedimento"; se vier zerado/vazio, cai em
    // "Valor da Consulta" (clientes guardam o orçamento num ou noutro). Fallback, NÃO soma,
    // para não contar em dobro quem preenche os dois com o mesmo valor.
    const vProc = parseBRL(row["Valor do Procedimento"]);
    valor += vProc > 0 ? vProc : parseBRL(row["Valor da Consulta"]);
  }
  return { count, valor };
}

// ── calcLeadTimes ──────────────────────────────────────

export function calcLeadTimes(
  kommoRows: KommoRow[],
  dateFrom?: string,
  dateTo?: string
): LeadTimeResult[] {
  const transitions: {
    label: string;
    fromField: keyof KommoRow;
    toField: keyof KommoRow;
  }[] = [
    { label: "Criação → Consulta Agendada", fromField: "created_at", toField: "Consulta Agendada Em" },
    { label: "Consulta Agendada → Realizada", fromField: "Consulta Agendada Em", toField: "Dia da Consulta Realizada" },
    { label: "Consulta Realizada → Proced. Agendado", fromField: "Dia da Consulta Realizada", toField: "Procedimento Agendado Em" },
    { label: "Proced. Agendado → Realizado", fromField: "Procedimento Agendado Em", toField: "Dia do Procedimento Realizado" },
  ];

  const hasDateFilter = !!(dateFrom || dateTo);

  return transitions.map(({ label, fromField, toField }) => {
    const diffs: number[] = [];

    for (const row of kommoRows) {
      const a = safeParseDate(row[fromField] as string | null);
      const b = safeParseDate(row[toField] as string | null);
      if (!a || !b) continue;
      // Considera a transição apenas se a data do evento de destino está no filtro
      if (hasDateFilter && !inRange(row[toField] as string | null, dateFrom, dateTo)) continue;
      const d = daysDiff(a, b);
      if (d !== null) diffs.push(d);
    }

    if (diffs.length === 0) {
      return { label, avgDays: null, medianDays: null, n: 0 };
    }

    const avg = diffs.reduce((s, v) => s + v, 0) / diffs.length;
    return {
      label,
      avgDays: Math.round(avg * 10) / 10,
      medianDays: Math.round(computeMedian(diffs) * 10) / 10,
      n: diffs.length,
    };
  });
}

// ── calcClientTable — consumes merged ──────────────────

export function calcClientTable(
  merged: Map<string, MergedClient>,
  resolveBasis?: FatBasisResolver
): CRMClientRow[] {
  return [...merged.values()]
    .map((m) => {
      const cacGeral = m.consultasAgendadas > 0 ? m.spend / m.consultasAgendadas : 0;
      const fatBruto = faturamentoBrutoFor(m, resolveBasis ? resolveBasis(m.client) : DEFAULT_FAT_BASIS);
      return {
        client: m.client,
        especialidade: getEspecialidade(m.client),
        investimento: m.spend,
        leadsTrafego: m.leadsTrafego,
        leadsTrafegoMeta: m.leadsTrafegoMeta,
        leadsTrafegoGoogle: m.leadsTrafegoGoogle,
        leadsCRM: m.leadsCRM,
        consultasAgendadas: m.consultasAgendadas,
        cacGeral,
        valorConsultasAgendadas: m.valorConsultasAgendadas,
        consultasRealizadas: m.consultasRealizadas,
        valorConsultasRealizadas: m.valorConsultasRealizadas,
        procedimentosAgendados: m.procedimentosAgendados,
        valorProcedimentosAgendados: m.valorProcedimentosAgendados,
        procedimentosRealizados: m.procedimentosRealizados,
        valorProcedimentosRealizados: m.valorProcedimentosRealizados,
        faturamentoBrutoRealizados: fatBruto,
        roas: m.spend > 0 ? fatBruto / m.spend : 0,
      };
    })
    .sort((a, b) => b.investimento - a.investimento);
}

// ── calcOrigemFunnel ───────────────────────────────────

export function calcOrigemFunnel(
  kommoRows: KommoRow[],
  dateFrom?: string,
  dateTo?: string
): OrigemFunnelRow[] {
  const map = new Map<string, OrigemFunnelRow>();
  const hasDateFilter = !!(dateFrom || dateTo);

  for (const row of kommoRows) {
    // Toda origem preenchida aparece no funil (canônicas consolidam variantes;
    // customizadas passam pelo canonicalOrigem com o rótulo original). Só vazia sai.
    const canonical = canonicalOrigem(row.Origem);
    if (!canonical) continue;
    let entry = map.get(canonical);
    if (!entry) {
      entry = { origem: canonical, leads: 0, consultasAgendadas: 0, consultasRealizadas: 0, procedimentosAgendados: 0, procedimentosRealizados: 0 };
      map.set(canonical, entry);
    }
    // leads = por created_at
    if (!hasDateFilter || inRange(row.created_at, dateFrom, dateTo)) {
      entry.leads++;
    }
    if (row["Consulta Agendada Em"] && (!hasDateFilter || inRange(row["Consulta Agendada Em"], dateFrom, dateTo))) entry.consultasAgendadas++;
    if (row["Dia da Consulta Realizada"] && (!hasDateFilter || inRange(row["Dia da Consulta Realizada"], dateFrom, dateTo))) entry.consultasRealizadas++;
    if (row["Procedimento Agendado Em"] && (!hasDateFilter || inRange(row["Procedimento Agendado Em"], dateFrom, dateTo))) entry.procedimentosAgendados++;
    if (row["Dia do Procedimento Realizado"] && (!hasDateFilter || inRange(row["Dia do Procedimento Realizado"], dateFrom, dateTo))) entry.procedimentosRealizados++;
  }

  return [...map.values()].sort((a, b) => b.leads - a.leads);
}

// Versão agregada: consome KommoAggRow[] já filtrado por período. Agrupa por
// canonicalOrigem e soma qtd por tipo de evento. Paridade coberta em teste.
export function calcOrigemFunnelAgg(aggRows: KommoAggRow[]): OrigemFunnelRow[] {
  const map = new Map<string, OrigemFunnelRow>();
  for (const r of aggRows) {
    const canonical = canonicalOrigem(r.origem);
    if (!canonical) continue;
    let e = map.get(canonical);
    if (!e) {
      e = { origem: canonical, leads: 0, consultasAgendadas: 0, consultasRealizadas: 0, procedimentosAgendados: 0, procedimentosRealizados: 0 };
      map.set(canonical, e);
    }
    const q = r.qtd || 0;
    switch (r.event_type) {
      case "lead": e.leads += q; break;
      case "consulta_agendada": e.consultasAgendadas += q; break;
      case "consulta_realizada": e.consultasRealizadas += q; break;
      case "proc_agendado": e.procedimentosAgendados += q; break;
      case "proc_realizado": e.procedimentosRealizados += q; break;
    }
  }
  return [...map.values()].sort((a, b) => b.leads - a.leads);
}

// Funil agregado por TAG (etiqueta do Kommo, dimensão por lead). Cada linha agregada carrega o
// conjunto de tags do lead em `r.tags`; um lead com N tags soma em cada uma delas — o total por
// tag pode exceder o total geral (leads multi-tag contam em cada). Leads sem tag são ignorados.
export function calcTagFunnelAgg(aggRows: KommoAggRow[]): TagFunnelRow[] {
  const map = new Map<string, TagFunnelRow>();
  for (const r of aggRows) {
    const tags = splitTags(r.tags);
    if (tags.length === 0) continue;
    const q = r.qtd || 0;
    for (const tag of tags) {
      let e = map.get(tag);
      if (!e) {
        e = { tag, leads: 0, consultasAgendadas: 0, consultasRealizadas: 0, procedimentosAgendados: 0, procedimentosRealizados: 0 };
        map.set(tag, e);
      }
      switch (r.event_type) {
        case "lead": e.leads += q; break;
        case "consulta_agendada": e.consultasAgendadas += q; break;
        case "consulta_realizada": e.consultasRealizadas += q; break;
        case "proc_agendado": e.procedimentosAgendados += q; break;
        case "proc_realizado": e.procedimentosRealizados += q; break;
      }
    }
  }
  return [...map.values()].sort((a, b) => b.leads - a.leads);
}
