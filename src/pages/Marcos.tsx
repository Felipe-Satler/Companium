import * as React from "react";
import { CalendarRange, Check, ChevronDown, Download, Flag, Pencil } from "lucide-react";
import { toast } from "sonner";

import { DashboardLayout } from "@/components/DashboardLayout";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useGestaoData } from "@/hooks/useGestaoData";
import {
  carregarMetas,
  gravarMeta,
  limparMetasExemploLegado,
  lerMetas,
  salvarMetaRemoto,
  type IndicadorMarco,
  type MetasMarcos,
} from "@/lib/marcosMetas";
import { listarMeses, mesAtual, mesLabel, useGestaoBI } from "@/components/gestao/useGestaoBI";
import { MarcosGraficos } from "@/components/marcos/MarcosGraficos";
import { FaixaMesVigente } from "@/components/marcos/FaixaMesVigente";
import { ExportarCsvModal, type ItemExport } from "@/components/marcos/ExportarCsvModal";
import { PainelExecutivo } from "@/components/marcos/PainelExecutivo";
import { classificarMeta, type FaixaMeta } from "@/components/marcos/painelExecutivo";
import { GRUPOS_MARCOS, atingimentoMarco, formatarMarco, formatarMarcoAbreviado, type FormatoMarco } from "@/components/marcos/indicadores";
import "@/components/marcos/marcos.css";

type Formato = FormatoMarco;
const grupos = GRUPOS_MARCOS;

const atualInicial = mesAtual();
const ano = Number(atualInicial.slice(0, 4));
const opcoesMes = listarMeses(`${ano - 3}-01`, `${ano}-12`).reverse().map((mes) => ({
  value: mes,
  label: mesLabel(mes),
}));


const formatar = formatarMarco;
const formatarAbrev = formatarMarcoAbreviado;

const formatarEdicao = (valor: number, formato: Formato) => {
  if (formato === "inteiro") return String(Math.round(valor));
  return valor.toFixed(2).replace(".", ",");
};

const parseValor = (texto: string): number | null => {
  const limpo = texto.trim().replace(/R\$|%|\s/g, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const valor = Number(normalizado);
  return Number.isFinite(valor) && valor >= 0 ? valor : null;
};

const COR_FAIXA: Record<FaixaMeta, string> = {
  superada: "hsl(var(--primary))",
  atingida: "hsl(var(--success))",
  "nao-batida": "hsl(var(--destructive))",
};
const CLASSE_FAIXA: Record<FaixaMeta, string> = {
  superada: "text-primary",
  atingida: "text-success",
  "nao-batida": "text-destructive",
};
const COR_NEUTRA = "hsl(var(--muted-foreground))";

function MetaCelula({
  valor,
  formato,
  onSave,
  rotulo,
}: {
  valor: number | undefined;
  formato: Formato;
  onSave: (valor: number | null) => void;
  rotulo: string;
}) {
  const [editando, setEditando] = React.useState(false);
  const [texto, setTexto] = React.useState(valor === undefined ? "" : formatarEdicao(valor, formato));
  const [salvo, setSalvo] = React.useState(false);

  React.useEffect(() => {
    if (!editando) setTexto(valor === undefined ? "" : formatarEdicao(valor, formato));
  }, [valor, formato, editando]);

  const salvar = () => {
    const proximo = parseValor(texto);
    onSave(proximo);
    setTexto(proximo === null ? "" : formatarEdicao(proximo, formato));
    setEditando(false);
    setSalvo(true);
    window.setTimeout(() => setSalvo(false), 1200);
  };

  if (editando) {
    return (
      <input
        autoFocus
        value={texto}
        onChange={(event) => setTexto(event.target.value)}
        onBlur={salvar}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setEditando(false);
        }}
        onFocus={(event) => event.currentTarget.select()}
        inputMode={formato === "inteiro" ? "numeric" : "decimal"}
        aria-label={rotulo}
        className="h-8 w-full min-w-0 rounded bg-transparent px-2 text-left text-sm font-bold tabular-nums text-foreground outline-none ring-1 ring-primary/50"
      />
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => setEditando(true)}
      title={valor === undefined ? "Clique para definir a meta" : `Meta: ${formatar(valor, formato)}`}
      aria-label={rotulo}
      className="marcos-goal-pill group/meta relative h-8 w-full min-w-0 cursor-pointer justify-start gap-1.5 rounded px-2 py-0 text-sm font-bold tabular-nums transition-colors hover:bg-foreground/10 [&_svg]:size-3"
      data-no-drag
    >
      <Pencil aria-hidden="true" className="size-3 shrink-0 text-primary opacity-90 transition-opacity group-hover/meta:opacity-100" />
      <span className="font-bold text-foreground">{valor === undefined ? "—" : formatarAbrev(valor, formato)}</span>
      <span
        aria-hidden="true"
        className={`absolute -right-1 -top-1.5 rounded-full bg-background text-primary transition-opacity ${salvo ? "opacity-100" : "opacity-0"}`}
        title="Meta salva"
      >
        <Check className="size-2.5" />
      </span>
    </Button>
  );
}

