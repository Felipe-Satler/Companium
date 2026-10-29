import * as React from "react";
import { ArrowDown } from "lucide-react";
import type { MetaTotais } from "./MetaKPIGrid";
import {
  type MetaIndicadorKey,
  type MetaVariante,
  fmtPct,
  serieKey,
  varianteLabel,
} from "./metaIndicadores";
import { Button } from "@/components/ui/button";

const ETAPAS: { key: MetaIndicadorKey; label: string; temVariante: boolean }[] = [
  { key: "leads", label: "Leads", temVariante: false },
  { key: "agendamentos", label: "Agendamentos", temVariante: true },
  { key: "reunioes", label: "Reuniões", temVariante: true },
  { key: "vendas", label: "Vendas", temVariante: true },
];

const fmtNum = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

export function MetaFunilConversao({ totais }: { totais: MetaTotais }) {
  const [variante, setVariante] = React.useState<MetaVariante>("total");

  const etapas = ETAPAS.map((e) => {
    const id = e.temVariante
      ? serieKey(e.key, variante)
      : e.key === "leads" && variante === "inbound"
        ? serieKey("leads_inbound", "inbound")
        : serieKey(e.key);
    const t = totais[id] ?? { plan: 0, real: 0 };
    const label = e.temVariante
      ? `${e.label} ${varianteLabel(variante)}`
      : e.key === "leads" && variante === "inbound"
        ? "Leads Inbound"
        : "Leads Total";
    return { ...e, label, ...t };
  });

  const maxReal = Math.max(...etapas.map((e) => e.real), 1);
  const topo = etapas[0]?.real ?? 0;
  const base = etapas[etapas.length - 1]?.real ?? 0;
  const conversaoTotal = topo > 0 ? (base / topo) * 100 : 0;

  let maiorQueda = { label: "", queda: 0 };
  for (let i = 1; i < etapas.length; i++) {
    const anterior = etapas[i - 1]!;
    const atual = etapas[i]!;
    const queda = anterior.real - atual.real;
    if (queda > maiorQueda.queda) {
      maiorQueda = { label: `${anterior.label} → ${atual.label}`, queda };
    }
  }

  return (
    <div className="neu-card rounded-xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-foreground">Funil de Conversão</h3>
          <div className="flex items-center gap-1 neu-inset rounded-lg p-1">
            {(["total", "inbound"] as MetaVariante[]).map((v) => (
              <Button
                key={v}
                size="sm"
                variant="ghost"
                onClick={() => setVariante(v)}
                className={`h-7 px-3 text-[11px] font-medium rounded-md ${
                  variante === v ? "neu-button text-primary" : "text-muted-foreground"
                }`}
              >
                {varianteLabel(v)}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Conversão Total
            </p>
            <p className="text-sm font-bold text-primary">{fmtPct(conversaoTotal)}</p>
          </div>
          {maiorQueda.queda > 0 && (
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Maior Queda
              </p>
              <p className="text-[10px] font-medium text-destructive">{maiorQueda.label}</p>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1">
        {etapas.map((etapa, i) => {
          const widthPct = Math.max((etapa.real / maxReal) * 100, 6);
          const atingimento = etapa.plan > 0 ? (etapa.real / etapa.plan) * 100 : 0;
          const proxima = etapas[i + 1];
          return (
            <div key={etapa.key}>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-muted-foreground w-[110px] shrink-0 text-right">
                  {etapa.label}
                </span>
                <div className="flex-1">
                  <div
                    className="h-9 rounded-md bg-primary/20 border border-primary/30 flex items-center px-3 transition-all"
                    style={{ width: `${widthPct}%` }}
                  >
                    <span className="text-xs font-bold text-primary whitespace-nowrap">
                      {fmtNum(etapa.real)}
                    </span>
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground w-[150px] shrink-0 text-right">
                  Plan. {fmtNum(etapa.plan)}
                  {etapa.plan > 0 && ` · ${fmtPct(atingimento)}`}
                </span>
              </div>

              {proxima && (
                <div className="flex items-center gap-3 py-0.5">
                  <span className="w-[110px] shrink-0" />
                  <div className="flex items-center gap-1.5 pl-2">
                    <ArrowDown className="h-3 w-3 text-muted-foreground/50" />
                    <span className="text-[10px] text-muted-foreground">
                      {etapa.real > 0 ? fmtPct((proxima.real / etapa.real) * 100) : "N/A"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
