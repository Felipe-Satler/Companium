import { useMemo } from "react";
import { ArrowDown, ArrowUp, GitCompareArrows, Minus, Target, Trophy } from "lucide-react";
import { SectionLabel } from "@/components/clientes/SectionLabel";
import { cn } from "@/lib/utils";

/**
 * PAINEL DE COMPARAÇÃO (apresentacional, reutilizável). Recebe DOIS conjuntos de totais já
 * calculados (A e B) + a definição das métricas e desenha, por indicador, os dois valores
 * lado a lado com barra proporcional, variação e selo do vencedor.
 *
 * É usado em três telas:
 *   - CRM / Meta Ads / Google Ads → variant "versus": A e B são dois PERÍODOS (real × real).
 *   - CRM → variant "attainment": A é o REAL e B é o PLANEJADO (meta); o badge mostra "quanto
 *     bateu" da meta (real ÷ planejado) e o selo "Meta batida" quando o alvo foi atingido.
 *
 * Não faz fetch — quem monta cada tela decide como obter os totais do lado B (buscando o
 * período B por conta própria ou passando o planejado já resolvido). Assim a lógica de
 * cálculo de cada tela não é duplicada aqui.
 */

// Direção de "melhora" de cada métrica.
export type Dir = "higher" | "lower" | "neutral";

export interface CompareMetricDef<T> {
  key: string;
  label: string;
  group: string;
  dir: Dir;
  get: (t: T) => number | null;
  fmt: (v: number | null) => string;
}

// "good" = B melhorou; "bad" = piorou; "neutral" = sem direção/sem mudança.
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

// Atingimento do alvo (real ÷ planejado). Para "lower" (ex.: CPL) o alvo é um TETO, então
// bater = ficar em ≤100%; para "higher" bater = chegar a ≥100%. Retorna null quando não há
// meta OU quando a métrica é "neutral" (informativa — ex.: investimento vs orçamento previsto):
// mostramos o % gasto do planejado, mas sem julgar "bateu/não bateu".
function attainmentHit(dir: Dir, real: number | null, plan: number | null): boolean | null {
  if (plan == null || plan === 0) return null;
  if (dir === "neutral") return null;
  const r = real ?? 0;
  const ratio = r / plan;
  if (dir === "lower") return ratio <= 1;
  return ratio >= 1;
}

// Barra proporcional de um lado (dot + rótulo + barra + valor + selo).
function SideBar({
  color,
  label,
  value,
  pct,
  badge,
}: {
  color: "a" | "b";
  label: string;
  value: string;
  pct: number;
  badge: React.ReactNode;
}) {
  const barColor = color === "a" ? "bg-primary" : "bg-violet-500";
  const dotColor = color === "a" ? "bg-primary" : "bg-violet-500";
  return (
    <div className="flex items-center gap-2">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", dotColor)} />
      <span className="w-24 shrink-0 truncate text-[11px] text-muted-foreground" title={label}>
        {label}
      </span>
      <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-secondary/50">
        <div
          className={cn("h-full rounded-md transition-all", barColor, badge ? "opacity-90" : "opacity-40")}
          style={{ width: `${Math.max(pct, value === "—" ? 0 : 2)}%` }}
        />
      </div>
      <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">{value}</span>
      <span className="w-20 shrink-0">{badge}</span>
    </div>
  );
}

function WinnerBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
      <Trophy className="h-2.5 w-2.5" />
      Melhor
    </span>
  );
}

function GoalBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
      <Target className="h-2.5 w-2.5" />
      Meta batida
    </span>
  );
}

// Badge de variação (variant "versus") — % de A→B, colorido pela direção.
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

// Badge de atingimento (variant "attainment") — real ÷ planejado em %, colorido por bateu/não.
function AttainmentBadge({ dir, real, plan }: { dir: Dir; real: number | null; plan: number | null }) {
  if (plan == null || plan === 0) {
    return (
      <span title="Sem meta cadastrada para o período" className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
        sem meta
      </span>
    );
  }
  const ratio = ((real ?? 0) / plan) * 100;
  const hit = attainmentHit(dir, real, plan);
  const tone =
    hit == null
      ? "bg-secondary text-muted-foreground"
      : hit
        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        : "bg-amber-500/10 text-amber-600 dark:text-amber-500";
  const title =
    dir === "neutral"
      ? "Realizado ÷ planejado (informativo — sem meta a bater/estourar)."
      : dir === "lower"
        ? "Realizado ÷ meta. Meta é um teto: ≤100% = dentro da meta."
        : "Realizado ÷ meta. ≥100% = meta atingida.";
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums", tone)}>
      {ratio.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
    </span>
  );
}