function Atingimento({ valor, faixa }: { valor: number; faixa: FaixaMeta }) {
  return (
    <span title={formatar(valor, "percentual")} className={`text-sm font-bold tabular-nums ${CLASSE_FAIXA[faixa]}`}>
      {formatar(valor, "percentual")}
    </span>
  );
}

/** Mini-gráfico de evolução do indicador: linha sólida = real, pontilhada = meta. */
function Sparkline({ pontos, cor }: { pontos: { real: number | null; meta: number | null }[]; cor: string }) {
  const W = 72;
  const H = 18;
  const P = 1.5;
  if (pontos.filter((p) => p.real !== null).length < 2) return null;
  const valores = pontos.flatMap((p) => [p.real, p.meta].filter((v): v is number => v !== null));
  if (!valores.length) return null;
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const span = max - min || 1;
  const x = (i: number) => P + (i / Math.max(1, pontos.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - min) / span) * (H - 2 * P);
  const segmentos = (campo: "real" | "meta") => {
    const partes: string[] = [];
    let atualSeg: string[] = [];
    pontos.forEach((p, i) => {
      const v = p[campo];
      if (v === null) {
        if (atualSeg.length > 1) partes.push(atualSeg.join(" "));
        atualSeg = [];
        return;
      }
      atualSeg.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    });
    if (atualSeg.length > 1) partes.push(atualSeg.join(" "));
    return partes;
  };
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="mt-0.5 block">
      {segmentos("meta").map((pontosMeta, i) => (
        <polyline key={`m${i}`} points={pontosMeta} fill="none" stroke={COR_NEUTRA} strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
      ))}
      {segmentos("real").map((pontosReal, i) => (
        <polyline key={`r${i}`} points={pontosReal} fill="none" stroke={cor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

function MarcosPage() {
  const { user } = useAuth();
  const email = user?.email ?? null;
  const { rows, mrrOficial, loading } = useGestaoData();
  const [atual, setAtual] = React.useState(mesAtual);
  React.useEffect(() => {
    const atualizar = () => setAtual(mesAtual());
    atualizar();
    const timer = window.setInterval(atualizar, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [inicio, setInicio] = React.useState(`${ano}-01`);
  // O mês de FIM é SEMPRE o mês vigente (acompanha o relógio — reavaliado a cada 60s). Não é
  // editável: o período vai do mês de início escolhido até o mês corrente.
  const fim = atual;
  // O seletor de início não oferece meses após o vigente (o fim é fixo no mês corrente).
  const opcoesInicio = React.useMemo(() => opcoesMes.filter((o) => o.value <= atual), [atual]);
  const [metas, setMetas] = React.useState<MetasMarcos>({});
  const [exportarAberto, setExportarAberto] = React.useState(false);
  const [recolhidos, setRecolhidos] = React.useState<Record<string, boolean>>({});
  const [colHover, setColHover] = React.useState<number | null>(null);
  const scrollArea = React.useRef<HTMLDivElement>(null);
  const [alvoRealce, setAlvoRealce] = React.useState<{ indicador?: IndicadorMarco; mes?: string } | null>(null);

  // Pinta primeiro com o cache local (instantâneo) e, em seguida, com o banco (fonte
  // compartilhada). Sem metas, a tela abre vazia — estado esperado no primeiro uso.
  React.useEffect(() => {
    setMetas(limparMetasExemploLegado(lerMetas()));
    let vivo = true;
    carregarMetas().then(({ metas: remotas }) => {
      if (vivo) setMetas(remotas);
    });
    return () => {
      vivo = false;
    };
  }, []);


  const inicioEf = inicio <= fim ? inicio : fim;
  const fimEf = fim;
  const bi = useGestaoBI(rows, {
    inicio: inicioEf,
    fim: fimEf,
    gestor: "todos",
    mrrOficial,
    rowsCLT: rows,
  });

  const inicioHist = React.useMemo(() => { const [a, m] = fimEf.split("-").map(Number); const d = new Date(Date.UTC(a!, m! - 11, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }, [fimEf]);
  const biHist = useGestaoBI(rows, { inicio: inicioHist, fim: fimEf, gestor: "todos", mrrOficial, rowsCLT: rows });
  const biVigente = useGestaoBI(rows, { inicio: atual, fim: atual, gestor: "todos", mrrOficial, rowsCLT: rows });
  // Presença é apenas apresentação: zero calculado em uma base carregada é dado válido.
  // A série oficial distingue um mês de MRR vazio/ausente de um zero explícito.
  const temRealizadoVigente = (indicador: IndicadorMarco) => {
    if (indicador === "mrr" && mrrOficial) {
      const valor = mrrOficial[atual]?.mrr;
      return valor !== null && valor !== undefined && Number.isFinite(valor);
    }
    return rows.length > 0;
  };

  const itensExport = React.useMemo<ItemExport[]>(
    () =>
      grupos.flatMap((grupo) =>
        grupo.indicadores.map((indicador) => ({
          grupo: grupo.nome,
          chave: indicador.chave,
          nome: indicador.nome,
          formato: indicador.formato,
          realizado: indicador.realizado,
        })),
      ),
    [],
  );

  const salvarMeta = React.useCallback((indicador: IndicadorMarco, mes: string, valor: number | null) => {
    // Otimista: atualiza a tela e o cache local na hora; persiste no banco em seguida.
    setMetas((atuais) => gravarMeta(atuais, indicador, mes, valor));
    void salvarMetaRemoto(indicador, mes, valor, email).catch((err) => {
      console.error("salvarMetaRemoto (marcos_metas):", err instanceof Error ? err.message : err);
      toast.error("Não foi possível salvar a meta no banco. Ela vale neste navegador até a próxima tentativa.");
    });
  }, [email]);

  const alternarGrupo = React.useCallback((nome: string) => {
    setRecolhidos((atuais) => ({ ...atuais, [nome]: !atuais[nome] }));
  }, []);

  const navegarGrade = React.useCallback((alvo: { indicador?: IndicadorMarco; mes?: string }) => {
    setAlvoRealce(alvo);
    const grupoAlvo = grupos.find((grupo) => grupo.indicadores.some((indicador) => indicador.chave === alvo.indicador));
    if (grupoAlvo) setRecolhidos((atuais) => ({ ...atuais, [grupoAlvo.nome]: false }));
    window.setTimeout(() => {
      const seletor = alvo.indicador && alvo.mes
        ? `[data-marcos-celula="${alvo.indicador}:${alvo.mes}"]`
        : alvo.indicador
          ? `[data-marcos-indicador="${alvo.indicador}"]`
          : alvo.mes
            ? `[data-marcos-mes="${alvo.mes}"]`
            : "";
      const elemento = seletor ? document.querySelector<HTMLElement>(seletor) : null;
      if (!elemento) return;
      elemento.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      const area = scrollArea.current;
      if (area && alvo.mes) area.scrollTo({ left: Math.max(0, elemento.offsetLeft - 186), behavior: "smooth" });
    }, 50);
    window.setTimeout(() => setAlvoRealce(null), 1800);
  }, []);

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:flex-wrap sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="neu-inset flex size-11 shrink-0 items-center justify-center rounded-full text-primary">
              <Flag className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold text-foreground">Marcos</h1>
              <p className="text-sm text-muted-foreground">Metas mensais comparadas ao realizado da Gestão</p>
            </div>
          </div>
        </header>

        <div className="neu-card flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2 pr-3 text-xs font-semibold uppercase text-muted-foreground sm:border-r sm:border-border/40">
            <CalendarRange className="size-4 text-primary" />
            Período
          </div>
          <div className="flex flex-wrap items-end gap-3 sm:items-center">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Mês de Início</label>
              <SearchableSelect value={inicio} onValueChange={setInicio} options={opcoesInicio} allOption={null} placeholder="Mês de Início" triggerClassName="h-8 text-[11px]" />
            </div>
            <div className="hidden h-8 w-px bg-border/50 sm:block" aria-hidden="true" />
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Mês de Fim</label>
              {/* Fixo no mês vigente — não editável. O período vai do início escolhido até hoje. */}
              <div
                className="flex h-8 items-center gap-1.5 rounded-md border border-border/50 bg-muted/30 px-2.5 text-[11px] font-medium"
                title="O mês de fim é sempre o mês vigente"
              >
                <span className="text-foreground">{mesLabel(atual)}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">mês vigente</span>
              </div>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => setExportarAberto(true)}
            variant="ghost"
            size="sm"
            className="marcos-export-button neu-button ml-auto inline-flex h-8 shrink-0 flex-row items-center gap-2 whitespace-nowrap px-3.5"
          >
            <Download aria-hidden="true" className="size-4" />
            Exportar CSV
          </Button>

        </div>

        {loading ? (
          <div className="neu-card p-6 text-sm text-muted-foreground">Carregando indicadores...</div>
        ) : rows.length === 0 ? (
          <div className="neu-card p-6">
            <p className="font-semibold text-foreground">Nenhuma planilha carregada</p>
            <p className="mt-1 text-sm text-muted-foreground">Importe ou sincronize a planilha na tela Gestão para visualizar o realizado.</p>
          </div>
        ) : null}


        <FaixaMesVigente atual={atual} mes={biVigente.meses[0]} metas={metas} temRealizado={temRealizadoVigente} loading={loading} parseValor={parseValor} onSalvarMeta={(indicador, valor) => salvarMeta(indicador, atual, valor)} />

        <div
          ref={scrollArea}
          className="neu-scroll overflow-x-auto pb-4"
          aria-label="Indicadores mensais com rolagem horizontal"
          data-marcos-scroll="pagina"
        >
          <div className="w-max min-w-full" onMouseLeave={() => setColHover(null)}>
            {/* Mês e rótulos usam os mesmos trilhos das células. */}
            <div className="sticky top-0 z-40">
              <div className="flex bg-background">
                <div className="marcos-grid-month-divider sticky left-0 z-50 w-[170px] shrink-0 border-r bg-background" />
                {bi.meses.map((mes, ci) => (
                  <div
                    key={mes.mes}
                    data-marcos-mes={mes.mes}
                    className={`marcos-month-columns whitespace-nowrap text-[13px] font-bold ${
                      ci > 0 ? "border-l marcos-grid-month-divider" : ""
                    } ${mes.mes === atual ? "text-primary" : "text-muted-foreground"} ${colHover === ci ? "bg-muted/15" : ""}`}
                  >
                    <div className="col-span-3 flex min-h-8 items-center justify-center gap-1">
                      <span>{mes.label}</span>
                      {mes.mes === atual && <span className="text-[9px] font-bold uppercase text-chart-pace">parcial</span>}
                    </div>
                    {["PLANEJADO", "REALIZADO", "%"].map((rotulo, indice) => (
                      <div key={rotulo} className={`flex min-h-7 items-center justify-center text-[11px] font-semibold tracking-wide text-muted-foreground ${indice > 0 ? "border-l marcos-grid-subcolumn-divider" : ""}`}>
                        {rotulo}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>


            {grupos.map((grupo, indiceGrupo) => {
              const recolhido = !!recolhidos[grupo.nome];
              return (
                <section key={grupo.nome} className={indiceGrupo === 0 ? "mt-0" : "mt-2.5"}>
                  <div className="mb-1 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => alternarGrupo(grupo.nome)}
                      aria-expanded={!recolhido}
                      title={`${grupo.descricao} · ${grupo.indicadores.length} ${grupo.indicadores.length === 1 ? "indicador" : "indicadores"}`}
                      className="sticky left-0 z-30 flex h-7 w-max items-center gap-2 bg-background px-1 text-left"
                    >
                      <ChevronDown data-collapsed={recolhido} className="marcos-group-chevron size-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{grupo.nome}</span>
                    </button>
                    <span aria-hidden="true" className="marcos-grid-horizontal-divider h-px flex-1 border-t" />
                  </div>
                  <div className="marcos-group-collapse" data-collapsed={recolhido} aria-hidden={recolhido}>
                    <div className="marcos-group-collapse-inner">
                    {grupo.indicadores.map((indicador, indice) => {
                      return (
                        <div key={indicador.chave} data-marcos-indicador={indicador.chave} className={`group/row flex min-h-12 items-stretch transition-shadow ${indice > 0 ? "border-t marcos-grid-horizontal-divider" : ""} ${alvoRealce?.indicador === indicador.chave && !alvoRealce.mes ? "ring-1 ring-primary" : ""}`}>
                          <div className="marcos-grid-month-divider sticky left-0 z-30 flex w-[170px] shrink-0 flex-col items-start justify-center border-r bg-background px-3 group-hover/row:bg-muted/15">
                            <span className="max-w-full truncate text-sm font-semibold leading-[1.3] text-foreground">{indicador.nome}</span>
                            {indicador.menorMelhor && (
                              <span className="text-[9px] font-medium uppercase text-muted-foreground">menor é melhor</span>
                            )}
                          </div>
                          {bi.meses.map((mes, ci) => {
                            const meta = metas[indicador.chave]?.[mes.mes];
                            const futuro = mes.mes > atual;
                            const real = indicador.realizado(mes);
                            const faixa = !futuro && meta !== undefined && meta !== 0 ? classificarMeta(real, meta, indicador.menorMelhor) : null;
                            const atingimento = atingimentoMarco(real, meta);
                            const tinta = faixa ? `color-mix(in oklab, ${COR_FAIXA[faixa]} 6%, transparent)` : mes.mes === atual ? "color-mix(in oklab, hsl(var(--primary)) 5%, transparent)" : undefined;
                            return (
                              <div
                                key={mes.mes}
                                data-marcos-celula={`${indicador.chave}:${mes.mes}`}
                                onMouseEnter={() => setColHover(ci)}
                                className={`marcos-month-columns whitespace-nowrap group-hover/row:bg-muted/15 ${
                                  ci > 0 ? "border-l marcos-grid-month-divider" : ""
                                } ${colHover === ci ? "bg-muted/15" : ""} ${(alvoRealce?.mes === mes.mes && (!alvoRealce.indicador || alvoRealce.indicador === indicador.chave)) ? "ring-1 ring-inset ring-primary" : ""}`}
                                style={colHover === ci ? undefined : tinta ? { backgroundColor: tinta } : undefined}
                              >
                                <span className="flex min-w-0 items-center px-3 py-3 leading-[1.3]">
                                  <MetaCelula valor={meta} formato={indicador.formato} rotulo={`Editar meta de ${indicador.nome} em ${mes.label}`} onSave={(valor) => salvarMeta(indicador.chave, mes.mes, valor)} />
                                </span>
                                <span
                                  className="marcos-grid-subcolumn-divider flex min-w-0 items-center border-l px-3 py-3 text-left text-sm font-bold leading-[1.3] tabular-nums text-foreground"
                                  title={futuro ? undefined : `Realizado: ${formatar(real, indicador.formato)}`}
                                >
                                  {futuro ? "" : formatarAbrev(real, indicador.formato)}
                                </span>
                                <span className="marcos-grid-subcolumn-divider flex min-w-0 items-center border-l px-3 py-3 leading-[1.3] tabular-nums">
                                  {!futuro && atingimento !== null && faixa && (
                                      <Atingimento valor={atingimento} faixa={faixa} />
                                  )}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </div>

        {!loading && rows.length > 0 && <MarcosGraficos meses={bi.meses} metas={metas} atual={atual} />}

        {!loading && <PainelExecutivo meses={bi.meses} mesesHist={biHist.meses} metas={metas} atual={atual} inicio={inicioEf} fim={fimEf} onNavegar={navegarGrade} />}

        <ExportarCsvModal
          aberto={exportarAberto}
          onOpenChange={setExportarAberto}
          itens={itensExport}
          meses={bi.meses}
          metas={metas}
          atual={atual}
          inicioTela={inicioEf}
          fimTela={fimEf}
        />
      </div>
    </DashboardLayout>
  );
}

export default MarcosPage;
