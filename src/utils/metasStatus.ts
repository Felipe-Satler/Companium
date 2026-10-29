import { MetaKey, MetaValues } from "@/hooks/useClientesMetas";
import { CRMClientRow } from "@/utils/crmCalculations";

/**
 * Status de cada par cliente × métrica na tela "Metas".
 *
 * Só existe planejado para os 9 campos do CRM (tabela `clientes_meta`) — Meta Ads e Google
 * Ads não têm meta própria, então a tela trabalha apenas com estes campos.
 *
 *   ok   = respeitando a meta
 *   off  = fora da meta
 *   none = sem meta cadastrada (ou sem real calculável no período)
 */
export type GoalStatus = "ok" | "off" | "none";

// Ordem dos cards do CRM — mantida na barra de métricas, no gráfico de barras e na tabela.
export const METAS_FIELDS: MetaKey[] = [
  "investimento",
  "leadsCRM",
  "cplCRM",
  "consultaAgendada",
  "consultaRealizada",
  "procedimentoAgendado",
  "procedimentoRealizado",
  "faturamento",
  "roas",
];

/**
 * Direção da métrica. MESMA regra do card do CRM (ver MetaSlot em MetaValueLine.tsx):
 * CPL e Investimento são CUSTO (quanto menor melhor); o resto é quanto maior melhor.
 * Precisa continuar espelhando aquele arquivo — se as duas telas divergirem, o mesmo
 * cliente aparece "dentro da meta" no CRM e "fora" aqui.
 */
export function isHigherBetter(field: MetaKey): boolean {
  const f = field.toLowerCase();
  return !(f.startsWith("cpl") || f.startsWith("investimento"));
}

/**
 * Real do cliente no período, por campo. `row` ausente = cliente sem NENHUM movimento no
 * período: os absolutos valem 0 (ele realmente não entregou nada), mas as TAXAS ficam null
 * (não dá para dividir por zero — não é "fora da meta", é "sem dado").
 *
 * CPL com 0 leads e investimento > 0 = custo infinito por lead → Infinity, que cai em "off"
 * (gastou e não trouxe lead nenhum). Sem investimento nem leads → null (nada aconteceu).
 * ROAS segue a mesma ideia com o investimento no denominador.
 */
export function realForField(row: CRMClientRow | undefined, field: MetaKey): number | null {
  if (!row) {
    return field === "cplCRM" || field === "roas" ? null : 0;
  }
  switch (field) {
    case "investimento":
      return row.investimento;
    case "leadsCRM":
      return row.leadsCRM;
    case "cplCRM":
      if (row.leadsCRM > 0) return row.investimento / row.leadsCRM;
      return row.investimento > 0 ? Infinity : null;
    case "consultaAgendada":
      return row.consultasAgendadas;
    case "consultaRealizada":
      return row.consultasRealizadas;
    case "procedimentoAgendado":
      return row.procedimentosAgendados;
    case "procedimentoRealizado":
      return row.procedimentosRealizados;
    case "faturamento":
      return row.faturamentoBrutoRealizados;
    case "roas":
      if (row.investimento > 0) return row.roas;
      return row.faturamentoBrutoRealizados > 0 ? Infinity : null;
    default:
      return null;
  }
}

/**
 * Classifica um par cliente × métrica. Meta ausente (ou <= 0, que não é alvo válido) e real
 * não calculável caem os dois em "none" — a fatia "sem meta" do gráfico.
 *
 * 100% conta como DENTRO da meta nos dois sentidos, igual ao card do CRM (lá o verde começa
 * em >= 100% para "maior é melhor", e o vermelho do custo só entra ACIMA de 100%).
 */
export function goalStatus(real: number | null, goal: number | null, higherIsBetter: boolean): GoalStatus {
  if (goal == null || !Number.isFinite(goal) || goal <= 0) return "none";
  if (real == null || Number.isNaN(real)) return "none";
  const meeting = higherIsBetter ? real >= goal : real <= goal;
  return meeting ? "ok" : "off";
}

