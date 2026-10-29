import { TrendingUp, Calendar, Clock } from "lucide-react";

export function CasesProgressPanel() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Progresso MTD */}
      <div className="neu-card rounded-lg p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <TrendingUp className="h-4 w-4 text-primary" />
          Progresso MTD
        </div>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-3xl font-bold text-foreground">52%</p>
            <p className="text-xs font-semibold text-red-600 dark:text-red-400">Atrasado</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-foreground">26 <span className="text-sm text-muted-foreground font-normal">/ 50</span></p>
            <p className="text-[11px] text-muted-foreground">Faltam 24 pts p/ meta proporcional</p>
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Realizado</span>
            <span>Meta MTD</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary" style={{ width: "52%" }} />
          </div>
        </div>
      </div>

      {/* Dias Úteis do Período */}
      <div className="neu-card rounded-lg p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Calendar className="h-4 w-4 text-primary" />
          Dias Úteis do Período
        </div>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-3xl font-bold text-foreground">24 <span className="text-sm text-muted-foreground font-normal">/ 31</span></p>
            <p className="text-xs text-muted-foreground">dias passados</p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">7</span>
            </div>
            <p className="text-xs text-muted-foreground">dias restantes</p>
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Progresso</span>
            <span>77%</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary" style={{ width: "77%" }} />
          </div>
        </div>
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span>Média/dia</span>
          </div>
          <span className="text-lg font-bold text-foreground">1.07</span>
        </div>
      </div>
    </div>
  );
}
