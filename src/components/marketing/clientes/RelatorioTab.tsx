import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { FileText, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { RelatorioResultado } from "@/components/marketing/clientes/RelatorioResultado";
import type { ClienteCard } from "@/components/marketing/clientes/ClientBriefCard";
import { useAdsRowsCanonicalizadas } from "@/hooks/useAdsRowsCanonicalizadas";
import { useCRMClienteData } from "@/hooks/useCRMClienteData";
import { useClientesMetas } from "@/hooks/useClientesMetas";
import { useMetaAdsCriativosData } from "@/hooks/useMetaAdsCriativosData";
import { fetchAdAnalyses } from "@/hooks/useAdAnalysis";
import {
  useClientReport,
  useClientReports,
  useCreateClientReport,
  useDeleteClientReport,
  useRenameClientReport,
} from "@/hooks/useClientReports";
import { montarSnapshot, type AnuncioMkt } from "@/utils/relatorioSnapshot";
import { montarComparacao } from "@/utils/comparacaoRelatorio";
import { nomeDoRelatorio } from "@/utils/relatorioMarkdown";
import { periodSignature } from "@/utils/crmOverrides";
import { janelaComparavel, type JanelaComparavel } from "../../../../shared/relatorio-metricas";

/**
 * A aba Relatório do cliente: escolhe o período, gera o diagnóstico, guarda histórico.
 */

const ISO = (d: Date) => format(d, "yyyy-MM-dd");

type Periodo = { de: string; ate: string; kind: string; label: string };
type Comparacao = JanelaComparavel & { label: string };

const dISO = (iso: string) => new Date(`${iso}T12:00:00`);

// Formato do criativo pelo que a linha traz: vídeo tocável → vídeo; senão tem thumb/mídia → estático.
function formatoDe(a: { videoUrl: string | null; media: string | null; thumbnail: string | null }): "video" | "estatico" | "desconhecido" {
  return a.videoUrl ? "video" : a.thumbnail || a.media ? "estatico" : "desconhecido";
}

type DadosCRM = ReturnType<typeof useCRMClienteData>;
type Criativos = ReturnType<typeof useMetaAdsCriativosData>;
type ResolveMeta = ReturnType<typeof useClientesMetas>["resolveMeta"];

/**
 * Monta o snapshot e dispara a criação. `comparacao`/`dadosB` nulos = período SIMPLES (sem ponta B) —
 * então nada da comparação entra no snapshot. A leitura é de `totals` (passa pelas correções manuais),
 * não de `clientTable`.
 */
async function gerarRelatorio(
  criar: ReturnType<typeof useCreateClientReport>,
  args: {
    cliente: ClienteCard;
    periodo: Periodo;
    comparacao: Comparacao | null;
    observacao: string;
    titulo: string;
    onCriado: (id: string) => void;
    dadosA: DadosCRM;
    adsAError: boolean;
    dadosB: DadosCRM | null;
    criativos: Criativos;
    resolveMeta: ResolveMeta;
    metasLoading: boolean;
  },
) {
  const { cliente, periodo, comparacao, observacao, titulo, onCriado, dadosA, adsAError, dadosB, criativos, resolveMeta, metasLoading } = args;

  const anunciosMkt: AnuncioMkt[] = criativos.anuncios.map((a) => ({
    adId: a.adId,
    codigo: a.nome,
    formato: formatoDe(a),
    objetivo: a.objetivo,
    status: a.status,
    hookRate: a.agg.hookRate,
    holdRate: a.agg.holdRate,
    // Resultado pelo tipo DOMINANTE (Conversas/Cadastros/…), não só cadastro — senão contas
    // otimizadas p/ mensagem/cliques chegam com tudo em 0.
    resultados: a.agg.resultado,
    tipoResultado: a.agg.tipoResultado,
    thumbnail: a.thumbnail,
    // Único destino honesto que a base tem; imagem fica sem link (ver AnuncioMkt.link).
    link: a.videoPermalink,
    gasto: a.agg.gasto,
    cliques: a.agg.cliquesLink,
    impressoes: a.agg.impressoes,
  }));

  // Análise IA só dos que podem ser citados (geração de demanda com Ad_ID). Falha vira mapa vazio.
  const idsDemanda = anunciosMkt.filter((a) => a.objetivo === "geracao_demanda").map((a) => a.adId);
  const analises = await fetchAdAnalyses(idsDemanda);

  const snapshot = montarSnapshot({
    cliente: cliente.padrao,
    periodo,
    comparacao,
    a: {
      totals: dadosA.totals,
      orcamento: dadosA.orcamentoParado,
      metas: resolveMeta(cliente.padrao, dISO(periodo.de), dISO(periodo.ate)),
      origemFunnel: dadosA.origemFunnel,
    },
    // Período simples: sem ponta B.
    b:
      comparacao && dadosB
        ? {
            totals: dadosB.totals,
            orcamento: dadosB.orcamentoParado,
            metas: resolveMeta(cliente.padrao, dISO(comparacao.de), dISO(comparacao.ate)),
          }
        : null,
    basisFaturamento: dadosA.resolveBasis(cliente.padrao),
    overrideGet: dadosA.overrides?.get,
    // O que o hook conseguiu ler de fato. Sem isto, uma leitura falha chegaria ao agente como zero.
    fontes: { crm: !dadosA.error, ads: !adsAError, metas: !metasLoading },
    marketing: { disponivel: !criativos.error, anuncios: anunciosMkt, analises },
  });

  criar.mutate(
    { cliente: cliente.padrao, snapshot, observacao: observacao || undefined, titulo: titulo || undefined },
    {
      onSuccess: (r) => {
        onCriado(r.id);
        toast.success("Gerando o relatório — aparece aqui em alguns minutos.");
      },
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "Não foi possível gerar o relatório"),
    },
  );
}

