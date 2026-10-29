import { useMemo, useState } from "react";
import { Check, ChevronDown, Filter, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface OrigemMultiSelectProps {
  value: string[]; // [] = todas
  onChange: (val: string[]) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}

export function OrigemMultiSelect({
  value,
  onChange,
  options,
  placeholder = "Todas as origens",
  className,
}: OrigemMultiSelectProps) {
  const allSelected = value.length === 0;
  const [search, setSearch] = useState("");

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, search]);

  const toggle = (opt: string) => {
    if (value.includes(opt)) {
      onChange(value.filter((v) => v !== opt));
    } else {
      onChange([...value, opt]);
    }
  };

  const label = allSelected
    ? placeholder
    : value.length === 1
    ? value[0]
    : `${value.length} origens`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-[200px] justify-between text-left text-xs font-normal neu-inset border-0",
            allSelected && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-3 neu-card border-0 rounded-xl" align="start">
        <div className="flex items-center justify-between px-1 pb-2 mb-2 border-b border-border/50">
          <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Filter className="h-3 w-3 text-primary" /> Origens
          </span>
          {!allSelected && (
            <button
              onClick={() => onChange([])}
              className="text-[10px] font-medium text-primary hover:underline"
            >
              Limpar
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1.5 mb-2 rounded-lg neu-inset">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar origem..."
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-[260px] overflow-y-auto space-y-1 pr-1">
          {filteredOptions.map((opt) => {
            const checked = value.includes(opt);
            return (
              <label
                key={opt}
                className={cn(
                  "flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer text-xs transition-all",
                  checked
                    ? "neu-inset text-foreground font-medium"
                    : "hover:neu-inset text-muted-foreground hover:text-foreground"
                )}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggle(opt)}
                />
                <span className="truncate flex-1">{opt}</span>
                {checked && <Check className="h-3 w-3 text-primary" />}
              </label>
            );
          })}
          {filteredOptions.length === 0 && (
            <div className="px-2 py-3 text-xs text-muted-foreground text-center">
              {options.length === 0 ? "Nenhuma origem disponível" : "Nenhum resultado"}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
