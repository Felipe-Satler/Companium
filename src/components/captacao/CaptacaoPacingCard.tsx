import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { differenceInCalendarDays, endOfMonth, startOfMonth } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

function fmtCurrency(val: number) {
  return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Parser pt-BR tolerante: "12.000,50" / "12000" / "12.000" → número. Vazio → null.
function parseBRLInput(s: string): number | null {
  if (!s.trim()) return null;
  let t = s.replace(/[^\d.,]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, "");
  const n = parseFloat(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

interface CaptacaoPacingCardProps {
  /** Investimento acumulado no período selecionado (exclusivo do canal). */
  accumulated: number;
  /** Meta do período: soma das metas mensais dos meses selecionados (null = indefinida). */
  target: number | null;
  /** Valor da meta do mês editável (pré-preenche o editor). */
  monthTarget?: number | null;
  /** Rótulo do mês que será editado (ex.: "setembro de 2026"). */
  editMonthLabel?: string;
  /** Início/fim do período selecionado — define a janela de meses do pacing. */
  periodFrom?: Date;
  periodTo?: Date;
  /** Se o usuário pode editar a meta (admin ou crm_editor). */
  canEdit?: boolean;
  saving?: boolean;
  onSave?: (value: number | null) => void | Promise<void>;
}

export function CaptacaoPacingCard({
  accumulated,
  target,
  monthTarget = null,
  editMonthLabel,
  periodFrom,
  periodTo,
  canEdit = false,
  saving = false,
  onSave,
}: CaptacaoPacingCardProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const hasTarget = target != null && target > 0;

  const { consumidoPct, mesDecorridoPct, status, statusClass } = useMemo(() => {
    const now = new Date();
    // Janela-alvo = meses cheios tocados pelo período (default: mês corrente). O ritmo
    // esperado é a fração dessa janela já decorrida — funciona p/ 1 mês em curso, mês
    // fechado (100%) ou vários meses.
    const winStart = startOfMonth(periodFrom ?? now);
    const winEnd = endOfMonth(periodTo ?? periodFrom ?? now);
    const totalDias = differenceInCalendarDays(winEnd, winStart) + 1;
    const decorridoDias = Math.min(Math.max(differenceInCalendarDays(now, winStart) + 1, 0), totalDias);
    const mesDecorrido = totalDias > 0 ? decorridoDias / totalDias : 0;
    if (!hasTarget) {
      return { consumidoPct: null as number | null, mesDecorridoPct: Math.round(mesDecorrido * 100), status: null as string | null, statusClass: "" };
    }
    const consumido = accumulated / (target as number);
    const diff = consumido - mesDecorrido;
    let status = "NO RITMO";
    let statusClass = "text-emerald-600 dark:text-emerald-400 border-emerald-400/40 bg-emerald-400/10";
    if (diff < -0.08) {
      status = "DEVAGAR";
      statusClass = "text-amber-600 dark:text-amber-400 border-amber-400/40 bg-amber-400/10";
    } else if (diff > 0.08) {
      status = "ACELERADO";
      statusClass = "text-sky-600 dark:text-sky-400 border-sky-400/40 bg-sky-400/10";
    }
    return { consumidoPct: Math.round(consumido * 100), mesDecorridoPct: Math.round(mesDecorrido * 100), status, statusClass };
  }, [accumulated, target, hasTarget, periodFrom, periodTo]);

  const fill = hasTarget ? Math.min(Math.max(consumidoPct ?? 0, 0), 100) : 0;

  const handleSave = async () => {
    const parsed = parseBRLInput(draft);
    try {
      await onSave?.(parsed);
      setOpen(false);
      toast.success(parsed == null ? "Meta removida." : "Meta mensal salva.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar a meta.");
    }
  };

  const handleClear = async () => {
    try {
      await onSave?.(null);
      setOpen(false);
      toast.success("Meta removida.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível remover a meta.");
    }
  };

  // Meta do mês definida = valor positivo. 0 (ou null) conta como "sem meta" (removida).
  const hasMonthTarget = (monthTarget ?? 0) > 0;

  const openEditor = () => {
    // Pré-preenche com a meta do MÊS editável (não a soma do período). Zerada → vazio.
    setDraft(hasMonthTarget ? String(monthTarget) : "");
    setOpen(true);
  };

  const metaLine = hasTarget ? (
    <span className="text-[11px] text-muted-foreground">
      de {fmtCurrency(target as number)} · {consumidoPct}%
    </span>
  ) : (
    <span className="text-[11px] text-muted-foreground">Meta do período não definida</span>
  );

  return (
    <div className="neu-card rounded-xl p-5 flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Pacing mensal</h3>
          <p className="text-[11px] text-muted-foreground">Investimento do período vs. meta do(s) mês(es) selecionado(s).</p>
        </div>
        {status ? (
          <span className={`neu-inset rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${statusClass}`}>
            {status}
          </span>
        ) : canEdit ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" onClick={openEditor} className="neu-button h-7 gap-1 text-[10px]">
                <Pencil className="h-3 w-3" /> Definir meta
              </Button>
            </PopoverTrigger>
            <EditorContent draft={draft} setDraft={setDraft} onSave={handleSave} onClear={handleClear} saving={saving} hasTarget={hasMonthTarget} editMonthLabel={editMonthLabel} setOpen={setOpen} />
          </Popover>
        ) : null}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center py-4">
        <div className="relative w-full max-w-[240px]">
          <svg viewBox="0 0 220 120" className="w-full">
            <path d="M 16 110 A 94 94 0 0 1 204 110" fill="none" stroke="hsl(var(--muted-foreground))" strokeOpacity={0.18} strokeWidth={14} strokeLinecap="round" pathLength={100} />
            <path d="M 16 110 A 94 94 0 0 1 204 110" fill="none" stroke="hsl(var(--primary))" strokeWidth={14} strokeLinecap="round" pathLength={100} strokeDasharray={`${fill} 100`} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-1 text-center">
            <span className="text-2xl font-bold text-foreground">{fmtCurrency(accumulated)}</span>
            {/* Meta: clicável p/ editar quando permitido e já definida. */}
            {hasTarget && canEdit ? (
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <button onClick={openEditor} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                    {metaLine}
                    <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <EditorContent draft={draft} setDraft={setDraft} onSave={handleSave} onClear={handleClear} saving={saving} hasTarget={hasMonthTarget} editMonthLabel={editMonthLabel} setOpen={setOpen} />
              </Popover>
            ) : (
              metaLine
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/40 pt-3">
        <span>Período decorrido: <span className="font-semibold text-foreground">{mesDecorridoPct}%</span></span>
        <span>Orçamento consumido: <span className="font-semibold text-foreground">{consumidoPct != null ? `${consumidoPct}%` : "—"}</span></span>
      </div>
    </div>
  );
}

function EditorContent({
  draft, setDraft, onSave, onClear, saving, hasTarget, editMonthLabel, setOpen,
}: {
  draft: string;
  setDraft: (s: string) => void;
  onSave: () => void;
  onClear: () => void;
  saving: boolean;
  hasTarget: boolean;
  editMonthLabel?: string;
  setOpen: (o: boolean) => void;
}) {
  return (
    <PopoverContent className="w-64 p-3 space-y-3" align="end">
      <div className="space-y-1">
        <label className="text-xs font-medium text-foreground">
          Meta mensal de investimento{editMonthLabel ? ` — ${editMonthLabel}` : ""}
        </label>
        <input
          autoFocus
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onSave(); }}
          placeholder="Ex.: 12.000"
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
        />
        <p className="text-[10px] text-muted-foreground">Vazio remove a meta.</p>
      </div>
      <div className="flex items-center justify-between gap-2">
        {hasTarget ? (
          <Button size="sm" variant="ghost" onClick={onClear} disabled={saving} className="text-xs text-destructive hover:text-destructive">Remover</Button>
        ) : <span />}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={saving} className="text-xs">Cancelar</Button>
          <Button size="sm" onClick={onSave} disabled={saving} className="neu-button-primary text-xs">{saving ? "..." : "Salvar"}</Button>
        </div>
      </div>
    </PopoverContent>
  );
}
