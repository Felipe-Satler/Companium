// Correção manual dos números do CRM (Leads / Consultas / Procedimentos) por VIEW filtrado.
//
// Regra "sempre fixo" (decisão do usuário): o valor digitado SUBSTITUI o calculado e cola
// naquele recorte, sem ser recalculado do banco, até ser removido. Para o valor não sumir
// quando o período padrão "dia 1 → hoje" avança de dia, a assinatura do período é
// NORMALIZADA — mês fechado e mês-até-hoje viram chaves estáveis; só ranges custom são
// casados por data exata.
//
// A chave (`filterSig`) inclui o FILTRO INTEIRO que afeta os totais dos cards
// (cliente + médico + origem + período), então um override só se aplica exatamente ao
// view que foi editado — nunca vaza para outro filtro.

import { clientMatchKey } from "@/data/clienteAliases";
import type { CRMTotals, CRMMonthlyEvolution, FatBasis } from "@/utils/crmCalculations";
import { DEFAULT_FAT_BASIS } from "@/utils/crmCalculations";

export type CRMOverrideMetric =
  // Contagens (números inteiros).
  | "leads"
  | "consultas_agendadas"
  | "consultas_realizadas"
  | "procedimentos_agendados"
  | "procedimentos_realizados"
  // Valores em dinheiro (R$) — editáveis igual às contagens.
  | "valor_consultas_agendadas"
  | "valor_consultas_realizadas"
  | "valor_procedimentos_agendados"
  | "valor_procedimentos_realizados";

export const CRM_OVERRIDE_METRICS: CRMOverrideMetric[] = [
  "leads",
  "consultas_agendadas",
  "consultas_realizadas",
  "procedimentos_agendados",
  "procedimentos_realizados",
  "valor_consultas_agendadas",
  "valor_consultas_realizadas",
  "valor_procedimentos_agendados",
  "valor_procedimentos_realizados",
];

// Métricas que representam VALOR em dinheiro (R$) — o editor usa formatação de moeda
// (aceita centavos) em vez de inteiro, e ao serem corrigidas recomputam o Faturamento Bruto.
export const CRM_OVERRIDE_CURRENCY_METRICS: ReadonlySet<CRMOverrideMetric> = new Set([
  "valor_consultas_agendadas",
  "valor_consultas_realizadas",
  "valor_procedimentos_agendados",
  "valor_procedimentos_realizados",
]);

export function isCurrencyMetric(metric: CRMOverrideMetric): boolean {
  return CRM_OVERRIDE_CURRENCY_METRICS.has(metric);
}

// Sentinela do agregado "todos os clientes" — nunca casa com o vínculo de um usuário-cliente
// (client_matchkey('__ALL__') não está nos cmpkeys dele), então o agregado fica invisível
// para acesso restrito. Ver a policy RESTRICTIVE em crm_metric_overrides.
export const OVERRIDE_ALL_CLIENTS = "__ALL__";

const MES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// Parse "yyyy-MM-dd" sem passar por Date (evita deslocamento de fuso).
function parseYMD(s: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate(); // m é 1-based aqui; day 0 do mês seguinte = último dia
}

export interface PeriodSignature {
  kind: "all" | "month" | "range";
  sig: string;
  label: string;
  from: string | null;
  to: string | null;
}

