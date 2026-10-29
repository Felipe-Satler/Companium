import { canonicalizeAdsClient, clientMatchKey, stripAccents } from "@/data/clienteAliases";

/**
 * SQUADS / PLANO / TEMPO DE CASA — vêm da tabela `projetos_lista` (projeto companium-db),
 * sincronizada a partir da planilha do Google Sheets.
 *
 * SQUAD = `lider_revops`. A tabela NÃO tem uma coluna "squad"; o líder de RevOps é o único
 * campo que agrupa clientes por time, então é ele que a tela usa como squad (e é o nome dele
 * que aparece nos filtros e nos gráficos). Se o squad passar a ser outra coisa, trocar o
 * campo aqui em `squadDaLinha` resolve — o resto da tela não muda.
 *
 * Este arquivo é PURO (sem React/Supabase) para poder ser testado: o fetch mora em
 * `useProjetosLista`.
 */

/** Linha crua da tabela (só as colunas que a tela usa). */
export interface ProjetoRow {
  cliente: string | null;
  data_inicio: string | null;
  status: string | null;
  plano: string | null;
  lider_revops: string | null;
  /** "Sim"/"Não" na planilha — o cliente usa CRM ou não. */
  crm: string | null;
}

/** O que a tela precisa saber sobre um cliente. */
export interface ClienteProjeto {
  /** Squad = líder de RevOps. null = sem líder na planilha. */
  squad: string | null;
  plano: string | null;
  /** Entrada do cliente (data_inicio MAIS ANTIGA entre os projetos dele). */
  desde: Date | null;
  status: string | null;
  /** Algum projeto do cliente está explicitamente ATIVO. */
  ativo: boolean;
  /** Usa CRM. null = a planilha não respondeu (nem "Sim" nem "Não"). */
  temCRM: boolean | null;
  /** A planilha preencheu status em algum projeto dele (branco em tudo = não dá p/ afirmar nada). */
  temStatus: boolean;
}

export interface ClienteAtivo {
  /** Nome como está na planilha ("Dr. José Ramos - VascuMed") — é o que o admin reconhece. */
  nome: string;
  /**
   * Token a gravar em `clientes_ocultos` para esconder este cliente. É a chave que casa com
   * o slug do dashboard ("jose_ramos"), NÃO o nome inteiro da planilha — o gate compara com o
   * slug canônico, e "jose_ramos_-_vascumed" não casaria com nada.
   */
  padrao: string;
}

export interface ProjetosIndex {
  /** chave de match → dados do cliente. */
  byKey: Map<string, ClienteProjeto>;
  /** Conjunto de palavras do nome de cada cliente — usado no match por subconjunto. */
  tokens: { ficha: ClienteProjeto; palavras: Set<string> }[];
  /** Squads (líderes) distintos, em ordem alfabética — alimenta o filtro. */
  squads: string[];
  /** Clientes ATIVOS, em ordem alfabética — alimenta o seletor da Administração. */
  ativos: ClienteAtivo[];
}

export const EMPTY_PROJETOS_INDEX: ProjetosIndex = { byKey: new Map(), tokens: [], squads: [], ativos: [] };

const squadDaLinha = (r: ProjetoRow): string | null => r.lider_revops?.trim() || null;

// "Sim"/"sim"/"SIM" → true; "Não"/"Nao"/"N" → false; vazio/qualquer outra coisa → null.
function parseSimNao(v: string | null): boolean | null {
  const t = stripAccents(v ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t.startsWith("s")) return true;
  if (t.startsWith("n")) return false;
  return null;
}

function ehAtivo(status: string | null): boolean {
  if (!status) return false;
  // "ATIVO" / "Ativo" / "ativo " — e nunca "INATIVO", que também contém "ativo".
  return /^ativ/.test(stripAccents(status).trim().toLowerCase());
}

