import { Card } from "@/components/ui/card";
import { Eye, Users, Heart, Share2, Bookmark } from "lucide-react";

const metrics = [
  { label: "Visualizações", value: "3.9M", trend: "+49.3%", trendColor: "text-primary", icon: Eye },
  { label: "Alcance", value: "11.9M", trend: "+21.5%", trendColor: "text-destructive", icon: Users },
  { label: "Interações", value: "384.7K", trend: "+38.2%", trendColor: "text-primary", icon: Heart },
  { label: "Views Perfil", value: "98.6K", trend: "-53.2%", trendColor: "text-destructive", icon: Eye },
  { label: "Salvos", value: "85.1K", trend: "+40.0%", trendColor: "text-primary", icon: Bookmark },
];

const engagement = [
  { icon: "❤️", label: "", value: "131.3K", sub: "Curtidas" },
  { icon: "💬", label: "", value: "11.5K", sub: "Comentários" },
  { icon: "↗️", label: "", value: "76.7K", sub: "Compartilhamentos" },
  { icon: "🔖", label: "", value: "85.1K", sub: "Salvos", color: "text-primary" },
];

export function SocialMetricsConsolidadas() {
  return (
    <div className="space-y-4">
      <span className="text-xs font-semibold text-muted-foreground">• Métricas Consolidadas</span>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {metrics.map((m) => (
          <Card key={m.label} className="p-4 neu-card">
            <div className="flex items-center justify-between">
              <m.icon className="h-4 w-4 text-muted-foreground" />
              <div className="flex items-center gap-1">
                <div className="h-8 w-12">
                  <svg viewBox="0 0 48 24" className="w-full h-full">
                    <path d="M0 18 Q12 8, 24 14 T48 6" fill="none" stroke={m.trendColor === "text-primary" ? "hsl(160,60%,45%)" : "#ef4444"} strokeWidth="1.5" />
                  </svg>
                </div>
              </div>
            </div>
            <p className="text-xl font-bold text-foreground mt-1">{m.value}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[10px] text-muted-foreground">{m.label}</span>
              <span className={`text-[10px] font-medium ${m.trendColor}`}>{m.trend}</span>
            </div>
          </Card>
        ))}
      </div>

      <span className="text-xs font-semibold text-muted-foreground">• Detalhamento do Engajamento</span>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {engagement.map((e) => (
          <div key={e.sub} className="flex items-center gap-2">
            <span className="text-lg">{e.icon}</span>
            <div>
              <p className={`text-lg font-bold ${e.color || "text-foreground"}`}>{e.value}</p>
              <p className="text-[10px] text-muted-foreground">{e.sub}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
