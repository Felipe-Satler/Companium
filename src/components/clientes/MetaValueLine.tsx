import { useState, useEffect, useRef } from "react";
import { Pencil, Plus, Minus, AlertTriangle, Trash2 } from "lucide-react";
import { MetaKind, MetaKey, MetaCardsCtx, META_LABELS } from "@/hooks/useClientesMetas";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

// Aceita número quebrado em pt-BR (vírgula) ou ponto. "3,7"/"3.7" → 3.7;
// "1.500,50" → 1500.5 (vírgula = decimal, ponto = milhar). "" → NaN.
function parseNum(s: string): number {
  const t = s.trim();
  if (t === "") return NaN;
  if (t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  return Number(t);
}

function fmtMeta(value: number, kind: MetaKind): string {
  if (kind === "currency") return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (kind === "ratio") return `${value.toFixed(2)}x`;
  // count: NÃO arredonda — mantém o valor digitado (mês 3,7 → "3,7"); o rateio mostra
  // a divisão (dia 0,1). Até 1 casa decimal, sem zeros à direita (40 → "40").
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

interface MetaValueLineProps {
  /** Valor "real" já existente, formatado — repetido na caixa "Real". */
  realText: string;
  /** Valor "real" numérico — usado p/ calcular o % do planejado já atingido. */
  realValue?: number;
  /** Meta resolvida para o período (rateada/somada). null = sem meta cadastrada. */
  meta: number | null;
  kind: MetaKind;
  /** Nome legível do campo (título do editor). */
  fieldLabel?: string;
  /** Habilita edição (cliente único selecionado e com cadastro). */
  editable?: boolean;
  saving?: boolean;
  /** Rótulo do mês-âncora editado, ex.: "jun/2026". */
  monthLabel?: string;
  /** Valor do MÊS INTEIRO salvo (prefill do editor). */
  monthValue?: number | null;
  /** Mês-âncora vazio/zerado → caixa Meta vira ALERTA "Preencher". */
  empty?: boolean;
  /** Andamento: true = quanto MAIOR o real melhor (leads); false = quanto MENOR melhor (CPL/custo). */
  higherIsBetter?: boolean;
  onSave?: (n: number) => void;
  /** Limpa o campo (volta a vazio). */
  onRemove?: () => void;
  /** Largura total + alinhado à esquerda (uso na faixa de destaque). Default = compacto/centralizado. */
  wide?: boolean;
}

/**
 * Caixas "Real | Meta" DENTRO do card. A caixa Meta abre um POPOVER (em portal — funciona
 * mesmo dentro de cards clicáveis) com input grande + botões Salvar / Remover / Cancelar.
 * Editar grava o valor do MÊS-ÂNCORA inteiro; remover limpa o campo (volta a vazio/alerta).
 */
export function MetaValueLine({
  realText,
  realValue,
  meta,
  kind,
  fieldLabel,
  editable,
  saving,
  monthLabel,
  monthValue,
  empty,
  higherIsBetter = true,
  onSave,
  onRemove,
  wide,
}: MetaValueLineProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // Prefill em pt-BR (vírgula) para o usuário continuar digitando no formato dele.
      setDraft(monthValue != null ? String(monthValue).replace(".", ",") : "");
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [open, monthValue]);

  // Sem meta e sem edição: não polui o card.
  if (meta == null && !editable) return null;

  const metaText = meta != null ? fmtMeta(meta, kind) : "—";
  const hasStored = monthValue != null;

  // Andamento: quantos % do planejado já foram atingidos pelo real (ex.: real 4 / meta 10 = 40%).
  // Só faz sentido quando há meta cadastrada (> 0) e um real numérico.
  const pct =
    meta != null && meta > 0 && realValue != null && Number.isFinite(realValue)
      ? (realValue / meta) * 100
      : null;

  // Cor do andamento por FAIXA de % do planejado atingido (4 níveis). Duas escalas invertidas:
  //  • Métricas "quanto MAIOR melhor" (leads, consultas, procedimentos, faturamento, ROAS):
  //      <60% vermelho · 60–90% amarelo · 90–100% azul · ≥100% verde.
  //  • CPL e Investimento (CUSTO — quanto MENOR melhor, higherIsBetter=false):
  //      <60% verde · 60–90% azul · 90–100% amarelo · >100% vermelho.
  // Fronteiras: 100% conta como "bateu" no grupo maior-é-melhor (verde) e ainda como
  // "dentro do alvo" (amarelo) no grupo custo — só ACIMA de 100% o custo vira vermelho.
  const tone: "red" | "amber" | "blue" | "green" | null =
    pct == null
      ? null
      : higherIsBetter
        ? pct >= 100 ? "green" : pct >= 90 ? "blue" : pct >= 60 ? "amber" : "red"
        : pct > 100 ? "red" : pct >= 90 ? "amber" : pct >= 60 ? "blue" : "green";
  // Barra: gradiente por tom (custo/positivo). Texto do % acompanha o tom.
  const TONE_BAR = {
    red: "bg-gradient-to-r from-red-500 to-rose-400",
    amber: "bg-gradient-to-r from-amber-500 to-amber-300",
    blue: "bg-gradient-to-r from-blue-600 to-sky-400",
    green: "bg-gradient-to-r from-emerald-600 to-emerald-400",
  } as const;
  const TONE_TEXT = { red: "text-red-500", amber: "text-amber-500", blue: "text-blue-600", green: "text-emerald-600" } as const;
  const statusBar = tone ? TONE_BAR[tone] : "bg-primary";
  const statusText = tone ? TONE_TEXT[tone] : "text-muted-foreground";

  const commit = () => {
    const t = draft.trim();
    if (t === "") {
      // Input vazio + Salvar = remover o valor.
      if (hasStored) onRemove?.();
    } else {
      const n = parseNum(t);
      if (Number.isFinite(n)) onSave?.(n);
    }
    setOpen(false);
  };

  // Passo dos botões −/+ do editor por tipo de métrica (facilita cadastrar sem digitar).
  const step = kind === "ratio" ? 0.1 : kind === "currency" ? 10 : 1;
  const unitPrefix = kind === "currency" ? "R$" : null;
  const unitSuffix = kind === "ratio" ? "x" : null;
  const bump = (dir: 1 | -1) => {
    const cur = parseNum(draft);
    const base = Number.isFinite(cur) ? cur : 0;
    const next = Math.max(0, Math.round((base + dir * step) * 10) / 10);
    setDraft(String(next).replace(".", ","));
    inputRef.current?.focus();
  };

  // Linha inferior editável: "editar meta" (mês-âncora com valor) ou alerta "definir plano"
  // (mês-âncora vazio). O valor planejado em si aparece grande na comparação acima.
  const editLine =
    empty && editable ? (
      <span className="inline-flex items-center gap-1 font-semibold text-amber-500">
        <AlertTriangle className="h-3 w-3 shrink-0" />
        definir planejado
        <Plus className="h-3 w-3 shrink-0" />
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Pencil className="h-2.5 w-2.5 shrink-0 text-primary/70" />
        editar planejado
      </span>
    );

  // Comparação em destaque "Real x Planejado" — número planejado grande e claro, na cor do
  // andamento, deixando explícito o quanto já foi entregue vs. o planejado.
  const comparison = meta != null && (
    <div className="flex flex-wrap items-baseline justify-center gap-x-1.5 gap-y-0.5 leading-none">
      <span className={`text-[17px] font-extrabold tabular-nums ${statusText}`}>{realText}</span>
      <span className="text-[11px] text-muted-foreground">de</span>
      <span className="text-[17px] font-extrabold tabular-nums text-foreground">{metaText}</span>
      <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">planejado</span>
    </div>
  );

  return (
    // Comparação "Real de Meta" em destaque + barra fina com % colorido + linha editável.
    <div className={wide ? "mt-2 w-full max-w-[280px]" : "mt-2 w-full max-w-[210px] mx-auto"}>
      {comparison}

      {pct != null && (
        <div
          className={`flex items-center gap-2 ${comparison ? "mt-1.5" : ""}`}
          title={`${Math.round(pct)}% do planejado${higherIsBetter ? " atingido" : " (custo vs. alvo)"}`}
        >
          <div className="h-[6px] flex-1 rounded-full bg-secondary overflow-hidden">
            <div
              className={`h-full rounded-full ${statusBar} transition-all`}
              style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
            />
          </div>
          <span className={`text-[12px] font-bold tabular-nums whitespace-nowrap ${statusText}`}>
            {Math.round(pct)}%
          </span>
        </div>
      )}

      {(editable || saving) && (
      <div className={`flex justify-center text-[11px] text-muted-foreground ${pct != null || comparison ? "mt-1" : ""}`}>
        {editable ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              {/* span (não <button>) p/ ficar dentro de cards-botão sem aninhar interativos */}
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setOpen(true); } }}
                className="inline-flex cursor-pointer items-center gap-1 rounded px-1 -mx-1 transition-colors hover:text-foreground"
                title={monthLabel ? `Editar planejado de ${monthLabel}` : undefined}
              >
                {editLine}
              </span>
            </PopoverTrigger>
            <PopoverContent
              align="center"
              className="w-72 p-4 space-y-3"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <div>
                <p className="text-sm font-bold text-foreground">Planejado{fieldLabel ? ` · ${fieldLabel}` : ""}</p>
                <p className="text-[11px] text-muted-foreground">{monthLabel} · meta do mês inteiro</p>
              </div>

              {/* Editor visual: −  [valor grande com unidade]  + */}
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
                <div className="relative flex-1">
                  {unitPrefix && (
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base font-semibold text-muted-foreground">
                      {unitPrefix}
                    </span>
                  )}
                  <input
                    ref={inputRef}
                    type="text"
                    inputMode="decimal"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value.replace(/[^\d.,-]/g, ""))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commit();
                      if (e.key === "Escape") setOpen(false);
                      if (e.key === "ArrowUp") { e.preventDefault(); bump(1); }
                      if (e.key === "ArrowDown") { e.preventDefault(); bump(-1); }
                    }}
                    placeholder="0"
                    className={`h-14 w-full rounded-md border border-input bg-background text-center text-2xl font-extrabold text-foreground tabular-nums outline-none focus:ring-2 focus:ring-primary ${unitPrefix ? "pl-11" : ""} ${unitSuffix ? "pr-8" : ""}`}
                  />
                  {unitSuffix && (
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-base font-semibold text-muted-foreground">
                      {unitSuffix}
                    </span>
                  )}
                </div>
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
                O valor do mês é distribuído automaticamente pelo período filtrado. Deixe vazio para remover.
              </p>

              <div className="flex items-center gap-2">
                <Button size="sm" className="flex-1" disabled={saving} onClick={commit}>
                  Salvar planejado
                </Button>
                <Button size="sm" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
              </div>
              {hasStored && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => { onRemove?.(); setOpen(false); }}
                  className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remover valor
                </Button>
              )}
            </PopoverContent>
          </Popover>
        ) : null}
        {saving && <span className="ml-1.5 text-amber-500/70">salvando…</span>}
      </div>
      )}
    </div>
  );
}

