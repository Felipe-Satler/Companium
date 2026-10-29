import { LucideIcon } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string;
  subtitle: string;
  icon: LucideIcon;
  iconColor?: string;
  valueColor?: string;
  loading?: boolean;
}

export function MetricCard({ title, value, subtitle, icon: Icon, iconColor = "text-primary", valueColor = "text-foreground", loading }: MetricCardProps) {
  if (loading) {
    return (
      <div className="neu-card p-5 flex items-center justify-between">
        <div className="flex-1 space-y-2">
          <div className="skeleton-loading h-3 w-24 rounded" />
          <div className="skeleton-loading h-6 w-32 rounded" />
          <div className="skeleton-loading h-3 w-20 rounded" />
        </div>
        <div className="skeleton-loading h-10 w-10 rounded-full" />
      </div>
    );
  }

  return (
    <div className="neu-card p-5 flex items-center justify-between">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
        <p className={`mt-1 text-xl font-bold ${valueColor}`}>{value}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className={`flex h-10 w-10 items-center justify-center rounded-full neu-inset ${iconColor}`}>
        <Icon className="h-5 w-5" />
      </div>
    </div>
  );
}
