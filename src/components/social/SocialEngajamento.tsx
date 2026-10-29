import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { Heart, Calendar } from "lucide-react";

const pieData = [
  { name: "Curtidos", value: 43, color: "#ec4899" },
  { name: "Comentários", value: 4, color: "#22d3ee" },
  { name: "Compartilhamentos", value: 25, color: "#a78bfa" },
  { name: "Salvos", value: 28, color: "#f59e0b" },
];

const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const alcanceData = [32, 45, 28, 50, 38, 42, 30];
const engajamentoData = [25, 38, 35, 42, 30, 48, 28];

export function SocialEngajamento() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Composição do Engajamento */}
      <div className="neu-card rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Heart className="h-4 w-4 text-pink-600 dark:text-pink-400" />
          <span className="text-sm font-bold text-foreground">Composição do Engajamento</span>
        </div>
        <p className="text-[10px] text-muted-foreground">Distribuição percentual da interação</p>

        <div className="flex items-center gap-6">
          <div className="relative h-32 w-32">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} innerRadius={35} outerRadius={55} dataKey="value" strokeWidth={0}>
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-bold text-foreground">304.6K</span>
              <span className="text-[9px] text-muted-foreground">Total</span>
            </div>
          </div>

          <div className="space-y-2 flex-1">
            {pieData.map((item) => (
              <div key={item.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-xs text-muted-foreground">{item.name}</span>
                </div>
                <span className="text-xs font-semibold text-foreground px-2 py-0.5 rounded bg-secondary/50">{item.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Melhor Dia para Postar */}
      <div className="neu-card rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
          <span className="text-sm font-bold text-foreground">Melhor Dia para Postar</span>
        </div>
        <p className="text-[10px] text-muted-foreground">Análise de performance por dia da semana</p>

        <div className="space-y-3">
          <div>
            <span className="text-[10px] text-muted-foreground font-semibold">✦ ALCANCE</span>
            <div className="flex items-center gap-1.5 mt-1.5">
              {days.map((d, i) => (
                <div key={`a-${d}`} className="flex-1 text-center">
                  <div
                    className={`rounded-lg py-2 text-[10px] font-bold ${
                      alcanceData[i] > 40 ? "bg-primary text-primary-foreground" : "bg-cyan-900/30 text-cyan-700 dark:text-cyan-300"
                    }`}
                  >
                    {d}
                    <p className="text-[8px] font-normal mt-0.5 opacity-70">{alcanceData[i]}%</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <span className="text-[10px] text-muted-foreground font-semibold">✦ ENGAJAMENTO</span>
            <div className="flex items-center gap-1.5 mt-1.5">
              {days.map((d, i) => (
                <div key={`e-${d}`} className="flex-1 text-center">
                  <div
                    className={`rounded-lg py-2 text-[10px] font-bold ${
                      engajamentoData[i] > 40 ? "bg-primary text-primary-foreground" : "bg-cyan-900/30 text-cyan-700 dark:text-cyan-300"
                    }`}
                  >
                    {d}
                    <p className="text-[8px] font-normal mt-0.5 opacity-70">{engajamentoData[i]}%</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-xs">
          <span className="text-primary font-semibold">✅ Qui é o melhor dia!</span>
          <p className="text-[10px] text-muted-foreground mt-0.5">Alcance 33% acima da média. Publique às 16h - Melhores horários: Manhã...</p>
        </div>
      </div>
    </div>
  );
}
