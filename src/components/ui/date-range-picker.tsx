import { useEffect, useState } from "react";
import { CalendarIcon } from "lucide-react";
import {
  format,
  isSameDay,
  subDays,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfQuarter,
  endOfQuarter,
  subQuarters,
  startOfYear,
  endOfYear,
  subYears,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DateRangePickerProps {
  from?: Date;
  to?: Date;
  onChange: (range: { from?: Date; to?: Date }) => void;
  className?: string;
  placeholder?: string;
  /**
   * Nome acessível do botão. Sem ele o botão se anuncia só pela data que mostra, e uma tela com
   * dois seletores (período analisado × período de comparação) fica com dois botões
   * indistinguíveis — de posição, para quem enxerga; de nome, para quem usa leitor de tela.
   */
  ariaLabel?: string;
}

type Preset = { label: string; getRange: () => { from: Date; to: Date } };

// Calculado no clique (não no load do módulo) pra "hoje" estar sempre atual.
function buildPresets(): Preset[] {
  const today = new Date();
  const yesterday = subDays(today, 1);
  return [
    { label: "Hoje", getRange: () => ({ from: today, to: today }) },
    { label: "Ontem", getRange: () => ({ from: yesterday, to: yesterday }) },
    { label: "Últimos 7 dias", getRange: () => ({ from: subDays(today, 6), to: today }) },
    { label: "Últimos 30 dias", getRange: () => ({ from: subDays(today, 29), to: today }) },
    { label: "Últimos 90 dias", getRange: () => ({ from: subDays(today, 89), to: today }) },
    { label: "Este mês", getRange: () => ({ from: startOfMonth(today), to: today }) },
    { label: "Último mês", getRange: () => ({ from: startOfMonth(subMonths(today, 1)), to: endOfMonth(subMonths(today, 1)) }) },
    { label: "Este trimestre", getRange: () => ({ from: startOfQuarter(today), to: today }) },
    { label: "Último trimestre", getRange: () => ({ from: startOfQuarter(subQuarters(today, 1)), to: endOfQuarter(subQuarters(today, 1)) }) },
    { label: "Este ano", getRange: () => ({ from: startOfYear(today), to: today }) },
    { label: "Último ano", getRange: () => ({ from: startOfYear(subYears(today, 1)), to: endOfYear(subYears(today, 1)) }) },
  ];
}

/**
 * Seletor de período: um único calendário (modo range, 2 meses) para escolher
 * data inicial e final, com presets prontos (últimos 7/30/90 dias, este/último
 * mês, este/último trimestre, este/último ano).
 */
export function DateRangePicker({
  from,
  to,
  onChange,
  className,
  placeholder = "Selecionar período",
  ariaLabel,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  // Rascunho local: seleção de data/preset só altera isto. O onChange (que
  // dispara o refetch no pai) só é chamado quando o usuário clica em "Aplicar".
  const [draftFrom, setDraftFrom] = useState<Date | undefined>(from);
  const [draftTo, setDraftTo] = useState<Date | undefined>(to);

  // Ao abrir o popover, sincroniza o rascunho com o valor aplicado atual.
  useEffect(() => {
    if (open) {
      setDraftFrom(from);
      setDraftTo(to);
    }
  }, [open, from, to]);

  const label = from
    ? to
      ? `${format(from, "dd/MM/yyyy")} – ${format(to, "dd/MM/yyyy")}`
      : format(from, "dd/MM/yyyy")
    : placeholder;

  const selected: DateRange | undefined = draftFrom ? { from: draftFrom, to: draftTo } : undefined;

  // Seleção mais previsível que o range padrão do react-day-picker:
  // - range já completo (from+to) → um novo clique RECOMEÇA o intervalo nesse dia
  //   (não precisa "Limpar" antes p/ escolher outro período);
  // - clicar de novo no único dia marcado → DESMARCA (corrige a desmarcação);
  // - caso normal (1º e 2º clique) → usa o range que o calendário calculou, já ordenado.
  const handleSelect = (range: DateRange | undefined, clickedDay: Date) => {
    if (draftFrom && draftTo) {
      setDraftFrom(clickedDay);
      setDraftTo(undefined);
      return;
    }
    if (draftFrom && !draftTo && isSameDay(clickedDay, draftFrom)) {
      setDraftFrom(undefined);
      setDraftTo(undefined);
      return;
    }
    setDraftFrom(range?.from);
    setDraftTo(range?.to);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          // Sem nome, o botão se anuncia só pela data que mostra. Numa tela com DOIS seletores
          // (o período analisado e o de comparação, na aba Relatório), quem usa leitor de tela ouve
          // dois botões indistinguíveis — e quem enxerga depende da posição para saber qual é qual.
          aria-label={ariaLabel}
          className={cn(
            "min-w-[230px] justify-start text-left text-xs font-normal neu-inset border-0",
            !from && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-3.5 w-3.5" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col sm:flex-row">
          {/* Presets */}
          <div className="flex flex-col gap-0.5 border-b border-border p-2 sm:border-b-0 sm:border-r sm:min-w-[160px]">
            {buildPresets().map((p) => (
              <Button
                key={p.label}
                variant="ghost"
                size="sm"
                className="justify-start h-8 text-xs font-normal"
                onClick={() => {
                  // Preset é um clique deliberado e único: aplica na hora e fecha (não
                  // exige "Aplicar"). Só a seleção manual no calendário fica em rascunho.
                  const r = p.getRange();
                  setDraftFrom(r.from);
                  setDraftTo(r.to);
                  onChange({ from: r.from, to: r.to });
                  setOpen(false);
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>

          {/* Calendário range */}
          <div>
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={selected}
              defaultMonth={draftFrom ?? draftTo ?? new Date()}
              onSelect={(r, clickedDay) => handleSelect(r, clickedDay)}
              locale={ptBR}
              initialFocus
              className="p-3 pointer-events-auto"
            />
            <div className="flex justify-end gap-2 border-t border-border p-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => {
                  setDraftFrom(undefined);
                  setDraftTo(undefined);
                }}
              >
                Limpar
              </Button>
              <Button
                size="sm"
                className="text-xs"
                onClick={() => {
                  // Dia único: ao selecionar só uma data no calendário, o
                  // react-day-picker deixa `to` indefinido. Sem `to` os hooks
                  // aplicam apenas o limite inferior (.gte) e o filtro de 1 dia
                  // não restringe nada. Colapsa para from..from.
                  onChange({ from: draftFrom, to: draftTo ?? draftFrom });
                  setOpen(false);
                }}
              >
                Aplicar
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
