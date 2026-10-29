import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, LayoutGrid, List, PenLine, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/ui/searchable-select";
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
import { ComposerSubnav } from "@/components/marketing/composer/ComposerSubnav";
import { RevisaoComposicao } from "@/components/marketing/composer/RevisaoComposicao";
import { ConceitosComposicao } from "@/components/marketing/composer/ConceitosComposicao";
import { CancelarComposicao } from "@/components/marketing/composer/CancelarComposicao";
import { ComposicoesGrid } from "@/components/marketing/composer/ComposicoesGrid";
import { ComposicoesLista } from "@/components/marketing/composer/ComposicoesLista";
import {
  ORDENACAO_PADRAO,
  ORDENACOES,
  ordenacaoPor,
  type OrdenacaoId,
} from "@/components/marketing/composer/agruparComposicoes";
import {
  useCancelComposition,
  useComposition,
  useCompositions,
  useDeleteComposition,
} from "@/hooks/useAdComposer";
import { planoDe, type ComposicaoResumo } from "@/lib/adComposerApi";
import {
  guardarVisao,
  lerVisao,
  type VisaoComposicoes,
} from "@/components/marketing/composer/visaoComposicoes";
import { useAvaliacoes } from "@/hooks/useAvaliacoes";
import { AvaliacaoControles } from "@/components/marketing/AvaliacaoControles";

const TODOS = "todos";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Busca em memória pelo que o card mostra: cliente, pedido e análise de origem. */
function filtrarComposicoes(
  lista: ComposicaoResumo[],
  { cliente, busca }: { cliente: string; busca: string },
) {
  const termo = busca.trim().toLowerCase();
  return lista.filter((c) => {
    if (cliente !== TODOS && c.cliente !== cliente) return false;
    if (!termo) return true;
    return [c.nome_exibicao, c.cliente, c.extra_prompt, c.analise_titulo].some((v) =>
      (v ?? "").toLowerCase().includes(termo),
    );
  });
}

function Detalhe({ id, onBack, onDelete }: { id: string; onBack: () => void; onDelete: () => void }) {
  const navigate = useNavigate();
  const { composition, isLoading, error } = useComposition(id);
  const cancelar = useCancelComposition();
  const apagar = useDeleteComposition();
  // O mesmo cache da listagem: votar aqui já deixa o card certo quando a pessoa voltar.
  const { itens: avaliacoes } = useAvaliacoes("composicao");
  const avaliacao = avaliacoes[id];

  if (isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (error || !composition) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Voltar
        </Button>
        <p className="text-sm text-destructive">{error || "Composição não encontrada."}</p>
      </div>
    );
  }

  const total = planoDe(composition).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Composições Salvas
          </Button>
          <h2 className="text-lg font-semibold">
            {composition.nome_exibicao || composition.cliente}
          </h2>
          <p className="text-xs text-muted-foreground">
            {total > 0 && `${total} anúncio${total === 1 ? "" : "s"} · `}
            composta em {formatDate(composition.criado_em)}
            {composition.analise_titulo && ` · análise “${composition.analise_titulo}”`}
          </p>
          {composition.extra_prompt && (
            <p className="max-w-2xl text-xs text-muted-foreground">
              Pedido: “{composition.extra_prompt}”
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Avaliar DEPOIS de ler é o momento em que a pessoa tem opinião formada — mandá-la voltar
              à listagem para votar é pedir que ela decida de memória. Mesmo componente da lista. */}
          <AvaliacaoControles alvo="composicao" id={composition.id} avaliacao={avaliacao} />

          <CancelarComposicao composicao={composition} />
          {/* A segunda ideia para o mesmo cliente é o uso mais comum de uma composição salva. */}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              navigate(`/marketing/composer?cliente=${encodeURIComponent(composition.cliente)}`)
            }
          >
            <PenLine className="mr-1.5 h-3.5 w-3.5" /> Compor de novo
          </Button>
          {composition.canDelete && (
            <Button variant="outline" size="sm" onClick={onDelete}>
              <Trash2 className="mr-1.5 h-4 w-4" /> Apagar
            </Button>
          )}
        </div>
      </div>

      <div className="neu-card rounded-xl p-5">
        {composition.status === "conceitos" ? (
          // Ainda na etapa de Conceitos Estratégicos: dá para aprovar daqui mesmo. "Escolher mais
          // insumos" descarta esta composição e abre a Nova Composição com o cliente.
          <ConceitosComposicao
            composicao={composition}
            onEscolherMaisInsumos={() =>
              void (async () => {
                try {
                  await cancelar.mutateAsync(composition.id).catch(() => {});
                  await apagar.mutateAsync(composition.id);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Não foi possível descartar os conceitos");
                  return;
                }
                navigate(`/marketing/composer?cliente=${encodeURIComponent(composition.cliente)}`);
              })()
            }
          />
        ) : (
          <RevisaoComposicao composicao={composition} />
        )}
      </div>
    </div>
  );
}

