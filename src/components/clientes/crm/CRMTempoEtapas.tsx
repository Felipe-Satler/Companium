import { LeadTimeResult } from "@/utils/crmCalculations";
import { Clock } from "lucide-react";

export function CRMTempoEtapas({ data }: { data: LeadTimeResult[] }) {
  if (!data.length) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Tempo Médio entre Etapas</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {data.map((item) => (
          <div key={item.label} className="neu-card rounded-xl p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full neu-inset text-primary shrink-0">
                <Clock className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider leading-tight mb-2">
                  {item.label}
                </p>
                {item.n === 0 ? (
                  <p className="text-sm text-muted-foreground italic">Sem dados</p>
                ) : (
                  <>
                    <p className="text-xl font-bold text-foreground">
                      {item.avgDays !== null ? `${item.avgDays} dias` : "—"}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-muted-foreground">
                        Mediana: {item.medianDays !== null ? `${item.medianDays}d` : "—"}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60">
                        ({item.n} registros)
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
