import { useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart } from "recharts";
import { PieChart, Pie, Cell } from "recharts";

interface ChannelData {
  name: string;
  date: string;
  realizado: string;
  meta: string;
  percent: string;
  percentColor: string;
  mtd: string;
  mtdColor: string;
  chartData: { day: string; Realizado: number; "Meta MTD": number }[];
  platforms: { name: string; value: number; color: string }[];
  totalViews: string;
  status?: string;
  statusColor?: string;
}

const channels: ChannelData[] = [
  {
    name: "Rafael Mendonça",
    date: "Março/2026",
    realizado: "1.8M",
    meta: "5.9M",
    percent: "31,1%",
    percentColor: "text-red-600 dark:text-red-400",
    mtd: "40,2%",
    mtdColor: "text-red-600 dark:text-red-400",
    status: "Crítico",
    statusColor: "bg-red-500/20 text-red-600 dark:text-red-400",
    chartData: Array.from({ length: 31 }, (_, i) => ({
      day: String(i + 1).padStart(2, "0"),
      Realizado: Math.floor(50000 + i * 40000 + Math.random() * 20000),
      "Meta MTD": Math.floor(190000 * ((i + 1) / 31)),
    })),
    platforms: [{ name: "Instagram", value: 100, color: "#ec4899" }],
    totalViews: "1.8M",
  },
  {
    name: "Viver de IA",
    date: "Março/2026",
    realizado: "1.1M",
    meta: "3.8M",
    percent: "27,9%",
    percentColor: "text-red-600 dark:text-red-400",
    mtd: "36,1%",
    mtdColor: "text-red-600 dark:text-red-400",
    status: "Crítico",
    statusColor: "bg-red-500/20 text-red-600 dark:text-red-400",
    chartData: Array.from({ length: 31 }, (_, i) => ({
      day: String(i + 1).padStart(2, "0"),
      Realizado: Math.floor(30000 + i * 25000 + Math.random() * 15000),
      "Meta MTD": Math.floor(120000 * ((i + 1) / 31)),
    })),
    platforms: [
      { name: "YouTube", value: 5, color: "#f87171" },
      { name: "Instagram", value: 95, color: "#ec4899" },
    ],
    totalViews: "1.1M",
  },
  {
    name: "Yago Matos",
    date: "Março/2026",
    realizado: "1.1M",
    meta: "1.2M",
    percent: "81%",
    percentColor: "text-primary",
    mtd: "104,7%",
    mtdColor: "text-primary",
    status: "No Ritmo",
    statusColor: "bg-primary/20 text-primary",
    chartData: Array.from({ length: 31 }, (_, i) => ({
      day: String(i + 1).padStart(2, "0"),
      Realizado: Math.floor(20000 + i * 35000 + Math.random() * 10000),
      "Meta MTD": Math.floor(40000 * ((i + 1) / 31)),
    })),
    platforms: [{ name: "Instagram", value: 100, color: "#ec4899" }],
    totalViews: "1.1M",
  },
];

function ChannelCard({ channel }: { channel: ChannelData }) {
  const [mode] = useState<"Views" | "MQL">("Views");
  const [view] = useState<"Acumulado" | "Diário">("Acumulado");

  return (
    <div className="neu-card rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-foreground">{channel.name}</span>
          <span className="text-[10px] text-muted-foreground">{channel.date}</span>
          <div className="flex items-center gap-1">
            <button className="px-2 py-0.5 text-[10px] rounded-full bg-primary text-primary-foreground font-medium">
              ⊙ Views
            </button>
            <button className="px-2 py-0.5 text-[10px] rounded-full text-muted-foreground font-medium">
              ⊙ MQL
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button className="px-2 py-0.5 text-[10px] rounded-full bg-primary text-primary-foreground font-medium">
              📈 Acumulado
            </button>
            <button className="px-2 py-0.5 text-[10px] rounded-full text-muted-foreground font-medium">
              📊 Diário
            </button>
          </div>
        </div>
        {channel.status && (
          <span className={`px-2.5 py-1 text-[10px] rounded-md font-medium ${channel.statusColor}`}>
            {channel.status}
          </span>
        )}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs">
        <span className="text-muted-foreground">
          ⊙ Realizado: <span className="text-foreground font-semibold">{channel.realizado}</span> / {channel.meta}
        </span>
        <span className={channel.percentColor + " font-bold"}>{channel.percent}</span>
        <span className="text-muted-foreground">
          MTD: <span className={channel.mtdColor + " font-bold"}>{channel.mtd}</span>
        </span>
      </div>

      {/* Chart + Donut */}
      <div className="grid grid-cols-[1fr_220px] gap-6">
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={channel.chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="day" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 11,
                }}
              />
              <Area type="monotone" dataKey="Realizado" fill="hsl(160, 60%, 45%)" fillOpacity={0.15} stroke="hsl(160, 60%, 45%)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Meta MTD" stroke="#94a3b8" strokeDasharray="5 5" dot={false} strokeWidth={1.5} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex items-center justify-center gap-4 mt-1">
            <div className="flex items-center gap-1.5">
              <span className="h-px w-4 border-t-2 border-primary" />
              <span className="text-[10px] text-muted-foreground">Realizado</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-px w-4 border-t border-dashed border-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">Meta MTD</span>
            </div>
          </div>
        </div>

        {/* Donut */}
        <div className="flex flex-col items-center justify-center">
          <p className="text-xs text-muted-foreground mb-2">Distribuição por Plataforma</p>
          <div className="relative h-32 w-32">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={channel.platforms}
                  cx="50%"
                  cy="50%"
                  innerRadius={35}
                  outerRadius={55}
                  dataKey="value"
                  stroke="none"
                >
                  {channel.platforms.map((p, i) => (
                    <Cell key={i} fill={p.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap justify-center">
            {channel.platforms.map((p) => (
              <div key={p.name} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                <span className="text-[10px] text-muted-foreground">{p.name} {p.value}%</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">TOTAL VIEWS</p>
          <p className="text-sm font-bold text-foreground">{channel.totalViews}</p>
        </div>
      </div>
    </div>
  );
}

export function MetaEvolucaoCanal() {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Evolução por Canal</h3>
      {channels.map((ch) => (
        <ChannelCard key={ch.name} channel={ch} />
      ))}
    </div>
  );
}