// Assinatura estável do período filtrado. ÂNCORA NO MÊS: qualquer recorte que comece no 1º
// dia e termine DENTRO do mesmo mês vira a MESMA chave "m:AAAA-MM" — seja "1º → último dia",
// "1º → hoje" ou "1º → um dia qualquer do mês". Assim a correção manual lançada num pedaço do
// mês aparece em QUALQUER período que englobe aquele mês (ex.: cadastrei 01→27, apareço ao
// filtrar 01→30, ou ao filtrar ago+set), e não some quando a ponta do filtro muda de dia.
//  • 1º dia → qualquer dia do mesmo mês  → "m:2026-09"  (estável o mês todo)
//  • range custom qualquer (começa no meio do mês, ou cruza meses) → "r:from_to" (casa exato)
// (`today` não influencia mais a assinatura — antes "1º → hoje" gerava uma chave "mtd:"
//  separada e "1º → dia<último" caía em range congelado; ambos sumiam ao virar o dia/mês.)
export function periodSignature(from?: string, to?: string, today: Date = new Date()): PeriodSignature {
  if (!from) return { kind: "all", sig: "all", label: "Todo o período", from: null, to: null };
  const toStr = to ?? from;
  const pf = parseYMD(from);
  const pt = parseYMD(toStr);
  if (!pf || !pt) return { kind: "range", sig: `r:${from}_${toStr}`, label: `${from} a ${toStr}`, from, to: toStr };

  const [fy, fm, fd] = pf;
  const [ty, tm] = pt;
  const monthKey = `${fy}-${pad2(fm)}`;
  const monthLabel = `${MES_PT[fm - 1]}/${fy}`;

  // Começa no 1º dia e as duas pontas caem no MESMO mês/ano → chave estável do mês.
  const startsFirst = fd === 1 && fy === ty && fm === tm;
  if (startsFirst) {
    return { kind: "month", sig: `m:${monthKey}`, label: monthLabel, from, to: toStr };
  }
  return { kind: "range", sig: `r:${from}_${toStr}`, label: `${from} a ${toStr}`, from, to: toStr };
}

// Lista normalizada (médico/origem) → string ordenada e estável para compor a assinatura.
function normList(xs?: string | string[]): string[] {
  const arr = Array.isArray(xs) ? xs : xs != null ? [xs] : [];
  return arr
    .map((x) => (x ?? "").trim())
    .filter((x) => x && x.toLowerCase() !== "all")
    .map((x) => x.toLowerCase())
    .sort();
}

export interface OverrideScope {
  client?: string; // filters.client ("all" ou slug canônico)
  medico?: string | string[];
  origem?: string | string[];
  from?: string; // yyyy-MM-dd
  to?: string; // yyyy-MM-dd
  // Escopo por TIPO de procedimento — só Dr. Diego Rezende / Dr. Pablo Fonseca, com exatamente
  // 1 procedimento filtrado. Token JÁ normalizado ("proc:<procedimentoKey>"). Quando presente,
  // vira um segmento EXTRA no fim da assinatura (ver buildFilterSig), isolando a correção
  // àquela coorte de procedimento. Vazio/ausente = sem recorte por procedimento (todo mundo),
  // e a assinatura fica IDÊNTICA à de antes — correções já gravadas seguem casando.
  procedimento?: string;
}

export interface OverrideColumns {
  client_scope: string;
  medico_scope: string;
  origem: string;
  period_kind: string;
  period_from: string | null;
  period_to: string | null;
  period_label: string;
}

export interface BuiltFilterSig {
  filterSig: string;
  columns: OverrideColumns;
}

// Monta a assinatura do filtro atual + as colunas legíveis de auditoria/escopo.
export function buildFilterSig(scope: OverrideScope, today: Date = new Date()): BuiltFilterSig {
  const rawClient = scope.client && scope.client !== "all" ? scope.client : OVERRIDE_ALL_CLIENTS;
  const clientKey = rawClient === OVERRIDE_ALL_CLIENTS ? OVERRIDE_ALL_CLIENTS : clientMatchKey(rawClient);
  const medicoList = normList(scope.medico);
  const origemList = normList(scope.origem);
  const period = periodSignature(scope.from, scope.to, today);

  // Procedimento entra como segmento EXTRA no FIM e SÓ quando presente: assim toda assinatura
  // sem recorte de procedimento continua byte-a-byte igual à de antes (correções já gravadas
  // seguem casando), e a correção por procedimento nunca colide com a do cliente inteiro.
  const proc = (scope.procedimento ?? "").trim();
  const parts = [clientKey, medicoList.join(","), origemList.join(","), period.sig];
  if (proc) parts.push(proc);
  const filterSig = parts.join("|");

  return {
    filterSig,
    columns: {
      // client_scope guarda o slug CRU (scope_kommo_ok normaliza com client_matchkey no banco).
      client_scope: rawClient,
      medico_scope: medicoList.join(","),
      origem: origemList.join(","),
      period_kind: period.kind,
      period_from: period.from,
      period_to: period.to,
      period_label: period.label,
    },
  };
}

