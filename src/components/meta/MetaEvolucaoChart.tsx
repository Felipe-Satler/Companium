import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { mesLabel } from "@/lib/metaDatas";
import { type CaptacaoMetaRow, valorDe } from "@/hooks/useCaptacaoMetas";
import { SERIES, fmtValor, type MetaSerie } from "./metaIndicadores";

const PRIMEIRA_SERIE: MetaSerie = SERIES[0]!;

export function MetaEvolucaoChart({ rows }: { rows: CaptacaoMetaRow[] }) {
  const [serieId, setSerieId] = React.useState<string>("agendamentos:total");
  const serie = SERIES.find((s) => s.id === serieId) ?? PRIMEIRA_SERIE;

  const data = React.useMemo(
    () =>
      rows.map((r) => {
        const plan = valorDe(r, serie.key, "plan", serie.variante);
        const real = valorDe(r, serie.key, "real", serie.variante);
        return {
          mes: mesLabel(r.mes),
          Real: real,
          Planejado: plan,
          Atingimento: plan > 0 ? Number(((real / plan) * 100).toFixed(1)) : 0,
        };
      }),
    [rows, serie]
  );

  const tooltipStyle = {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    fontSize: "12px",
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="neu-card rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">Evolução — Real x Planejado</h3>
          <SearchableSelect
            value={serieId}
            onValueChange={setSerieId}
            options={SERIES.map((s) => ({ value: s.id, label: s.label }))}
            allOption={null}
            placeholder="Indicador"
            searchPlaceholder="Buscar indicador..."
            triggerClassName="w-[220px]"
          />
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis
                dataKey="mes"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number) => fmtValor(v, serie.tipo)}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: "11px" }} />
              <Line
                type="monotone"
                dataKey="Real"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="Planejado"
                stroke="#60a5fa"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="neu-card rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">
          Atingimento da meta por mês — {serie.label}
        </h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis
                dataKey="mes"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v}%`} />
              <Bar dataKey="Atingimento" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
