import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Users, MapPin } from "lucide-react";
import { useState } from "react";

const platformData = [
  { name: "Instagram", Homens: 3500, Mulheres: 2800 },
  { name: "Facebook", Homens: 2200, Mulheres: 1800 },
  { name: "TikTok", Homens: 1200, Mulheres: 900 },
  { name: "Messenger", Homens: 400, Mulheres: 300 },
  { name: "Aud. Net.", Homens: 200, Mulheres: 100 },
];

const ageData = [
  { name: "18-24", Homens: 1200, Mulheres: 900 },
  { name: "25-34", Homens: 3800, Mulheres: 2900 },
  { name: "35-44", Homens: 2500, Mulheres: 2100 },
  { name: "45-54", Homens: 1800, Mulheres: 1400 },
  { name: "55-64", Homens: 800, Mulheres: 600 },
  { name: "65+", Homens: 300, Mulheres: 200 },
];

const topStates = [
  { state: "SP", value: "754", pct: 32 },
  { state: "MG", value: "421", pct: 18 },
  { state: "RJ", value: "312", pct: 13 },
  { state: "PR", value: "198", pct: 8 },
  { state: "RS", value: "167", pct: 7 },
];

const viewTabs = ["Geral", "Meta", "Google", "TikTok", "Anúncios"];

export function PaidMediaAudiencia() {
  const [view, setView] = useState("Geral");

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold text-foreground">Análise de Audiência</span>
        </div>
        <div className="flex items-center gap-1">
          {viewTabs.map((t) => (
            <button
              key={t}
              onClick={() => setView(t)}
              className={`px-2.5 py-1 text-[10px] rounded font-medium transition-colors ${
                view === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Date bar */}
      <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 text-xs">
        <span className="text-primary font-medium">📅 Último dia: 22 de Mar 2026</span>
        <span className="ml-auto text-muted-foreground">⬇ Download</span>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Platform distribution */}
        <div className="neu-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-foreground">📊 Pads marketing por plataforma</span>
            <div className="ml-auto flex items-center gap-1">
              {["Alcance", "Imp."].map((f, i) => (
                <button key={f} className={`px-2 py-0.5 text-[9px] rounded font-medium ${i === 0 ? "bg-primary/20 text-primary" : "text-muted-foreground"}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={platformData} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 10 }} />
                <Bar dataKey="Homens" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} barSize={14} />
                <Bar dataKey="Mulheres" fill="#a78bfa" radius={[2, 2, 0, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Age distribution */}
        <div className="neu-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-foreground">📊 Distribuição por generalidade</span>
            <span className="ml-auto text-[9px] text-muted-foreground">Imp. est.</span>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ageData} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 10 }} />
                <Bar dataKey="Homens" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} barSize={14} />
                <Bar dataKey="Mulheres" fill="#a78bfa" radius={[2, 2, 0, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" />
          <div>
            <span className="font-medium text-foreground">Homens</span>
            <p className="text-[9px]">27.512.521 · Custo médio: R$0,11 · % do gasto total: 64,8%</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-purple-400" />
          <div>
            <span className="font-medium text-foreground">Mulheres</span>
            <p className="text-[9px]">20.947.223 · Custo médio: R$0,14 · % do gasto total: 35,2%</p>
          </div>
        </div>
      </div>

      {/* MQL por Estado */}
      <div className="neu-card rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold text-foreground">MQL por Estado</span>
          </div>
          <div className="flex items-center gap-1">
            <button className="px-2.5 py-1 text-[10px] rounded bg-primary text-primary-foreground font-medium">Brasil</button>
            {["▼", "▲", "🗺️ Estados ↓"].map((b) => (
              <button key={b} className="px-2 py-1 text-[10px] rounded text-muted-foreground hover:bg-secondary border border-border/50">{b}</button>
            ))}
          </div>
        </div>

        {/* Simplified Brazil map representation */}
        <div className="flex items-center justify-center py-8">
          <div className="relative w-48 h-56">
            {/* SVG-like brazil silhouette using colored blocks */}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
              {Array.from({ length: 8 }, (_, row) => (
                <div key={row} className="flex gap-1">
                  {Array.from({ length: Math.max(3, 7 - Math.abs(row - 3)) }, (_, col) => {
                    const intensity = Math.random();
                    const bg = intensity > 0.7 ? "bg-primary" : intensity > 0.4 ? "bg-primary/60" : "bg-primary/30";
                    return <div key={col} className={`h-5 w-5 rounded ${bg}`} />;
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Color legend */}
        <div className="flex items-center justify-center gap-2 text-[9px] text-muted-foreground">
          {["bg-primary/20", "bg-primary/40", "bg-primary/60", "bg-primary/80", "bg-primary"].map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className={`h-3 w-6 rounded ${c}`} />
            </div>
          ))}
        </div>

        {/* Top 5 States */}
        <div>
          <span className="text-[10px] text-muted-foreground font-semibold">Top 5 Estados</span>
          <div className="grid grid-cols-5 gap-3 mt-2">
            {topStates.map((s) => (
              <div key={s.state} className="text-center p-2 rounded-lg bg-secondary/30 border border-border/30">
                <span className="text-sm font-bold text-foreground">{s.state}</span>
                <p className="text-xs text-muted-foreground">{s.value}</p>
                <p className="text-[9px] text-primary">{s.pct}%</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Acompanhamento de Otimização */}
      <div className="neu-card rounded-xl p-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground">⚡ Acompanhamento de Otimização (+11)</span>
          <svg className="h-3 w-3 text-muted-foreground ml-auto" viewBox="0 0 12 12" fill="none"><path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
      </div>
    </div>
  );
}
