import { Card } from "@/components/ui/card";

const accounts = [
  { handle: "@perfil.exemplo", followers: "68.7K seguidores", avatar: "🟢", growth: "45%", color: "from-purple-600/40 to-pink-600/40" },
  { handle: "@rafaelmilagre", followers: "68.2K seguidores", avatar: "👤", growth: "44%", color: "from-purple-600/40 to-pink-600/40" },
  { handle: "@yagomartinsor", followers: "42.7K seguidores", avatar: "👤", growth: "7%", color: "from-purple-600/40 to-pink-600/40" },
];

export function SocialContasMonitoradas() {
  return (
    <div className="space-y-3">
      <span className="text-xs font-semibold text-muted-foreground">• Contas Monitoradas</span>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {accounts.map((a) => (
          <Card key={a.handle} className={`p-4 bg-gradient-to-r ${a.color} border-purple-500/20`}>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-purple-500/30 flex items-center justify-center text-2xl">{a.avatar}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">{a.handle}</p>
                <p className="text-[10px] text-muted-foreground">{a.followers}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Alcance</span>
              <span>{a.growth}</span>
            </div>
            <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden mt-1">
              <div className="h-full rounded-full bg-pink-400" style={{ width: a.growth }} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
