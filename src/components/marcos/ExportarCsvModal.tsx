import * as React from "react";
import { Download } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { mesLabel, type BIMes } from "@/components/gestao/useGestaoBI";
import type { IndicadorMarco, MetasMarcos } from "@/lib/marcosMetas";

type Formato = "moeda" | "inteiro" | "percentual";

export type ItemExport = {
  grupo: string;
  chave: IndicadorMarco;
  nome: string;
  formato: Formato;
  realizado: (mes: BIMes) => number;
};

/** Número cru para CSV: sem R$, sem milhar, decimal com vírgula. */
const formatarNumero = (valor: number, formato: Formato) => {
  if (formato === "inteiro") return valor.toFixed(0);
  return valor.toFixed(2).replace(".", ",");
};

const mesSlug = (mes: string) => mesLabel(mes).replace("/", "");

function montarCsv(
  itens: ItemExport[],
  meses: BIMes[],
  metas: MetasMarcos,
  atual: string,
): string {
  const linhas: string[] = ["Grupo;Indicador;Mes;Planejado;Real;Percentual;Desvio"];
  for (const item of itens) {
    for (const m of meses) {
      const meta = metas[item.chave]?.[m.mes];
      const futuro = m.mes > atual;
      const real = item.realizado(m);
      const planejado = meta !== undefined ? formatarNumero(meta, item.formato) : "";
      const realTxt = futuro ? "" : formatarNumero(real, item.formato);
      const percentual =
        !futuro && meta !== undefined && meta !== 0
          ? ((real / meta) * 100).toFixed(2).replace(".", ",")
          : "";
      const desvio = !futuro && meta !== undefined ? formatarNumero(real - meta, item.formato) : "";
      linhas.push([item.grupo, item.nome, mesLabel(m.mes), planejado, realTxt, percentual, desvio].join(";"));
    }
  }
  return linhas.join("\r\n");
}

