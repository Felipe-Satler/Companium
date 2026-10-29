import {
  INDICADORES,
  type MetaVariante,
  corAtingimento,
  fmtPct,
  fmtValor,
  serieKey,
  varianteLabel,
} from "./metaIndicadores";

export type MetaTotais = Record<string, { plan: number; real: number }>;

function Barra({ pct, variante }: { pct: number; variante?: MetaVariante }) {
  const cor =
    pct >= 100
      ? "bg-primary"
      : variante === "total"
        ? "bg-sky-400"
        : variante === "inbound"
          ? "bg-violet-400"
          : pct >= 80
            ? "bg-primary"
            : "bg-destructive";
  return (
    <div className="neu-inset h-1.5 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full ${cor}`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

export function MetaKPIGrid({ totais }: { totais: MetaTotais }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {INDICADORES.map((ind) => {
        const titulo = (
          <p
            className={`text-sm font-semibold text-foreground tracking-wide ${
              ind.key === "novo_mrr" ? "" : "uppercase"
            }`}
          >
            {ind.label}
          </p>
        );

        if (ind.variantes) {
          return (
            <div key={ind.key} className="neu-card rounded-xl p-4 space-y-3">
              {titulo}

              <div className="grid grid-cols-[auto_1fr_1fr] gap-x-2 gap-y-1 items-center">
                <span />
                <span className="text-[10px] text-muted-foreground text-right">Real</span>
                <span className="text-[10px] text-muted-foreground text-right">Planejado</span>

                {[
                  ...ind.variantes.map((v) => ({ v, sub: false })),
                  // Meta / Google entram logo abaixo do Inbound como detalhamento (só valores).
                  ...(ind.subvariantes ?? []).map((v) => ({ v, sub: true })),
                ].map(({ v, sub }) => {
                  const { plan, real } = totais[serieKey(ind.key, v)] ?? { plan: 0, real: 0 };
                  const valorCls = `neu-inset rounded-md px-1 py-1 text-right ${
                    sub ? "text-xs font-semibold text-muted-foreground" : "text-sm font-bold text-foreground"
                  }`;
                  return (
                    <div key={v} className="contents">
                      {sub ? (
                        <span className="pl-2 text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                          <span className="text-muted-foreground/40">└</span>
                          {varianteLabel(v)}
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-muted-foreground">
                          {varianteLabel(v)}
                        </span>
                      )}
                      <span className={valorCls}>{fmtValor(real, ind.tipo)}</span>
                      <span className={valorCls}>{fmtValor(plan, ind.tipo)}</span>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2">
                {ind.variantes.map((v) => {
                  const { plan, real } = totais[serieKey(ind.key, v)] ?? { plan: 0, real: 0 };
                  const pct = plan > 0 ? (real / plan) * 100 : 0;
                  return (
                    <div key={v} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Atingimento {varianteLabel(v)}</span>
                        <span className={`font-bold ${corAtingimento(pct)}`}>
                          {plan > 0 ? fmtPct(pct) : "—"}
                        </span>
                      </div>
                      <Barra pct={pct} variante={v} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }

        const { plan, real } = totais[serieKey(ind.key)] ?? { plan: 0, real: 0 };
        const diff = real - plan;
        const pct = plan > 0 ? (real / plan) * 100 : 0;

        return (
          <div key={ind.key} className="neu-card rounded-xl p-4 space-y-3">
            {titulo}

            <div className="grid grid-cols-2 gap-2">
              <div className="neu-inset rounded-lg p-2">
                <p className="text-xs text-muted-foreground">Real</p>
                <p className="text-base font-bold text-foreground">{fmtValor(real, ind.tipo)}</p>
              </div>
              <div className="neu-inset rounded-lg p-2">
                <p className="text-xs text-muted-foreground">Planejado</p>
                <p className="text-base font-bold text-foreground">{fmtValor(plan, ind.tipo)}</p>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Dif.{" "}
                <span
                  className={diff >= 0 ? "text-primary font-semibold" : "text-destructive font-semibold"}
                >
                  {diff >= 0 ? "+" : "−"}
                  {fmtValor(Math.abs(diff), ind.tipo)}
                </span>
              </span>
              <span className={`font-bold ${corAtingimento(pct)}`}>
                {plan > 0 ? fmtPct(pct) : "—"}
              </span>
            </div>

            <Barra pct={pct} />
          </div>
        );
      })}
    </div>
  );
}
