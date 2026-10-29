import * as React from "react";
import { GestaoBIMatriz } from "./GestaoBIMatriz";
import { GestaoBICharts } from "./GestaoBICharts";
import { intervaloBI, listarMeses, mesLabel, useGestaoBI } from "./useGestaoBI";
import type { GestaoCliente, SerieMrrOficial } from "@/hooks/useGestaoData";



export function GestaoDashboard({
  rows,
  rowsCLT,
  loading,
  inicio,
  fim,
  gestor,
  mrrOficial,
}: {
  rows: GestaoCliente[];
  /** Base sem o recorte de datas: o CLT precisa de todo o histórico de inativos. */
  rowsCLT?: GestaoCliente[];
  loading?: boolean | undefined;
  inicio: string;
  fim: string;
  gestor: string;
  mrrOficial?: SerieMrrOficial | null;
}) {
  const TODOS_MESES = "todos";
  const semIntervalo = inicio === TODOS_MESES || fim === TODOS_MESES;
  const inicioEf = semIntervalo ? null : inicio <= fim ? inicio : fim;
  const fimEf = semIntervalo ? null : inicio <= fim ? fim : inicio;

  // Meses concretos quando o usuário escolhe "todos".
  const { biInicio, biFim } = React.useMemo(() => {
    const r = intervaloBI(rows, inicioEf, fimEf);
    return { biInicio: r.inicio, biFim: r.fim };
  }, [rows, inicioEf, fimEf]);

  const bi = useGestaoBI(rows, {
    inicio: biInicio,
    fim: biFim < biInicio ? biInicio : biFim,
    gestor,
    mrrOficial: mrrOficial ?? null,
    rowsCLT: rowsCLT ?? null,
  });

  if (loading) {
    return (
      <div className="neu-card p-6 text-sm text-foreground/70">Carregando indicadores...</div>
    );
  }

  return (
    <div className="space-y-4">
      <GestaoBIMatriz bi={bi} />
      <GestaoBICharts bi={bi} />
    </div>

  );
}