function MetricRow<T>({
  def,
  a,
  b,
  labelA,
  labelB,
  variant,
}: {
  def: CompareMetricDef<T>;
  a: number | null;
  b: number | null;
  labelA: string;
  labelB: string;
  variant: "versus" | "attainment";
}) {
  const av = a ?? 0;
  const bv = b ?? 0;
  const max = Math.max(av, bv);
  const pctA = max > 0 ? (av / max) * 100 : 0;
  const pctB = max > 0 ? (bv / max) * 100 : 0;

  let badgeA: React.ReactNode = null;
  let badgeB: React.ReactNode = null;
  let topBadge: React.ReactNode = null;

  if (variant === "attainment") {
    // A = real, B = planejado. O badge de linha mostra o atingimento; o selo "Meta batida"
    // fica no lado do REAL (A) quando o alvo foi cumprido.
    const hit = attainmentHit(def.dir, a, b);
    if (hit) badgeA = <GoalBadge />;
    topBadge = <AttainmentBadge dir={def.dir} real={a} plan={b} />;
  } else {
    const fav = favOf(def.dir, a, b);
    // Vencedor: "higher" → maior valor; "lower" → menor (só quando diferentes); "neutral" nunca.
    if (def.dir !== "neutral" && av !== bv) {
      const bWins = def.dir === "higher" ? bv > av : bv < av;
      if (bWins) badgeB = <WinnerBadge />;
      else badgeA = <WinnerBadge />;
    }
    topBadge = <DeltaBadge fav={fav} a={a} b={b} dir={def.dir} />;
  }

  return (
    <div className="py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{def.label}</span>
        {topBadge}
      </div>
      <div className="space-y-1.5">
        <SideBar color="a" label={labelA} value={def.fmt(a)} pct={pctA} badge={badgeA} />
        <SideBar color="b" label={labelB} value={def.fmt(b)} pct={pctB} badge={badgeB} />
      </div>
    </div>
  );
}

export function ComparacaoPanel<T>({
  title = "Comparação de períodos",
  metrics,
  groupOrder,
  totalsA,
  totalsB,
  labelA,
  labelB,
  loading,
  variant = "versus",
}: {
  title?: string;
  metrics: CompareMetricDef<T>[];
  groupOrder: string[];
  totalsA: T;
  totalsB: T | null;
  labelA: string;
  labelB: string;
  loading: boolean;
  variant?: "versus" | "attainment";
}) {
  // Placar geral. "versus": em quantos indicadores (com direção) cada lado está melhor.
  // "attainment": quantas metas foram batidas (de quantas cadastradas).
  const score = useMemo(() => {
    let aWins = 0;
    let bWins = 0;
    let hits = 0;
    let goals = 0;
    if (totalsB) {
      for (const m of metrics) {
        const a = m.get(totalsA);
        const b = m.get(totalsB);
        if (variant === "attainment") {
          const hit = attainmentHit(m.dir, a, b);
          if (hit == null) continue;
          goals++;
          if (hit) hits++;
        } else {
          if (m.dir === "neutral") continue;
          const fav = favOf(m.dir, a, b);
          if (fav === "good") bWins++;
          else if (fav === "bad") aWins++;
        }
      }
    }
    return { aWins, bWins, hits, goals };
  }, [totalsA, totalsB, metrics, variant]);

  const isAttain = variant === "attainment";

  return (
    <div className="space-y-3">
      <SectionLabel>{title}</SectionLabel>
      <div className="neu-card overflow-hidden rounded-2xl">
        {/* Cabeçalho: legenda dos dois lados + placar geral */}
        <div className="flex flex-col gap-3 border-b border-border bg-secondary/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            {isAttain ? <Target className="h-4 w-4 text-primary" /> : <GitCompareArrows className="h-4 w-4 text-primary" />}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                <span className="h-2 w-2 rounded-full bg-primary" />
                {labelA}
              </span>
              <span className="text-[11px] font-medium text-muted-foreground">{isAttain ? "×" : "vs"}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-2.5 py-1 text-xs font-semibold text-violet-600 dark:text-violet-400">
                <span className="h-2 w-2 rounded-full bg-violet-500" />
                {labelB}
              </span>
            </div>
          </div>
          {!loading && totalsB && (
            <div className="flex items-center gap-2 text-xs">
              {isAttain ? (
                score.goals === 0 ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 font-semibold text-muted-foreground">
                    Nenhuma meta cadastrada
                  </span>
                ) : (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold",
                      score.hits >= score.goals - score.hits
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "bg-amber-500/10 text-amber-600 dark:text-amber-500",
                    )}
                  >
                    <Target className="h-3.5 w-3.5" />
                    {score.hits} de {score.goals} metas batidas
                  </span>
                )
              ) : score.bWins > score.aWins ? (
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

        {loading || !totalsB ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton-loading h-12 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-8 gap-y-1 p-4 lg:grid-cols-2">
            {groupOrder.map((group) => {
              const inGroup = metrics.filter((m) => m.group === group);
              if (inGroup.length === 0) return null;
              return (
                <div key={group} className="min-w-0">
                  <p className="mb-1 mt-2 border-b border-border/60 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/80">
                    {group}
                  </p>
                  <div className="divide-y divide-border/40">
                    {inGroup.map((m) => (
                      <MetricRow
                        key={m.key}
                        def={m}
                        a={m.get(totalsA)}
                        b={totalsB ? m.get(totalsB) : null}
                        labelA={labelA}
                        labelB={labelB}
                        variant={variant}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Formatadores compartilhados (pt-BR) usados nas defs de métrica das telas.
export function fmtInt(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
export function fmtCurrency(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
export function fmtRoas(v: number | null): string {
  if (v == null) return "—";
  return `${v.toFixed(2).replace(".", ",")}x`;
}
