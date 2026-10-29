import { Card } from "@/components/ui/card";
import { Trophy } from "lucide-react";

const sellers = [
  { rank: 1, name: "Murilo Bento", vendas: 863520, meta: 1240000, badge: "gold" },
  { rank: 2, name: "Guilherme Fontes", vendas: 785310, meta: 1000000, badge: "silver" },
  { rank: 3, name: "Pedro Estevão", vendas: 772106, meta: 780000, badge: "bronze" },
  { rank: 4, name: "Juan Barros", vendas: 731262, meta: 780000, badge: null },
  { rank: 5, name: "Vitor Seixas", vendas: 694824, meta: 490000, badge: null },
  { rank: 6, name: "Eduardo Gomes", vendas: 645216, meta: 930000, badge: null },
  { rank: 7, name: "Mateus Elias", vendas: 632322, meta: 780000, badge: null },
  { rank: 8, name: "Isabel Bragança", vendas: 604249, meta: 425000, badge: null },
  { rank: 9, name: "William Dorneles", vendas: 584063, meta: 930000, badge: null },
  { rank: 10, name: "Lucas Correia", vendas: 558590, meta: 1000000, badge: null },
  { rank: 11, name: "Daniel Guerra", vendas: 497506, meta: 620000, badge: null },
  { rank: 12, name: "Ariel Tavares", vendas: 461506, meta: 425000, badge: null },
  { rank: 13, name: "Matheus Santos", vendas: 421524, meta: 420000, badge: null },
  { rank: 14, name: "Du Teixeira", vendas: 415476, meta: 1520000, badge: null },
  { rank: 15, name: "Lucas Moreira", vendas: 384762, meta: 490000, badge: null },
  { rank: 16, name: "Lucas Gabriel", vendas: 354960, meta: 250000, badge: null },
  { rank: 17, name: "Alice Torres", vendas: 234270, meta: 500000, badge: null },
  { rank: 18, name: "Tales Quintela", vendas: 234000, meta: 200000, badge: null },
  { rank: 19, name: "Nadia Campos", vendas: 178020, meta: 425000, badge: null },
  { rank: 20, name: "Helena Martins Silva", vendas: 167760, meta: 425000, badge: null },
];

function formatCurrency(value: number) {
  return `R$ ${value.toLocaleString("pt-BR")}`;
}

function getBarColor(pct: number) {
  if (pct >= 100) return "bg-emerald-500";
  if (pct >= 80) return "bg-primary";
  if (pct >= 60) return "bg-amber-500";
  return "bg-red-500";
}

function getPctColor(pct: number) {
  if (pct >= 100) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 80) return "text-primary";
  if (pct >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function getBadgeEmoji(badge: string | null) {
  if (badge === "gold") return "🥇";
  if (badge === "silver") return "🥈";
  if (badge === "bronze") return "🥉";
  return null;
}

interface Props {
  loading: boolean;
}

export function RankingList({ loading }: Props) {
  if (loading) return <div className="h-96 rounded-xl skeleton-loading" />;

  // Pace position = 77% of the bar (day 24 of 31)
  const pacePosition = 77;

  return (
    <Card className="neu-card p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <Trophy className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Ranking do Período</span>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Acompanhe PACE, forecasting e progresso em tempo real
      </p>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <span className="text-[11px] text-muted-foreground">Acima do esperado</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-amber-500" />
          <span className="text-[11px] text-muted-foreground">Atenção</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
          <span className="text-[11px] text-muted-foreground">Abaixo do esperado</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
          <span className="text-[11px] text-muted-foreground">Forecasting</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3.5 w-0.5 bg-red-500 rounded-full" />
          <span className="text-[11px] text-muted-foreground">Pace (onde deveria estar)</span>
        </div>
      </div>

      {/* Sellers */}
      <div className="space-y-2">
        {sellers.map((s) => {
          const pct = Math.round((s.vendas / s.meta) * 100);
          const barWidth = Math.min(pct, 150);
          const faltam = s.meta - s.vendas;
          const emoji = getBadgeEmoji(s.badge);

          return (
            <div
              key={s.rank}
              className="flex items-center gap-4 py-3 px-3 rounded-lg hover:bg-secondary/30 transition-colors"
            >
              {/* Rank */}
              <div className="w-8 text-right shrink-0">
                {emoji ? (
                  <span className="text-base">{emoji}</span>
                ) : (
                  <span className="text-xs text-muted-foreground font-medium">#{s.rank}</span>
                )}
              </div>

              {/* Name */}
              <div className="w-40 shrink-0">
                <span className="text-sm font-medium text-foreground">{s.name}</span>
              </div>

              {/* Bar section */}
              <div className="flex-1 min-w-0">
                {/* Values above bar */}
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    {formatCurrency(s.vendas)} / {formatCurrency(s.meta)}
                  </span>
                  {faltam > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      Faltam: {formatCurrency(faltam)}
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                <div className="relative h-6 bg-secondary/50 rounded overflow-visible">
                  {/* Filled bar */}
                  <div
                    className={`absolute inset-y-0 left-0 rounded ${getBarColor(pct)} transition-all duration-500`}
                    style={{ width: `${Math.min(barWidth, 100)}%` }}
                  />

                  {/* Pace marker */}
                  {pct < 100 && (
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                      style={{ left: `${pacePosition}%` }}
                    >
                      <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-red-500 rounded-full" />
                    </div>
                  )}
                </div>
              </div>

              {/* Percentage */}
              <div className="w-14 text-right shrink-0">
                <span
                  className={`text-sm font-bold ${getPctColor(pct)} ${
                    pct < 70 ? "bg-red-500/20 px-1.5 py-0.5 rounded" : ""
                  }`}
                >
                  {pct}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
