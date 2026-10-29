import { useMemo, useState } from "react";
import { Check, ChevronDown, Filter, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { norm } from "@/lib/texto";
import { cn } from "@/lib/utils";

export interface MultiOption {
  id: string;
  label: string;
}

interface MetasMultiSelectProps {
  /** Título dentro do popover, ex.: "Squads". */
  title: string;
  options: MultiOption[];
  /** Ids marcados. Vazio = nenhum filtro, o que a tela lê como "todos". */
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Rótulo do botão quando nada está marcado, ex.: "Todos os squads". */
  placeholder: string;
  /** Substantivo plural p/ a contagem no botão, ex.: "métricas" → "3 métricas". */
  pluralNoun: string;
  /** Desabilita o filtro inteiro (fonte de dados ainda não conectada). */
  disabled?: boolean;
  /** Aviso curto dentro do popover (ex.: a planilha de squads ainda não sincronizada). */
  hint?: string;
  /**
   * Campo de busca dentro do popover. FILTRA a lista — não aceita termo novo, porque o valor
   * escolhido tem de casar com a lista de origem para os filtros funcionarem depois.
   * Opcional: as listas curtas (squads, métricas) não ganham nada com ele.
   */
  searchable?: boolean;
  /**
   * Necessário quando este select vive DENTRO de um Dialog. O popover é portalado para fora do
   * diálogo, e a trava de rolagem do Radix Dialog bloqueia a roda do mouse fora da árvore dele —
   * a lista ficava impossível de rolar. Com `modal`, o popover cuida da própria rolagem.
   */
  modal?: boolean;
  className?: string;
}

/**
 * Filtro multi-seleção em dropdown (checkbox por opção), no mesmo padrão visual do
 * OrigemMultiSelect das outras telas de /clientes. O campo de busca é opcional (`searchable`):
 * as listas daqui são curtas (squads e as 9 métricas com meta) e não ganham nada com ele, mas a
 * de especialidades é longa.
 *
 * Nada marcado = TODOS. O botão diz isso em texto para o usuário não precisar abrir o menu
 * para descobrir que o filtro está aberto.
 */
export function MetasMultiSelect({
  title,
  options,
  selected,
  onChange,
  placeholder,
  pluralNoun,
  disabled,
  hint,
  searchable,
  modal,
  className,
}: MetasMultiSelectProps) {
  const [busca, setBusca] = useState("");
  const allSelected = selected.length === 0;

  const visiveis = useMemo(() => {
    const termo = norm(busca.trim());
    if (!searchable || !termo) return options;
    return options.filter((o) => norm(o.label).includes(termo));
  }, [options, busca, searchable]);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id]);
  };

  const label = allSelected
    ? placeholder
    : selected.length === 1
      ? (options.find((o) => o.id === selected[0])?.label ?? `1 ${pluralNoun}`)
      : `${selected.length} ${pluralNoun}`;

  return (
    <Popover modal={modal} onOpenChange={(aberto) => !aberto && setBusca("")}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          title={disabled ? hint : undefined}
          className={cn(
            "w-[200px] justify-between text-left text-xs font-normal neu-inset border-0",
            allSelected && "text-muted-foreground",
            disabled && "cursor-not-allowed opacity-50",
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
            <Filter className="h-3 w-3 text-primary" /> {title}
          </span>
          {!allSelected && (
            <button onClick={() => onChange([])} className="text-[10px] font-medium text-primary hover:underline">
              Limpar
            </button>
          )}
        </div>
        {hint && <p className="px-1 pb-2 text-[10px] leading-snug text-muted-foreground">{hint}</p>}
        {searchable && (
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Filtrar…"
              aria-label={`Filtrar ${title.toLowerCase()}`}
              disabled={disabled}
              className="h-8 pl-8 text-xs"
            />
          </div>
        )}
        <div className="max-h-[260px] overflow-y-auto space-y-1 pr-1">
          {visiveis.map((opt) => {
            const checked = selected.includes(opt.id);
            return (
              <label
                key={opt.id}
                className={cn(
                  "flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-all",
                  disabled
                    ? "cursor-not-allowed text-muted-foreground opacity-50"
                    : checked
                      ? "neu-inset text-foreground font-medium cursor-pointer"
                      : "hover:neu-inset text-muted-foreground hover:text-foreground cursor-pointer",
                )}
              >
                <Checkbox checked={checked} disabled={disabled} onCheckedChange={() => toggle(opt.id)} />
                <span className="truncate flex-1">{opt.label}</span>
                {checked && <Check className="h-3 w-3 text-primary" />}
              </label>
            );
          })}
          {visiveis.length === 0 && (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
              {options.length === 0 ? "Nada disponível" : `Nada encontrado para “${busca.trim()}”`}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
