import * as React from "react";

/**
 * Faixa de DADOS PRINCIPAIS (KPIs em foco) no topo das métricas — no padrão dos prints
 * aprovados (artifact): ACHATADA (sem card), colunas separadas por filete, número grande,
 * sub-info (ex.: "Meta Ads 266 · Google 28") e barra de andamento vs. plano (% + "plano X").
 *
 * Puramente apresentacional (sem fetch/cálculo → sem impacto no carregamento). Usa tokens,
 * então acompanha tema claro/escuro. Responsivo: empilha no mobile, colunas no desktop.
 */
export interface FocusItem {
  label: string;
  value: string;
  /** "blue" = custo/CPL em azul; "green" = positivo. Default = tinta padrão. */
  accent?: "blue" | "green";
  /** Linha de sub-info abaixo do número (ex.: quebra Meta/Google ou "abaixo do teto"). */
  sub?: React.ReactNode;
  /** % vs. plano — quando definido (>=0), mostra a barra de progresso. */
  pct?: number | null;
  /** Valor planejado já formatado (ex.: "200" / "R$ 90.000" / "2,00x"). Renderiza a
   *  comparação em destaque "<value> de <meta> planejado" (Real x Planejado) acima da barra. */
  meta?: string;
  /** Texto do plano abaixo da barra (ex.: "plano 2.000" / "plano R$ 90.000"). */
  plano?: string;
  /** Cor da barra: "green" (padrão p/ metas de volume/valor) ou "blue" (custo). */
  barColor?: "blue" | "green";
  /** Conteúdo custom abaixo da sub (ex.: editor de planejado). Substitui a barra embutida. */
  slot?: React.ReactNode;
}

const COLS: Record<number, string> = {
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
};

export function FocusStrip({ items }: { items: FocusItem[] }) {
  const cols = COLS[items.length] ?? "lg:grid-cols-4";
  return (
    // CARD único com REALCE AZUL (borda + leve preenchimento + glow azul) — destaca os
    // dados principais do resto da página. `!` vence o estilo base do neu-card.
    <div
      className={`neu-card rounded-2xl overflow-hidden grid grid-cols-1 sm:grid-cols-2 ${cols} divide-y sm:divide-y-0 sm:divide-x divide-border !border-primary/40 !bg-primary/[0.05] !shadow-[0_8px_28px_-10px_rgba(26,115,233,0.35)]`}
    >
      {items.map((it, i) => {
        const hasBar = it.pct != null && Number.isFinite(it.pct);
        const barGreen = (it.barColor ?? "green") === "green";
        const width = hasBar ? Math.max(0, Math.min(100, it.pct as number)) : 0;
        return (
          <div key={i} className="px-5 py-5 flex flex-col gap-2.5 min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              {it.label}
            </p>
            <p
              className={`text-[40px] leading-none font-extrabold tracking-tight tabular-nums ${
                it.accent === "blue"
                  ? "text-primary"
                  : it.accent === "green"
                    ? "text-emerald-500"
                    : "text-foreground"
              }`}
            >
              {it.value}
            </p>
            {it.sub && <div className="text-[13px] text-muted-foreground leading-snug">{it.sub}</div>}
            {it.slot}
            {/* Comparação em destaque: "<real> de <meta> da meta" — número planejado grande e claro. */}
            {!it.slot && it.meta && (
              <p className="text-[15px] leading-none text-muted-foreground">
                de <b className="text-[17px] font-extrabold tabular-nums text-foreground">{it.meta}</b>{" "}
                <span className="text-[10px] font-semibold uppercase tracking-wider">planejado</span>
              </p>
            )}
            {!it.slot && hasBar && (
              <div className="flex items-center gap-3">
                <div className="h-1.5 flex-1 rounded-full bg-secondary overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      barGreen
                        ? "bg-gradient-to-r from-emerald-600 to-emerald-400"
                        : "bg-gradient-to-r from-blue-600 to-sky-400"
                    }`}
                    style={{ width: `${width}%` }}
                  />
                </div>
                <span
                  className={`text-[13px] font-bold tabular-nums ${barGreen ? "text-emerald-600" : "text-blue-600"}`}
                >
                  {Math.round(it.pct as number)}%
                </span>
              </div>
            )}
            {!it.slot && !it.meta && it.plano && <p className="text-[11px] text-muted-foreground/70">{it.plano}</p>}
          </div>
        );
      })}
    </div>
  );
}
