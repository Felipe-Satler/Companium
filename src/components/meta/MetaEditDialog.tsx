import * as React from "react";
import type { DateRange } from "react-day-picker";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, CalendarIcon, RotateCcw, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { mesLabel } from "@/lib/metaDatas";
import { type CaptacaoMetaRow, linhaVazia, valorDe } from "@/hooks/useCaptacaoMetas";
import { mesAtualStr, podeEditarMes, type MetasEditScope } from "@/lib/metasEditScope";
import { INDICADORES, campoDe, varianteLabel, variantesDe } from "./metaIndicadores";

/** Lista de meses (AAAA-MM) cobertos por um intervalo de dias. */
export function mesesDoPeriodo(range: DateRange | undefined): string[] {
  if (!range?.from) return [];
  const fim = range.to ?? range.from;
  const meses: string[] = [];
  const cursor = new Date(range.from.getFullYear(), range.from.getMonth(), 1);
  const limite = new Date(fim.getFullYear(), fim.getMonth(), 1);
  while (cursor <= limite) {
    meses.push(format(cursor, "yyyy-MM"));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return meses;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: CaptacaoMetaRow[];
  periodo: DateRange | undefined;
  onPeriodoChange: (range: DateRange | undefined) => void;
  salvando: boolean;
  onSalvar: (rows: CaptacaoMetaRow[]) => void;
  /** Escopos de edição por intervalo de mês (passado/presente/futuro). Um mês fora dos
   *  escopos concedidos não pode ser selecionado nem salvo. */
  scope: MetasEditScope;
}

export function MetaEditDialog({
  open,
  onOpenChange,
  rows,
  periodo,
  onPeriodoChange,
  salvando,
  onSalvar,
  scope,
}: Props) {
  const [valores, setValores] = React.useState<Record<string, string>>({});

  const meses = React.useMemo(() => mesesDoPeriodo(periodo), [periodo]);
  const mesBase = meses[0] ?? null;

  const mesAtual = React.useMemo(() => mesAtualStr(), []);
  const podeTudo = scope.past && scope.present && scope.future;
  // Meses do período fora dos escopos concedidos (bloqueiam o salvamento).
  const mesesBloqueados = React.useMemo(
    () => meses.filter((m) => !podeEditarMes(m, mesAtual, scope)),
    [meses, mesAtual, scope]
  );
  const temMesBloqueado = mesesBloqueados.length > 0;
  // Desabilita no calendário qualquer dia cujo mês o usuário não pode editar.
  const diaBloqueado = React.useCallback(
    (day: Date) => !podeEditarMes(format(day, "yyyy-MM"), mesAtual, scope),
    [mesAtual, scope]
  );

  const carregarMes = React.useCallback(
    (m: string | null) => {
      const existente = (m ? rows.find((r) => r.mes === m) : undefined) ?? linhaVazia(m ?? "");
      const next: Record<string, string> = {};
      for (const ind of INDICADORES) {
        for (const v of variantesDe(ind)) {
          next[campoDe(ind.key, "plan", v)] = String(valorDe(existente, ind.key, "plan", v) ?? 0);
          next[campoDe(ind.key, "real", v)] = String(valorDe(existente, ind.key, "real", v) ?? 0);
        }
      }
      setValores(next);
    },
    [rows]
  );

  // Recarrega os valores ao abrir o diálogo ou ao trocar o período selecionado.
  React.useEffect(() => {
    if (!open) return;
    carregarMes(mesBase);
  }, [open, mesBase, carregarMes]);

  const resetarMes = () => {
    setValores((prev) => {
      const next = { ...prev };
      for (const campo of Object.keys(next)) next[campo] = "0";
      return next;
    });
  };

  const set = (campo: string, v: string) => setValores((prev) => ({ ...prev, [campo]: v }));

  const submit = () => {
    const alvos = meses.length ? meses : [];
    if (!alvos.length) return;
    // Trava de UI: não deixa enviar meses fora dos escopos concedidos.
    if (temMesBloqueado) return;
    const payload = alvos.map((m) => {
      const row = linhaVazia(m) as unknown as Record<string, unknown>;
      for (const ind of INDICADORES) {
        for (const v of variantesDe(ind)) {
          row[campoDe(ind.key, "plan", v)] = Number(
            valores[campoDe(ind.key, "plan", v)]?.replace(",", ".") || 0
          );
          row[campoDe(ind.key, "real", v)] = Number(
            valores[campoDe(ind.key, "real", v)]?.replace(",", ".") || 0
          );
        }
      }
      return row as unknown as CaptacaoMetaRow;
    });
    onSalvar(payload);
  };

  const periodoLabel = periodo?.from
    ? periodo.to && periodo.to.getTime() !== periodo.from.getTime()
      ? `${format(periodo.from, "dd/MM/yyyy")} – ${format(periodo.to, "dd/MM/yyyy")}`
      : format(periodo.from, "dd/MM/yyyy")
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="neu-dialog max-w-2xl max-h-[85vh] overflow-y-auto neu-scroll p-0">
        <div className="p-6 space-y-5">
          <DialogHeader className="pb-4 border-b border-border/50">
            <div className="flex items-center gap-3">
              <div className="neu-button rounded-xl p-2.5 text-primary">
                <CalendarDays className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <DialogTitle className="text-base font-semibold tracking-tight">
                  Cadastrar / atualizar metas do período
                </DialogTitle>
                <p className="text-xs text-muted-foreground">
                  Preencha o planejado e o real para cada indicador.
                </p>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4">
            <div className="neu-card rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-3.5 w-3.5 text-primary" />
                <Label className="text-xs font-medium text-foreground">Período de referência</Label>
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left text-xs font-normal neu-inset border-0",
                      !periodoLabel && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                    {periodoLabel ?? "Selecione o dia ou intervalo"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="range"
                    selected={periodo}
                    onSelect={onPeriodoChange}
                    numberOfMonths={2}
                    locale={ptBR}
                    initialFocus
                    // Desabilita dias de meses fora dos escopos concedidos (passado/presente/futuro).
                    disabled={podeTudo ? undefined : diaBloqueado}
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              {meses.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Metas aplicadas a: {meses.map(mesLabel).join(", ")}
                </p>
              )}
              {!podeTudo && (
                <p className="text-[11px] text-muted-foreground">
                  Você pode editar:{" "}
                  {[
                    scope.past && "meses anteriores",
                    scope.present && "mês atual",
                    scope.future && "meses futuros",
                  ]
                    .filter(Boolean)
                    .join(", ") || "nenhum mês (peça acesso ao administrador)"}
                  .
                </p>
              )}
              {temMesBloqueado && (
                <p className="text-[11px] font-medium text-destructive">
                  Período inclui mês(es) fora do seu acesso — remova{" "}
                  {mesesBloqueados.map(mesLabel).join(", ")} para salvar.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {INDICADORES.map((ind) => (
                <div key={ind.key} className="neu-inset rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-foreground">{ind.label}</p>
                  {variantesDe(ind).map((v) => {
                    const sub = !!v && (ind.subvariantes?.includes(v) ?? false);
                    return (
                    <div key={v ?? "unico"} className={sub ? "space-y-1 pl-3" : "space-y-1"}>
                      {v && (
                        <p
                          className={
                            sub
                              ? "text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1"
                              : "text-[10px] font-medium text-primary uppercase tracking-wide"
                          }
                        >
                          {sub && <span className="text-muted-foreground/40 normal-case">└</span>}
                          {varianteLabel(v)}
                        </p>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Real</Label>
                          {ind.key === "investimento" ? (
                            // Investimento real é calculado do banco (Meta Ads + Google Ads);
                            // não é mais editável manualmente. Ver useCaptacaoInvestimentoReal.
                            <div className="h-8 flex items-center rounded-md neu-inset px-2 text-[10px] text-muted-foreground">
                              Automático (Meta + Google)
                            </div>
                          ) : (
                            <Input
                              type="number"
                              inputMode="decimal"
                              className="h-8 text-xs"
                              value={valores[campoDe(ind.key, "real", v)] ?? ""}
                              onChange={(e) => set(campoDe(ind.key, "real", v), e.target.value)}
                            />
                          )}
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Planejado</Label>
                          <Input
                            type="number"
                            inputMode="decimal"
                            className="h-8 text-xs"
                            value={valores[campoDe(ind.key, "plan", v)] ?? ""}
                            onChange={(e) => set(campoDe(ind.key, "plan", v), e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="gap-3 sm:justify-between items-center pt-4 border-t border-border/50">
            <Button
              variant="outline"
              onClick={resetarMes}
              disabled={salvando}
              className="neu-button border-0 text-xs text-destructive hover:text-destructive"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Resetar metas
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={salvando}
                className="neu-button border-0 text-xs"
              >
                Cancelar
              </Button>
              <Button
                onClick={submit}
                disabled={salvando || !meses.length || temMesBloqueado}
                className="neu-button-primary border-0 h-9 px-5 text-xs font-semibold tracking-wide"
              >
                <Save className="h-3.5 w-3.5 mr-1.5" />
                {salvando ? "Salvando..." : "Salvar período"}
              </Button>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