/**
 * Marketing › Composer › Composições Salvas — tudo que a equipe já compôs.
 *
 * Toda composição cai aqui sozinha: o worker grava a linha quando o pedido chega, então "salvar" não
 * é uma ação. A lista é da carteira inteira, filtrável por cliente; antes ela era um histórico no pé
 * da tela de compor, que só existia depois de escolher o cliente.
 *
 * A composição aberta fica na URL (`?composicao=<id>`), para dar para mandar o link a alguém.
 * Apagar é só de quem criou ou de admin; o worker impõe isso, e o botão só aparece quando pode.
 */
export default function MarketingComposicoes() {
  const [params, setParams] = useSearchParams();
  const openId = params.get("composicao");
  const [cliente, setCliente] = useState(TODOS);
  const [busca, setBusca] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{ id: string; label: string } | null>(null);

  const { compositions, isLoading, error } = useCompositions(null);
  const apagar = useDeleteComposition();

  // Só os clientes que TÊM composição: um filtro com a carteira inteira ofereceria dezenas de
  // opções que levam a uma lista vazia.
  const clientes = useMemo(() => {
    const porPadrao = new Map<string, string>();
    for (const c of compositions) {
      if (!porPadrao.has(c.cliente)) porPadrao.set(c.cliente, c.nome_exibicao || c.cliente);
    }
    return [...porPadrao]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [compositions]);

  const visiveis = useMemo(
    () => filtrarComposicoes(compositions, { cliente, busca }),
    [compositions, cliente, busca],
  );

  // A lista é o padrão do SITE e a grade é a exceção; a regra e o porquê estão em
  // `visaoComposicoes.ts`, com teste — ela já se perdeu uma vez por viver só no `localStorage`.
  const { itens: avaliacoes } = useAvaliacoes("composicao");
  const [visao, setVisao] = useState<VisaoComposicoes>(lerVisao);
  const trocarVisao = (v: VisaoComposicoes) => {
    setVisao(v);
    guardarVisao(v);
  };

  const [ordenacao, setOrdenacao] = useState<OrdenacaoId>(ORDENACAO_PADRAO);

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("composicao", id);
    else next.delete("composicao");
    setParams(next);
    window.scrollTo({ top: 0 });
  };

  const confirmDelete = () => {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    apagar.mutate(target.id, {
      onSuccess: () => {
        toast.success("Composição apagada");
        if (openId === target.id) open(null);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Não foi possível apagar"),
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <MineracaoHeader activeTab="Composer" />
        <ComposerSubnav activeTab="Composições Salvas" />

        {openId ? (
          <Detalhe
            id={openId}
            onBack={() => open(null)}
            onDelete={() => setPendingDelete({ id: openId, label: "Esta composição" })}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <SearchableSelect
                options={clientes}
                value={cliente}
                onValueChange={setCliente}
                allOption={{ value: TODOS, label: "Todos os clientes" }}
                searchPlaceholder="Buscar cliente"
                triggerClassName="h-9 w-56 text-xs"
              />

              <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por cliente, pedido ou análise"
                  aria-label="Buscar composição"
                  className="h-9 pl-8 text-xs"
                />
              </div>

              {/* A ordenação só existe na lista: na grade ela é sempre por data, e um seletor que
                  não muda nada do que está na tela é pior que nenhum. */}
              {visao === "lista" && !isLoading && (
                <SearchableSelect
                  options={ORDENACOES.map((o) => ({ value: o.id, label: o.label }))}
                  value={ordenacao}
                  onValueChange={(v) => setOrdenacao(ordenacaoPor(v).id)}
                  triggerClassName="h-9 w-44 text-xs"
                />
              )}

              {!isLoading && (
                <span className="text-xs text-muted-foreground">
                  {visiveis.length} composiç{visiveis.length === 1 ? "ão" : "ões"}
                  {visiveis.length !== compositions.length && ` de ${compositions.length}`}
                </span>
              )}

            </div>

            {/* Linha própria, abaixo dos filtros. Antes eram dois ícones mudos espremidos na borda
                direita da barra, e levou dois dias para alguém achá-los — o melhor argumento
                possível de que estavam escondidos demais. Agora têm rótulo e lugar. */}
            <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
              {(
                [
                  { id: "lista" as const, Icon: List, texto: "Lista", label: "Ver em lista, agrupado por cliente" },
                  { id: "cards" as const, Icon: LayoutGrid, texto: "Cards", label: "Ver em cards" },
                ]
              ).map(({ id, Icon, texto, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => trocarVisao(id)}
                  aria-pressed={visao === id}
                  aria-label={label}
                  title={label}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                    visao === id
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {texto}
                </button>
              ))}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {isLoading ? (
              // O esqueleto imita a visão ATIVA. Com a lista por padrão, seis placeholders de card
              // piscando antes de aparecer uma lista é um salto visual que sugere que a tela mudou
              // de ideia.
              visao === "lista" ? (
                <div className="space-y-1.5">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-11 rounded-xl" />
                  ))}
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-44 rounded-xl" />
                  ))}
                </div>
              )
            ) : visiveis.length === 0 ? (
              <div className="neu-card rounded-xl p-10 text-center text-sm text-muted-foreground">
                {compositions.length
                  ? // Filtro em memória: a lista existe, só não casou. Dizer isso evita a leitura
                    // de que não há composição nenhuma.
                    "Nenhuma composição com esses filtros."
                  : "Nenhuma composição ainda. Componha uma na aba Nova Composição."}
              </div>
            ) : visao === "lista" ? (
              <ComposicoesLista
                compositions={visiveis}
                ordenacao={ordenacao}
                avaliacoes={avaliacoes}
                onSelect={open}
                onDelete={(id) => {
                  const c = compositions.find((x) => x.id === id);
                  setPendingDelete({
                    id,
                    label: c ? `A composição de ${c.nome_exibicao || c.cliente}` : "Esta composição",
                  });
                }}
                apagando={apagar.isPending ? (apagar.variables as string) : null}
              />
            ) : (
              <ComposicoesGrid
                compositions={visiveis}
                avaliacoes={avaliacoes}
                onSelect={open}
                onDelete={(id) => {
                  const c = compositions.find((x) => x.id === id);
                  setPendingDelete({
                    id,
                    label: c ? `A composição de ${c.nome_exibicao || c.cliente}` : "Esta composição",
                  });
                }}
                apagando={apagar.isPending ? (apagar.variables as string) : null}
              />
            )}
          </>
        )}

        <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
          <AlertDialogContent className="neu-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>Apagar composição?</AlertDialogTitle>
              <AlertDialogDescription>
                {pendingDelete?.label} some para toda a equipe, com todos os anúncios dela. Não dá
                para desfazer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDelete}>Apagar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
