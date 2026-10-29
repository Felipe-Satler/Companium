import { Facebook, Chrome } from "lucide-react";

const META_COLOR = "#1877F2";
const GOOGLE_COLOR = "#E1306C";

interface MetricInput {
  label: string;
  meta: number;
  google: number;
  betterWhen: "lower" | "higher";
}

interface Props {
  metrics: MetricInput[];
}

interface ComputedRow {
  label: string;
  winner: "meta" | "google" | "tie";
  diffPct: number; // sempre positivo, representa "quanto melhor"
  metaValue: number;
  googleValue: number;
}

function compute(m: MetricInput): ComputedRow {
  const { meta, google, betterWhen } = m;
  if (meta <= 0 || google <= 0) {
    return { label: m.label, winner: "tie", diffPct: 0, metaValue: meta, googleValue: google };
  }
  let winner: "meta" | "google" = "meta";
  let diffPct = 0;
  if (betterWhen === "lower") {
    if (meta < google) {
      winner = "meta";
      diffPct = ((google - meta) / google) * 100;
    } else {
      winner = "google";
      diffPct = ((meta - google) / meta) * 100;
    }
  } else {
    if (meta > google) {
      winner = "meta";
      diffPct = ((meta - google) / google) * 100;
    } else {
      winner = "google";
      diffPct = ((google - meta) / meta) * 100;
    }
  }
  return { label: m.label, winner, diffPct, metaValue: meta, googleValue: google };
}

export function PerformanceEfficiencyBars({ metrics }: Props) {
  const rows = metrics.map(compute);
  const maxDiff = Math.max(...rows.map((r) => r.diffPct), 1);

  return (
    <div className="neu-card rounded-xl p-6">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-foreground">Eficiência relativa</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Quanto um canal supera o outro em cada métrica (em %)
        </p>
      </div>

      {/* Header */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 pb-3 mb-3 border-b border-border/50">
        <div className="flex items-center justify-end">
          <div className="neu-inset flex items-center gap-2 px-3 py-1.5 rounded-lg">
            <Facebook className="h-4 w-4" style={{ color: META_COLOR }} />
            <span className="text-xs font-semibold text-foreground">Meta vence</span>
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider text-center min-w-[110px] px-2">
          Métrica
        </div>
        <div className="flex items-center justify-start">
          <div className="neu-inset flex items-center gap-2 px-3 py-1.5 rounded-lg">
            <span className="text-xs font-semibold text-foreground">Google vence</span>
            <Chrome className="h-4 w-4" style={{ color: GOOGLE_COLOR }} />
          </div>
        </div>
      </div>

      <div className="space-y-2.5">
        {rows.map((r) => {
          const widthPct = (r.diffPct / maxDiff) * 100;
          return (
            <div key={r.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              {/* Meta side */}
              <div className="relative h-7 flex items-center justify-end">
                {r.winner === "meta" && (
                  <>
                    <span className="absolute right-0 -top-0.5 text-[11px] font-bold tabular-nums" style={{ color: META_COLOR }}>
                      −{r.diffPct.toFixed(0)}%
                    </span>
                    <div
                      className="h-3 rounded-l-full mt-3"
                      style={{ width: `${widthPct}%`, backgroundColor: META_COLOR, opacity: 0.85 }}
                    />
                  </>
                )}
              </div>

              {/* Center label + axis */}
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider text-center min-w-[110px] px-2 border-l border-r border-border/50 py-1">
                {r.label}
              </div>

              {/* Google side */}
              <div className="relative h-7 flex items-center justify-start">
                {r.winner === "google" && (
                  <>
                    <span className="absolute left-0 -top-0.5 text-[11px] font-bold tabular-nums" style={{ color: GOOGLE_COLOR }}>
                      +{r.diffPct.toFixed(0)}%
                    </span>
                    <div
                      className="h-3 rounded-r-full mt-3"
                      style={{ width: `${widthPct}%`, backgroundColor: GOOGLE_COLOR, opacity: 0.85 }}
                    />
                  </>
                )}
                {r.winner === "tie" && (
                  <span className="text-[10px] text-muted-foreground italic ml-2">sem dados comparáveis</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground mt-4 text-center italic">
        Barras maiores indicam vantagem mais relevante. Métricas sem dados em um dos canais são ignoradas.
      </p>
    </div>
  );
}
