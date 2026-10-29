import * as React from "react";
import { CalendarCheck2, ChevronUp, Gauge, History, Medal, Scale, StepForward, Target, TriangleAlert } from "lucide-react";
import type { BIMes } from "@/components/gestao/useGestaoBI";
import { mesLabel } from "@/components/gestao/useGestaoBI";
import { Button } from "@/components/ui/button";
import { INDICADORES_MARCOS, formatarMarco, formatarMarcoAbreviado } from "./indicadores";
import { montarCelulasExecutivas, resumirFaixas, type CelulaExecutiva, type FaixaMeta } from "./painelExecutivo";
import { montarApoios, type ApoioPainel, type ItemApoio } from "./destaquesPainel";
import { calcularLacuna, situacaoGeral, textoExtremo, textoLacuna } from "./pacing";
import type { IndicadorMarco, MetasMarcos } from "@/lib/marcosMetas";

type AlvoGrade = { indicador?: IndicadorMarco; mes?: string };
type Props = { meses: BIMes[]; mesesHist: BIMes[]; metas: MetasMarcos; atual: string; inicio: string; fim: string; onNavegar: (alvo: AlvoGrade) => void };
const FAIXAS: { chave: FaixaMeta; label: string; classe: string; texto: string }[] = [
  { chave: "superada", label: "Superadas", classe: "bg-primary", texto: "text-primary" },
  { chave: "atingida", label: "Atingidas", classe: "bg-success", texto: "text-success" },
  { chave: "nao-batida", label: "Não batidas", classe: "bg-destructive", texto: "text-destructive" },
];
const pct = (valor: number) => `${valor.toFixed(2).replace(".", ",")}%`;
const sinalPct = (razao: number) => `${razao >= 0 ? "+" : "−"} ${(Math.abs(razao) * 100).toFixed(1).replace(".", ",")}%`;
const rotulo = (faixa: FaixaMeta) => faixa === "superada" ? "Superada" : faixa === "atingida" ? "Atingida" : "Não batida";
function BarraSegmentada({ celulas, compacta = false }: { celulas: CelulaExecutiva[]; compacta?: boolean }) {
  const r = resumirFaixas(celulas);
  return <div className={`neu-inset flex w-full overflow-hidden rounded-full ${compacta ? "h-1.5" : "h-2.5"}`} role="img" aria-label={`${r.superadas} superadas, ${r.atingidas} atingidas, ${r.naoBatidas} não batidas`}>
    {FAIXAS.map((f) => { const n = celulas.filter((c) => c.faixa === f.chave).length; return n ? <span key={f.chave} className={`${f.classe} h-full`} style={{ width: `${n / r.total * 100}%` }} /> : null; })}
  </div>;
}
function BarraMeta({ celula }: { celula: CelulaExecutiva }) {
  const razao = Math.max(0, celula.razao);
  const escala = Math.max(1, razao);
  const marco = 100 / escala;
  return <div className="neu-inset relative h-2.5 w-full overflow-hidden rounded-full" role="img" aria-label={`Realizado sobre meta: ${pct(celula.razao * 100)}`}>
    <span className={`absolute inset-y-0 left-0 ${celula.faixa === "nao-batida" ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.min(1, razao) / escala * 100}%` }} />
    {razao > 1 && <span className="absolute inset-y-0 bg-success" style={{ left: `${marco}%`, width: `${(razao - 1) / escala * 100}%` }} />}
    <span className="absolute inset-y-0 w-px bg-foreground" style={{ left: `${Math.min(99.8, marco)}%` }} />
  </div>;
}
function CardApoio({ apoio, indice, onNavegar }: { apoio: ApoioPainel; indice: number; onNavegar: Props["onNavegar"] }) {
  const ICONES = { alvo: Target, medal: Medal, alerta: TriangleAlert, gauge: Gauge };
  const Icon = (apoio.icone ? ICONES[apoio.icone] : [CalendarCheck2, Medal, TriangleAlert, Gauge][indice]) ?? Gauge;
  const rico = apoio.razao !== undefined && apoio.faixa !== undefined;
  const corFaixa = rico ? FAIXAS.find((f) => f.chave === apoio.faixa)?.texto : undefined;
  const conteudo = <span className="block min-w-0 w-full"><span className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-muted-foreground"><Icon className="size-3.5 shrink-0 text-success" />{apoio.titulo}</span>{rico ? <><span className="mt-1 block truncate text-sm font-semibold text-foreground" title={apoio.valor}>{apoio.valor}</span><span className="mt-0.5 flex items-center gap-2"><strong className={`text-xs font-bold tabular-nums ${corFaixa}`}>{pct(apoio.razao! * 100)}</strong><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold neu-inset ${corFaixa}`}>{rotulo(apoio.faixa!)}</span></span>{apoio.detalhe && <span className="block truncate text-[10px] text-muted-foreground" title={apoio.detalhe}>{apoio.detalhe}</span>}</> : <><strong className="mt-1 block truncate text-sm font-semibold text-foreground" title={apoio.valor}>{apoio.valor}</strong>{apoio.detalhe && <span className="mt-0.5 block truncate text-[10px] text-muted-foreground" title={apoio.detalhe}>{apoio.detalhe}</span>}</>}</span>;
  return apoio.alvo ? <Button variant="ghost" onClick={() => { if (apoio.alvo) onNavegar(apoio.alvo); }} className="neu-card h-auto min-h-16 min-w-0 justify-start px-3 py-2 text-left hover:text-foreground">{conteudo}</Button> : <div className="neu-card min-h-16 min-w-0 px-3 py-2">{conteudo}</div>;
}
export function PainelExecutivo({ meses, mesesHist, metas, atual, inicio, fim, onNavegar }: Props) {
  const [indicador, setIndicador] = React.useState<IndicadorMarco | "todos">("todos");
  const [recolhido, setRecolhido] = React.useState(false);
  const escopoMes = inicio === fim;
  const titulo = escopoMes ? `Mês · ${mesLabel(inicio)}` : `Período · ${mesLabel(inicio)} a ${mesLabel(fim)}`;
  const todas = React.useMemo(() => montarCelulasExecutivas(meses, metas, atual), [meses, metas, atual]);
  const celulas = React.useMemo(() => indicador === "todos" ? todas : todas.filter((c) => c.indicador.chave === indicador), [todas, indicador]);
  const resumo = resumirFaixas(celulas);
  const def = INDICADORES_MARCOS.find((d) => d.chave === indicador);
  const individual = escopoMes && indicador !== "todos";
  const celula = individual ? celulas.find((c) => c.mes.mes === inicio) : undefined;
  const diferenca = celula ? (celula.indicador.menorMelhor ? celula.meta - celula.real : celula.real - celula.meta) : undefined;
  const prevKey = React.useMemo(() => { const [a, m] = inicio.split("-").map(Number); const d = new Date(Date.UTC(a!, m! - 2, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }, [inicio]);
  const nextKey = React.useMemo(() => { const [a, m] = inicio.split("-").map(Number); const d = new Date(Date.UTC(a!, m!, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }, [inicio]);
  const anterior = mesesHist.find((m) => m.mes === prevKey) ?? meses.find((m) => m.mes === prevKey);
  const valorAnterior = anterior && anterior.mes <= atual && def ? def.realizado(anterior) : undefined;
  const variacao = celula && valorAnterior ? (celula.real / valorAnterior - 1) * 100 : undefined;
  const hist = escopoMes ? mesesHist.filter((m) => m.mes <= inicio).slice(-12) : meses;
  const celulasHist = React.useMemo(() => montarCelulasExecutivas(hist, metas, atual), [hist, metas, atual]);
  const apoios = montarApoios(celulas, celulasHist, meses, indicador, escopoMes);
  const pacing = def ? calcularLacuna(def, meses, metas, atual, escopoMes) : null;
  const rotuloPacing = indicador === "todos" ? (escopoMes ? `Situação de ${mesLabel(inicio)}` : "Situação do período") : `Situação ${def?.artigo ?? "do"} ${def?.nome ?? ""} do Período`;
  const situacao = indicador === "todos" ? situacaoGeral(meses, metas, atual, escopoMes) : null;
  const mesSel = individual ? mesesHist.find((m) => m.mes === inicio) ?? meses.find((m) => m.mes === inicio) : undefined;
  const realSel = mesSel && mesSel.mes <= atual && def ? def.realizado(mesSel) : undefined;
  const metaSel = def ? metas[def.chave]?.[inicio] : undefined;
  const metaAnt = def ? metas[def.chave]?.[prevKey] : undefined;
  const varMeta = metaSel !== undefined && metaAnt ? metaSel / metaAnt - 1 : undefined;
  const varReal = realSel !== undefined && valorAnterior ? realSel / valorAnterior - 1 : undefined;
  const serieReal = def ? mesesHist.filter((m) => m.mes <= inicio && m.mes <= atual).map((m) => ({ mes: m, valor: def.realizado(m) })).filter((p) => Number.isFinite(p.valor)) : [];
  const melhorQue = (a: number, b: number) => (def?.menorMelhor ? a < b : a > b);
  const posicao = individual && def && realSel !== undefined && serieReal.length > 1 ? 1 + serieReal.filter((p) => melhorQue(p.valor, realSel)).length : undefined;
  const recorde = serieReal.length ? serieReal.reduce((melhor, p) => (melhorQue(p.valor, melhor.valor) ? p : melhor), serieReal[0]!) : undefined;
  const segundo = posicao === 1 ? serieReal.filter((p) => p.valor !== realSel).reduce<(typeof serieReal)[number] | undefined>((melhor, p) => (!melhor || melhorQue(p.valor, melhor.valor) ? p : melhor), undefined) : undefined;
  const valorPosicao = realSel === undefined ? "—" : serieReal.length <= 1 ? "único mês com dado na janela" : posicao === 1 ? "melhor marca dos últimos 12 meses" : `${posicao}º melhor de ${serieReal.length} meses`;
  const detalhePosicao = posicao === 1 && segundo && def ? `2º: ${formatarMarcoAbreviado(segundo.valor, def.formato)} em ${segundo.mes.label}` : posicao && posicao > 1 && recorde && def ? `recorde ${formatarMarcoAbreviado(recorde.valor, def.formato)} em ${recorde.mes.label}` : undefined;
  const nextMeta = def ? metas[def.chave]?.[nextKey] : undefined;
  const salto = nextMeta !== undefined && realSel ? nextMeta / realSel - 1 : undefined;
  const valorProximo = nextMeta !== undefined && def ? `${mesLabel(nextKey)} · meta ${formatarMarcoAbreviado(nextMeta, def.formato)}` : nextKey > atual ? "último mês da base" : `sem meta definida para ${mesLabel(nextKey)}`;
  const exigeMelhorar = salto !== undefined && def ? (def.menorMelhor ? salto < 0 : salto > 0) : false;
  const leituraEntrega = varMeta === undefined || varReal === undefined || !def ? undefined : varMeta === 0 ? "meta mantida" : (def.menorMelhor ? varMeta < 0 : varMeta > 0) ? (def.menorMelhor ? varReal < 0 : varReal > 0) ? "acompanhou a meta" : "meta subiu e entrega caiu" : (def.menorMelhor ? varReal < 0 : varReal > 0) ? "entrega subiu com meta mais leve" : "os dois recuaram";
  const descricao = !resumo.total ? (individual ? "Sem meta e realizado válidos neste mês" : "Sem metas definidas no período") : individual && celula ? rotulo(celula.faixa) : escopoMes ? `metas batidas em ${mesLabel(inicio)}` : def ? `metas de ${def.nome} batidas no período` : `metas batidas · ${pct(resumo.batidas / resumo.total * 100)}`;
  const estatisticas = individual ? [
    { label: "Atingimento", valor: celula ? pct(celula.razao * 100) : "—", texto: celula ? FAIXAS.find((f) => f.chave === celula.faixa)?.texto : "text-muted-foreground" },
    { label: "Diferença", valor: diferenca !== undefined && def ? `${diferenca >= 0 ? "+" : "−"} ${formatarMarcoAbreviado(Math.abs(diferenca), def.formato)}` : "—", texto: diferenca === undefined ? "text-muted-foreground" : diferenca >= 0 ? "text-primary" : "text-destructive" },
    { label: "Vs mês anterior", valor: variacao !== undefined ? `${variacao >= 0 ? "+" : "−"} ${pct(Math.abs(variacao))}` : "sem mês anterior", texto: variacao !== undefined ? "text-foreground" : "text-muted-foreground" },
  ] : FAIXAS.map((f) => ({ label: f.label, valor: resumo.total ? String(celulas.filter((c) => c.faixa === f.chave).length) : "—", texto: f.texto }));
  return <section className="space-y-4" aria-label="Painel executivo">
    <div className="neu-card px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="neu-inset flex size-8 shrink-0 items-center justify-center rounded-lg text-primary"><Target className="size-4" /></span>
        <h2 className="mr-auto text-sm font-bold text-foreground">{titulo}</h2>
        <div className="flex min-w-0 flex-wrap gap-1" aria-label="Métrica do painel">
          {[{ chave: "todos" as const, nome: "Todos" }, ...INDICADORES_MARCOS].map((item) => <Button key={item.chave} type="button" variant="ghost" size="sm" onClick={() => setIndicador(item.chave)} aria-pressed={indicador === item.chave} className={`h-6 rounded-full px-2 text-[10px] ${indicador === item.chave ? "neu-raised text-primary" : "text-muted-foreground"}`}>{item.nome}</Button>)}
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={() => setRecolhido((v) => !v)} aria-label={recolhido ? "Expandir painel executivo" : "Recolher painel executivo"} title={recolhido ? "Expandir painel" : "Recolher painel"} className="size-8 shrink-0 text-muted-foreground"><ChevronUp className={`transition-transform duration-250 motion-reduce:transition-none ${recolhido ? "rotate-180" : ""}`} /></Button>
      </div>
      {!recolhido && <div className="mt-3">
        <div className="flex items-baseline gap-2 whitespace-nowrap tabular-nums" data-painel-numero>
          <strong className={`font-bold text-foreground ${individual ? "text-xl sm:text-3xl" : "text-4xl"}`} title={celula ? formatarMarco(celula.real, celula.indicador.formato) : undefined}>{individual ? celula ? formatarMarcoAbreviado(celula.real, celula.indicador.formato) : "—" : resumo.total ? resumo.batidas : "—"}</strong>
          <span className="text-sm text-muted-foreground sm:text-lg" title={celula ? formatarMarco(celula.meta, celula.indicador.formato) : undefined}>/ {individual ? celula ? formatarMarcoAbreviado(celula.meta, celula.indicador.formato) : "—" : resumo.total ? resumo.total : "—"}</span>
        </div>
        <p className={`mt-1 text-xs font-semibold ${celula ? FAIXAS.find((f) => f.chave === celula.faixa)?.texto : "text-muted-foreground"}`}>{descricao}</p>
        <div className="mt-3">{celula ? <BarraMeta celula={celula} /> : <BarraSegmentada celulas={celulas} />}</div>
        <div className="mt-3 grid grid-cols-3 gap-3">{estatisticas.map((s, i) => <div key={s.label} className={`min-w-0 ${i === 0 ? "text-left" : i === 1 ? "text-center" : "text-right"}`}><strong className={`block truncate text-base font-bold tabular-nums ${s.texto}`} title={s.valor}>{s.valor}</strong><span className="text-[10px] text-muted-foreground">{s.label}</span></div>)}</div>
      </div>}
    </div>
    {!recolhido && <>
      {!individual && <div className="neu-card px-4 py-3 sm:px-5" aria-label="Composição das metas">
        <h3 className="mb-2 text-[10px] font-bold uppercase text-muted-foreground">{indicador === "todos" ? "Composição por grupo" : "Composição por mês"}</h3>
        {indicador === "todos" ? <div className="grid gap-3 sm:grid-cols-3">{["Base", "Ganho", "Perda"].map((grupo) => { const itens = celulas.filter((c) => c.grupo === grupo); const r = resumirFaixas(itens); return <div key={grupo}><div className="mb-1 flex justify-between text-[11px]"><span className="font-bold text-foreground">{grupo}</span><span className="text-muted-foreground tabular-nums">{r.total ? `${r.batidas}/${r.total}` : "—"}</span></div><BarraSegmentada celulas={itens} compacta /></div>; })}</div> : <div className="grid grid-cols-1 gap-2 sm:flex">{meses.map((mes) => { const c = celulas.find((item) => item.mes.mes === mes.mes); return <div key={mes.mes} className="flex min-w-0 flex-1 items-center gap-2 sm:block sm:text-center" title={c ? `${mes.label}: ${rotulo(c.faixa)} · ${formatarMarco(c.real, c.indicador.formato)} / ${formatarMarco(c.meta, c.indicador.formato)}` : `${mes.label}: sem meta ou realizado válido`}><span className={`block h-2.5 w-12 rounded-sm sm:w-full ${c ? FAIXAS.find((f) => f.chave === c.faixa)?.classe : "bg-muted"}`} /><span className="mt-1 block text-[10px] text-muted-foreground">{mes.label}</span></div>; })}</div>}
      </div>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" aria-label="Destaques do painel">{apoios.map((apoio: ItemApoio, i) => {
        if (apoio.tipo === "pacing") return <div key="pace" className="neu-card min-h-16 min-w-0 px-3 py-2"><span className="flex min-w-0 items-center gap-1.5 text-[10px] font-bold uppercase text-muted-foreground"><Gauge className="size-3.5 shrink-0 text-success" /><span className="truncate" title={rotuloPacing}>{rotuloPacing}</span></span>{indicador === "todos" ? situacao ? <><span className="mt-1 flex items-center gap-2"><strong className={`text-lg font-bold tabular-nums ${situacao.faixa === "abaixo" ? "text-destructive" : situacao.faixa === "acima" ? "text-primary" : "text-success"}`}>{sinalPct(situacao.desvio)}</strong><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold neu-inset ${situacao.faixa === "abaixo" ? "text-destructive" : situacao.faixa === "acima" ? "text-primary" : "text-success"}`}>{situacao.faixa === "abaixo" ? "Abaixo da meta" : situacao.faixa === "acima" ? "Acima da meta" : "Na meta"}</span></span><span className="block text-[10px] text-muted-foreground">{situacao.total < 2 ? `desvio de ${situacao.unico} contra a meta` : "desvio mediano contra as metas"}</span>{situacao.folga && situacao.lacuna && <ul className="mt-1 space-y-0.5 text-[11px]"><li className="flex justify-between gap-2"><span className="truncate text-muted-foreground">Maior folga: <span className="text-foreground">{situacao.folga.indicador.nome}</span></span><span className="shrink-0 font-bold tabular-nums text-primary">{textoExtremo(situacao.folga)}</span></li><li className="flex justify-between gap-2"><span className="truncate text-muted-foreground">Maior lacuna: <span className="text-foreground">{situacao.lacuna.indicador.nome}</span></span><span className={`shrink-0 font-bold tabular-nums ${situacao.lacuna.lacuna > 0 ? "text-destructive" : "text-primary"}`}>{textoExtremo(situacao.lacuna)}</span></li></ul>}</> : <strong className="mt-1 block text-sm text-muted-foreground">{escopoMes ? "Sem metas definidas no mês" : "Sem metas definidas no período"}</strong> : pacing ? <><strong className={`mt-1 block truncate text-sm tabular-nums ${pacing.lacuna > 0 ? "text-destructive" : "text-primary"}`}>{textoLacuna(pacing)}</strong><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{pacing.referencia}</span></> : <strong className="mt-1 block text-sm text-muted-foreground">—</strong>}</div>;
        if (apoio.tipo === "metaEntrega") return <div key="metaEntrega" className="neu-card min-h-16 min-w-0 px-3 py-2"><span className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-muted-foreground"><Scale className="size-3.5 shrink-0 text-success" />Meta contra entrega</span><span className="mt-1 flex items-baseline gap-4 whitespace-nowrap tabular-nums"><span className="text-sm"><span className="mr-1 text-[10px] text-muted-foreground">Meta</span><strong className="text-foreground">{varMeta !== undefined ? sinalPct(varMeta) : "—"}</strong></span><span className="text-sm"><span className="mr-1 text-[10px] text-muted-foreground">Real</span><strong className={varReal === undefined || varReal === 0 ? "text-foreground" : (def?.menorMelhor ? varReal < 0 : varReal > 0) ? "text-primary" : "text-destructive"}>{varReal !== undefined ? sinalPct(varReal) : "—"}</strong></span></span>{leituraEntrega && <span className="mt-0.5 block truncate text-[10px] text-muted-foreground" title={leituraEntrega}>{leituraEntrega}</span>}</div>;
        if (apoio.tipo === "posicao") return <div key="posicao" className="neu-card min-h-16 min-w-0 px-3 py-2"><span className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-muted-foreground"><History className="size-3.5 shrink-0 text-success" />Posição no histórico · 12 meses</span><strong className="mt-1 block truncate text-sm text-foreground" title={valorPosicao}>{valorPosicao}</strong>{detalhePosicao && <span className="mt-0.5 block truncate text-[10px] text-muted-foreground" title={detalhePosicao}>{detalhePosicao}</span>}</div>;
        if (apoio.tipo === "proximo") return <div key="proximo" className="neu-card min-h-16 min-w-0 px-3 py-2"><span className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-muted-foreground"><StepForward className="size-3.5 shrink-0 text-success" />Próximo mês</span><strong className="mt-1 block truncate text-sm text-foreground" title={valorProximo}>{valorProximo}</strong>{salto !== undefined && <span className={`mt-0.5 block truncate text-[10px] tabular-nums ${exigeMelhorar ? "text-chart-pace" : "text-muted-foreground"}`}>{`pede ${sinalPct(salto)} sobre ${mesLabel(inicio)}`}</span>}</div>;
        return <CardApoio key={apoio.titulo} apoio={apoio as ApoioPainel} indice={i} onNavegar={onNavegar} />;
      })}</div>
    </>}
  </section>;
}