// Assinatura da correção de UMA origem sozinha (mesmo cliente/médico/período). É EXATAMENTE
// a chave que foi (ou seria) gravada ao filtrar aquela origem isolada e corrigir o número.
// Usada p/ compor o recorte de ≥2 origens somando, por origem, a correção OU o calculado —
// ver `componentValue` em useCRMOverrides (comporta-se igual ao banco: total = soma das partes).
export function buildOrigemSig(
  scope: OverrideScope,
  origem: string,
  today: Date = new Date()
): string {
  return buildFilterSig({ ...scope, origem: [origem] }, today).filterSig;
}

// ── Rollup das correções por PROCEDIMENTO no view SEM procedimento filtrado ───────
// As correções lançadas por procedimento são gravadas com um segmento EXTRA "|proc:<key>"
// no FIM da assinatura (ver buildFilterSig). Quando nenhum procedimento está filtrado, o
// total do recorte deve "puxar" a SOMA dessas correções por procedimento — igual ao que o
// usuário veria somando cada procedimento à mão. Estes helpers extraem a assinatura do
// recorte PAI (sem procedimento) e agrupam a soma por (base, métrica). Ver useCRMOverrides.

// Assinatura tem o segmento de procedimento no fim?
export function isProcSig(sig: string): boolean {
  return sig.includes("|proc:");
}

// Remove o segmento final "|proc:<key>" de uma assinatura, devolvendo a assinatura do
// recorte PAI (o mesmo cliente/médico/origem/período, SEM recorte por procedimento). Sem
// esse segmento, devolve a própria assinatura. O segmento de procedimento é sempre o ÚLTIMO.
export function baseSigWithoutProc(sig: string): string {
  const i = sig.lastIndexOf("|proc:");
  return i === -1 ? sig : sig.slice(0, i);
}

// Agrupa correções POR PROCEDIMENTO somando o valor por (assinatura-pai, métrica). A
// assinatura-pai é exatamente a assinatura do view SEM procedimento filtrado, então o total
// desse view pode somar as correções que foram lançadas procedimento a procedimento. Linhas
// sem o segmento "|proc:" são ignoradas (não são correções por procedimento).
export function sumProcOverridesByBase(
  rows: { filter_sig: string; metric: string; value: number | string }[]
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    if (!isProcSig(r.filter_sig)) continue;
    const n = Number(r.value); // PostgREST devolve numeric como string.
    if (!Number.isFinite(n)) continue;
    const base = baseSigWithoutProc(r.filter_sig);
    const m = (out[base] ??= {});
    m[r.metric] = (m[r.metric] ?? 0) + n;
  }
  return out;
}

export interface MonthCell {
  from: string; // yyyy-MM-dd (clampado ao range de origem)
  to: string; // yyyy-MM-dd
}