function GerarBtn({ carregando, onClick }: { carregando: boolean; onClick: () => void }) {
  return (
    <Button size="sm" onClick={onClick} disabled={carregando}>
      {carregando ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <FileText className="mr-1.5 h-3.5 w-3.5" />
      )}
      Gerar relatório
    </Button>
  );
}

/**
 * Modo COMPARATIVO: monta os hooks dos DOIS períodos. Componente separado de propósito — os hooks de
 * número não têm `enabled` e, com data vazia, varrem a base inteira; só montamos quando há período.
 */
function BotaoGerar({
  cliente,
  periodo,
  comparacao,
  observacao,
  titulo,
  onCriado,
}: {
  cliente: ClienteCard;
  periodo: Periodo;
  comparacao: Comparacao;
  observacao: string;
  titulo: string;
  onCriado: (id: string) => void;
}) {
  const criar = useCreateClientReport();
  const adsA = useAdsRowsCanonicalizadas(periodo.de, periodo.ate);
  const adsB = useAdsRowsCanonicalizadas(comparacao.de, comparacao.ate);
  const dadosA = useCRMClienteData(cliente.padrao, periodo.de, periodo.ate, undefined, undefined, adsA.adsRows);
  const dadosB = useCRMClienteData(cliente.padrao, comparacao.de, comparacao.ate, undefined, undefined, adsB.adsRows);
  const criativosA = useMetaAdsCriativosData(cliente.padrao, periodo.de, periodo.ate);
  const { resolveMeta, loading: metasLoading } = useClientesMetas();
  const [preparando, setPreparando] = useState(false);
  const carregando =
    dadosA.loading || dadosB.loading || adsA.loading || adsB.loading || criativosA.loading ||
    metasLoading || preparando || criar.isPending;

  return (
    <GerarBtn
      carregando={carregando}
      onClick={() => {
        setPreparando(true);
        gerarRelatorio(criar, {
          cliente, periodo, comparacao, observacao, titulo, onCriado,
          dadosA, adsAError: !!adsA.error, dadosB, criativos: criativosA, resolveMeta, metasLoading,
        }).finally(() => setPreparando(false));
      }}
    />
  );
}

