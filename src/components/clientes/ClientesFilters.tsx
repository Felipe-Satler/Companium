import { format } from "date-fns";
import { CalendarIcon, Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { OrigemMultiSelect } from "./OrigemMultiSelect";
import { MedicoMultiSelect } from "./MedicoMultiSelect";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { prettyClientLabel } from "@/data/clienteAliases";

export interface ClientesFiltersState {
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  client: string;
  especialidade: string;
  origem: string[]; // [] = todas
  medico: string[]; // [] = todos (multi-seleção; inclui a opção "Sem médico")
  tags: string[]; // [] = todas (nomes de tag; só surge na tela de CRM)
  /** "include" = clientes que TÊM alguma das tags; "exclude" = clientes que NÃO têm nenhuma delas. */
  tagsMode: "include" | "exclude";
  /** true (padrão) = só clientes ATIVO na planilha; false = carteira histórica inteira. */
  apenasAtivos: boolean;
}

interface ClientesFiltersProps {
  filters: ClientesFiltersState;
  onFiltersChange: (filters: ClientesFiltersState) => void;
  clients: string[];
  especialidades: string[];
  origens?: string[];
  medicos?: string[];
}

export function ClientesFilters({
  filters,
  onFiltersChange,
  clients,
  especialidades,
  origens,
  medicos,
}: ClientesFiltersProps) {
  const hasActiveFilters =
    filters.dateFrom || filters.dateTo || filters.client !== "all" || filters.especialidade !== "all" || filters.origem.length > 0 || filters.medico.length > 0 || (filters.tags?.length ?? 0) > 0;

  const clearFilters = () => {
    onFiltersChange({
      dateFrom: undefined,
      dateTo: undefined,
      client: "all",
      apenasAtivos: true,
      especialidade: "all",
      origem: [],
      medico: [],
      tags: [],
      tagsMode: "include",
    });
  };

  return (
    <div className="neu-card rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Filter className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Filtros</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Período (range único + presets) */}
        <DateRangePicker
          from={filters.dateFrom}
          to={filters.dateTo}
          onChange={({ from, to }) =>
            onFiltersChange({ ...filters, dateFrom: from, dateTo: to })
          }
        />

        {/* Cliente */}
        <SearchableSelect
          value={filters.client}
          onValueChange={(val) => onFiltersChange({ ...filters, client: val })}
          options={clients.map((c) => ({
            value: c,
            // Display-only: rótulo oficial do cliente (CLIENT_DISPLAY_LABELS) com fallback
            // p/ underscore→espaço + strip "groohub". O `value` segue sendo o canônico p/ matching.
            label: prettyClientLabel(c),
          }))}
          placeholder="Todos os clientes"
          searchPlaceholder="Buscar cliente..."
          emptyText="Nenhum cliente encontrado."
          allOption={{ value: "all", label: "Todos os clientes" }}
          triggerClassName="w-[220px]"
          contentClassName="w-[260px]"
        />

        {/* Especialidade */}
        <SearchableSelect
          value={filters.especialidade}
          onValueChange={(val) =>
            onFiltersChange({ ...filters, especialidade: val })
          }
          options={especialidades.map((e) => ({ value: e, label: e }))}
          placeholder="Todas as especialidades"
          searchPlaceholder="Buscar especialidade..."
          emptyText="Nenhuma especialidade encontrada."
          allOption={{ value: "all", label: "Todas as especialidades" }}
        />

        {/* Origem (multi-select) */}
        {origens && origens.length > 0 && (
          <OrigemMultiSelect
            value={filters.origem}
            onChange={(val) => onFiltersChange({ ...filters, origem: val })}
            options={origens}
          />
        )}

        {/* Médico (multi-seleção; aparece só quando o cliente tem mais de um) */}
        {medicos && medicos.length > 1 && (
          <MedicoMultiSelect
            value={filters.medico}
            onChange={(val) => onFiltersChange({ ...filters, medico: val })}
            options={medicos}
          />
        )}

        {hasActiveFilters && (
          <Button
            variant="outline"
            size="sm"
            onClick={clearFilters}
            className="flex items-center gap-1.5 text-xs font-medium bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/20 hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
            Limpar filtros
          </Button>
        )}
      </div>
    </div>
  );
}

// Função (não objeto fixo) para evitar congelar a data no momento do load do módulo.
// Default gerencial: 1º dia do mês atual → hoje. "Limpar filtros" zera para undefined.
export function getDefaultFilters(): ClientesFiltersState {
  const now = new Date();
  return {
    dateFrom: new Date(now.getFullYear(), now.getMonth(), 1),
    dateTo: now,
    client: "all",
    especialidade: "all",
    origem: [],
    medico: [],
    tags: [],
    tagsMode: "include",
    apenasAtivos: true,
  };
}

// Mantido para compatibilidade caso outro módulo ainda importe — prefira getDefaultFilters().
export const defaultFilters: ClientesFiltersState = {
  apenasAtivos: true,
  dateFrom: undefined,
  dateTo: undefined,
  client: "all",
  especialidade: "all",
  origem: [],
  medico: [],
  tags: [],
  tagsMode: "include",
};
