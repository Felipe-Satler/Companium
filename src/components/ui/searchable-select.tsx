import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  allOption?: SearchableSelectOption | null;
  triggerClassName?: string;
  contentClassName?: string;
  /**
   * Necessário quando o select vive DENTRO de um Dialog: o popover é portalado para fora dele, e a
   * trava de rolagem do Radix Dialog bloqueia a roda do mouse fora da sua árvore — a lista fica
   * impossível de rolar. Com `modal`, o popover cuida da própria rolagem.
   */
  modal?: boolean;
}

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = "Selecione...",
  searchPlaceholder = "Buscar...",
  emptyText = "Nenhum item encontrado.",
  allOption = { value: "all", label: "Todos" },
  triggerClassName,
  contentClassName,
  modal,
}: SearchableSelectProps) {
  const selected =
    allOption && value === allOption.value
      ? allOption
      : options.find((o) => o.value === value);

  return (
    <Popover modal={modal}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className={cn(
            "w-[200px] justify-between text-xs font-normal neu-inset border-0",
            !selected && "text-muted-foreground",
            triggerClassName
          )}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-[240px] p-0 bg-popover", contentClassName)}
        align="start"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="text-xs" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {allOption && (
                <CommandItem
                  value={allOption.label}
                  onSelect={() => onValueChange(allOption.value)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-3.5 w-3.5",
                      value === allOption.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {allOption.label}
                </CommandItem>
              )}
              {options.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={opt.label}
                  onSelect={() => onValueChange(opt.value)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-3.5 w-3.5",
                      value === opt.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {opt.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
