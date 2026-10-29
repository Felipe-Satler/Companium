import { Flame, Trophy } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const mockSales = [
  { name: "Mateus Elias", time: "há 22 minutos", value: "R$  37.800,00", initials: "ME" },
  { name: "Daniel Guer...", time: "há 42 minutos", value: "R$  24.510,00", initials: "DG" },
  { name: "William Dorneles", time: "há cerca de 1 hora", value: "R$  46.800,00", initials: "WD" },
  { name: "Rafael Quie...", time: "há cerca de 1 hora", value: "R$  48.600,00", initials: "RQ" },
  { name: "Lucas Gabriel", time: "há cerca de 1 hora", value: "R$  46.800,00", initials: "LG" },
  { name: "Rafael Quie...", time: "há cerca de 1 hora", value: "R$  46.800,00", initials: "RQ" },
  { name: "Du Teixeira", time: "há cerca de 1 hora", value: "R$  46.800,00", initials: "DT" },
  { name: "Lucas Correia", time: "há cerca de 1 hora", value: "R$  46.800,00", initials: "LC" },
  { name: "Pedro Estev...", time: "há cerca de 1 hora", value: "R$  46.800,00", initials: "PE" },
  { name: "Pedro Estev...", time: "há cerca de 2 horas", value: "R$  46.800,00", initials: "PE" },
  { name: "Ariel Tavares", time: "há cerca de 2 horas", value: "R$  46.800,00", initials: "AT" },
  { name: "Lucas Correia", time: "há cerca de 2 horas", value: "R$  46.800,00", initials: "LC" },
  { name: "William Dorneles", time: "há cerca de 2 horas", value: "R$  46.800,00", initials: "WD" },
  { name: "Murilo B...", time: "há cerca de 2 horas", value: "R$  61.800,00", initials: "MB", highlighted: true },
  { name: "William Dorneles", time: "há cerca de 2 horas", value: "R$  46.800,00", initials: "WD" },
];

const avatarColors = [
  "bg-amber-700",
  "bg-emerald-700",
  "bg-rose-700",
  "bg-slate-600",
  "bg-cyan-700",
  "bg-violet-700",
  "bg-orange-700",
  "bg-teal-700",
  "bg-pink-700",
];

interface LastSalesPanelProps {
  loading?: boolean;
}

export function LastSalesPanel({ loading }: LastSalesPanelProps) {
  if (loading) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between mb-4 px-2">
          <div className="skeleton-loading h-5 w-32 rounded" />
          <div className="skeleton-loading h-5 w-16 rounded" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-2">
              <div className="skeleton-loading h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <div className="skeleton-loading h-3 w-24 rounded" />
                <div className="skeleton-loading h-2.5 w-16 rounded" />
              </div>
              <div className="skeleton-loading h-4 w-20 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-chart-forecast" />
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
            Últimas Vendas
          </h3>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-live/30 px-2.5 py-1">
          <span className="h-2 w-2 rounded-full bg-live animate-pulse-live" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-live">
            Ao Vivo
          </span>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-2">
          {mockSales.map((sale, index) => (
            <div
              key={index}
              className={`flex items-center gap-3 rounded-xl px-3 py-3 transition-all ${
                sale.highlighted
                  ? "neu-card"
                  : "neu-inset hover:shadow-none"
              }`}
            >
              <Avatar className="h-10 w-10 shrink-0">
                <AvatarFallback
                  className={`text-[11px] font-semibold text-foreground ${
                    avatarColors[index % avatarColors.length]
                  }`}
                >
                  {sale.initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{sale.name}</p>
                <p className="text-[11px] text-muted-foreground">{sale.time}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {sale.highlighted && (
                  <Trophy className="h-3.5 w-3.5 text-chart-forecast" />
                )}
                <span className={`text-sm font-bold font-mono tabular-nums whitespace-nowrap ${
                  sale.highlighted ? "text-chart-forecast" : "text-primary"
                }`}>
                  {sale.value}
                </span>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