function parseData(d: string | null): Date | null {
  if (!d) return null;
  // Coluna `date` chega como 'YYYY-MM-DD'; T00:00:00 evita o deslocamento de fuso que
  // `new Date('YYYY-MM-DD')` (interpretada como UTC) causaria no Brasil.
  const dt = new Date(`${d.slice(0, 10)}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

// Conectivos ignorados na chave "frouxa" — mesma ideia do useClientesMetas: deixa
// "Instituto Urológico Aurora" casar com "Instituto Urológico DE Contagem".
const CONECTIVOS = new Set(["de", "da", "do", "das", "dos", "e"]);
function chaveFrouxa(s: string): string {
  return clientMatchKey(s)
    .split("_")
    .filter((t) => t && !CONECTIVOS.has(t))
    .join("_");
}

/**
 * Chaves candidatas de um nome da planilha, da mais forte para a mais fraca.
 *
 * O nome lá vem no formato "Dr. José Ramos - VascuMed": médico + clínica. O slug canônico do
 * dashboard é só "Jose_Ramos", então o nome inteiro NÃO casa — daí as partes antes e depois do
 * traço entrarem como candidatas (há cliente conhecido pelo médico e cliente conhecido pela
 * clínica). As fracas só são registradas quando não são ambíguas (ver buildProjetosIndex).
 */
export function chavesCandidatas(cliente: string): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    const k = clientMatchKey(canonicalizeAdsClient(s));
    if (k && !out.includes(k)) out.push(k);
  };
  add(cliente);
  const corte = cliente.indexOf(" - ");
  if (corte > 0) {
    add(cliente.slice(0, corte)); // "Dr. José Ramos"
    add(cliente.slice(corte + 3)); // "VascuMed"
  }
  return out;
}

/** Junta os projetos de um mesmo cliente numa ficha só. */
function mesclar(rows: ProjetoRow[]): ClienteProjeto {
  // Projeto de referência: um ATIVO na frente; entre iguais, o de início mais RECENTE
  // (é o contrato que vale hoje, e é dele que saem squad e plano).
  const ordenadas = [...rows].sort((a, b) => {
    const at = ehAtivo(a.status) ? 0 : 1;
    const bt = ehAtivo(b.status) ? 0 : 1;
    if (at !== bt) return at - bt;
    return (parseData(b.data_inicio)?.getTime() ?? 0) - (parseData(a.data_inicio)?.getTime() ?? 0);
  });
  const ref = ordenadas[0];

  // Tempo de casa = a entrada MAIS ANTIGA (o cliente é "de casa" desde o primeiro projeto).
  let desde: Date | null = null;
  for (const r of rows) {
    const d = parseData(r.data_inicio);
    if (d && (!desde || d < desde)) desde = d;
  }

  return {
    // Campo vazio no projeto de referência cai para qualquer outro projeto que o tenha —
    // é comum a planilha só preencher o líder/plano numa das linhas do cliente.
    squad: squadDaLinha(ref) ?? ordenadas.map(squadDaLinha).find((s) => s) ?? null,
    plano: ref.plano?.trim() || ordenadas.map((r) => r.plano?.trim()).find((p) => p) || null,
    desde,
    status: ref.status?.trim() || null,
    ativo: rows.some((r) => ehAtivo(r.status)),
    temStatus: rows.some((r) => !!r.status?.trim()),
    // Basta um projeto do cliente declarar CRM p/ ele contar como "com CRM".
    temCRM: rows.some((r) => parseSimNao(r.crm) === true)
      ? true
      : rows.some((r) => parseSimNao(r.crm) === false)
        ? false
        : null,
  };
}

/**
 * Monta o índice de consulta a partir das linhas da tabela.
 *
 * Agrupa por cliente (chave forte = nome inteiro canonicalizado) e só então registra as
 * chaves fracas — e apenas as que apontam para UM único cliente. Assim duas clínicas com
 * médicos homônimos, ou dois projetos de nomes parecidos, nunca resolvem para o squad errado:
 * na dúvida, o cliente fica sem squad em vez de receber um squad falso.
 */
export function buildProjetosIndex(rows: ProjetoRow[]): ProjetosIndex {
  const grupos = new Map<string, ProjetoRow[]>();
  for (const r of rows) {
    const nome = r.cliente?.trim();
    if (!nome) continue;
    const forte = chavesCandidatas(nome)[0];
    if (!forte) continue;
    const g = grupos.get(forte);
    if (g) g.push(r);
    else grupos.set(forte, [r]);
  }

  const fichas = new Map<string, ClienteProjeto>();
  for (const [k, rs] of grupos) fichas.set(k, mesclar(rs));

  const byKey = new Map<string, ClienteProjeto>();
  for (const [k, f] of fichas) byKey.set(k, f);

  // Chaves fracas (partes do nome + versão sem conectivos): registra só o que não é ambíguo.
  const fracas = new Map<string, string | null>(); // chave → grupo dono (null = ambígua)
  const anotar = (chave: string, dono: string) => {
    if (!chave || byKey.has(chave)) return; // chave forte sempre vence
    const atual = fracas.get(chave);
    if (atual === undefined) fracas.set(chave, dono);
    else if (atual !== dono) fracas.set(chave, null);
  };
  for (const [k, rs] of grupos) {
    for (const r of rs) {
      const nome = r.cliente?.trim();
      if (!nome) continue;
      for (const c of chavesCandidatas(nome)) anotar(c, k);
      anotar(chaveFrouxa(nome), k);
      const corte = nome.indexOf(" - ");
      if (corte > 0) {
        anotar(chaveFrouxa(canonicalizeAdsClient(nome.slice(0, corte))), k);
        anotar(chaveFrouxa(canonicalizeAdsClient(nome.slice(corte + 3))), k);
      }
    }
    anotar(chaveFrouxa(k), k);
  }
  for (const [chave, dono] of fracas) {
    if (dono && fichas.has(dono)) byKey.set(chave, fichas.get(dono)!);
  }

  // Só entram no filtro os squads de clientes ATIVOS — a tela esconde os inativos, então
  // oferecer o líder de uma carteira toda inativa daria um filtro que não devolve ninguém.
  const squads = [
    ...new Set(
      [...fichas.values()].filter(clienteVisivel).map((f) => f.squad).filter((s): s is string => !!s),
    ),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));

  // Clientes ATIVOS p/ o seletor da Administração. O `padrao` é a chave do MÉDICO (parte antes
  // do traço) quando ela existe, porque é ela que costuma bater com o slug do dashboard; o
  // nome inteiro fica de reserva. Quem não casar entra pelo modo manual da tela.
  const ativos: ClienteAtivo[] = [];
  const vistos = new Set<string>();
  for (const [k, rs] of grupos) {
    const ficha = fichas.get(k);
    if (!ficha || !clienteVisivel(ficha) || !ficha.ativo) continue;
    const nome = rs.map((r) => r.cliente?.trim()).find((n) => n) ?? "";
    if (!nome) continue;
    const cands = chavesCandidatas(nome);
    const padrao = cands[1] ?? cands[0];
    if (!padrao || vistos.has(padrao)) continue;
    vistos.add(padrao);
    ativos.push({ nome, padrao });
  }
  ativos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  // Palavras do nome de cada cliente (sem conectivos), p/ o match por subconjunto do
  // resolveProjeto. Vem do nome INTEIRO da planilha, então cobre tanto o nome do médico
  // quanto o da clínica ("Dr. José Ramos - VascuMed" → {jose, rosa, vascumed}).
  const tokens: { ficha: ClienteProjeto; palavras: Set<string> }[] = [];
  for (const [k, rs] of grupos) {
    const ficha = fichas.get(k);
    if (!ficha) continue;
    const palavras = new Set<string>();
    for (const r of rs) {
      const nome = r.cliente?.trim();
      if (!nome) continue;
      for (const t of clientMatchKey(canonicalizeAdsClient(nome)).split("_")) {
        if (t && !CONECTIVOS.has(t)) palavras.add(t);
      }
    }
    if (palavras.size) tokens.push({ ficha, palavras });
  }

  return { byKey, tokens, squads, ativos };
}

/** Todo elemento de `a` está em `b`? */
function contido(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * Consulta pelo slug canônico do dashboard (ex.: "Jose_Ramos").
 *
 * Três tentativas, da mais forte para a mais fraca:
 *   1. chave exata;
 *   2. chave sem conectivos ("de/da/do");
 *   3. SUBCONJUNTO de palavras, em qualquer direção — é o caso comum na prática, porque a
 *      planilha escreve o nome curto e o dashboard o longo (ou vice-versa):
 *        "Dr. Alcides"              ⊂ "Alcides_Furtado"
 *        "Luis_Pacheco"             ⊂ "Dr. Luís Felipe Pacheco"
 *      Só vale quando UM único cliente qualifica: "Jose" sozinho casaria com Cordeiro,
 *      Geraldo e Pires ao mesmo tempo, e aí é melhor não resolver do que resolver errado.
 */
export function resolveProjeto(index: ProjetosIndex, canonical: string): ClienteProjeto | null {
  const k = clientMatchKey(canonical);
  const direto = index.byKey.get(k) ?? index.byKey.get(chaveFrouxa(canonical));
  if (direto) return direto;

  const alvo = new Set(k.split("_").filter((t) => t && !CONECTIVOS.has(t)));
  if (!alvo.size) return null;
  let achado: ClienteProjeto | null = null;
  for (const { ficha, palavras } of index.tokens) {
    if (!contido(alvo, palavras) && !contido(palavras, alvo)) continue;
    if (achado && achado !== ficha) return null; // ambíguo: não arrisca
    achado = ficha;
  }
  return achado;
}

/**
 * O cliente entra na tela de Metas?
 *
 * Sai APENAS quando a planilha de projetos afirma que ele está inativo — ou seja, ela
 * preencheu o status dele e nenhum dos projetos está ativo. Fora isso ele fica:
 *   - cliente que NÃO está na planilha → status desconhecido, continua aparecendo;
 *   - cliente na planilha com status em BRANCO → também desconhecido, continua aparecendo.
 * Desconhecido não é inativo: a carteira daqui tem de ser a mesma das telas de CRM/Meta Ads/
 * Google Ads, e esconder quem a planilha não classificou deixaria esta tela menor que elas.
 */
export function clienteVisivel(proj: ClienteProjeto | null): boolean {
  if (!proj) return true;
  return proj.ativo || !proj.temStatus;
}

// ---------------------------------------------------------------------------
// MATURIDADE — há quanto tempo o cliente é de casa, contado da `data_inicio` mais antiga.
// ---------------------------------------------------------------------------

export type MaturidadeId = "0-3" | "4-6" | "7-12" | "13+";

export interface FaixaMaturidade {
  id: MaturidadeId;
  label: string;
  /** Limites em MESES completos, [min, max]. max null = sem teto. */
  min: number;
  max: number | null;
}

export const FAIXAS_MATURIDADE: FaixaMaturidade[] = [
  { id: "0-3", label: "0 a 3 meses", min: 0, max: 3 },
  { id: "4-6", label: "4 a 6 meses", min: 4, max: 6 },
  { id: "7-12", label: "7 a 12 meses", min: 7, max: 12 },
  { id: "13+", label: "13 meses ou mais", min: 13, max: null },
];

/**
 * Meses COMPLETOS entre a entrada e hoje. Um cliente que entrou em 20/09 só vira "1 mês" em
 * 20/10 — contar por diferença de mês do calendário diria "1 mês" já em 1º/10.
 */
export function mesesDeCasa(desde: Date, hoje: Date = new Date()): number {
  let m = (hoje.getFullYear() - desde.getFullYear()) * 12 + (hoje.getMonth() - desde.getMonth());
  if (hoje.getDate() < desde.getDate()) m -= 1;
  return Math.max(0, m);
}

/** Faixa de maturidade do cliente. null quando não há data de início na planilha. */
export function faixaMaturidade(desde: Date | null, hoje: Date = new Date()): MaturidadeId | null {
  if (!desde) return null;
  const m = mesesDeCasa(desde, hoje);
  const f = FAIXAS_MATURIDADE.find((x) => m >= x.min && (x.max == null || m <= x.max));
  return f?.id ?? null;
}

// ---------------------------------------------------------------------------
// MATURIDADE — faixas do FILTRO do CRM. Diferente das FAIXAS_MATURIDADE (que particionam a
// carteira em 4 fatias exclusivas): aqui as faixas "Primeiros N meses" representam o TEMPO
// DE DADOS do cliente no banco — o cliente aparece quando JÁ ACUMULOU pelo menos N meses de
// histórico (contados da data mais antiga de dado real, via mesesDeCasa). São faixas que se
// SOBREPÕEM por limite INFERIOR ("Primeiros 12 meses" ⊂ "Primeiros 6 meses" ⊂ "Primeiros 3
// meses"): quem tem 10 meses de dados aparece em "Primeiros 3" e "Primeiros 6", mas não em
// "Primeiros 12"; quem tem ≥3 meses aparece em "Primeiros 3". Por isso TODOS os clientes com
// pelo menos 3 meses de dados caem em "Primeiros 3 meses". Select de escolha única.
// Tudo em MESES COMPLETOS de casa (mesesDeCasa), contados da data_inicio mais antiga.
// ---------------------------------------------------------------------------

export type CrmMaturidadeId = "prim3" | "prim6" | "prim12" | "4a6" | "7a12" | "13+";

export interface FaixaMaturidadeCrm {
  id: CrmMaturidadeId;
  label: string;
  min: number;
  max: number | null;
}

export const CRM_MATURIDADE_FAIXAS: FaixaMaturidadeCrm[] = [
  { id: "prim3", label: "Primeiros 3 meses", min: 3, max: null },
  { id: "prim6", label: "Primeiros 6 meses", min: 6, max: null },
  { id: "prim12", label: "Primeiros 12 meses", min: 12, max: null },
  { id: "4a6", label: "Entre 4 e 6 meses", min: 4, max: 6 },
  { id: "7a12", label: "Entre 7 e 12 meses", min: 7, max: 12 },
  { id: "13+", label: "Acima de 13 meses", min: 13, max: null },
];

/** O cliente (dado seu tempo de casa em meses) cai na faixa de maturidade do CRM escolhida? */
export function clienteNaFaixaMaturidadeCrm(meses: number | null, id: CrmMaturidadeId): boolean {
  if (meses == null) return false;
  const f = CRM_MATURIDADE_FAIXAS.find((x) => x.id === id);
  if (!f) return false;
  return meses >= f.min && (f.max == null || meses <= f.max);
}

// JANELA (offset em MESES desde o início do cliente) de cada faixa de maturidade. É o que
// transforma "Primeiros 3 meses" numa fatia de datas RELATIVA a cada cliente: o período deixa
// de ser o global e passa a ser os meses de casa correspondentes à faixa, POR cliente.
//   • "Primeiros N meses" → do início até o fim do N-ésimo mês (start..start+N).
//   • "Entre A e B meses"  → do fim do mês (A-1) até o fim do mês B (start+(A-1)..start+B).
//   • "Acima de 13 meses"  → do 13º mês em diante (start+12..hoje), sem teto.
// Os offsets batem com `mesesDeCasa` (meses COMPLETOS): o mês 4 começa em start+3 meses.
const CRM_MATURIDADE_JANELA_OFFSETS: Record<CrmMaturidadeId, { start: number; end: number | null }> = {
  prim3: { start: 0, end: 3 },
  prim6: { start: 0, end: 6 },
  prim12: { start: 0, end: 12 },
  "4a6": { start: 3, end: 6 },
  "7a12": { start: 6, end: 12 },
  "13+": { start: 12, end: null },
};

/** Soma `n` meses a uma data (preserva o dia; mantém a aritmética simples do setMonth). */
function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setMonth(r.getMonth() + n);
  return r;
}

/**
 * Janela de datas (INCLUSIVA nos dois extremos) da faixa de maturidade do CRM para UM cliente,
 * a partir do seu início real (`desde`). Devolve `null` quando não há início conhecido ou quando
 * a janela ficaria vazia (cliente mais novo que o começo da faixa — ex.: "Entre 4 e 6" para quem
 * só tem 2 meses de casa). O limite superior aberto ("Acima de 13") vai até `hoje`.
 */
export function crmMaturidadeJanela(
  id: CrmMaturidadeId,
  desde: Date | null,
  hoje: Date = new Date(),
): { from: Date; to: Date } | null {
  const off = CRM_MATURIDADE_JANELA_OFFSETS[id];
  if (!off || !desde) return null;
  const from = addMonths(desde, off.start);
  let to: Date;
  if (off.end == null) {
    to = hoje;
  } else {
    // start+end é EXCLUSIVO (início do mês seguinte à faixa); o último dia INCLUSIVO é 1 dia antes.
    to = addMonths(desde, off.end);
    to.setDate(to.getDate() - 1);
  }
  if (to.getTime() < from.getTime()) return null;
  return { from, to };
}