/** Modo SIMPLES: só o período analisado (sem ponta B) — corta ~metade da leitura de CRM+ads. */
function BotaoGerarSimples({
  cliente,
  periodo,
  observacao,
  titulo,
  onCriado,
}: {
  cliente: ClienteCard;
  periodo: Periodo;
  observacao: string;
  titulo: string;
  onCriado: (id: string) => void;
}) {
  const criar = useCreateClientReport();
  const adsA = useAdsRowsCanonicalizadas(periodo.de, periodo.ate);
  const dadosA = useCRMClienteData(cliente.padrao, periodo.de, periodo.ate, undefined, undefined, adsA.adsRows);
  const criativosA = useMetaAdsCriativosData(cliente.padrao, periodo.de, periodo.ate);
  const { resolveMeta, loading: metasLoading } = useClientesMetas();
  const [preparando, setPreparando] = useState(false);
  const carregando =
    dadosA.loading || adsA.loading || criativosA.loading || metasLoading || preparando || criar.isPending;

  return (
    <GerarBtn
      carregando={carregando}
      onClick={() => {
        setPreparando(true);
        gerarRelatorio(criar, {
          cliente, periodo, comparacao: null, observacao, titulo, onCriado,
          dadosA, adsAError: !!adsA.error, dadosB: null, criativos: criativosA, resolveMeta, metasLoading,
        }).finally(() => setPreparando(false));
      }}
    />
  );
}