function baixarCsv(conteudo: string, nomeArquivo: string) {
  const blob = new Blob([`\uFEFF${conteudo}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ExportarCsvModal({
  aberto,
  onOpenChange,
  itens,
  meses,
  metas,
  atual,
  inicioTela,
  fimTela,
}: {
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
  itens: ItemExport[];
  meses: BIMes[];
  metas: MetasMarcos;
  atual: string;
  inicioTela: string;
  fimTela: string;
}) {
  const [inicio, setInicio] = React.useState(inicioTela);
  const [fim, setFim] = React.useState(fimTela);
  const [selecionados, setSelecionados] = React.useState<Set<string>>(() => new Set());

  React.useEffect(() => {
    if (aberto) {
      setInicio(inicioTela);
      setFim(fimTela);
      setSelecionados(new Set(itens.map((i) => i.chave)));
    }
  }, [aberto, inicioTela, fimTela, itens]);

  const opcoesMes = React.useMemo(
    () => meses.map((m) => ({ value: m.mes, label: mesLabel(m.mes) })),
    [meses],
  );

  const idxInicio = meses.findIndex((m) => m.mes === inicio);
  const idxFim = meses.findIndex((m) => m.mes === fim);
  const iIni = idxInicio === -1 ? 0 : idxInicio;
  const iFim = idxFim === -1 ? meses.length - 1 : idxFim;
  const [ordenadoIni, ordenadoFim] = iIni <= iFim ? [iIni, iFim] : [iFim, iIni];
  const mesesNoRange = React.useMemo(
    () => meses.slice(ordenadoIni, ordenadoFim + 1),
    [meses, ordenadoIni, ordenadoFim],
  );

  const gruposUnicos = React.useMemo(() => {
    const porGrupo: { grupo: string; itens: ItemExport[] }[] = [];
    for (const item of itens) {
      const existente = porGrupo.find((g) => g.grupo === item.grupo);
      if (existente) existente.itens.push(item);
      else porGrupo.push({ grupo: item.grupo, itens: [item] });
    }
    return porGrupo;
  }, [itens]);

  const alternarIndicador = (chave: string, marcado: boolean) => {
    setSelecionados((atuais) => {
      const proximos = new Set(atuais);
      if (marcado) proximos.add(chave);
      else proximos.delete(chave);
      return proximos;
    });
  };

  const alternarGrupo = (itensGrupo: ItemExport[], marcado: boolean) => {
    setSelecionados((atuais) => {
      const proximos = new Set(atuais);
      for (const item of itensGrupo) {
        if (marcado) proximos.add(item.chave);
        else proximos.delete(item.chave);
      }
      return proximos;
    });
  };

  const exportar = () => {
    const itensSelecionados = itens.filter((i) => selecionados.has(i.chave));
    if (itensSelecionados.length === 0 || mesesNoRange.length === 0) return;
    const csv = montarCsv(itensSelecionados, mesesNoRange, metas, atual);
    const primeiroMes = mesesNoRange[0];
    const ultimoMes = mesesNoRange[mesesNoRange.length - 1];
    if (!primeiroMes || !ultimoMes) return;
    const primeiro = mesSlug(primeiroMes.mes);
    const ultimo = mesSlug(ultimoMes.mes);
    const nome =
      primeiro === ultimo ? `marcos_${primeiro}.csv` : `marcos_${primeiro}_a_${ultimo}.csv`;
    baixarCsv(csv, nome);
    onOpenChange(false);
  };

  const contagemMeses = mesesNoRange.length;
  const contagemLinhas = selecionados.size * contagemMeses;

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent
        className="marcos-export-dialog flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-[560px] flex-col gap-0 overflow-hidden rounded-lg bg-background p-0"
        overlayClassName="marcos-export-overlay"
        closeClassName="inline-flex size-8 items-center justify-center hover:bg-accent"
        closeLabel="Fechar"
      >
        <DialogHeader className="shrink-0 border-b border-border/50 p-6 pr-14 text-left">
          <DialogTitle>Exportar CSV</DialogTitle>
          <DialogDescription>
            Escolha o período e os indicadores. O arquivo sai com os mesmos números exibidos na tela.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-6 overflow-y-auto p-6">
          <div>
            <p className="mb-4 text-xs font-semibold uppercase text-muted-foreground">Período</p>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label htmlFor="export-mes-inicio" className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  Mês de Início
                </label>
                <SearchableSelect
                  value={inicio}
                  onValueChange={setInicio}
                  options={opcoesMes}
                  allOption={null}
                  placeholder="Mês de Início"
                  triggerClassName="h-8 text-[11px]"
                />
              </div>
              <div className="h-8 w-px bg-border/50" aria-hidden="true" />
              <div>
                <label htmlFor="export-mes-fim" className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  Mês de Fim
                </label>
                <SearchableSelect
                  value={fim}
                  onValueChange={setFim}
                  options={opcoesMes}
                  allOption={null}
                  placeholder="Mês de Fim"
                  triggerClassName="h-8 text-[11px]"
                />
              </div>
            </div>
          </div>

          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Indicadores</p>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelecionados(new Set(itens.map((i) => i.chave)))}
                  className="h-8 px-2 text-xs font-medium text-primary"
                >
                  Marcar todos
                </Button>
                <span aria-hidden="true" className="h-4 w-px bg-border/70" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelecionados(new Set())}
                  className="h-8 px-2 text-xs font-medium text-muted-foreground"
                >
                  Desmarcar todos
                </Button>
              </div>
            </div>
            <div className="space-y-4">
              {gruposUnicos.map(({ grupo, itens: itensGrupo }) => {
                const marcados = itensGrupo.filter((i) => selecionados.has(i.chave)).length;
                const estadoGrupo =
                  marcados === 0 ? false : marcados === itensGrupo.length ? true : "indeterminate";
                return (
                  <div key={grupo} className="rounded-lg bg-muted/30 p-4">
                    <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Checkbox
                        id={`grupo-${grupo}`}
                        checked={estadoGrupo}
                        onCheckedChange={(marcado) => alternarGrupo(itensGrupo, marcado === true)}
                      />
                      {grupo}
                      <span className="text-[10px] font-medium uppercase text-muted-foreground">
                        {marcados}/{itensGrupo.length}
                      </span>
                    </label>
                    <div className="mt-4 space-y-4 pl-3">
                      {itensGrupo.map((item) => (
                        <label
                          key={item.chave}
                          className="flex items-center gap-2 text-sm text-foreground"
                        >
                          <Checkbox
                            id={`ind-${item.chave}`}
                            checked={selecionados.has(item.chave)}
                            onCheckedChange={(marcado) => alternarIndicador(item.chave, marcado === true)}
                          />
                          {item.nome}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        <DialogFooter className="shrink-0 flex-row flex-wrap items-center justify-between gap-4 border-t border-border/50 px-6 py-4 sm:justify-between sm:space-x-0">
          <p className="min-w-0 flex-1 text-xs font-medium leading-5 text-foreground" aria-live="polite">
            {selecionados.size === 0
              ? "Nenhum indicador selecionado"
              : `${selecionados.size} ${selecionados.size === 1 ? "indicador" : "indicadores"}, ${contagemMeses} ${contagemMeses === 1 ? "mês" : "meses"}, ${contagemLinhas} ${contagemLinhas === 1 ? "linha" : "linhas"}`}
          </p>
          <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-sm text-muted-foreground"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={exportar}
            disabled={selecionados.size === 0 || contagemMeses === 0}
            className="marcos-export-button inline-flex flex-row items-center gap-2 whitespace-nowrap px-3.5 text-sm font-semibold"
          >
            <Download aria-hidden="true" className="size-4" />
            Exportar
          </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
