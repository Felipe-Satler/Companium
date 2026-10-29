import { useMemo, useState } from "react";
import { Check, ChevronDown, Tag, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

// Select de TAGS, espelhado no OrigemMultiSelect: escolhe por NOME; [] = todas.
// `mode` controla se o filtro é por quem TEM ("include") ou quem NÃO TEM ("exclude") as tags.
type TagsMode = "include" | "exclude";

interface TagsMultiSelectProps {
  value: string[]; // [] = todas
  onChange: (val: string[]) => void;
  options: string[];
  mode?: TagsMode;
  onModeChange?: (m: TagsMode) => void;
  placeholder?: string;
  className?: string;
}

export function TagsMultiSelect({
  value,
  onChange,
  options,
  mode = "include",
  onModeChange,
  placeholder = "Todas as tags",
  className,
}: TagsMultiSelectProps) {
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

  const prefix = mode === "exclude" ? "Sem " : "";
  const label = allSelected
    ? placeholder
    : value.length === 1
    ? `${prefix}${value[0]}`
    : `${prefix}${value.length} tags`;

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
            <Tag className="h-3 w-3 text-primary" /> Tags
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
        {onModeChange && (
          <div className="flex items-center gap-1 p-0.5 mb-2 rounded-lg neu-inset">
            <button
              type="button"
              onClick={() => onModeChange("include")}
              className={cn(
                "flex-1 rounded-md px-2 py-1 text-[10px] font-medium transition-all",
                mode === "include" ? "neu-card text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Com a tag
            </button>
            <button
              type="button"
              onClick={() => onModeChange("exclude")}
              className={cn(
                "flex-1 rounded-md px-2 py-1 text-[10px] font-medium transition-all",
                mode === "exclude" ? "neu-card text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Sem a tag
            </button>
          </div>
        )}
        <div className="flex items-center gap-1.5 px-2 py-1.5 mb-2 rounded-lg neu-inset">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar tag..."
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
              {options.length === 0 ? "Nenhuma tag cadastrada" : "Nenhum resultado"}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