// % do planejado que o real representa. null quando não há meta ou real.
export function goalPct(real: number | null, goal: number | null): number | null {
  if (goal == null || !Number.isFinite(goal) || goal <= 0) return null;
  if (real == null || Number.isNaN(real)) return null;
  return (real / goal) * 100;
}

/** Uma célula da tabela: o real, a meta do período e o veredito. */
export interface MetaCell {
  field: MetaKey;
  real: number | null;
  goal: number | null;
  pct: number | null;
  status: GoalStatus;
}

/** Uma linha da tabela: o cliente e suas células (uma por métrica selecionada). */
export interface MetaClientRow {
  client: string;
  squad: string | null;
  plano: string | null;
  /** Entrada do cliente na Groohub (ordenação por tempo de casa). null = fonte indisponível. */
  desde: Date | null;
  cells: MetaCell[];
}

export function buildCells(
  row: CRMClientRow | undefined,
  metas: MetaValues | undefined,
  fields: MetaKey[],
): MetaCell[] {
  return fields.map((field) => {
    const real = realForField(row, field);
    const goal = metas?.[field]?.value ?? null;
    return { field, real, goal, pct: goalPct(real, goal), status: goalStatus(real, goal, isHigherBetter(field)) };
  });
}

export interface StatusCounts {
  ok: number;
  off: number;
  none: number;
}

export const EMPTY_COUNTS: StatusCounts = { ok: 0, off: 0, none: 0 };

/**
 * Quantas métricas FORA da meta bastam para o cliente inteiro contar como fora da meta.
 *
 * 1 = basta escorregar em uma. É o critério mais duro, e o combinado hoje. Está isolado aqui
 * de propósito: subir para 2 ou 3 muda a pizza inteira sem tocar em mais nada — as três
 * funções abaixo e todos os gráficos leem esta constante.
 */
export const LIMITE_FORA_DA_META = 1;

/**
 * Veredito do CLIENTE (é assim que a pizza conta — um cliente, uma fatia; não mais um par
 * cliente × métrica):
 *
 *   off  = tem pelo menos LIMITE_FORA_DA_META métricas fora da meta;
 *   none = não tem meta cadastrada em NENHUMA das métricas selecionadas;
 *   ok   = tem meta e não estourou o limite de métricas fora.
 *
 * A ordem importa: quem está fora do limite é "fora" mesmo que tenha metas em dia em outras
 * métricas — o alerta não pode ser diluído pelo que deu certo.
 */
export function clientStatus(row: MetaClientRow, limite: number = LIMITE_FORA_DA_META): GoalStatus {
  let off = 0;
  let comMeta = 0;
  for (const c of row.cells) {
    if (c.status === "off") off += 1;
    if (c.status !== "none") comMeta += 1;
  }
  if (off >= limite && off > 0) return "off";
  return comMeta > 0 ? "ok" : "none";
}

/** Conta CLIENTES por veredito — o que alimenta cada pizza. */
export function countClientStatuses(rows: MetaClientRow[], limite: number = LIMITE_FORA_DA_META): StatusCounts {
  const out: StatusCounts = { ok: 0, off: 0, none: 0 };
  for (const r of rows) out[clientStatus(r, limite)] += 1;
  return out;
}

/** Total de células contadas — 0 significa "nada a mostrar" (esconde a pizza). */
export function countsTotal(c: StatusCounts): number {
  return c.ok + c.off + c.none;
}

/** Contagem por métrica, para o gráfico de barras (uma barra por status, por métrica). */
export function countsByField(rows: MetaClientRow[], fields: MetaKey[]): Map<MetaKey, StatusCounts> {
  const out = new Map<MetaKey, StatusCounts>();
  for (const f of fields) out.set(f, { ok: 0, off: 0, none: 0 });
  for (const r of rows) {
    for (const c of r.cells) {
      const acc = out.get(c.field);
      if (acc) acc[c.status] += 1;
    }
  }
  return out;
}

/**
 * Ordenação da tabela: squad → plano → tempo de casa (mais antigo primeiro) → nome.
 * Enquanto squad/plano/entrada não têm fonte (planilha ainda não sincronizada), todos os
 * campos são null e a comparação cai direto no alfabético, como combinado.
 */
