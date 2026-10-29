import { useMemo } from "react";
import { ArrowDown, ArrowUp, GitCompareArrows, Minus, Trophy } from "lucide-react";
import { useClientesData } from "@/hooks/useClientesData";
import { useCRMClienteData, CRMTotals } from "@/hooks/useCRMClienteData";
import { useClientesMetas, MetaKey, MetaValues } from "@/hooks/useClientesMetas";
import {
  canonicalizeAdsClient,
  foldMergedAdsClient,
  adsMedicoForClient,
} from "@/data/clienteAliases";
import { SectionLabel } from "@/components/clientes/SectionLabel";
import { cn } from "@/lib/utils";

/**
 * COMPARAÇÃO DE PERÍODOS (CRM). Recebe os totais já calculados do período A (o filtro
 * corrente da tela, para não refazer o fetch) e busca, por conta própria, os totais do
 * período B escolhido no seletor de comparação — reaproveitando exatamente o MESMO
 * pipeline da página (useClientesData → canonicalMap → useCRMClienteData) com os mesmos
 * filtros de cliente/origem/médico/procedimento, mudando só as datas.
 *
 * PLANEJADO INTEGRADO: além dos dois valores reais, cada período mostra "quanto bateu" do
 * seu PRÓPRIO planejado (a meta cadastrada é mensal, então o alvo é rateado para a janela de
 * cada período). O selo de % é verde quando a meta foi batida, âmbar quando não, e cinza
 * quando não há meta cadastrada ou a métrica é informativa (investimento). Assim dá pra ver,
 * lado a lado, o real de A × real de B E o atingimento de cada um contra o plano.
 *
 * Este componente é montado CONDICIONALMENTE (só quando a comparação está ativa), então os
 * hooks de fetch/metas só disparam quando o usuário realmente compara — sem custo quando a
 * comparação está desligada.
 */

// Direção de "melhora" de cada métrica.
type Dir = "higher" | "lower" | "neutral";

// Linha da comparação = CRMTotals + a etapa "Orçamento" do funil (count/valor represado),
// que vem separada do CRMTotals no hook (orcamentoParado).
type CRMCompareRow = CRMTotals & { orcamentoCount: number; orcamentoValor: number };

interface MetricDef {
  key: string;
  label: string;
  group: string;
  dir: Dir;
  get: (t: CRMCompareRow) => number | null;
  fmt: (v: number | null) => string;
  /** Chave do planejado correspondente (quando existe meta cadastrável p/ o indicador). */
  metaKey?: MetaKey;
}

