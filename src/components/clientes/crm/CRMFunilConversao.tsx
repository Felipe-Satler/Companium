import { FunnelStage } from "@/utils/crmCalculations";
import { ArrowDown } from "lucide-react";

function fmt(val: number) {
  // Sempre o valor inteiro exato (com separador de milhar), sem abreviar p/ "K"/"Mi".
  return val.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

export function CRMFunilConversao({ data }: { data: FunnelStage[] }) {
  if (!data.length) return null;

  const maxCount = Math.max(...data.map((s) => s.count), 1);
  const first = data[0].count;
  const last = data[data.length - 1].count;
  const totalRate = first > 0 ? ((last / first) * 100).toFixed(1) : "N/A";

  // Find biggest drop-off
  let biggestDrop = { label: "", drop: 0 };
  for (let i = 1; i < data.length; i++) {
    const drop = data[i - 1].count - data[i].count;
    if (drop > biggestDrop.drop) {
      biggestDrop = { label: `${data[i - 1].label} → ${data[i].label}`, drop };
    }
  }

  return (
    <div className="neu-card rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-sm font-semibold text-foreground">Funil de Conversão</h3>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Conversão Total</p>
            <p className="text-sm font-bold text-primary">{totalRate}%</p>
          </div>
          {biggestDrop.drop > 0 && (
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Maior Drop-off</p>
              <p className="text-[10px] font-medium text-red-600 dark:text-red-400">{biggestDrop.label}</p>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1">
        {data.map((stage, i) => {
          const widthPct = maxCount > 0 ? Math.max((stage.count / maxCount) * 100, 4) : 4;
          // Gradiente por etapa (topo azul → fundo verde), seguindo o modelo aprovado.
          const grad =
            i === 0
              ? "from-blue-600 to-blue-400"
              : i === 1
                ? "from-blue-500 to-sky-400"
                : i === 2
                  ? "from-emerald-600 to-emerald-400"
                  : "from-emerald-700 to-emerald-500";
          return (
            <div key={stage.label}>
              {/* Stage bar */}
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-muted-foreground w-[140px] shrink-0 text-right">
                  {stage.label}
                </span>
                <div className="flex-1 relative">
                  <div
                    className={`h-8 rounded-md bg-gradient-to-r ${grad} flex items-center px-3 transition-all shadow-sm`}
                    style={{ width: `${widthPct}%` }}
                  >
                    <span className="text-xs font-bold text-white whitespace-nowrap">
                      {fmt(stage.count)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Arrow + rate between stages */}
              {i < data.length - 1 && (
                <div className="flex items-center gap-3 py-0.5">
                  <span className="w-[140px] shrink-0" />
                  <div className="flex items-center gap-1.5 pl-2">
                    <ArrowDown className="h-3 w-3 text-muted-foreground/50" />
                    <span className="text-[10px] text-muted-foreground">
                      {data[i + 1].rate !== null
                        ? `${data[i + 1].rate!.toFixed(1)}%`
                        : "N/A"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