export function compareClientRows(a: MetaClientRow, b: MetaClientRow): number {
  const byText = (x: string | null, y: string | null) => {
    if (x === y) return 0;
    if (x == null) return 1; // sem informação vai para o fim
    if (y == null) return -1;
    return x.localeCompare(y, "pt-BR");
  };
  const squad = byText(a.squad, b.squad);
  if (squad !== 0) return squad;
  const plano = byText(a.plano, b.plano);
  if (plano !== 0) return plano;
  if (a.desde && b.desde && a.desde.getTime() !== b.desde.getTime()) {
    return a.desde.getTime() - b.desde.getTime(); // mais tempo de casa primeiro
  }
  if (a.desde && !b.desde) return -1;
  if (!a.desde && b.desde) return 1;
  return a.client.localeCompare(b.client, "pt-BR");
}

/** Um cliente dentro de um dos três grupos, com quantas métricas dele caíram ali. */
export interface ClientStatusEntry {
  client: string;
  count: number;
}

/**
 * Quais CLIENTES estão em cada grupo — o detalhamento que a pizza abre ao ser clicada.
 *
 * Cada cliente entra em UM grupo só (o veredito de `clientStatus`). O `count` diz quantas
 * métricas sustentam aquele veredito: no grupo "fora" é o nº de métricas estouradas (2 pesa
 * mais que 1), no "dentro" é o nº de métricas em dia, e no "sem meta" o nº de métricas sem
 * alvo cadastrado.
 *
 * Ordem: mais métricas primeiro (o caso mais grave no topo do "fora"), desempate alfabético.
 */
export function clientsByStatus(
  rows: MetaClientRow[],
  limite: number = LIMITE_FORA_DA_META,
): Record<GoalStatus, ClientStatusEntry[]> {
  const acc: Record<GoalStatus, ClientStatusEntry[]> = { ok: [], off: [], none: [] };
  for (const r of rows) {
    const st = clientStatus(r, limite);
    const count = r.cells.filter((c) =>
      st === "off" ? c.status === "off" : st === "ok" ? c.status === "ok" : c.status === "none",
    ).length;
    acc[st].push({ client: r.client, count });
  }
  for (const st of ["ok", "off", "none"] as GoalStatus[]) {
    acc[st].sort((a, b) => b.count - a.count || a.client.localeCompare(b.client, "pt-BR"));
  }
  return acc;
}

/**
 * Clientes de UMA métrica, separados por veredito — o detalhamento que o gráfico de barras
 * abre para baixo. Aqui não há limite a aplicar: numa métrica só, o cliente tem exatamente
 * um veredito.
 */
export function clientsForField(rows: MetaClientRow[], field: MetaKey): Record<GoalStatus, string[]> {
  const out: Record<GoalStatus, string[]> = { ok: [], off: [], none: [] };
  for (const r of rows) {
    const cell = r.cells.find((c) => c.field === field);
    if (cell) out[cell.status].push(r.client);
  }
  for (const st of ["ok", "off", "none"] as GoalStatus[]) {
    out[st].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }
  return out;
}

/**
 * A barra clicada no gráfico "Clientes por métrica": uma métrica, um veredito e o gráfico de
 * onde veio o clique (`squad` null = o gráfico geral, da carteira inteira).
 */
export interface BarFilter {
  field: MetaKey;
  status: GoalStatus;
  squad: string | null;
}

/**
 * As linhas que a barra clicada representa — é o que filtra a tabela. Mesma leitura de
 * `clientsForField`, para a tabela mostrar exatamente os clientes que a lista aberta mostra.
 * Sem filtro devolve `rows` intacto (mesma identidade, para não invalidar memos à toa).
 */
export function rowsForBar(rows: MetaClientRow[], filter: BarFilter | null): MetaClientRow[] {
  if (!filter) return rows;
  return rows.filter(
    (r) =>
      (filter.squad == null || r.squad === filter.squad) &&
      r.cells.some((c) => c.field === filter.field && c.status === filter.status),
  );
}
