import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  ComposedChart,
  Legend,
} from "recharts";

const dailyData = Array.from({ length: 24 }, (_, i) => {
  const day = i + 1;
  const date = `${String(day).padStart(2, "0")}/03`;
  const acumulado = Math.min(Math.round(day * 1.07), 26);
  const meta = Math.round((64 / 31) * day);
  return { date, cases: acumulado, meta };
});

const projectionData = Array.from({ length: 7 }, (_, i) => {
  const day = 25 + i;
  const date = `${String(day).padStart(2, "0")}/03`;
  const projected = Math.round(26 + (i + 1) * 0.3);
  const meta = Math.round((64 / 31) * day);
  return { date, projection: projected, meta };
});

const fullData = [
  ...dailyData.map((d) => ({ ...d, projection: undefined as number | undefined })),
  ...projectionData.map((d) => ({ ...d, cases: undefined as number | undefined })),
];

export function CasesEvolutionChart() {
  const [view, setView] = useState<"diario" | "acumulado">("acumulado");
  const [showMeta, setShowMeta] = useState(true);

  return (
    <div className="neu-card rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Evolução de Cases</h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-secondary/50 p-0.5">
            <button
              onClick={() => setView("diario")}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                view === "diario" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              Diário
            </button>
            <button
              onClick={() => setView("acumulado")}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                view === "acumulado" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              Acumulado
            </button>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <div
              className={`relative w-9 h-5 rounded-full transition-colors ${showMeta ? "bg-primary" : "bg-secondary"}`}
              onClick={() => setShowMeta(!showMeta)}
            >
              <div
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  showMeta ? "translate-x-4" : ""
                }`}
              />
            </div>
            <span className="text-xs text-muted-foreground">Meta</span>
          </label>
        </div>
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={fullData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis
              dataKey="date"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            />
            <Area
              type="monotone"
              dataKey="cases"
              stroke="hsl(var(--primary))"
              fill="hsl(var(--primary))"
              fillOpacity={0.3}
              strokeWidth={2}
              name="Cases Aprovados"
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="projection"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={1.5}
              strokeDasharray="5 5"
              dot={false}
              name="Projeção"
              connectNulls={false}
            />
            {showMeta && (
              <Line
                type="monotone"
                dataKey="meta"
                stroke="hsl(var(--muted-foreground))"
                strokeWidth={1.5}
                strokeDasharray="5 5"
                dot={false}
                name="PACE Meta"
              />
            )}
            <Legend
              iconType="circle"
              wrapperStyle={{ fontSize: "11px", color: "hsl(var(--muted-foreground))" }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
