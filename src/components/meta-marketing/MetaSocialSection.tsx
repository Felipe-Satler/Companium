import { Share2 } from "lucide-react";

const viewsMetrics = [
  { label: "META", value: "10.9M", bg: "" },
  { label: "REALIZADO", value: "3.9M", bg: "" },
  { label: "% ATINGIMENTO", value: "35,9%", bg: "bg-primary/20", valueColor: "text-primary" },
  { label: "META MTD", value: "8.5M", bg: "" },
  { label: "% MTD", value: "46,4%", bg: "bg-primary/20", valueColor: "text-primary" },
];

const mqlMetrics = [
  { label: "META", value: "2200", bg: "" },
  { label: "REALIZADO", value: "1542", bg: "" },
  { label: "% ATINGIMENTO", value: "70,1%", bg: "bg-primary/20", valueColor: "text-primary" },
  { label: "META MTD", value: "1703", bg: "" },
  { label: "% MTD", value: "90,5%", bg: "bg-primary/20", valueColor: "text-primary" },
];

function MetricsRow({ metrics, label }: { metrics: typeof viewsMetrics; label: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-xs text-muted-foreground">⊙ {label}</span>
      </div>
      <div className="grid grid-cols-5 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className={`rounded-lg border border-border/50 p-3 ${m.bg || "bg-card"}`}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{m.label}</p>
            <p className={`text-xl font-bold ${m.valueColor || "text-foreground"}`}>{m.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MetaSocialSection() {
  return (
    <div className="neu-card rounded-xl p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-500/20">
          <Share2 className="h-5 w-5 text-orange-600 dark:text-orange-400" />
        </div>
        <div>
          <span className="text-base font-bold text-foreground">Social</span>
          <p className="text-xs text-muted-foreground">4 canais • 3.9M views • 1542 MQLs MTD</p>
        </div>
      </div>

      <MetricsRow metrics={viewsMetrics} label="Views" />
      <MetricsRow metrics={mqlMetrics} label="MQL" />
    </div>
  );
}
