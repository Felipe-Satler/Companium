import { LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface MetricCardProps {
  title: string;
  value: string;
  subtitle: string;
  description?: string | undefined;
  icon: LucideIcon;
  iconColor?: string | undefined;
  valueColor?: string | undefined;
  loading?: boolean | undefined;
  valueHover?: string | undefined;
}

export function MetricCard({ title, value, subtitle, description, icon: Icon, iconColor = "text-primary", valueColor = "text-foreground", loading, valueHover }: MetricCardProps) {
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
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground">{title}</p>
        {valueHover ? (
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`mt-1 inline-block text-xl font-bold cursor-help ${valueColor}`}>
                  {value}
                </span>
              </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px]">
                  {valueHover}
                </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <p className={`mt-1 text-xl font-bold ${valueColor}`} title={value}>
            {value}
          </p>
        )}
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        {description && (
          <p className="mt-0.5 text-[10px] text-muted-foreground/80">{description}</p>
        )}
      </div>
      <div className={`flex h-10 w-10 items-center justify-center rounded-full neu-inset ${iconColor}`}>
        <Icon className="h-5 w-5" />
      </div>
    </div>
  );
}
