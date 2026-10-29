import { HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  text: string;
}

export function MetricInfoTooltip({ text }: Props) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground transition-colors"
            aria-label="Mais informações"
          >
            <HelpCircle className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[240px] text-xs">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
