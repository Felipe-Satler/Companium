import { Card } from "@/components/ui/card";
import { Image, Play, LayoutGrid, Heart, MessageSquare, Share2, Bookmark } from "lucide-react";

const types = [
  {
    label: "Carrossel", icon: LayoutGrid, posts: "400 posts", badge: "Winner", badgeColor: "bg-primary",
    engMedio: 1400, engLabel: "1.4K", barPct: 85, barColor: "bg-primary",
    likes: 557, comments: 31, shares: 140, saves: 312, volume: "88.2K",
  },
  {
    label: "Imagem", icon: Image, posts: "391 posts", badge: null, badgeColor: "",
    engMedio: 1300, engLabel: "1.3K", barPct: 70, barColor: "bg-pink-500",
    likes: 473, comments: 99, shares: 371, saves: 460, volume: "36.8K",
  },
  {
    label: "Vídeo", icon: Play, posts: "204 posts", badge: null, badgeColor: "",
    engMedio: 189, engLabel: "189", barPct: 25, barColor: "bg-purple-500",
    likes: 108, comments: 9, shares: 50, saves: 22, volume: "23.2K",
  },
];

export function SocialPerformanceTipo() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-lg">📊</span>
        <span className="text-sm font-bold text-foreground">Performance por Tipo de Conteúdo</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {types.map((t) => (
          <Card key={t.label} className="p-4 neu-card space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                  t.label === "Carrossel" ? "bg-pink-500/20" : t.label === "Imagem" ? "bg-yellow-500/20" : "bg-purple-500/20"
                }`}>
                  <t.icon className={`h-4 w-4 ${
                    t.label === "Carrossel" ? "text-pink-600 dark:text-pink-400" : t.label === "Imagem" ? "text-yellow-600 dark:text-yellow-400" : "text-purple-600 dark:text-purple-400"
                  }`} />
                </div>
                <div>
                  <p className="text-xs font-bold text-foreground">{t.label}</p>
                  <p className="text-[10px] text-muted-foreground">{t.posts}</p>
                </div>
              </div>
              {t.badge && (
                <span className={`px-2 py-0.5 rounded text-[9px] font-semibold text-white ${t.badgeColor}`}>{t.badge}</span>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                <span>Engajamento Médio ⓘ</span>
                <span className="text-sm font-bold text-foreground">{t.engLabel}</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                <div className={`h-full rounded-full ${t.barColor}`} style={{ width: `${t.barPct}%` }} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="flex items-center gap-1 text-muted-foreground"><Heart className="h-3 w-3 text-pink-600 dark:text-pink-400" /> Likes: <span className="text-foreground font-medium">{t.likes}</span></div>
              <div className="flex items-center gap-1 text-muted-foreground"><MessageSquare className="h-3 w-3 text-cyan-600 dark:text-cyan-400" /> Coment: <span className="text-foreground font-medium">{t.comments}</span></div>
              <div className="flex items-center gap-1 text-muted-foreground"><Share2 className="h-3 w-3 text-purple-600 dark:text-purple-400" /> Shares: <span className="text-foreground font-medium">{t.shares}</span></div>
              <div className="flex items-center gap-1 text-muted-foreground"><Bookmark className="h-3 w-3 text-yellow-600 dark:text-yellow-400" /> Saves: <span className="text-foreground font-medium">{t.saves}</span></div>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-border/30">
              <span className="text-[10px] text-muted-foreground">✦ Volume</span>
              <span className="text-sm font-bold text-foreground">{t.volume}</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
