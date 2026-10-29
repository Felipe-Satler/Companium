import { Card } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Line, ComposedChart, ReferenceDot } from "recharts";
import { LucideIcon, Calendar } from "lucide-react";
import { useState } from "react";

interface PaceSectionProps {
  title: string;
  icon: LucideIcon;
  iconColor?: string;
  statusLabel: string;
  statusType: "danger" | "warning" | "success";
  meta: {
    metaValue: string;
    realizadoValue: string;
    realizadoPct: string;
    faltaValue: string;
  };
  performance: {
    esperadoHoje: string;
    faltanteMTD: string;
    faltanteColor?: string;
    progressoPct: number;
    progressoLabel: string;
  };
  ritmo: {
    paceAtual: string;
    necessario: string;
    diasRestantes: number;
  };
  chartData: Array<{ day: string; realizado: number | null; metaEsperada: number | null; projecao: number | null }>;
  chartYDomain?: [number, number];
  chartYFormatter?: (v: number) => string;
  loading?: boolean;
}

const statusColors = {
  danger: "bg-destructive/20 text-destructive",
  warning: "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400",
  success: "bg-primary/20 text-primary",
};

const statusIcons = {
  danger: "▼",
  warning: "⚠",
  success: "▲",
};

export function PaceSection({
  title, icon: Icon, iconColor = "text-primary", statusLabel, statusType,
  meta, performance, ritmo, chartData, chartYFormatter, loading,
}: PaceSectionProps) {
  const [view, setView] = useState<"diario" | "acumulado">("acumulado");

  if (loading) return <div className="h-[340px] rounded-xl skeleton-loading" />;

  const chartConfig = {
    realizado: { label: "Realizado", color: "hsl(var(--primary))" },
    metaEsperada: { label: "Meta Esperada", color: "hsl(var(--muted-foreground))" },
    projecao: { label: "Projeção", color: "hsl(var(--chart-line-forecast))" },
  };

  const yFmt = chartYFormatter || ((v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 }));

  // Find the last non-null realizado point for the reference dot
  const lastRealizadoIndex = [...chartData].reverse().findIndex(d => d.realizado !== null);
  const lastRealizadoPoint = lastRealizadoIndex >= 0 ? chartData[chartData.length - 1 - lastRealizadoIndex] : null;

  return (
    <Card className="neu-card p-5">
      {/* Section header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${iconColor}`} />
            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">{title}</h3>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setView("diario")}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                view === "diario" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Diário
            </button>
            <button
              onClick={() => setView("acumulado")}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                view === "acumulado" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Acumulado
            </button>
          </div>
        </div>
        <span className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md ${statusColors[statusType]}`}>
          {statusIcons[statusType]} {statusLabel}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
        {/* Left - Metrics */}
        <div className="space-y-4">
          {/* Meta do Período */}
          <Card className="neu-inset p-4 space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-primary" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Meta do Período</span>
            </div>
            <div className="flex items-center gap-6">
              <div>
                <p className="text-[10px] text-muted-foreground">Meta</p>
                <p className="text-lg font-bold text-foreground">{meta.metaValue}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Realizado</p>
                <p className="text-lg font-bold text-foreground">{meta.realizadoValue} <span className="text-xs font-normal text-muted-foreground">({meta.realizadoPct})</span></p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">Falta p/ Meta</span>
              <span className="text-sm font-bold text-destructive">{meta.faltaValue}</span>
            </div>
          </Card>

          {/* Performance MTD */}
          <Card className="neu-inset p-4 space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-chart-forecast" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Performance MTD</span>
            </div>
            <div className="flex items-center gap-6">
              <div>
                <p className="text-[10px] text-muted-foreground">Esperado Hoje</p>
                <p className="text-lg font-bold text-foreground">{performance.esperadoHoje}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Faltante MTD</p>
                <p className={`text-lg font-bold ${performance.faltanteColor || "text-destructive"}`}>{performance.faltanteMTD}</p>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">Progresso MTD</span>
                <span className="text-xs font-semibold text-primary">{performance.progressoLabel}</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(performance.progressoPct, 100)}%` }} />
              </div>
            </div>
          </Card>

          {/* Ritmo Diário */}
          <Card className="neu-inset p-4 space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-chart-forecast" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ritmo Diário</span>
            </div>
            <div className="flex items-center gap-6">
              <div>
                <p className="text-[10px] text-muted-foreground">PACE Atual</p>
                <p className="text-lg font-bold text-primary">{ritmo.paceAtual}<span className="text-xs font-normal text-muted-foreground">/dia</span></p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Necessário</p>
                <p className="text-lg font-bold text-destructive">{ritmo.necessario}<span className="text-xs font-normal text-muted-foreground">/dia</span></p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>{ritmo.diasRestantes} dias restantes</span>
            </div>
          </Card>
        </div>

        {/* Right - Chart */}
        <div>
          <ChartContainer config={chartConfig} className="h-[320px] w-full">
            <ComposedChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={yFmt} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area type="monotone" dataKey="realizado" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" strokeWidth={2} connectNulls={false} />
              <Line type="monotone" dataKey="metaEsperada" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="6 4" dot={false} connectNulls />
              <Line type="monotone" dataKey="projecao" stroke="hsl(var(--chart-line-forecast))" strokeWidth={1.5} strokeDasharray="6 4" dot={false} connectNulls={false} />
              {lastRealizadoPoint && (
                <ReferenceDot
                  x={lastRealizadoPoint.day}
                  y={lastRealizadoPoint.realizado!}
                  r={5}
                  fill="hsl(var(--primary))"
                  stroke="hsl(var(--background))"
                  strokeWidth={2}
                />
              )}
            </ComposedChart>
          </ChartContainer>
          <div className="flex items-center justify-center gap-5 mt-2">
            {Object.entries(chartConfig).map(([key, cfg]) => (
              <div key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: cfg.color }} />
                <span>{cfg.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
