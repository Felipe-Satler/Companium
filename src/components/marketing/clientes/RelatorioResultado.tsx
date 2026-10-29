import { Fragment, useEffect, useRef, useState } from "react";
import { AlertTriangle, Flag, HelpCircle, Loader2, Pencil, Search, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { nomeDoRelatorio } from "@/utils/relatorioMarkdown";
import { useSanitizedMarkdown } from "@/hooks/useSanitizedMarkdown";
import type { Prioridade, Relatorio, TipoCausa } from "@/lib/clientReportsApi";
import type { MarketingSnapshot, MetricaSnapshot } from "@/utils/relatorioSnapshot";
import { thumbQuadrada } from "@/lib/imagemProxy";
import { RelatorioCriativos } from "@/components/marketing/clientes/RelatorioCriativos";
import { MenuExportarRelatorio } from "@/components/marketing/clientes/MenuExportarRelatorio";

/**
 * Um relatório: os quatro blocos, a prioridade e os números que o embasaram.
 *
 * **Os números saem do `snapshot` gravado, nunca de um hook ao vivo.** Um relatório de agosto lido em
 * dezembro tem de mostrar os números de agosto — recalcular aqui faria o texto e a tabela discordarem
 * assim que o banco mudasse, que é exatamente o bug que o snapshot existe para evitar.
 */

const PRIORIDADE: Record<Prioridade, { label: string; classe: string; Icon: typeof Flag }> = {
  gargalo: {
    label: "Gargalo",
    classe: "bg-destructive/10 text-destructive border-destructive/30",
    Icon: Flag,
  },
  investigacao: {
    label: "Investigação",
    classe: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
    Icon: Search,
  },
  oportunidade: {
    label: "Oportunidade",
    classe: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    Icon: TrendingUp,
  },
};

const TIPO_CAUSA: Record<TipoCausa, string> = {
  causa: "causa comprovada",
  correlacao: "correlação",
  hipotese: "hipótese",
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/**
 * O valor de uma ponta, com as TRÊS situações distinguidas — é a regra central desta feature:
 * fonte ilegível, número não calculável e zero de verdade são coisas diferentes.
 */
function valorTexto(p: MetricaSnapshot["a"] | null, unidade: string) {
  if (!p || p.disponivel === false) return "sem informação";
  if (p.valor === null || p.valor === undefined) return "não calculável";
  if (unidade === "moeda") return BRL.format(p.valor);
  if (unidade === "ratio") return `${p.valor.toFixed(2).replace(".", ",")}x`;
  return NUM.format(p.valor);
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h4>
      <div className="mt-1 text-[13px] leading-relaxed">{children}</div>
    </div>
  );
}

function TabelaNumeros({ metricas, comparativo }: { metricas: MetricaSnapshot[]; comparativo: boolean }) {
  const grupos = new Map<string, MetricaSnapshot[]>();
  for (const m of metricas) {
    if (!grupos.has(m.grupo)) grupos.set(m.grupo, []);
    grupos.get(m.grupo)!.push(m);
  }
  const colSpan = comparativo ? 4 : 3;

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-[11px]">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">Métrica</th>
            <th className="px-2 py-1.5 text-right font-medium">Período</th>
            {comparativo && <th className="px-2 py-1.5 text-right font-medium">Comparável</th>}
            <th className="px-2 py-1.5 text-right font-medium">Meta</th>
          </tr>
        </thead>
        <tbody>
          {[...grupos].map(([grupo, lista]) => (
            // A key vai no Fragment: no <tr> interno ela não satisfaz a lista do map.
            <Fragment key={grupo}>
              <tr className="bg-muted/20">
                <td colSpan={colSpan} className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {grupo}
                </td>
              </tr>
              {lista.map((m) => {
                const indisponivel = m.a?.disponivel === false;
                return (
                  <tr key={m.id} className="border-t border-border/60">
                    <td className="px-2 py-1.5">
                      {m.label}
                      {m.a?.corrigido && (
                        <span
                          className="ml-1 text-[10px] text-amber-600 dark:text-amber-400"
                          title="Número com correção manual lançada no CRM para este período"
                        >
                          corrigido
                        </span>
                      )}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right tabular-nums ${
                        indisponivel ? "italic text-muted-foreground" : "font-semibold"
                      }`}
                    >
                      {valorTexto(m.a, m.unidade)}
                    </td>
                    {comparativo && (
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                        {valorTexto(m.b, m.unidade)}
                      </td>
                    )}
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {m.meta?.a ? (
                        <span
                          className={
                            m.meta.a.status === "off"
                              ? "text-destructive"
                              : m.meta.a.status === "ok"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-muted-foreground"
                          }
                        >
                          {m.direcao === "lower" ? "≤ " : ""}
                          {valorTexto({ valor: m.meta.a.valor, disponivel: true, corrigido: false }, m.unidade)}
                          {m.meta.a.pct != null && ` (${m.meta.a.pct.toFixed(0)}%)`}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Taxa (Hook/Hold) com 2 casas. Estático não tem retenção de vídeo → "n/a"; null → "—". */
function taxaPct(v: number | null | undefined, estatico?: boolean) {
  if (estatico) return "n/a";
  return v === null || v === undefined ? "—" : `${v.toFixed(2).replace(".", ",")}%`;
}

// Miniatura do Meta via proxy (mesmo weserv do card de Meta Ads): redimensiona a thumb 64×64 legada e
// resolve CORS/retina. A URL do Meta pode expirar (fica congelada no snapshot) → onError cai no
// placeholder em vez de quebrar a linha. `cover` aqui de propósito: em tabela a miniatura é
// identificador, e o quadrado uniforme ajuda a varrer a coluna (no carrossel é `inside`, que não corta
// — lá a pessoa está julgando o anúncio). Ver src/lib/imagemProxy.ts.
const thumbSrc = (url: string) => thumbQuadrada(url);

function Thumb({ src, alt }: { src: string | null; alt: string }) {
  const [erro, setErro] = useState(false);
  if (!src || erro) {
    return <div className="h-9 w-9 shrink-0 rounded bg-muted" aria-hidden />;
  }
  return (
    <img
      src={thumbSrc(src)}
      alt={alt}
      loading="lazy"
      className="h-9 w-9 shrink-0 rounded border border-border object-cover"
      onError={() => setErro(true)}
    />
  );
}

/**
 * Desempenho por criativo: a média da conta (geração de demanda) e os anúncios salientes, com a
 * miniatura de cada um. Mesma regra de três estados — custo/resultado null é "não calculável", não
 * zero. "Resultado" é o do tipo dominante do anúncio (Conversas/Cadastros/…), não só cadastro. Sai do
 * `snapshot` gravado.
 */
function CriativosMarketing({ mkt }: { mkt: MarketingSnapshot }) {
  const c = mkt.conta;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="font-medium">Conta (geração de demanda):</span>
        <span>Hook <strong className="text-foreground">{taxaPct(c.hookRate)}</strong></span>
        <span>Hold <strong className="text-foreground">{taxaPct(c.holdRate)}</strong></span>
        <span>CPC <strong className="text-foreground">{c.cpc == null ? "não calculável" : BRL.format(c.cpc)}</strong></span>
        <span>Custo/result. <strong className="text-foreground">{c.custoResultadoMeta == null ? "não calculável" : BRL.format(c.custoResultadoMeta)}</strong></span>
        <span>Resultados <strong className="text-foreground">{c.resultadosMeta == null ? "sem informação" : NUM.format(c.resultadosMeta)}</strong></span>
        <span>Investimento <strong className="text-foreground">{c.gasto == null ? "sem informação" : BRL.format(c.gasto)}</strong></span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[11px]">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium" aria-label="Miniatura" />
              <th className="px-2 py-1.5 text-left font-medium">Criativo</th>
              <th className="px-2 py-1.5 text-right font-medium">Hook</th>
              <th className="px-2 py-1.5 text-right font-medium">Hold</th>
              <th className="px-2 py-1.5 text-right font-medium">Custo/result.</th>
              <th className="px-2 py-1.5 text-right font-medium">Resultados</th>
              <th className="px-2 py-1.5 text-right font-medium">Gasto</th>
            </tr>
          </thead>
          <tbody>
            {mkt.criativos.map((cr) => {
              const est = cr.formato === "estatico";
              const tipo = cr.tipoResultado && cr.tipoResultado !== "—" ? cr.tipoResultado : null;
              return (
                // O resumo da análise IA (quando há) fica no title — contexto sem poluir a tabela.
                <tr
                  key={cr.adId || cr.codigo}
                  className="border-t border-border/60"
                  title={cr.analise?.resumo || undefined}
                >
                  <td className="px-2 py-1.5">
                    <Thumb src={cr.thumbnail} alt={cr.codigo || "criativo"} />
                  </td>
                  <td className="px-2 py-1.5">
                    {cr.codigo || "(sem nome)"}
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      {cr.formato}
                      {tipo ? ` · ${tipo}` : ""}
                      {cr.status === "pausado" ? " · pausado" : ""}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{taxaPct(cr.hookRate, est)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{taxaPct(cr.holdRate, est)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {cr.cpl == null ? "não calc." : BRL.format(cr.cpl)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{NUM.format(cr.resultados)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{BRL.format(cr.gasto)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * O cabeçalho: o nome do relatório (editável) e o botão de copiar em markdown.
 *
 * O nome é editável AQUI, e não só no histórico, porque é aqui que a pessoa acabou de ler o
 * relatório e sabe como chamá-lo. `onRenomear` ausente = sem permissão para renomear (não é seu e
 * você não é admin): o campo vira texto, em vez de um input que falha ao salvar.
 */
function Cabecalho({
  relatorio,
  onRenomear,
  renomeando,
  acoes,
}: {
  relatorio: Relatorio;
  onRenomear?: (titulo: string) => void;
  renomeando?: boolean;
  /** O menu de saídas. Vem de fora porque ele precisa dos nós das tabelas, que são irmãs daqui. */
  acoes?: React.ReactNode;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(relatorio.titulo ?? "");

  // Trocar de relatório no histórico com o editor aberto deixaria o nome de um sobre o outro.
  useEffect(() => {
    setEditando(false);
    setRascunho(relatorio.titulo ?? "");
  }, [relatorio.id, relatorio.titulo]);

  const salvar = () => {
    onRenomear?.(rascunho.trim());
    setEditando(false);
  };

  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        {editando ? (
          <div className="flex items-center gap-1.5">
            <Input
              autoFocus
              value={rascunho}
              maxLength={120}
              onChange={(e) => setRascunho(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") salvar();
                if (e.key === "Escape") setEditando(false);
              }}
              placeholder={relatorio.periodo_label || "Nome do relatório"}
              className="h-7 text-sm"
              aria-label="Nome do relatório"
            />
            <Button size="sm" className="h-7" onClick={salvar} disabled={renomeando}>
              Salvar
            </Button>
          </div>
        ) : (
          <h3 className="flex items-center gap-1.5 truncate text-sm font-semibold">
            <span className="truncate">{nomeDoRelatorio(relatorio)}</span>
            {onRenomear && (
              <button
                type="button"
                onClick={() => setEditando(true)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Renomear relatório"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </h3>
        )}
      </div>

      {acoes}
    </div>
  );
}

export function RelatorioResultado({
  relatorio,
  onRenomear,
  renomeando,
}: {
  relatorio: Relatorio;
  onRenomear?: (titulo: string) => void;
  renomeando?: boolean;
}) {
  const html = useSanitizedMarkdown(relatorio.relatorio_md);
  const blocos = relatorio.relatorio;
  const avisos = relatorio.avisos ?? [];

  // Os nós que as saídas capturam. O menu mora no cabeçalho e as tabelas são irmãs dele, então as
  // referências nascem aqui e descem como funções — passar o `ref` cru deixaria o menu depender da
  // ordem de montagem para saber se a tabela existe.
  const refRelatorio = useRef<HTMLDivElement>(null);
  const refCriativos = useRef<HTMLDivElement>(null);
  const refNumeros = useRef<HTMLDivElement>(null);
  const detCriativos = useRef<HTMLDetailsElement>(null);
  const detNumeros = useRef<HTMLDetailsElement>(null);

  const temCriativos = Boolean(
    relatorio.snapshot?.marketing?.disponivel && relatorio.snapshot.marketing.criativos.length,
  );
  const temNumeros = Boolean(relatorio.snapshot?.metricas?.length);

  /**
   * Abre a seção e devolve o nó.
   *
   * A abertura é parte de obter o alvo, não um efeito colateral: `<details>` fechado tem altura
   * zero, e capturar um nó de altura zero devolve uma imagem em branco — que é o pior resultado
   * possível, porque parece ter funcionado. Fica aberto depois, de propósito: quem pediu a imagem
   * daquela tabela quer vê-la.
   */
  const alvoDe = (
    det: React.RefObject<HTMLDetailsElement>,
    node: React.RefObject<HTMLDivElement>,
  ) => () => {
    if (det.current) det.current.open = true;
    return node.current;
  };

  if (relatorio.status === "running") {
    return (
      <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        escrevendo o diagnóstico… (leva alguns minutos)
      </p>
    );
  }

  if (relatorio.status === "error") {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
        <p className="text-sm text-destructive">{relatorio.error || "O relatório falhou."}</p>
      </div>
    );
  }

  const prio = blocos?.problema.prioridade ? PRIORIDADE[blocos.problema.prioridade] : null;

  return (
    <div className="space-y-4" ref={refRelatorio}>
      <Cabecalho
        relatorio={relatorio}
        onRenomear={onRenomear}
        renomeando={renomeando}
        acoes={
          <MenuExportarRelatorio
            relatorio={relatorio}
            alvoRelatorio={() => refRelatorio.current}
            alvoCriativos={temCriativos ? alvoDe(detCriativos, refCriativos) : null}
            alvoNumeros={temNumeros ? alvoDe(detNumeros, refNumeros) : null}
          />
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {prio ? (
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-semibold ${prio.classe}`}>
            <prio.Icon className="h-3 w-3" />
            {prio.label}
          </span>
        ) : (
          blocos && (
            // O worker não chuta entre gargalo e oportunidade; a tela diz isso em vez de esconder.
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 font-medium text-muted-foreground">
              <HelpCircle className="h-3 w-3" />
              prioridade não classificada
            </span>
          )
        )}
        <span className="text-muted-foreground">
          {relatorio.periodo_label || `${relatorio.periodo_de} a ${relatorio.periodo_ate}`}
        </span>
        {relatorio.comparacao_de && (
          <span className="text-muted-foreground">
            · contra {relatorio.comparacao_de} a {relatorio.comparacao_ate}
          </span>
        )}
      </div>

      {relatorio.comparacao_motivo && (
        <p className="text-[11px] italic text-muted-foreground">{relatorio.comparacao_motivo}</p>
      )}

      {avisos.length > 0 && (
        <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
          {avisos.map((a, i) => (
            <p
              key={`${a.codigo}-${i}`}
              className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{a.detalhe}</span>
            </p>
          ))}
        </div>
      )}

      {blocos ? (
        <div className="space-y-3">
          {blocos.leitura && <Bloco titulo="Leitura do Relatório">{blocos.leitura}</Bloco>}
          {blocos.problema.texto && (
            <Bloco titulo="Problema ou oportunidade">
              <p>{blocos.problema.texto}</p>
              {blocos.problema.impacto && (
                <p className="mt-1 text-muted-foreground">Impacto: {blocos.problema.impacto}</p>
              )}
              {blocos.problema.criativos && blocos.problema.criativos.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {blocos.problema.criativos.map((cod) => (
                    <span
                      key={cod}
                      className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium"
                    >
                      {cod}
                    </span>
                  ))}
                </div>
              )}
            </Bloco>
          )}
          {blocos.causa.texto && (
            <Bloco titulo={`Causa e correlação · ${TIPO_CAUSA[blocos.causa.tipo]}`}>
              <p>{blocos.causa.texto}</p>
              {blocos.causa.verificar && (
                <p className="mt-1 text-muted-foreground">A verificar: {blocos.causa.verificar}</p>
              )}
            </Bloco>
          )}
          {blocos.acao.texto && (
            <Bloco titulo="Solução ou ação">
              <p>{blocos.acao.texto}</p>
              <p className="mt-1 text-muted-foreground">
                Responsável: {blocos.acao.responsavel} · Prazo: {blocos.acao.prazo}
              </p>
            </Bloco>
          )}
          {blocos.limitacoes.length > 0 && (
            <Bloco titulo="Limitações">
              <ul className="list-inside list-disc text-muted-foreground">
                {blocos.limitacoes.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </Bloco>
          )}
        </div>
      ) : (
        html && (
          <>
            <p className="text-[11px] text-muted-foreground">
              O agente não devolveu o bloco estruturado desta vez — o diagnóstico abaixo continua
              valendo, mas sem prioridade classificada.
            </p>
            <div
              className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-sm prose-headings:font-semibold [&_p]:text-[13px]"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </>
        )
      )}

      {/* Carrossel primeiro: bater o olho no que esteve no ar. A tabela abaixo é para comparar
          número entre anúncios — duas perguntas diferentes sobre o mesmo dado. */}
      {relatorio.snapshot?.marketing && (
        <RelatorioCriativos mkt={relatorio.snapshot.marketing} />
      )}

      {relatorio.snapshot?.marketing?.disponivel && relatorio.snapshot.marketing.criativos.length ? (
        <details className="rounded-lg border border-border" open ref={detCriativos}>
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
            Desempenho por criativo (Meta)
          </summary>
          <div className="p-2 pt-0" ref={refCriativos}>
            <CriativosMarketing mkt={relatorio.snapshot.marketing} />
          </div>
        </details>
      ) : null}

      {relatorio.snapshot?.metricas?.length ? (
        <details className="rounded-lg border border-border" ref={detNumeros}>
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
            Números que embasaram este relatório
          </summary>
          <div className="p-2 pt-0" ref={refNumeros}>
            <TabelaNumeros
              metricas={relatorio.snapshot.metricas}
              comparativo={relatorio.snapshot.comparacao != null}
            />
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Valores como estavam quando o relatório foi gerado
              {relatorio.snapshot.geradoEm
                ? ` (${new Date(relatorio.snapshot.geradoEm).toLocaleString("pt-BR")})`
                : ""}
              . Base do faturamento: consultas {relatorio.snapshot.basisFaturamento?.consulta}, procedimentos{" "}
              {relatorio.snapshot.basisFaturamento?.procedimento}.
            </p>
          </div>
        </details>
      ) : null}
    </div>
  );
}
