import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Cpu,
  Library,
  Loader2,
  PenLine,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MineracaoHeader } from "@/components/marketing/mineracao/MineracaoHeader";
import { RevisaoComposicao } from "@/components/marketing/composer/RevisaoComposicao";
import { ConceitosComposicao } from "@/components/marketing/composer/ConceitosComposicao";
import { OrquestracaoPercurso } from "@/components/marketing/composer/OrquestracaoPercurso";
import { PipelineOrquestracao } from "@/components/marketing/composer/PipelineOrquestracao";
import { duracao, useAgora } from "@/components/marketing/composer/tempoOrquestracao";
import { useCancelComposition, useComposition, useDeleteComposition } from "@/hooks/useAdComposer";
import { useClientesVisiveis } from "@/hooks/useClientesVisiveis";
import { useProjetosLista } from "@/hooks/useProjetosLista";
import {
  useCancelOrquestracao,
  useCreateOrquestracao,
  useDeleteOrquestracao,
  useOrquestracao,
  useOrquestracoes,
} from "@/hooks/useOrquestrador";
import { foiCancelada, type Orquestracao, type OrquestracaoResumo } from "@/lib/orquestradorApi";
import { acompanhar, pedirPermissaoDeAviso } from "@/lib/acompanhamento";

function quando(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Onde a orquestração está: a etapa que roda agora, ou como terminou. */
function situacao(o: OrquestracaoResumo) {
  if (foiCancelada(o)) return "cancelada";
  if (o.status === "error") return "falhou";
  if (o.status === "ok") return "concluída";
  if (o.status === "revisao") return "aguardando revisão";
  if (o.status === "conceitos") return "aguardando a aprovação dos conceitos";
  const atual = (o.etapas ?? []).find((e) => e.status === "running");
  return atual ? `${atual.label.toLowerCase()}…` : "começando…";
}

/** Há quanto tempo roda — ou quanto levou, depois de terminar. */
function tempoTotal(o: OrquestracaoResumo, agora: number) {
  const fim = o.status === "running" ? agora : Date.parse(o.atualizado_em);
  return duracao(fim - Date.parse(o.criado_em));
}

/** Direções prontas: um clique escreve o começo do pedido, e a pessoa completa se quiser. */
const DIRECOES = [
  "Só Stories",
  "Um Reels e um anúncio de busca",
  "Foco no procedimento carro-chefe",
  "Público que já conhece a clínica",
];

/**
 * O que a rodada custou: tempo, créditos de busca, chamadas de agente, peças e anúncios.
 *
 * É a primeira pergunta de quem decide se isto vale a pena, e a resposta estava espalhada (ou em
 * lugar nenhum). Travessão onde não há o dado: orquestração de antes desta contagem não tem custo
 * gravado, e "0 créditos" ali seria afirmar uma coisa que ninguém mediu.
 */
function CustoDaRodada({ orquestracao, tempo }: { orquestracao: Orquestracao; tempo: string | null }) {
  const custo = orquestracao.decisoes?.custo;
  const n = (v?: number) => (typeof v === "number" ? String(v) : "—");
  const itens: [string, string, string?][] = [
    ["Tempo", tempo ?? "—"],
    [
      "Créditos de busca",
      n(custo?.creditos),
      custo && !custo.buscas ? "Não minerou: usou a Biblioteca, ou seguiu sem análise" : undefined,
    ],
    ["Chamadas de agente", n(custo?.chamadas_agente)],
    ["Peças analisadas", n(custo?.pecas)],
    ["Anúncios", n(custo?.anuncios)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {itens.map(([rotulo, valor, dica]) => (
        <div key={rotulo} className="rounded-lg border border-border bg-card px-3 py-2" title={dica}>
          <dt className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {rotulo}
          </dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums">{valor}</dd>
        </div>
      ))}
    </dl>
  );
}

function Detalhe({
  id,
  onBack,
  onDelete,
  onCancel,
  cancelando,
  onRepetir,
}: {
  id: string;
  onBack: () => void;
  onDelete: () => void;
  onCancel: () => void;
  cancelando: boolean;
  onRepetir: (cliente: string) => void;
}) {
  const navigate = useNavigate();
  const { orquestracao, isLoading, error } = useOrquestracao(id);
  // A composição é uma linha comum do Composer: o mesmo hook, o mesmo polling, o mesmo marcador
  // "2 de 5" de quem compõe à mão.
  const { composition } = useComposition(orquestracao?.composition_id ?? null);
  const cancelarComposicao = useCancelComposition();
  const apagarComposicao = useDeleteComposition();
  /**
   * "Escolher mais insumos" numa orquestração: os insumos do orquestrador não se editam, então a
   * composição é descartada (o worker fecha a orquestração dizendo por quê) e a Nova Composição
   * abre com o cliente, para escolher à mão.
   */
  const descartarConceitos = async (compositionId: string) => {
    try {
      await cancelarComposicao.mutateAsync(compositionId).catch(() => {});
      await apagarComposicao.mutateAsync(compositionId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível descartar os conceitos");
      return;
    }
    navigate(`/marketing/composer?cliente=${encodeURIComponent(orquestracao?.cliente ?? "")}`);
  };
  const rodando = orquestracao?.status === "running";
  const agora = useAgora(rodando);

  if (isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (error || !orquestracao) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Voltar
        </Button>
        <p className="text-sm text-destructive">{error || "Orquestração não encontrada."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Orquestrações
          </Button>
          <h2 className="text-lg font-semibold">
            {orquestracao.nome_exibicao || orquestracao.cliente}
          </h2>
          <p className="text-xs text-muted-foreground">
            disparada em {quando(orquestracao.criado_em)} · {situacao(orquestracao)}
            {tempoTotal(orquestracao, agora) && (
              <span className="tabular-nums">
                {" "}
                · {rodando ? "há" : "levou"} {tempoTotal(orquestracao, agora)}
              </span>
            )}
          </p>
          {orquestracao.pedido && (
            <p className="max-w-2xl text-xs text-muted-foreground">Pedido: “{orquestracao.pedido}”</p>
          )}
        </div>

        {/* Enquanto roda, a única ação é parar. O botão é de quem disparou (ou admin) — o mesmo
            critério de apagar, e o worker confere de novo. */}
        {rodando && orquestracao.canDelete && (
          <Button variant="outline" size="sm" onClick={onCancel} disabled={cancelando}>
            {cancelando ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Square className="mr-1.5 h-3.5 w-3.5" />
            )}
            {cancelando ? "Cancelando…" : "Cancelar"}
          </Button>
        )}

        {/* O que fazer DEPOIS: terminar numa tela sem saída obrigava a voltar e achar o cliente de
            novo. Só aparecem com a orquestração parada — durante, não há o que ajustar. */}
        {!rodando && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              title="Abre a Nova Composição com este cliente, para escolher os insumos à mão"
              onClick={() =>
                navigate(`/marketing/composer?cliente=${encodeURIComponent(orquestracao.cliente)}`)
              }
            >
              <PenLine className="mr-1.5 h-3.5 w-3.5" /> Ajustar à mão
            </Button>
            <Button variant="outline" size="sm" onClick={() => onRepetir(orquestracao.cliente)}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Orquestrar de novo
            </Button>
            {orquestracao.canDelete && (
              <Button variant="ghost" size="sm" onClick={onDelete} aria-label="Apagar orquestração">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>

      <PipelineOrquestracao etapas={orquestracao.etapas ?? []} rodando={rodando} />

      <CustoDaRodada orquestracao={orquestracao} tempo={tempoTotal(orquestracao, agora)} />

      {rodando && (
        <p className="text-xs text-muted-foreground">
          Pode sair desta tela: a orquestração continua no servidor, e os anúncios caem em
          Composições Salvas.
        </p>
      )}

      {orquestracao.status === "conceitos" && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          <span className="font-semibold">Aguardando sua aprovação dos conceitos.</span> Ao lado, um
          Conceito Estratégico por anúncio: aprove ou rejeite cada um (o agente sugere outro) e
          clique em “Começar composição” — é isso que faz a orquestração seguir.
        </p>
      )}

      {/* A orquestração terminou o trabalho dela e espera uma pessoa: dizer ONDE agir. */}
      {orquestracao.status === "revisao" && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          <span className="font-semibold">Aguardando sua revisão.</span> Os anúncios estão prontos ao
          lado: edite, peça revisão ao agente se precisar e clique em “Salvar composição” — é isso
          que conclui a orquestração.
        </p>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="neu-card space-y-3 rounded-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Percurso</h3>
            {orquestracao.library_entry_id && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  navigate(`/marketing/biblioteca?analise=${orquestracao.library_entry_id}`)
                }
              >
                <Library className="mr-1.5 h-3.5 w-3.5" />
                Abrir a análise
              </Button>
            )}
          </div>
          <OrquestracaoPercurso orquestracao={orquestracao} />
        </section>

        <section className="neu-card space-y-3 rounded-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Anúncios</h3>
            {orquestracao.composition_id && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  navigate(`/marketing/composer/salvas?composicao=${orquestracao.composition_id}`)
                }
              >
                <Library className="mr-1.5 h-3.5 w-3.5" />
                Ver em Composições Salvas
              </Button>
            )}
          </div>
          {orquestracao.decisoes?.pedido_ao_composer && (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                O que ele pediu ao Composer
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed">
                {orquestracao.decisoes.pedido_ao_composer}
              </p>
            </div>
          )}
          {composition?.status === "conceitos" ? (
            <ConceitosComposicao
              composicao={composition}
              nome={orquestracao.nome_exibicao || orquestracao.cliente}
              onEscolherMaisInsumos={() => void descartarConceitos(composition.id)}
            />
          ) : composition ? (
            <RevisaoComposicao composicao={composition} />
          ) : (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              {rodando
                ? "Os anúncios aparecem aqui quando o orquestrador chegar à composição."
                : "Esta orquestração não chegou à composição."}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * Marketing › Orquestrador — do cliente aos anúncios, sem ninguém entre as etapas.
 *
 * A pessoa escolhe o cliente e, se quiser, escreve uma direção. O orquestrador lê os números das
 * duas semanas fechadas, decide a abordagem, usa uma análise da Biblioteca ou manda minerar uma
 * nova, escolhe relatórios e documentos e pede os anúncios ao Composer. A tela mostra o percurso
 * inteiro: o que ele leu, o que decidiu, por quê, e o que perguntou a cada bot.
 *
 * A orquestração aberta fica na URL (`?orquestracao=<id>`). Sair da tela não a interrompe: ela roda
 * no worker, e os anúncios caem em Composições Salvas como os de qualquer composição.
 *
 * Só equipe interna, pelos mesmos dois guardas do resto de /marketing.
 */
export default function MarketingOrquestrador() {
  // Arma o filtro de ativos/ocultos. Sem isso `index.ativos` não sabe quem está ativo.
  useClientesVisiveis();

  const [params, setParams] = useSearchParams();
  const openId = params.get("orquestracao");
  const { index, loading: projetosLoading } = useProjetosLista();
  const [cliente, setCliente] = useState(params.get("cliente") ?? "");
  const [pedido, setPedido] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingCancel, setPendingCancel] = useState<string | null>(null);

  const { orquestracoes, isLoading, error } = useOrquestracoes();
  const criar = useCreateOrquestracao();
  const apagar = useDeleteOrquestracao();
  const cancelar = useCancelOrquestracao();

  const clientes = useMemo(
    () => index.ativos.map((a) => ({ value: a.padrao, label: a.nome })),
    [index],
  );
  const emCurso = orquestracoes.find((o) => o.status === "running") ?? null;
  const agora = useAgora(Boolean(emCurso));
  const podeOrquestrar = Boolean(cliente) && !criar.isPending && !emCurso;

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("orquestracao", id);
    else next.delete("orquestracao");
    setParams(next);
    window.scrollTo({ top: 0 });
  };

  const orquestrar = () => {
    if (!podeOrquestrar) return;
    pedirPermissaoDeAviso();
    const nome = index.ativos.find((a) => a.padrao === cliente)?.nome ?? cliente;
    criar.mutate(
      { cliente, pedido: pedido.trim() || undefined, pularRevisao: false },
      {
        onSuccess: (r) => {
          setPedido("");
          open(r.id);
          acompanhar({ tipo: "orquestracao", id: r.id, nome });
          toast.success("Orquestrando — você é avisado quando terminar, mesmo em outra aba.");
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Não foi possível orquestrar"),
      },
    );
  };

  /** Volta ao disparo já com o cliente escolhido: refazer não pode custar achar o cliente de novo. */
  const repetir = (padrao: string) => {
    setCliente(padrao);
    open(null);
  };

  const parar = () => {
    const id = pendingCancel;
    if (!id) return;
    setPendingCancel(null);
    cancelar.mutate(id, {
      onSuccess: () => toast.success("Cancelando — ela para assim que a etapa em curso soltar."),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "Não foi possível cancelar"),
    });
  };

  const remover = () => {
    const id = pendingDelete;
    if (!id) return;
    setPendingDelete(null);
    apagar.mutate(id, {
      onSuccess: () => {
        toast.success("Orquestração apagada — a composição continua em Composições Salvas");
        if (openId === id) open(null);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Não foi possível apagar"),
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <MineracaoHeader activeTab="Orquestrador" />

        {openId ? (
          <Detalhe
            id={openId}
            onBack={() => open(null)}
            onDelete={() => setPendingDelete(openId)}
            onCancel={() => setPendingCancel(openId)}
            // Segue "cancelando" depois do 202: a orquestração só para quando a etapa em curso solta.
            cancelando={cancelar.isPending || (cancelar.isSuccess && cancelar.variables === openId)}
            onRepetir={repetir}
          />
        ) : (
          <>
            {/* Em andamento primeiro: quem volta à tela quer saber onde está a que disparou, não
                disparar outra (e não pode — é uma por vez). */}
            {emCurso && (
              <button
                type="button"
                onClick={() => open(emCurso.id)}
                className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-primary bg-primary/5 px-4 py-3 text-left transition-colors hover:bg-primary/10"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      {emCurso.nome_exibicao || emCurso.cliente}
                    </span>
                    <span className="block font-mono text-[11px] text-muted-foreground">
                      {situacao(emCurso)} · há {tempoTotal(emCurso, agora)}
                    </span>
                  </span>
                </span>
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">
                  Acompanhar →
                </span>
              </button>
            )}

            {projetosLoading ? (
              <Skeleton className="h-56 rounded-xl" />
            ) : (
              <div className="neu-card overflow-hidden rounded-xl">
                <div className="border-b border-border px-5 py-4">
                  <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">
                    <Cpu className="h-3.5 w-3.5" />
                    Orquestrador
                  </p>
                  <h2 className="mt-1 text-sm font-semibold">
                    Do cliente aos anúncios, sozinho
                  </h2>
                  <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">
                    Lê os números das duas últimas semanas fechadas, decide a abordagem, usa uma
                    análise da Biblioteca se houver uma que sirva, escolhe os relatórios e
                    documentos e pede os anúncios ao Composer.
                  </p>
                </div>

                <div className="space-y-4 p-5">
                  <SearchableSelect
                    options={clientes}
                    value={cliente}
                    onValueChange={setCliente}
                    allOption={null}
                    placeholder="Escolha o cliente"
                    searchPlaceholder="Buscar cliente"
                    triggerClassName="max-w-sm"
                  />

                  <div className="space-y-2">
                    <Textarea
                      value={pedido}
                      onChange={(e) => setPedido(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) orquestrar();
                      }}
                      placeholder="Opcional — uma direção. Sem ela, ele decide tudo pelos números."
                      aria-label="Direção para o orquestrador"
                      rows={2}
                      maxLength={4000}
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">Sugestões:</span>
                      {DIRECOES.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setPedido((atual) => (atual.trim() ? `${atual.trim()}; ${d.toLowerCase()}` : d))}
                          className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Visível e travada de propósito: a revisão humana é obrigatória por enquanto, e a
                      chave mostra que existe a opção — e que ela está desligada. O worker já a
                      respeita (`pularRevisao`); liberar é tirar o `disabled` daqui. */}
                  <div className="flex items-center gap-2">
                    <Switch
                      id="pular-revisao"
                      checked={false}
                      disabled
                      aria-describedby="pular-revisao-ajuda"
                    />
                    <Label htmlFor="pular-revisao" className="text-xs text-muted-foreground">
                      Pular revisão da composição
                    </Label>
                    <span id="pular-revisao-ajuda" className="text-[11px] text-muted-foreground">
                      — em breve. Por enquanto toda composição espera você revisar e salvar.
                    </span>
                  </div>

                  {/* Dito ANTES do clique: ninguém aprova o gasto no meio do caminho. */}
                  <p className="flex max-w-3xl items-start gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-2 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Quando nenhuma análise da Biblioteca serve, ele minera uma nova sem perguntar:
                    isso gasta créditos de busca e pode levar dezenas de minutos de transcrição. A
                    análise nova fica salva na Biblioteca.
                  </p>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                    <span className="text-xs text-muted-foreground">
                      {emCurso
                        ? "Uma por vez: espere a que está em andamento terminar."
                        : !cliente
                          ? "Escolha o cliente para começar."
                          : "Ctrl + Enter também dispara."}
                    </span>
                    <Button size="sm" onClick={orquestrar} disabled={!podeOrquestrar}>
                      {criar.isPending ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Cpu className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Orquestrar do começo ao fim
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Orquestrações</h2>
              {isLoading ? (
                <Skeleton className="h-24 rounded-xl" />
              ) : orquestracoes.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  Nenhuma orquestração ainda.
                </p>
              ) : (
                <ul className="space-y-2">
                  {orquestracoes.map((o) => (
                    <li
                      key={o.id}
                      className="flex items-start gap-2 rounded-lg border border-border bg-card p-2.5 transition-colors hover:bg-muted/40"
                    >
                      <button
                        type="button"
                        onClick={() => open(o.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-xs font-semibold">
                          {o.nome_exibicao || o.cliente}
                          <span
                            className={`ml-1.5 inline-flex items-center gap-1 font-normal ${
                              o.status === "error" && !foiCancelada(o)
                                ? "text-destructive"
                                : "text-muted-foreground"
                            }`}
                          >
                            {o.status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
                            {situacao(o)}
                          </span>
                        </p>
                        {o.pedido && (
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            “{o.pedido}”
                          </p>
                        )}
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {quando(o.criado_em)}
                          {tempoTotal(o, agora) && (
                            <span className="tabular-nums">
                              {" "}
                              · {o.status === "running" ? "há" : "levou"} {tempoTotal(o, agora)}
                            </span>
                          )}
                        </p>
                      </button>
                      {o.canDelete && o.status !== "running" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 shrink-0 px-2 text-muted-foreground hover:text-destructive"
                          onClick={() => setPendingDelete(o.id)}
                          disabled={apagar.isPending && apagar.variables === o.id}
                          aria-label={`Apagar orquestração de ${o.nome_exibicao || o.cliente}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        <AlertDialog open={pendingCancel !== null} onOpenChange={(o) => !o && setPendingCancel(null)}>
          <AlertDialogContent className="neu-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>Cancelar a orquestração?</AlertDialogTitle>
              <AlertDialogDescription>
                Ela para na etapa em que está. O que já ficou pronto — uma análise salva, anúncios
                já escritos — não é desfeito, e créditos de busca já gastos não voltam.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Continuar rodando</AlertDialogCancel>
              <AlertDialogAction onClick={parar}>Cancelar orquestração</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
          <AlertDialogContent className="neu-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>Apagar orquestração?</AlertDialogTitle>
              <AlertDialogDescription>
                Some o registro do percurso — o diagnóstico, as decisões e as perguntas aos bots. Os
                anúncios e a análise que nasceram dela continuam em Composições Salvas e na
                Biblioteca.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={remover}>Apagar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
