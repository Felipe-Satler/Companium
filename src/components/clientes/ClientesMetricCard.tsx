import { LucideIcon } from "lucide-react";

interface ClientesMetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: LucideIcon;
  borderColor?: string;
  valueColor?: string;
}

export function ClientesMetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  borderColor = "border-primary/50",
  valueColor = "text-foreground",
}: ClientesMetricCardProps) {
  return (
    <div className={`neu-card rounded-xl border-l-2 ${borderColor} p-4 flex flex-col gap-2`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