// Divide o período [from,to] em células por MÊS-CALENDÁRIO. Cada célula é o trecho do
// range que cai naquele mês (primeira/última célula podem ser parciais se o range começar/
// terminar no meio do mês). Usada para decompor um recorte multi-mês (ex.: filtro por ANO)
// e somar, mês a mês, a correção manual OU o calculado — igual ao banco (total = soma das
// partes). Cada mês (fechado OU corrente até hoje) vira a sig "m:AAAA-MM" — exatamente a
// chave em que o preenchimento manual daquele mês foi gravado.
//   • range de mês único (ou sem `from`) → []  (nada a decompor)
export function monthCellsInRange(from?: string, to?: string): MonthCell[] {
  if (!from) return [];
  const toStr = to ?? from;
  const pf = parseYMD(from);
  const pt = parseYMD(toStr);
  if (!pf || !pt) return [];
  const [fy, fm] = pf;
  const [ty, tm] = pt;
  // Range invertido ou mesmo mês → sem decomposição.
  if (ty < fy || (ty === fy && tm < fm)) return [];
  if (fy === ty && fm === tm) return [];

  const cells: MonthCell[] = [];
  let y = fy;
  let m = fm;
  let guard = 0;
  while ((y < ty || (y === ty && m <= tm)) && guard++ < 600) {
    const first = `${y}-${pad2(m)}-01`;
    const last = `${y}-${pad2(m)}-${pad2(lastDayOfMonth(y, m))}`;
    cells.push({
      from: y === fy && m === fm ? from : first,
      to: y === ty && m === tm ? toStr : last,
    });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return cells;
}

// Mapa métrica → campo do CRMTotals que ela substitui.
export const OVERRIDE_TOTALS_FIELD: Record<CRMOverrideMetric, keyof CRMTotals> = {
  leads: "leadsCRM",
  consultas_agendadas: "consultasAgendadas",
  consultas_realizadas: "consultasRealizadas",
  procedimentos_agendados: "procedimentosAgendados",
  procedimentos_realizados: "procedimentosRealizados",
  valor_consultas_agendadas: "valorConsultasAgendadas",
  valor_consultas_realizadas: "valorConsultasRealizadas",
  valor_procedimentos_agendados: "valorProcedimentosAgendados",
  valor_procedimentos_realizados: "valorProcedimentosRealizados",
};

// Valores (calculados do banco) das 9 métricas corrigíveis extraídos de um CRMTotals — a
// "contribuição" de um recorte. Usado p/ o recorte de ≥2 origens: cada origem entra com a
// sua correção manual, ou (se não tiver) com a sua contribuição do banco. Assim o combinado
// soma "por partes", exatamente como o banco somaria as origens.
export type OverrideMetricValues = Partial<Record<CRMOverrideMetric, number>>;

export function overrideValuesFromTotals(totals: CRMTotals): OverrideMetricValues {
  const out: OverrideMetricValues = {};
  for (const metric of CRM_OVERRIDE_METRICS) {
    const v = totals[OVERRIDE_TOTALS_FIELD[metric]];
    if (typeof v === "number" && Number.isFinite(v)) out[metric] = v;
  }
  return out;
}

// Substitui nos totais os campos que têm correção manual (deixa o resto calculado intacto).
// Como o funil de conversão deriva de `totals`, a correção propaga p/ ele automaticamente.
//
// Quando um VALOR (R$) é corrigido, o Faturamento Bruto (e o ROAS) são recomputados a partir
// dos valores já substituídos, respeitando a base escolhida (agendadas/realizadas ×
// agendados/realizados) — assim a correção do valor propaga p/ o Faturamento, sem
// inconsistência entre o card de valor e o headline de Faturamento. Isso só acontece quando
// há de fato correção de valor (senão o Faturamento calculado, que respeita a base por
// cliente no agregado, é preservado intacto).
export function applyTotalsOverrides(
  totals: CRMTotals,
  get: (metric: CRMOverrideMetric) => number | undefined,
  basis: FatBasis = DEFAULT_FAT_BASIS
): CRMTotals {
  let out = totals;
  let currencyTouched = false;
  for (const metric of CRM_OVERRIDE_METRICS) {
    const v = get(metric);
    if (v != null && Number.isFinite(v)) {
      if (out === totals) out = { ...totals };
      out[OVERRIDE_TOTALS_FIELD[metric]] = v;
      if (isCurrencyMetric(metric)) currencyTouched = true;
    }
  }
  if (currencyTouched && out !== totals) {
    const c = basis.consulta === "agendadas" ? out.valorConsultasAgendadas : out.valorConsultasRealizadas;
    const p = basis.procedimento === "agendados" ? out.valorProcedimentosAgendados : out.valorProcedimentosRealizados;
    out.faturamentoBruto = c + p;
    out.roas = out.investimentoTotal > 0 ? out.faturamentoBruto / out.investimentoTotal : 0;
  }
  return out;
}

// ── Correções manuais na EVOLUÇÃO MENSAL (gráficos do CRM) ──────────────────────
// Cada barra da evolução é um mês. Para que ela acompanhe a correção manual feita nos
// cards de totais, montamos — por mês — a MESMA assinatura de filtro que os cards
// gerariam se o usuário tivesse filtrado exatamente aquele mês, herdando
// cliente/médico/origem do recorte atual e recortando o período ao mês (interseção com
// o range filtrado). Qualquer mês (fechado ou corrente até hoje) → "m:AAAA-MM".
// Assim, remover a correção nos cards faz a barra voltar sozinha ao valor do banco (a
// chave deixa de existir → lookup devolve undefined → cai no calculado).
export function buildMonthlyFilterSig(
  monthKey: string, // "AAAA-MM"
  scope: Omit<OverrideScope, "from" | "to">,
  filterFrom?: string, // yyyy-MM-dd (range do filtro atual, se houver)
  filterTo?: string,
  today: Date = new Date()
): string {
  const pf = parseYMD(`${monthKey}-01`);
  if (!pf) return "";
  const [y, m] = pf;
  const monthStart = `${monthKey}-01`;
  const monthEnd = `${monthKey}-${pad2(lastDayOfMonth(y, m))}`;
  // Interseção do mês com o range do filtro: o pedaço do mês efetivamente exibido na barra.
  const ff = filterFrom ? filterFrom.slice(0, 10) : undefined;
  const ft = filterTo ? filterTo.slice(0, 10) : undefined;
  const from = ff && ff > monthStart ? ff : monthStart;
  const to = ft && ft < monthEnd ? ft : monthEnd;
  return buildFilterSig({ ...scope, from, to }, today).filterSig;
}

// Métricas de CONTAGEM → campo correspondente na linha da evolução mensal.
const OVERRIDE_EVOLUTION_COUNT_FIELD: Partial<Record<CRMOverrideMetric, keyof CRMMonthlyEvolution>> = {
  leads: "leads",
  consultas_agendadas: "consultasAgendadas",
  consultas_realizadas: "consultasRealizadas",
  procedimentos_agendados: "procedimentosAgendados",
  procedimentos_realizados: "procedimentosRealizados",
};

// Aplica a UM mês da evolução as correções manuais válidas para aquele mês (mesma regra
// dos totais em applyTotalsOverrides): contagens substituídas direto; valores (R$)
// substituem as parcelas e recomputam o faturamento pela base. ROAS e CPL do mês são
// recalculados com os mesmos números do banco (investimento não é corrigível). Sem
// nenhuma correção no mês, devolve a linha original inalterada (mesma referência).
export function applyEvolutionOverrides(
  row: CRMMonthlyEvolution,
  get: (metric: CRMOverrideMetric) => number | undefined,
  basis: FatBasis = DEFAULT_FAT_BASIS
): CRMMonthlyEvolution {
  let out = row;
  const touch = () => {
    if (out === row) out = { ...row };
  };

  // Contagens: substituição direta (leads, consultas, procedimentos).
  for (const metric of Object.keys(OVERRIDE_EVOLUTION_COUNT_FIELD) as CRMOverrideMetric[]) {
    const v = get(metric);
    if (v != null && Number.isFinite(v)) {
      touch();
      (out[OVERRIDE_EVOLUTION_COUNT_FIELD[metric]!] as number) = v;
    }
  }

  // Valores (R$): substitui as parcelas corrigidas e recomputa o faturamento pela base.
  let currencyTouched = false;
  const vca = get("valor_consultas_agendadas");
  const vcr = get("valor_consultas_realizadas");
  const vpa = get("valor_procedimentos_agendados");
  const vpr = get("valor_procedimentos_realizados");
  if (vca != null && Number.isFinite(vca)) { touch(); out.valorConsultasAgendadas = vca; currencyTouched = true; }
  if (vcr != null && Number.isFinite(vcr)) { touch(); out.valorConsultasRealizadas = vcr; currencyTouched = true; }
  if (vpa != null && Number.isFinite(vpa)) { touch(); out.valorProcedimentosAgendados = vpa; currencyTouched = true; }
  if (vpr != null && Number.isFinite(vpr)) { touch(); out.valorProcedimentosRealizados = vpr; currencyTouched = true; }
  if (currencyTouched) {
    const c = basis.consulta === "agendadas" ? out.valorConsultasAgendadas : out.valorConsultasRealizadas;
    const p = basis.procedimento === "agendados" ? out.valorProcedimentosAgendados : out.valorProcedimentosRealizados;
    out.faturamento = c + p;
  }

  // Derivados do mês (mesmas fórmulas de calcMonthlyEvolutionAgg): só recomputa se
  // algo mudou — senão preserva os valores já calculados do banco intactos.
  if (out !== row) {
    out.roas = out.investimento > 0 ? out.faturamento / out.investimento : 0;
    out.cpl = out.leads > 0 ? out.investimento / out.leads : 0;
  }
  return out;
}