export function RelatorioTab({ cliente }: { cliente: ClienteCard }) {
  const [de, setDe] = useState<Date | undefined>();
  const [ate, setAte] = useState<Date | undefined>();
  const [observacao, setObservacao] = useState("");
  const [titulo, setTitulo] = useState("");
  const [selecionado, setSelecionado] = useState<string | null>(null);

  // COMPARAÇÃO — mesma gramática da aba CRM da tela Clientes: um select escolhe SE compara, e o
  // período de comparação é um range exato, escolhido no mesmo `DateRangePicker` do período
  // analisado. Antes era um interruptor, e a janela vinha pronta da regra compartilhada: dava para
  // ligar ou desligar a comparação, não para dizer CONTRA O QUÊ comparar.
  //
  // SEM comparação por padrão. Comparar é a decisão mais forte que esta tela toma — ela muda o que
  // o agente pode afirmar — e vinha ligada sozinha, então um relatório saía comparativo sem ninguém
  // ter pedido. O relatório de período simples descreve o nível do período contra a meta, que é o
  // que se quer na maioria das vezes; quem quer a comparação liga, e aí escolhe contra o quê.
  const [modoComparacao, setModoComparacao] = useState<"off" | "periodo">("off");
  const [compDe, setCompDe] = useState<Date | undefined>();
  const [compAte, setCompAte] = useState<Date | undefined>();
  // Alguém já mexeu no período de comparação? Enquanto não, ele acompanha a sugestão da regra —
  // depois, para de se mover sozinho. Sem esta trava, escolher o comparável e em seguida ajustar o
  // período analisado apagaria a escolha sem avisar.
  const [compManual, setCompManual] = useState(false);

  const { relatorios, error: erroLista } = useClientReports(cliente.padrao);
  const { relatorio } = useClientReport(selecionado);
  const apagar = useDeleteClientReport(cliente.padrao);
  const renomear = useRenameClientReport(cliente.padrao);

  const periodo = useMemo<Periodo | null>(() => {
    if (!de || !ate) return null;
    const dIso = ISO(de);
    const aIso = ISO(ate);
    const sig = periodSignature(dIso, aIso);
    return { de: dIso, ate: aIso, kind: sig.kind, label: sig.label };
  }, [de, ate]);

  // A janela que a regra COMPARTILHADA com o worker sugere. Continua sendo o padrão: quem não mexe
  // no seletor gera exatamente o relatório que gerava antes.
  const sugestao = useMemo(() => (periodo ? janelaComparavel(periodo) : null), [periodo]);

  // Enquanto ninguém mexeu, o período de comparação segue a sugestão.
  useEffect(() => {
    if (compManual || !sugestao) return;
    setCompDe(dISO(sugestao.de));
    setCompAte(dISO(sugestao.ate));
  }, [sugestao, compManual]);

  /**
   * A comparação que vai ao snapshot. A conta mora em `montarComparacao`, que é testável sozinha —
   * o campo `comparavel` dela autoriza (ou proíbe) o agente a concluir a partir de contagem.
   */
  const comparacao = useMemo<Comparacao | null>(() => {
    if (modoComparacao === "off" || !periodo || !compDe || !compAte) return null;
    return montarComparacao({ periodo, de: ISO(compDe), ate: ISO(compAte), sugestao });
  }, [modoComparacao, periodo, compDe, compAte, sugestao]);

  const remover = (id: string) =>
    apagar.mutate(id, {
      onSuccess: () => {
        if (selecionado === id) setSelecionado(null);
        toast.success("Relatório apagado");
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Não foi possível apagar"),
    });

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            {/* `block` porque o Label do shadcn é um <label>, que é inline: sem isto o `space-y`
                não o empilha e o rótulo fica AO LADO do seletor — enquanto o de "Comparação",
                cujo irmão é um <div>, fica acima. Dois rótulos irmãos em posições diferentes na
                mesma linha do formulário. */}
            <Label className="block text-xs">Período a analisar</Label>
            <DateRangePicker
              from={de}
              to={ate}
              ariaLabel="Período a analisar"
              onChange={({ from, to }) => {
                setDe(from);
                setAte(to);
              }}
            />
          </div>
          {/* A mesma gramática do CRM: um select diz SE compara, e o período de comparação aparece
              ao lado com o "vs", no mesmo seletor de range do período analisado.
              `modal` porque esta aba vive dentro de um Dialog — sem ele a trava de rolagem do
              Radix bloqueia a roda do mouse na lista portalada. */}
          <div className="space-y-1.5">
            <Label className="block text-xs">Comparação</Label>
            <div className="flex flex-wrap items-center gap-2">
              <SearchableSelect
                value={modoComparacao}
                onValueChange={(v) => setModoComparacao(v as "off" | "periodo")}
                options={[
                  { value: "off", label: "Sem comparação" },
                  { value: "periodo", label: "Comparar com outro período" },
                ]}
                allOption={null}
                modal
                placeholder="Comparar..."
                searchPlaceholder="Buscar modo..."
                triggerClassName="w-[220px]"
              />
              {modoComparacao === "periodo" && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-violet-600 dark:text-violet-400">
                    vs
                  </span>
                  <DateRangePicker
                    from={compDe}
                    to={compAte}
                    ariaLabel="Período de comparação"
                    onChange={({ from, to }) => {
                      setCompDe(from);
                      setCompAte(to);
                      setCompManual(true);
                    }}
                    placeholder="Período de comparação"
                    className="border border-violet-500/40 text-violet-600 dark:text-violet-400"
                  />
                </span>
              )}
            </div>
          </div>
          {periodo && modoComparacao === "periodo" && comparacao ? (
            <BotaoGerar
              cliente={cliente}
              periodo={periodo}
              comparacao={comparacao}
              observacao={observacao}
              titulo={titulo}
              onCriado={setSelecionado}
            />
          ) : periodo && modoComparacao === "off" ? (
            <BotaoGerarSimples
              cliente={cliente}
              periodo={periodo}
              observacao={observacao}
              titulo={titulo}
              onCriado={setSelecionado}
            />
          ) : (
            <Button size="sm" disabled>
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              Gerar relatório
            </Button>
          )}
        </div>

        {modoComparacao === "periodo" && comparacao ? (
          <p className="text-[11px] text-muted-foreground">
            Será comparado com <strong>{comparacao.label}</strong> ({comparacao.de} a {comparacao.ate}).{" "}
            {comparacao.motivo}
            {/* Só aparece depois de alguém mexer: é a saída de volta para a regra, que sem isto
                seria um caminho sem retorno — e a regra é o que o worker confere. */}
            {compManual && sugestao && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => setCompManual(false)}
                  className="font-medium text-primary underline underline-offset-2"
                >
                  usar a janela sugerida ({sugestao.de} a {sugestao.ate})
                </button>
              </>
            )}
          </p>
        ) : periodo && modoComparacao === "off" ? (
          <p className="text-[11px] text-muted-foreground">
            Relatório de <strong>período simples</strong> (sem comparação): descreve o nível do período,
            usando a meta quando houver.
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label className="text-xs" htmlFor="relatorio-titulo">
            Nome do relatório (opcional)
          </Label>
          <Input
            id="relatorio-titulo"
            value={titulo}
            maxLength={120}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex.: Setembro — depois da troca de oferta"
            className="h-8 text-xs"
          />
          {/* O nome é rótulo de prateleira e NÃO vai ao agente: o que direciona a análise é o Foco,
              logo abaixo. Dizer isso evita que alguém escreva a instrução no campo errado. */}
          <p className="text-[10px] text-muted-foreground">
            Só para achar no histórico. Não influencia a análise — para isso, use o Foco abaixo.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs" htmlFor="relatorio-obs">
            Foco (opcional)
          </Label>
          <Textarea
            id="relatorio-obs"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Ex.: olhar a campanha de setembro; o cliente reclamou da qualidade do lead"
            className="min-h-[54px] text-xs"
          />
        </div>
      </div>

      {erroLista && <p className="text-sm text-destructive">{erroLista}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_200px]">
        <div className="min-w-0">
          {relatorio ? (
            <RelatorioResultado
              relatorio={relatorio}
              // Sem permissão (não é seu e você não é admin), o nome vira texto em vez de um campo
              // que falharia ao salvar. A regra é a mesma do apagar, que o worker já impõe.
              onRenomear={
                relatorio.canDelete
                  ? (novo) => renomear.mutate({ id: relatorio.id, titulo: novo })
                  : undefined
              }
              renomeando={renomear.isPending}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              Escolha um período e clique em “Gerar relatório”.
            </p>
          )}
        </div>

        <aside className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Histórico
          </h4>
          {relatorios.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Nenhum relatório ainda.</p>
          ) : (
            <ul className="space-y-1">
              {relatorios.map((r) => (
                <li
                  key={r.id}
                  className={`flex items-start gap-1 rounded-md border p-1.5 ${
                    r.id === selecionado ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelecionado(r.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-[11px] font-medium">
                      {nomeDoRelatorio(r)}
                    </p>
                    {/* Com nome dado, o período continua visível: é ele que situa o relatório no
                        tempo, e um nome como "depois da troca de oferta" não diz de quando é. */}
                    {r.titulo && (
                      <p className="truncate text-[10px] text-muted-foreground">
                        {r.periodo_label || `${r.periodo_de} a ${r.periodo_ate}`}
                      </p>
                    )}
                    <p className="truncate text-[10px] text-muted-foreground">
                      {r.status === "running"
                        ? "escrevendo…"
                        : r.status === "error"
                          ? "falhou"
                          : (r.prioridade ?? "sem prioridade")}
                    </p>
                  </button>
                  {r.canDelete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 shrink-0 px-1 text-muted-foreground hover:text-destructive"
                      onClick={() => remover(r.id)}
                      disabled={apagar.isPending && apagar.variables === r.id}
                      aria-label="Apagar relatório"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
