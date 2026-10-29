import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer, Legend } from "recharts";
import { Target } from "lucide-react";

const data = [
  { subject: "Alcance", A: 80, B: 65, C: 40 },
  { subject: "Interações", A: 50, B: 75, C: 60 },
  { subject: "Engajamento", A: 70, B: 55, C: 80 },
  { subject: "Seguidores", A: 60, B: 90, C: 45 },
  { subject: "Frequência", A: 45, B: 60, C: 70 },
];

const ranking = [
  { handle: "@rafaelmilagre", badge: "Líder", badgeColor: "bg-pink-500", bar: 85, barColor: "bg-pink-500" },
  { handle: "@perfil.exempl", badge: "Ativo", badgeColor: "bg-primary", bar: 70, barColor: "bg-primary" },
  { handle: "@yagomartinsor", badge: "Ativo", badgeColor: "bg-cyan-500", bar: 55, barColor: "bg-cyan-500" },
];

export function SocialComparativo() {
  return (
    <div className="neu-card rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Target className="h-4 w-4 text-purple-600 dark:text-purple-400" />
        <span className="text-sm font-bold text-foreground">Comparativo de Performance</span>
      </div>
      <p className="text-[10px] text-muted-foreground">Análise multicritério entre contas do cliente</p>

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data}>
            <PolarGrid stroke="hsl(var(--border))" />
            <PolarAngleAxis dataKey="subject" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} />
            <Radar name="@perfil.exemplo" dataKey="A" stroke="#ec4899" fill="#ec4899" fillOpacity={0.15} />
            <Radar name="@rafaelmilagre" dataKey="B" stroke="#a78bfa" fill="#a78bfa" fillOpacity={0.1} />
            <Radar name="@yagomartinsor" dataKey="C" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-center gap-3 text-[9px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-pink-500" />@perfil.exemplo</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-purple-400" />@rafaelmilagre</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-yellow-500" />@yagomartinsor</span>
      </div>

      <div className="space-y-1 pt-2">
        <span className="text-[10px] text-muted-foreground font-semibold">RANKING GERAL 🏆</span>
        {ranking.map((r, i) => (
          <div key={r.handle} className="flex items-center gap-2 py-1.5">
            <span className="text-xs text-muted-foreground w-4">{i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"}</span>
            <span className="text-xs text-foreground flex-1">{r.handle}</span>
            <span className={`px-1.5 py-0.5 rounded text-[9px] text-white font-medium ${r.badgeColor}`}>{r.badge}</span>
            <div className="w-24 h-1.5 rounded-full bg-secondary overflow-hidden">
              <div className={`h-full rounded-full ${r.barColor}`} style={{ width: `${r.bar}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
