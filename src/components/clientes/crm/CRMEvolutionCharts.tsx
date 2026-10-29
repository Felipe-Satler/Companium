import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Maximize2 } from "lucide-react";
import { CRMMonthlyEvolution } from "@/utils/crmCalculations";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// Unidade de cada gráfico → formatação dos rótulos/eixo/tooltip. Segue a regra do usuário:
// NUNCA abreviar ("Mil"/"Mi"), sempre o valor inteiro completo (pt-BR).
type ValueKind = "count" | "currency" | "ratio";
function makeFmt(kind: ValueKind): (v: number) => string {
  if (kind === "currency") {
    return (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  }
  if (kind === "ratio") {
    return (v) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;
  }
  return (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

// Evolução mensal + meta de cada série (rateada por mês p/ absolutos, constante p/ taxas)
// injetada pela página CRM. A meta é opcional (null = sem cadastro): investimento, leads,
// faturamento, roas, cpl, consultas e procedimentos têm coluna de meta em clientes_meta.
export interface CRMEvolutionRow extends CRMMonthlyEvolution {
  metaLeads?: number | null;
  metaConsultasAgendadas?: number | null;
  metaConsultasRealizadas?: number | null;
  metaProcedimentosAgendados?: number | null;
  metaProcedimentosRealizados?: number | null;
  metaInvestimento?: number | null;
  metaFaturamento?: number | null;
  metaRoas?: number | null;
  metaCpl?: number | null;
}

interface BarSeries {
  key: keyof CRMMonthlyEvolution;
  label: string;
  color: string;
  /** Campo da meta (rateada por mês) correspondente a esta barra, se houver. */
  metaKey?: keyof CRMEvolutionRow;
}

interface ChartCardProps {
  title: string;
  data: CRMEvolutionRow[];
  bars: BarSeries[];
  /** Unidade das séries (formata rótulos/eixo/tooltip). Default: contagem inteira. */
  valueKind?: ValueKind;
}

// Nível da meta da série p/ a linha de referência: o alvo do período (máximo entre os
// meses exibidos — quando algum mês está cheio, é o alvo mensal inteiro). null = sem meta.
function metaLevel(data: CRMEvolutionRow[], metaKey?: keyof CRMEvolutionRow): number | null {
  if (!metaKey) return null;
  let max: number | null = null;
  for (const d of data) {
    const v = d[metaKey];
    if (v == null || !Number.isFinite(v)) continue;
    if (max == null || (v as number) > max) max = v as number;
  }
  return max;
}

// ── Tooltip: Real de cada série + Meta e % atingido, deixando claro perto/longe ──
interface TooltipEntry { payload?: CRMEvolutionRow }
function EvoTooltip({ active, payload, label, bars, fmt }: { active?: boolean; payload?: TooltipEntry[]; label?: string; bars: BarSeries[]; fmt: (v: number) => string }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div style={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12, padding: "8px 10px" }}>
      <p style={{ fontWeight: 600, marginBottom: 4 }}>{String(label ?? "").replace(/\n/g, " ")}</p>
      {bars.map((b) => {
        const val = Number(row[b.key] ?? 0);
        const meta = b.metaKey ? row[b.metaKey] : null;
        const hasMeta = meta != null && Number.isFinite(meta) && (meta as number) > 0;
        const pct = hasMeta ? Math.round((val / (meta as number)) * 100) : null;
        return (
          <div key={String(b.key)} style={{ display: "flex", alignItems: "center", gap: 6, lineHeight: "18px" }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 9999, backgroundColor: b.color }} />
            <span style={{ color: "hsl(var(--foreground))" }}>{b.label}:</span>
            <span style={{ fontWeight: 700, color: b.color }}>{fmt(val)}</span>
            {hasMeta && (
              <span style={{ color: "hsl(var(--muted-foreground))" }}>
                / meta {fmt(meta as number)} ({pct}%)
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Legenda (séries + metas) — reaproveitada no card e na visão expandida ──
function ChartLegend({ bars, metaLines, fmt }: { bars: BarSeries[]; metaLines: { b: BarSeries; level: number }[]; fmt: (v: number) => string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
      {bars.map((b) => (
        <span key={b.key as string} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.color }} />
          {b.label}
        </span>
      ))}
      {/* Nome + valor da meta na legenda (canto sup. esquerdo), fonte menor e na cor da
          série — fica FORA da área das barras, sem se misturar com os números delas. */}
      {metaLines.map(({ b, level }) => (
        <span key={b.metaKey as string} className="flex items-center gap-1 text-[10px] font-medium" style={{ color: b.color }}>
          <span className="h-0 w-3.5 border-t-2 border-dashed" style={{ borderColor: b.color }} />
          Meta {b.label}: {fmt(level)}
        </span>
      ))}
    </div>
  );
}

// ── Gráfico em si — o mesmo desenho tanto no card quanto na visão expandida; só muda a
//    altura do contêiner pai (ResponsiveContainer preenche 100%). ──
function ChartGraph({ data, bars, metaLines, fmt, valueKind, allTicks = false }: { data: CRMEvolutionRow[]; bars: BarSeries[]; metaLines: { b: BarSeries; level: number }[]; fmt: (v: number) => string; valueKind: ValueKind; allTicks?: boolean }) {
  // Barras agrupadas quando há mais de uma série; barra única segue igual ao Meta/Google Ads.
  const barSize = bars.length > 1 ? 18 : 26;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 24, right: 12, left: -6, bottom: 5 }} barGap={4}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
        {/* Expandido: força TODOS os meses no eixo (interval=0); no card, deixa o recharts
            esconder rótulos que se sobreporiam, mantendo a leitura limpa em pouco espaço. */}
        <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} interval={allTicks ? 0 : "preserveEnd"} />
        <YAxis
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={fmt}
          allowDecimals={valueKind === "ratio"}
          width={valueKind === "currency" ? 56 : undefined}
        />
        <Tooltip cursor={{ fill: "hsl(var(--muted-foreground))", opacity: 0.08 }} content={<EvoTooltip bars={bars} fmt={fmt} />} />
        {bars.map((b) => (
          <Bar
            key={b.key as string}
            dataKey={b.key as string}
            fill={b.color}
            radius={[4, 4, 0, 0]}
            barSize={barSize}
            isAnimationActive={false}
            label={{ position: "top", fontSize: bars.length > 1 ? 12 : 14, fontWeight: 600, fill: b.color, formatter: fmt }}
          />
        ))}
        {/* Linha da meta atravessando TODO o quadro, na altura do alvo (alinhada ao
            eixo Y). A barra "passa" a linha quando a meta é batida. O nome/valor fica
            na legenda (canto sup. esq.), então nada é desenhado sobre as barras.
            ifOverflow="extendDomain" garante que a linha caiba no gráfico. */}
        {metaLines.map(({ b, level }) => (
          <ReferenceLine
            key={b.metaKey as string}
            y={level}
            stroke={b.color}
            strokeWidth={2}
            strokeDasharray="6 4"
            ifOverflow="extendDomain"
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function ChartCard({ title, data, bars, valueKind = "count" }: ChartCardProps) {
  const fmt = makeFmt(valueKind);
  const [expanded, setExpanded] = useState(false);
  // Nível da meta por série (linha full-width). Só as séries que têm meta cadastrada.
  const metaLines = bars
    .map((b) => ({ b, level: metaLevel(data, b.metaKey) }))
    .filter((m): m is { b: BarSeries; level: number } => m.level != null);

  return (
    <>
      <div className="neu-card rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {/* Expandir p/ tela cheia — mais espaço p/ print quando há muitos meses. */}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            title="Expandir gráfico"
            aria-label="Expandir gráfico"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
        <ChartLegend bars={bars} metaLines={metaLines} fmt={fmt} />
        <div className="h-56">
          <ChartGraph data={data} bars={bars} metaLines={metaLines} fmt={fmt} valueKind={valueKind} />
        </div>
      </div>

      {/* Visão expandida: largura ~95vw e altura alta dão folga p/ o print, principalmente
          com muitos meses no eixo. Mesmo desenho do card (ChartGraph), só maior. */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-[95vw] w-[95vw]">
          <DialogTitle className="text-base font-semibold text-foreground">{title}</DialogTitle>
          <ChartLegend bars={bars} metaLines={metaLines} fmt={fmt} />
          <div className="h-[72vh]">
            <ChartGraph data={data} bars={bars} metaLines={metaLines} fmt={fmt} valueKind={valueKind} allTicks />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CRMEvolutionCharts({ data }: { data: CRMEvolutionRow[] }) {
  if (!data.length) return null;

  return (
    <div className="space-y-4">
      {/* Trio 1 (investimento, faturamento, roas) + Trio 2 (leads tráfego, leads CRM, CPL) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* ── Trio 1: Investimento · Faturamento · ROAS ── */}
        <ChartCard
          title="Evolução de Investimento"
          data={data}
          valueKind="currency"
          bars={[{ key: "investimento", label: "Investimento", color: "hsl(var(--primary))", metaKey: "metaInvestimento" }]}
        />
        <ChartCard
          title="Evolução de Faturamento"
          data={data}
          valueKind="currency"
          bars={[{ key: "faturamento", label: "Faturamento", color: "#34d399", metaKey: "metaFaturamento" }]}
        />
        <ChartCard
          title="Evolução de ROAS"
          data={data}
          valueKind="ratio"
          bars={[{ key: "roas", label: "ROAS", color: "#f59e0b", metaKey: "metaRoas" }]}
        />

        {/* ── Trio 2: Leads Tráfego · Leads CRM · CPL CRM ── */}
        <ChartCard
          title="Evolução de Leads Tráfego"
          data={data}
          bars={[{ key: "leadsTrafego", label: "Leads Tráfego", color: "#60a5fa" }]}
        />
        <ChartCard
          title="Evolução de Leads CRM"
          data={data}
          bars={[{ key: "leads", label: "Leads CRM", color: "hsl(var(--primary))", metaKey: "metaLeads" }]}
        />
        <ChartCard
          title="Evolução de CPL CRM"
          data={data}
          valueKind="currency"
          bars={[{ key: "cpl", label: "CPL CRM", color: "#818cf8", metaKey: "metaCpl" }]}
        />
      </div>

      {/* ── Dupla: Consultas · Procedimentos — ocupa a largura inteira (2 colunas iguais),
          sem sobrar espaço nas laterais. ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartCard
          title="Evolução de Consultas"
          data={data}
          bars={[
            { key: "consultasAgendadas", label: "Agendadas", color: "#60a5fa", metaKey: "metaConsultasAgendadas" },
            { key: "consultasRealizadas", label: "Realizadas", color: "hsl(var(--primary))", metaKey: "metaConsultasRealizadas" },
          ]}
        />
        <ChartCard
          title="Evolução de Procedimentos"
          data={data}
          bars={[
            { key: "procedimentosAgendados", label: "Agendados", color: "#f59e0b", metaKey: "metaProcedimentosAgendados" },
            { key: "procedimentosRealizados", label: "Realizados", color: "#34d399", metaKey: "metaProcedimentosRealizados" },
          ]}
        />
      </div>
    </div>
  );
}
