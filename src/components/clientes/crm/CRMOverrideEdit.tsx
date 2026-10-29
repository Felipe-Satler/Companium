import { useState, useEffect, useRef } from "react";
import { Pencil, Plus, Minus, Trash2, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CRMOverridesCtx } from "@/hooks/useCRMOverrides";
import { CRMOverrideMetric, isCurrencyMetric } from "@/utils/crmOverrides";

// Aceita número em pt-BR (vírgula) ou ponto. "" → NaN.
function parseNum(s: string): number {
  const t = s.trim();
  if (t === "") return NaN;
  if (t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  return Number(t);
}

function fmtInt(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function fmtCurrency(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Rótulo do valor CALCULADO/corrigido conforme o tipo da métrica (moeda × contagem).
function fmtValue(n: number, currency: boolean): string {
  return currency ? fmtCurrency(n) : fmtInt(n);
}

/**
 * Correção manual de UM número do CRM (Leads/Consultas/Procedimentos) para o VIEW filtrado.
 * O valor gravado SUBSTITUI o calculado e cola no recorte até ser removido.
 *
 * Visibilidade:
 *  • canEdit=false e SEM correção → não renderiza nada (invisível p/ quem não pode editar).
 *  • canEdit=false e COM correção → selo "editado" (só leitura, sem controles).
 *  • canEdit=true → gatilho "ajustar" (ou "editado" clicável) que abre o popover.
 */
export function CRMOverrideEdit({
  ctx,
  metric,
  computed,
  label,
  canEdit,
  periodLabel,
  triggerText = "ajustar",
}: {
  ctx?: CRMOverridesCtx;
  metric: CRMOverrideMetric;
  /** Valor CALCULADO (sem correção) — prefill do editor e referência mostrada no popover. */
  computed: number;
  label: string;
  canEdit: boolean;
  /** Rótulo do período filtrado, ex.: "ago/2026". */
  periodLabel?: string;
  /** Texto do gatilho quando não há correção (ex.: "ajustar nº", "ajustar valor"). */
  triggerText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const currency = isCurrencyMetric(metric); // valor em R$ (aceita centavos) × contagem inteira
  const overridden = !!ctx?.has(metric);
  // Correção gravada EXATAMENTE neste recorte (vs. soma derivada das correções por origem,
  // que existe só na visão combinada e não tem uma linha própria p/ remover aqui).
  const hasExactOverride = ctx?.hasExact ? ctx.hasExact(metric) : overridden;
  const current = ctx?.get(metric); // valor corrigido (ou soma por origem), se houver
  const saving = !!ctx?.saving;

  useEffect(() => {
    if (open) {
      const prefill = overridden && current != null ? current : computed;
      // Moeda: prefill com centavos (pt-BR "1.234,56"); contagem: inteiro arredondado.
      setDraft(
        currency
          ? prefill.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : String(Math.round(prefill))
      );
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [open, overridden, current, computed, currency]);

  // Sem contexto, ou (não pode editar E não há correção) → nada a mostrar.
  if (!ctx) return null;
  if (!canEdit && !overridden) return null;

  // Passo do +/-: contagem = 1; moeda = R$ 50 (arredonda p/ 2 casas).
  const step = currency ? 50 : 1;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const bump = (dir: 1 | -1) => {
    const cur = parseNum(draft);
    const base = Number.isFinite(cur) ? cur : 0;
    const next = Math.max(0, base + dir * step);
    setDraft(
      currency
        ? round2(next).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : String(Math.round(next))
    );
    inputRef.current?.focus();
  };

  // Mostra o motivo REAL de uma falha de gravação (antes era engolida em silêncio, o que fazia
  // a correção "não salvar" sem nenhum aviso — principalmente em clientes sem dado no CRM, onde
  // o card simplesmente voltava a 0). O erro do Postgres (RLS, constraint, coluna) aparece aqui.
  const reportError = (verb: string) => (e: unknown) => {
    const msg = (e as { message?: string })?.message ?? String(e);
    toast.error(`Não foi possível ${verb} a correção de "${label}": ${msg}`);
  };

  const commit = () => {
    const t = draft.trim();
    if (t === "") {
      // Vazio + Salvar = remover a correção (volta ao calculado). Só há o que remover
      // quando existe uma correção gravada NESTE recorte (soma derivada não se remove aqui).
      if (hasExactOverride) {
        ctx.clear(metric).then(() => toast.success(`Correção de "${label}" removida.`)).catch(reportError("remover"));
      }
    } else {
      const n = parseNum(t);
      if (Number.isFinite(n)) {
        ctx
          .save(metric, Math.max(0, currency ? round2(n) : n))
          .then(() => toast.success(`Correção de "${label}" salva.`))
          .catch(reportError("salvar"));
      }
    }
    setOpen(false);
  };

  // Selo passivo (quem não pode editar): apenas informa que o número é manual.
  if (!canEdit) {
    return (
      <span
        className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400"
        title={`${label} ajustado manualmente${current != null ? ` para ${fmtValue(current, currency)}` : ""} (calculado: ${fmtValue(computed, currency)})`}
      >
        <PencilLine className="h-2.5 w-2.5 shrink-0" />
        editado
      </span>
    );
  }

  // Gatilho editável (span, não <button>, p/ conviver dentro de cards-botão).
  const trigger = overridden ? (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
          setOpen(true);
        }
      }}
      className="mt-1 inline-flex cursor-pointer items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
      title={`Correção manual (calculado: ${fmtValue(computed, currency)}). Clique para ajustar ou remover.`}
    >
      <PencilLine className="h-2.5 w-2.5 shrink-0" />
      editado
    </span>
  ) : (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
          setOpen(true);
        }
      }}
      className="mt-1 inline-flex max-w-full cursor-pointer items-start gap-1 rounded px-1 -mx-1 text-left text-[10px] text-muted-foreground transition-colors hover:text-foreground"
      title="Ajustar este valor para o período filtrado"
    >
      <Pencil className="mt-0.5 h-2.5 w-2.5 shrink-0 text-primary/70" />
      <span className="min-w-0 whitespace-normal break-words leading-tight">{triggerText}</span>
    </span>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="center"
        collisionPadding={16}
        className="w-72 max-w-[calc(100vw-2rem)] p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div>
          <p className="text-sm font-bold text-foreground">Corrigir · {label}</p>
          <p className="text-[11px] text-muted-foreground">
            {periodLabel ? `${periodLabel} · ` : ""}vale para o filtro atual
          </p>
        </div>

        <div className="flex items-stretch gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={saving}
            onClick={() => bump(-1)}
            className="h-14 w-11 shrink-0 text-lg"
            aria-label="Diminuir"
          >
            <Minus className="h-5 w-5" />
          </Button>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d.,-]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setOpen(false);
              if (e.key === "ArrowUp") {
                e.preventDefault();
                bump(1);
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                bump(-1);
              }
            }}
            placeholder={currency ? "0,00" : "0"}
            className="h-14 min-w-0 flex-1 rounded-md border border-input bg-background text-center text-2xl font-extrabold text-foreground tabular-nums outline-none focus:ring-2 focus:ring-primary"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={saving}
            onClick={() => bump(1)}
            className="h-14 w-11 shrink-0 text-lg"
            aria-label="Aumentar"
          >
            <Plus className="h-5 w-5" />
          </Button>
        </div>

        <p className="text-[10px] text-muted-foreground text-center">
          Calculado do banco: <b className="text-foreground">{fmtValue(computed, currency)}</b>. O valor salvo
          fica fixo neste filtro até ser removido.
        </p>

        <div className="flex items-center gap-2">
          <Button size="sm" className="flex-1" disabled={saving} onClick={commit}>
            Salvar correção
          </Button>
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>
            Cancelar
          </Button>
        </div>
        {hasExactOverride && (
          <Button
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => {
              ctx.clear(metric).then(() => toast.success(`Correção de "${label}" removida.`)).catch(reportError("remover"));
              setOpen(false);
            }}
            className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" /> Remover correção (voltar ao calculado)
          </Button>
        )}
        {!hasExactOverride && overridden && (
          <p className="text-[10px] text-muted-foreground text-center">
            Este valor é a <b className="text-foreground">soma</b> das correções dos sub-recortes (por{" "}
            <b className="text-foreground">mês</b>, <b className="text-foreground">origem</b> e/ou{" "}
            <b className="text-foreground">procedimento</b>). Salvar aqui grava uma correção própria deste
            recorte combinado.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
