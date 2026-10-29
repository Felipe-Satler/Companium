import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

export function BotSelect({ bots, current, currentLabel, canSwitch, onSelect }: {
  bots: { id: string; label: string }[];
  current: string | null;
  currentLabel?: string;
  canSwitch?: boolean;
  onSelect: (id: string) => void;
}) {
  const label = currentLabel ??bots.find((b) => b.id === current)?.label ?? 'Assistente';

  // Not switchable: a static chip, same height as Send.
  if (!canSwitch || bots.length <= 1) {
    return (
      <div className="flex h-full items-center rounded-md border border-border bg-secondary px-3 text-sm text-secondary-foreground">
        {label}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* secondary = distinct from the green Send; h-full aligns with it */}
        <Button variant="secondary" size="sm" className="h-full">{label} ▾</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top">
        {bots.map((b) => (
          <DropdownMenuItem key={b.id} onClick={() => onSelect(b.id)}>
            {b.id === current ? '● ' : '○ '}{b.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