/**
 * Atalho p/ plugar uma meta num card: lê o campo do contexto e renderiza a MetaValueLine.
 * Sem contexto (ex.: visão agregada sem dados) ou sem meta e sem edição → não renderiza.
 */
export function MetaSlot({ metas, field, realText, realValue, wide }: { metas?: MetaCardsCtx; field: MetaKey; realText: string; realValue?: number; wide?: boolean }) {
  if (!metas) return null;
  const r = metas.values[field];
  return (
    <MetaValueLine
      wide={wide}
      realText={realText}
      realValue={realValue}
      meta={r.value}
      kind={r.kind}
      // CPL e Investimento são CUSTO: quanto MENOR o real vs. planejado, melhor (usam a escala
      // de cores invertida). Demais campos (leads, consultas, procedimentos, faturamento, ROAS):
      // maior é melhor.
      higherIsBetter={!(field.toLowerCase().startsWith("cpl") || field.toLowerCase().startsWith("investimento"))}
      fieldLabel={META_LABELS[field]}
      editable={metas.editable}
      saving={metas.saving}
      monthLabel={metas.monthLabel}
      monthValue={metas.editable ? metas.getMonthValue(field) : null}
      empty={metas.editable ? metas.isEmpty(field) : false}
      onSave={(n) => metas.onSave(field, n)}
      onRemove={() => metas.onClear(field)}
    />
  );
}
