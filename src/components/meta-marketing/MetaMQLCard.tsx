import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Line, ComposedChart } from "recharts";
import { BarChart3, Grid3X3, Maximize2 } from "lucide-react";

const sourceFilters = ["Geral", "Paid Media", "Social", "Nina", "Site", "Eventos", "Lifecycle", "Outros"];
const sourceColors: Record<string, string> = {
  "Paid Media": "hsl(var(--primary))",
  Social: "hsl(160, 60%, 55%)",
  Nina: "#a78bfa",
  Site: "#38bdf8",
  Eventos: "#f87171",
  Lifecycle: "#818cf8",
  Outros: "#94a3b8",
};

const dailyData = Array.from({ length: 24 }, (_, i) => {
  const day = i + 1;
  return {
    name: `${day}/Mar`,
    "Paid Media": Math.floor(150 + Math.random() * 250),
    Social: Math.floor(80 + Math.random() * 150),
    Nina: Math.floor(20 + Math.random() * 60),
    Site: Math.floor(30 + Math.random() * 80),
    Eventos: Math.floor(10 + Math.random() * 40),
    Lifecycle: Math.floor(10 + Math.random() * 30),
    Outros: Math.floor(5 + Math.random() * 20),
    "Meta Diária": 420,
  };
});

export function MetaMQLCard() {
  const [activeFilter, setActiveFilter] = useState("Geral");

  return (
    <div className="neu-card rounded-xl p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20">
            <BarChart3 className="h-5 w-5 text-primary" />
          </div>
          <span className="text-base font-bold text-foreground">Meta de MQL</span>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {sourceFilters.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`px-2.5 py-1 text-[10px] rounded-full font-medium transition-colors ${
                activeFilter === f
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f !== "Geral" && (
                <span
                  className="inline-block h-2 w-2 rounded-full mr-1"
                  style={{ backgroundColor: sourceColors[f] || "#94a3b8" }}
                />
              )}
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Big number */}
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold text-foreground">11.102</span>
          <span className="text-sm text-muted-foreground">/ 25.267</span>
        </div>
        <div className="mt-2 h-2 w-full rounded-full bg-secondary overflow-hidden">
          <div className="h-full rounded-full bg-red-500" style={{ width: "43.9%" }} />
        </div>
        <div className="flex items-center justify-between mt-2">
          <div>
            <span className="text-lg font-bold text-red-600 dark:text-red-400">56,8%</span>
            <p className="text-[10px] text-muted-foreground">Ritmo MTD</p>
          </div>
          <div className="text-center">
            <span className="text-lg font-bold text-foreground">19.562</span>
            <p className="text-[10px] text-muted-foreground">Meta MTD</p>
          </div>
          <div className="text-right">
            <span className="text-lg font-bold text-foreground">43,9%</span>
            <p className="text-[10px] text-muted-foreground">da Meta</p>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-foreground">MQLs Diários por Fonte</span>
          <div className="flex items-center gap-1">
            <button className="p-1.5 rounded bg-secondary text-muted-foreground hover:text-foreground">
              <BarChart3 className="h-3.5 w-3.5" />
            </button>
            <button className="p-1.5 rounded bg-secondary text-muted-foreground hover:text-foreground">
              <Grid3X3 className="h-3.5 w-3.5" />
            </button>
            <button className="p-1.5 rounded bg-secondary text-muted-foreground hover:text-foreground">
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dailyData} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 11,
                }}
              />
              {Object.entries(sourceColors).map(([key, color]) => (
                <Bar key={key} dataKey={key} stackId="a" fill={color} radius={key === "Outros" ? [2, 2, 0, 0] : [0, 0, 0, 0]} />
              ))}
              <Line type="monotone" dataKey="Meta Diária" stroke="#94a3b8" strokeDasharray="5 5" dot={false} strokeWidth={1.5} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-center gap-4 mt-3">
          {Object.entries(sourceColors).map(([key, color]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-[10px] text-muted-foreground">{key}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span className="h-px w-4 border-t border-dashed border-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">Meta Diária</span>
          </div>
        </div>
      </div>
    </div>
  );
}