function fmtInt(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
function fmtCurrency(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtRoas(v: number | null): string {
  if (v == null) return "—";
  return `${v.toFixed(2).replace(".", ",")}x`;
}

// CPL derivado (investimento ÷ leads CRM). null quando não há leads.
const cplOf = (t: CRMCompareRow) => (t.leadsCRM > 0 ? t.investimentoTotal / t.leadsCRM : null);

const METRICS: MetricDef[] = [
  { key: "leadsCRM", label: "Leads CRM", group: "Leads", dir: "higher", get: (t) => t.leadsCRM, fmt: fmtInt, metaKey: "leadsCRM" },
  { key: "leadsTrafego", label: "Leads Tráfego", group: "Leads", dir: "higher", get: (t) => t.leadsTrafego, fmt: fmtInt },
  { key: "cplCRM", label: "CPL CRM", group: "Leads", dir: "lower", get: cplOf, fmt: fmtCurrency, metaKey: "cplCRM" },
  { key: "orcamentoCount", label: "Leads em Orçamento", group: "Orçamento", dir: "higher", get: (t) => t.orcamentoCount, fmt: fmtInt },
  { key: "orcamentoValor", label: "Valor em Orçamento", group: "Orçamento", dir: "higher", get: (t) => t.orcamentoValor, fmt: fmtCurrency },
  { key: "consAgend", label: "Consultas Agendadas", group: "Consultas", dir: "higher", get: (t) => t.consultasAgendadas, fmt: fmtInt, metaKey: "consultaAgendada" },
  { key: "consReal", label: "Consultas Realizadas", group: "Consultas", dir: "higher", get: (t) => t.consultasRealizadas, fmt: fmtInt, metaKey: "consultaRealizada" },
  { key: "procAgend", label: "Procedimentos Agendados", group: "Procedimentos", dir: "higher", get: (t) => t.procedimentosAgendados, fmt: fmtInt, metaKey: "procedimentoAgendado" },
  { key: "procReal", label: "Procedimentos Realizados", group: "Procedimentos", dir: "higher", get: (t) => t.procedimentosRealizados, fmt: fmtInt, metaKey: "procedimentoRealizado" },
  { key: "investimento", label: "Investimento Total", group: "Resultado", dir: "neutral", get: (t) => t.investimentoTotal, fmt: fmtCurrency, metaKey: "investimento" },
  { key: "faturamento", label: "Faturamento Bruto", group: "Resultado", dir: "higher", get: (t) => t.faturamentoBruto, fmt: fmtCurrency, metaKey: "faturamento" },
  { key: "roas", label: "ROAS", group: "Resultado", dir: "higher", get: (t) => t.roas, fmt: fmtRoas, metaKey: "roas" },
];

const GROUP_ORDER = ["Leads", "Orçamento", "Consultas", "Procedimentos", "Resultado"];

// "good" = período B melhorou; "bad" = piorou; "neutral" = sem direção/sem mudança.
type Fav = "good" | "bad" | "neutral";

function favOf(dir: Dir, a: number | null, b: number | null): Fav {
  if (dir === "neutral") return "neutral";
  const av = a ?? 0;
  const bv = b ?? 0;
  if (bv === av) return "neutral";
  const bBigger = bv > av;
  const goodWhenBigger = dir === "higher";
  return bBigger === goodWhenBigger ? "good" : "bad";
}

// Atingimento do alvo (real ÷ planejado). "lower" (CPL) → o alvo é um TETO: bater = ≤100%.
// "higher" → bater = ≥100%. "neutral" (investimento) e sem meta → null (informativo, não julga).
function attainHit(dir: Dir, real: number | null, plan: number | null): boolean | null {
  if (plan == null || plan === 0) return null;
  if (dir === "neutral") return null;
  const ratio = (real ?? 0) / plan;
  return dir === "lower" ? ratio <= 1 : ratio >= 1;
}

// Selo "quanto bateu da meta" de um período. Fica ao lado do valor real de cada barra.
function MetaChip({ dir, real, plan }: { dir: Dir; real: number | null; plan: number | null }) {
  if (plan == null || plan === 0) {
    return <span className="text-[10px] text-muted-foreground/40" title="Sem meta cadastrada para o período">—</span>;
  }
  const ratio = ((real ?? 0) / plan) * 100;
  const hit = attainHit(dir, real, plan);
  const tone =
    hit == null
      ? "bg-secondary text-muted-foreground"
      : hit
        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        : "bg-amber-500/10 text-amber-600 dark:text-amber-500";
  const title =
    dir === "neutral"
      ? `Realizado ÷ planejado (meta ${fmtNum(plan)}) — informativo`
      : dir === "lower"
        ? `${ratio.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% da meta (${fmtNum(plan)}). Meta é teto: ≤100% = dentro.`
        : `${ratio.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% da meta (${fmtNum(plan)}). ≥100% = meta batida.`;
  return (
    <span title={title} className={cn("inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums", tone)}>
      {ratio.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
    </span>
  );
}

function fmtNum(v: number): string {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

// Uma barra de período: dot + rótulo + barra proporcional (com tracejado da meta) + valor +
// selo de meta + selo de vencedor.
function PeriodBar({
  color,
  label,
  value,
  pct,
  metaPct,
  winner,
  dir,
  real,
  plan,
  fmt,
}: {
  color: "a" | "b";
  label: string;
  value: string;
  pct: number;
  /** Posição (0–100) do tracejado da meta na barra; null quando não há meta. */
  metaPct: number | null;
  winner: boolean;
  dir: Dir;
  real: number | null;
  plan: number | null;
  fmt: (v: number | null) => string;
}) {
  const barColor = color === "a" ? "bg-primary" : "bg-violet-500";
  const dotColor = color === "a" ? "bg-primary" : "bg-violet-500";
  return (
    <div className="flex items-center gap-2">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", dotColor)} />
      <span className="w-20 shrink-0 truncate text-[11px] text-muted-foreground sm:w-28" title={label}>
        {label}
      </span>
      {/* Container relativo NÃO clipado: o preenchimento é clipado por um wrapper interno, mas o
          tracejado da meta fica por cima e visível até na borda (100%). */}
      <div className="relative h-5 min-w-0 flex-1">
        <div className="absolute inset-0 overflow-hidden rounded-md bg-secondary/50">
          <div
            className={cn("h-full rounded-md transition-all", barColor, winner ? "opacity-90" : "opacity-40")}
            style={{ width: `${Math.max(pct, value === "—" ? 0 : 2)}%` }}
          />
        </div>
        {metaPct != null && (
          <div
            className="absolute inset-y-[-2px] z-10 flex flex-col items-center"
            style={{ left: `${metaPct}%`, transform: "translateX(-50%)" }}
            title={`Meta: ${fmt(plan)}`}
          >
            {/* Cabecinha do marcador + linha tracejada da meta. */}
            <span className="h-1.5 w-1.5 rounded-full bg-foreground/80" />
            <span className="w-0 flex-1 border-l-2 border-dashed border-foreground/80" />
          </div>
        )}
      </div>
      {/* Valor REALIZADO (destaque) + a META do período logo abaixo (o que o tracejado marca). */}
      <span className="w-24 shrink-0 text-right leading-tight">
        <span className="block text-sm font-semibold tabular-nums text-foreground">{value}</span>
        {plan != null && plan > 0 && (
          <span className="block text-[9px] font-medium tabular-nums text-muted-foreground">meta {fmt(plan)}</span>
        )}
      </span>
      {/* Atingimento da meta (quanto bateu). */}
      <span className="flex w-12 shrink-0 justify-end">
        <MetaChip dir={dir} real={real} plan={plan} />
      </span>
      {/* Período vencedor entre A e B neste indicador. */}
      <span className="flex w-5 shrink-0 justify-center">
        {winner && <Trophy className="h-3 w-3 text-emerald-600 dark:text-emerald-400" aria-label="Melhor período" />}
      </span>
    </div>
  );
}

function DeltaBadge({ fav, a, b, dir }: { fav: Fav; a: number | null; b: number | null; dir: Dir }) {
  const av = a ?? 0;
  const bv = b ?? 0;
  const diff = bv - av;
  const pct = av !== 0 ? (diff / Math.abs(av)) * 100 : null;
  const Icon = diff > 0 ? ArrowUp : diff < 0 ? ArrowDown : Minus;
  const tone =
    fav === "good"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : fav === "bad"
        ? "bg-red-500/10 text-red-600 dark:text-red-400"
        : "bg-secondary text-muted-foreground";
  const pctText = pct == null ? (diff !== 0 ? "novo" : "—") : `${diff > 0 ? "+" : ""}${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  const title =
    dir === "neutral"
      ? "Variação de A para B (métrica informativa, sem melhor/pior)"
      : fav === "good"
        ? "Período B está melhor neste indicador"
        : fav === "bad"
          ? "Período A está melhor neste indicador"
          : "Sem variação entre os períodos";
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums", tone)}>
      <Icon className="h-3 w-3" />
      {pctText}
    </span>
  );
}

function MetricRow({
  def,
  a,
  b,
  labelA,
  labelB,
  planA,
  planB,
}: {
  def: MetricDef;
  a: number | null;
  b: number | null;
  labelA: string;
  labelB: string;
  planA: number | null;
  planB: number | null;
}) {
  const av = a ?? 0;
  const bv = b ?? 0;
  // Escala comum da métrica: inclui os valores reais E as metas, p/ o tracejado da meta caber
  // sempre dentro da barra (real e meta na mesma régua → dá pra ver o quanto faltou/passou).
  const max = Math.max(av, bv, planA ?? 0, planB ?? 0);
  const pctA = max > 0 ? (av / max) * 100 : 0;
  const pctB = max > 0 ? (bv / max) * 100 : 0;
  const metaPctA = planA != null && planA > 0 && max > 0 ? (planA / max) * 100 : null;
  const metaPctB = planB != null && planB > 0 && max > 0 ? (planB / max) * 100 : null;
  const fav = favOf(def.dir, a, b);
  // Vencedor: para "higher" o maior valor; para "lower" o menor (só quando diferentes);
  // "neutral" nunca tem vencedor.
  let winnerA = false;
  let winnerB = false;
  if (def.dir !== "neutral" && av !== bv) {
    const bWins = def.dir === "higher" ? bv > av : bv < av;
    winnerB = bWins;
    winnerA = !bWins;
  }
  return (
    <div className="py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{def.label}</span>
        <DeltaBadge fav={fav} a={a} b={b} dir={def.dir} />
      </div>
      <div className="space-y-1.5">
        <PeriodBar color="a" label={labelA} value={def.fmt(a)} pct={pctA} metaPct={metaPctA} winner={winnerA} dir={def.dir} real={a} plan={planA} fmt={def.fmt} />
        <PeriodBar color="b" label={labelB} value={def.fmt(b)} pct={pctB} metaPct={metaPctB} winner={winnerB} dir={def.dir} real={b} plan={planB} fmt={def.fmt} />
      </div>
    </div>
  );
}

// Especificação de UM lado da comparação: um recorte de clientes sobre uma janela de datas.
// - clientFilter: slug único (ou "all"); clientList: conjunto de slugs (coortes de
//   especialidade/maturidade — aí clientFilter="all" e o hook filtra pela lista). from/to em
//   yyyy-MM-dd. metaSlug/metaScope/period*: alimentam o planejado rateado (só faz sentido p/
//   cliente único; em coortes/"all" o resolveMeta devolve nulos e os selos de meta viram "—").
export interface CohortSpec {
  label: string;
  clientFilter: string;
  clientList?: string[];
  from: string;
  to: string;
  periodFrom?: Date;
  periodTo?: Date;
  metaSlug: string;
  metaScope: string;
}

// Busca os totais de UM lado reusando exatamente o pipeline da página (ads canonicalizados via
// canonicalMap → externalAdsRows do CRM). Isolado num hook p/ ser chamado 2× (lado A e B) em
// ordem fixa — os dois lados podem ser recortes diferentes (cliente/coorte) e/ou datas diferentes.
function useSideRow(
  spec: CohortSpec,
  origemFilter?: string[],
  medicoFilter?: string[],
  procedimentoFilter?: string[],
  adsScopeNames?: string[],
): { row: CRMCompareRow; loading: boolean } {
  const { data: adsData, canonicalMap, loading: adsLoading } = useClientesData(spec.from, spec.to, adsScopeNames);
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
    [adsData, canonicalMap]
  );
  const { totals, orcamentoParado, loading: crmLoading } = useCRMClienteData(
    spec.clientFilter,
    spec.from,
    spec.to,
    origemFilter,
    medicoFilter,
    adsRows,
    spec.clientList,
    procedimentoFilter
  );
  const row: CRMCompareRow = useMemo(
    () => ({ ...totals, orcamentoCount: orcamentoParado.count, orcamentoValor: orcamentoParado.valor }),
    [totals, orcamentoParado]
  );
  return { row, loading: adsLoading || crmLoading };
}

export function CRMComparacao({
  cohortA,
  cohortB,
  origemFilter,
  medicoFilter,
  procedimentoFilter,
  adsScopeNames,
}: {
  /** Lado A e lado B da comparação (período, cliente, especialidade ou maturidade). */
  cohortA: CohortSpec;
  cohortB: CohortSpec;
  origemFilter?: string[];
  medicoFilter?: string[];
  procedimentoFilter?: string[];
  adsScopeNames?: string[];
}) {
  const labelA = cohortA.label;
  const labelB = cohortB.label;

  // Ordem FIXA de hooks: lado A, depois lado B. Quando os dois lados compartilham a janela de
  // datas (coorte/cliente), o fetch de ads é o mesmo e o dedupedFetch reaproveita a resposta.
  const { row: rowA, loading: loadingA } = useSideRow(cohortA, origemFilter, medicoFilter, procedimentoFilter, adsScopeNames);
  const { row: rowB, loading: loadingB } = useSideRow(cohortB, origemFilter, medicoFilter, procedimentoFilter, adsScopeNames);

  // Planejado (rateado) de cada lado — mesma fonte da tela (clientes_meta). Em coortes/"all" o
  // resolveMeta devolve nulos, então os selos de meta aparecem como "—" (sem somar metas de vários).
  const { resolveMeta, loading: metasLoading } = useClientesMetas();
  const metaA: MetaValues = useMemo(
    () => resolveMeta(cohortA.metaSlug, cohortA.periodFrom, cohortA.periodTo, cohortA.metaScope),
    [resolveMeta, cohortA.metaSlug, cohortA.periodFrom, cohortA.periodTo, cohortA.metaScope]
  );
  const metaB: MetaValues = useMemo(
    () => resolveMeta(cohortB.metaSlug, cohortB.periodFrom, cohortB.periodTo, cohortB.metaScope),
    [resolveMeta, cohortB.metaSlug, cohortB.periodFrom, cohortB.periodTo, cohortB.metaScope]
  );

  const loading = loadingA || loadingB || metasLoading;

  const planOf = (m: MetaValues, def: MetricDef): number | null => (def.metaKey ? m[def.metaKey].value : null);

  // Placar geral: em quantos indicadores (com direção) cada período está melhor.
  const score = useMemo(() => {
    let aWins = 0;
    let bWins = 0;
    for (const m of METRICS) {
      if (m.dir === "neutral") continue;
      const fav = favOf(m.dir, m.get(rowA), m.get(rowB));
      if (fav === "good") bWins++;
      else if (fav === "bad") aWins++;
    }
    return { aWins, bWins };
  }, [rowA, rowB]);

  // Placar de metas: quantos indicadores bateram a meta em cada período (de quantos com meta).
  const metaScoreOf = (t: CRMCompareRow, m: MetaValues) => {
    let hits = 0;
    let goals = 0;
    for (const def of METRICS) {
      const plan = planOf(m, def);
      const hit = attainHit(def.dir, def.get(t), plan);
      if (hit == null) continue;
      goals++;
      if (hit) hits++;
    }
    return { hits, goals };
  };
  const metaScoreA = useMemo(() => metaScoreOf(rowA, metaA), [rowA, metaA]);
  const metaScoreB = useMemo(() => metaScoreOf(rowB, metaB), [rowB, metaB]);

  return (
    <div className="space-y-3">
      <SectionLabel>Comparação</SectionLabel>
      <div className="neu-card overflow-hidden rounded-2xl">
        {/* Cabeçalho: legenda dos dois períodos + placar geral + metas batidas de cada período */}
        <div className="flex flex-col gap-3 border-b border-border bg-secondary/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4 text-primary" />
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                <span className="h-2 w-2 rounded-full bg-primary" />
                {labelA}
              </span>
              <span className="text-[11px] font-medium text-muted-foreground">vs</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-2.5 py-1 text-xs font-semibold text-violet-600 dark:text-violet-400">
                <span className="h-2 w-2 rounded-full bg-violet-500" />
                {labelB}
              </span>
            </div>
          </div>
          {!loading && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {(metaScoreA.goals > 0 || metaScoreB.goals > 0) && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 font-medium text-muted-foreground">
                  Metas batidas —{" "}
                  <span className="font-semibold text-primary">{labelA}: {metaScoreA.hits}/{metaScoreA.goals}</span>
                  <span className="opacity-50">·</span>
                  <span className="font-semibold text-violet-600 dark:text-violet-400">{labelB}: {metaScoreB.hits}/{metaScoreB.goals}</span>
                </span>
              )}
              {score.bWins > score.aWins ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-3 py-1 font-semibold text-violet-600 dark:text-violet-400">
                  <Trophy className="h-3.5 w-3.5" />
                  {labelB} melhor em {score.bWins} de {score.aWins + score.bWins}
                </span>
              ) : score.aWins > score.bWins ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 font-semibold text-primary">
                  <Trophy className="h-3.5 w-3.5" />
                  {labelA} melhor em {score.aWins} de {score.aWins + score.bWins}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 font-semibold text-muted-foreground">
                  Empate técnico
                </span>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton-loading h-12 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="p-4">
            {/* Legenda: deixa claro o que é o valor real (barra cheia) e o que é a meta
                (tracejado), além do selo de atingimento. */}
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border/60 pb-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-6 rounded-sm bg-primary/70" />
                Realizado (barra cheia)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3.5 w-0 border-l-2 border-dashed border-foreground/70" />
                Meta (tracejado)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-flex items-center justify-center rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">%</span>
                quanto bateu da meta
                <span className="text-muted-foreground/60">(verde bateu · âmbar não)</span>
              </span>
            </div>
            <div className="grid grid-cols-1 gap-x-8 gap-y-1 lg:grid-cols-2">
              {GROUP_ORDER.map((group) => (
                <div key={group} className="min-w-0">
                  <p className="mb-1 mt-2 border-b border-border/60 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/80">
                    {group}
                  </p>
                  <div className="divide-y divide-border/40">
                    {METRICS.filter((m) => m.group === group).map((m) => (
                      <MetricRow
                        key={m.key}
                        def={m}
                        a={m.get(rowA)}
                        b={m.get(rowB)}
                        labelA={labelA}
                        labelB={labelB}
                        planA={planOf(metaA, m)}
                        planB={planOf(metaB, m)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
