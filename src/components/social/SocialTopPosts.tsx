import { Trophy, Eye, Heart, MessageSquare, Share2, Bookmark } from "lucide-react";
import { Card } from "@/components/ui/card";

const posts = [
  {
    rank: 1, handle: "@rafaelmilagre", badge: "+2022% vs média", badgeColor: "bg-primary",
    text: "Alexa com o poder de um Agente de IA ligado da Amazon. É a Amazon entrando no jogo de vez!",
    views: "517.0K", likes: "17.4K", comments: "797", shares: "48.8K", saves: "6.7K",
    type: "Carrossel", score: 75,
  },
  {
    rank: 2, handle: "@rafaelmilagre", badge: "+1889% vs média", badgeColor: "bg-primary",
    text: "Um desaconselho o que a Apple não conseguiu em 5 anos. É isso de graça. 🤯",
    views: "409.8K", likes: "23.8K", comments: "428", shares: "23.6K", saves: "12.9K",
    type: "Carrossel", score: 100,
  },
  {
    rank: 3, handle: "@yagomartinob", badge: "+3701% vs média", badgeColor: "bg-destructive",
    text: "O ConBoss é um evento novo recheado de conteúdo para quem vive se questionando...",
    views: "325.4K", likes: "10.7K", comments: "5", shares: "10.7K", saves: "9.5K",
    type: "Instagram", score: 100,
  },
  {
    rank: 4, handle: "@rafaelmilagre", badge: "+2386% vs média", badgeColor: "bg-primary",
    text: "Google lançou a sua IA e já deixamos cenários conectados. Ações da GOOG caíram 24%...",
    views: "237.9K", likes: "1.4K", comments: "272", shares: "14.0K", saves: "2.2K",
    type: "Carrossel", score: 97,
  },
  {
    rank: 5, handle: "@rafaelmilagre", badge: "+2749% vs média", badgeColor: "bg-primary",
    text: "Ah imagina lembra de um nome de um negócio, a ideia e de graça, usa na natureza e do jeito certo...",
    views: "182.2K", likes: "5.9K", comments: "163", shares: "10.0K", saves: "8.6K",
    type: "Carrossel", score: 100,
  },
];

export function SocialTopPosts() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
          <span className="text-sm font-bold text-foreground">Posts de Maior Sucesso</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <button className="px-2 py-1 rounded text-muted-foreground hover:bg-secondary border border-border/50">Engajamento ▼</button>
          <button className="px-2 py-1 rounded text-muted-foreground hover:bg-secondary border border-border/50">Todos ▼</button>
          <button className="px-2 py-1 rounded text-muted-foreground hover:bg-secondary border border-border/50">⚙️</button>
          <button className="px-2 py-1 rounded text-muted-foreground hover:bg-secondary border border-border/50">Todas... ▼</button>
        </div>
      </div>

      <div className="space-y-3">
        {posts.map((p) => (
          <Card key={p.rank} className="p-4 neu-card">
            <div className="flex items-start gap-3">
              <div className={`flex items-center justify-center h-7 w-7 rounded-full text-sm font-bold ${
                p.rank <= 2 ? "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400" : "bg-pink-500/20 text-pink-600 dark:text-pink-400"
              }`}>
                {p.rank}
              </div>

              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-purple-500/30" />
                  <span className="text-xs font-bold text-foreground">{p.handle}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] text-white font-medium ${p.badgeColor}`}>{p.badge}</span>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">{p.text}</p>

                <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{p.views}</span>
                  <span className="flex items-center gap-1 text-pink-600 dark:text-pink-400"><Heart className="h-3 w-3" />{p.likes}</span>
                  <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" />{p.comments}</span>
                  <span className="flex items-center gap-1"><Share2 className="h-3 w-3" />{p.shares}</span>
                  <span className="flex items-center gap-1"><Bookmark className="h-3 w-3" />{p.saves}</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded text-[9px] bg-secondary text-muted-foreground">{p.type}</span>
                  <span className="text-[9px] text-muted-foreground">Performance Score</span>
                </div>

                <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${p.score}%` }} />
                </div>
                <span className="text-[9px] text-muted-foreground">{p.score}/100</span>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Mostrando 1-5 de 50 posts</span>
        <div className="flex items-center gap-1">
          <span>5/...</span>
          <span>‹ Previous</span>
          {[1, 2, 3, 4, "...", 10].map((n, i) => (
            <button key={i} className={`px-1.5 py-0.5 rounded ${n === 1 ? "bg-primary text-primary-foreground" : ""}`}>{n}</button>
          ))}
          <span>Next ›</span>
        </div>
      </div>
    </div>
  );
}
