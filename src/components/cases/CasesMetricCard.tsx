import { LucideIcon } from "lucide-react";

interface CasesMetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: LucideIcon;
  borderColor?: string;
  valueColor?: string;
  progress?: number;
  progressColor?: string;
}

export function CasesMetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  borderColor = "border-primary",
  valueColor = "text-foreground",
  progress,
  progressColor = "bg-primary",
}: CasesMetricCardProps) {
  return (
    <div className={`neu-card rounded-lg ${borderColor} p-4 flex flex-col gap-2 min-w-[180px]`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
      {progress !== undefined && (
        <div className="w-full h-1.5 rounded-full bg-secondary mt-1">
          <div
            className={`h-full rounded-full ${progressColor}`}
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      )}
      {subtitle && (
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}
