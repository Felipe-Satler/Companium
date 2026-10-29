import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BookmarkCheck, BookmarkPlus, PenLine } from "lucide-react";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MineracaoHeader } from "@/components/marketing/mineracao/MineracaoHeader";
import { MineracaoSubnav } from "@/components/marketing/mineracao/MineracaoSubnav";
import { MineracaoForm } from "@/components/marketing/mineracao/MineracaoForm";
import { PipelineProgress } from "@/components/marketing/mineracao/PipelineProgress";
import { AnalysisReport } from "@/components/marketing/mineracao/AnalysisReport";
import { analiseOrganica } from "@/components/marketing/mineracao/relatorioTexto";
import { AdGrid } from "@/components/marketing/mineracao/AdGrid";
import { AnuncianteBanner } from "@/components/marketing/mineracao/AnuncianteBanner";
import { SaveToLibraryDialog } from "@/components/marketing/mineracao/SaveToLibraryDialog";
import {
  useAnalyzeSelected,
  useAskGrid,
  useClearQuestion,
  useCancelSpyRun,
  useLastRunId,
  useLoadMore,
  useReanalyzeSpyRun,
  useSaveToLibrary,
  useSpyRun,
  useStartSpyRun,
} from "@/hooks/useAdSpy";
import { advertiserRunInput, type SpyAd, type StartRunInput } from "@/lib/adSpyApi";

/** Espelha SPY_MAX_SELECTED do worker (default 30). O worker é quem impõe; aqui é só a UI. */
const MAX_SELECTED = 30;

const ANALYSIS_STAGES = new Set(["download", "transcribe", "analyze"]);

/** Mesma ordem em que o worker entrega o corpus ao agente — é por ela que a análise cita #n. */
function citationOrder(ads: SpyAd[]) {
  return ads
    .filter((a) => a.selected)
    .sort((a, b) => (b.days_running ?? -1) - (a.days_running ?? -1) || a.id - b.id);
}

/**
 * Mineração — busca em blocos, seleção manual, análise e Biblioteca.
 *
 * Só equipe interna: /marketing não está na CLIENT_USER_ALLOWED do ProtectedRoute, a sidebar esconde
 * o item para usuário-cliente, e o worker recusa quem tem linha em `user_client_scope` — a guarda
 * do frontend é conveniência, a do worker é a fronteira.
 */
export default function Marketing() {
  const [runId, selectRunId] = useLastRunId();
  const { run, ads, error } = useSpyRun(runId);
  // Grid de um anunciante: uma visão adicional, aberta a partir de outra busca. A busca de origem é
  // lida aqui só para dar nome ao caminho de volta — e fica em cache, então voltar é imediato.
  const anunciante = run?.sources.includes("meta_advertiser") ? run.settings?.advertiser ?? null : null;
  const origem = useSpyRun(anunciante?.fromRunId ?? null);
  const startRun = useStartSpyRun();
  const loadMore = useLoadMore();
  const analyze = useAnalyzeSelected();
  const reanalyze = useReanalyzeSpyRun();
  const cancelRun = useCancelSpyRun();
  const save = useSaveToLibrary();
  const ask = useAskGrid();
  const clearQuestion = useClearQuestion();

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saveOpen, setSaveOpen] = useState(false);
  // Guarda QUAL texto de análise foi salvo: reanalisar gera outro texto, e aí salvar volta a fazer
  // sentido (a Biblioteca guarda snapshot). O id da entrada é o que o "Compor" leva ao Composer.
  const [savedAnalysis, setSavedAnalysis] = useState<{ texto: string; id: string } | null>(null);

  // Ao abrir uma busca (inclusive após F5), a seleção parte do que o servidor tem marcado.
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!run || hydratedFor === run.id) return;
    setSelected(new Set(ads.filter((a) => a.selected).map((a) => a.id)));
    setHydratedFor(run.id);
  }, [run, ads, hydratedFor]);

  // "Minerar este anunciante" troca a busca na tela. O anúncio fica aqui até a pessoa confirmar:
  // a busca gasta crédito, e isso tem de ser decisão de quem clica, não efeito de um ícone.
  const [mineTarget, setMineTarget] = useState<SpyAd | null>(null);
  // A seleção de cada busca que a pessoa deixou para minerar um anunciante. A seleção só vai ao
  // servidor na hora de analisar; sem isto, ir e voltar apagaria o que estava marcado.
  const stashedSelection = useRef(new Map<string, Set<number>>());

  const busy = run?.status === "searching" || run?.status === "running";
  // `status === "running"` entra junto: entre pedir a análise e o worker marcar a primeira etapa
  // como iniciada há uns segundos em que TODA etapa ainda está "pending". Sem isso, a tela fica sem
  // resposta visível justo no clique que mais espera resposta.
  const showPipeline =
    run?.status === "running" ||
    Boolean(run?.stages?.some((s) => ANALYSIS_STAGES.has(s.key) && s.status !== "pending"));
  const cited = useMemo(() => citationOrder(ads), [ads]);
  const citeIndex = useMemo(
    () => (run?.status === "done" ? new Map(cited.map((a, i) => [a.id, i + 1])) : undefined),
    [cited, run?.status],
  );

  const toggle = useCallback((id: number) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_SELECTED) next.add(id);
      return next;
    });
  }, []);

  const handleStart = (input: StartRunInput) => {
    startRun.mutate(input, {
      onSuccess: (res) => {
        setSelected(new Set());
        setHydratedFor(res.runId);
        setSavedAnalysis(null);
        selectRunId(res.runId);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Não foi possível iniciar a busca"),
    });
  };

  const handleMineAdvertiser = () => {
    const input = mineTarget && advertiserRunInput(mineTarget, run);
    setMineTarget(null);
    if (!input) return;
    if (run) stashedSelection.current.set(run.id, selected);
    handleStart(input);
  };

  const handleBack = () => {
    const from = run?.settings?.advertiser?.fromRunId;
    // Sem busca de origem (ou se ela foi apagada), sair do grid do anunciante é voltar ao formulário.
    if (!from || (origem.error && !origem.run)) {
      setSelected(new Set());
      setHydratedFor(null);
      setSavedAnalysis(null);
      selectRunId(null);
      return;
    }
    const guardada = stashedSelection.current.get(from);
    setSelected(guardada ?? new Set());
    // Com a seleção guardada, ela vale mais que a do servidor (que só conhece o que foi analisado).
    setHydratedFor(guardada ? from : null);
    setSavedAnalysis(null);
    selectRunId(from);
  };

  const handleAsk = (pergunta: string) => {
    if (!runId) return;
    ask.mutate(
      { runId, pergunta },
      { onError: (err) => toast.error(err instanceof Error ? err.message : "Não foi possível perguntar") },
    );
  };

  const handleClearQuestion = () => {
    if (!runId) return;
    clearQuestion.mutate(runId, {
      onError: (err) => toast.error(err instanceof Error ? err.message : "Não foi possível limpar a pergunta"),
    });
  };

  /** Soma à seleção as peças que atendem, na ordem do grid, até o teto da análise. */
  const handleSelectMatching = (ids: number[]) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (next.size >= MAX_SELECTED) break;
      next.add(id);
    }
    const ficaramDeFora = ids.filter((id) => !next.has(id)).length;
    setSelected(next);
    if (ficaramDeFora > 0) {
      toast.info(
        `A análise aceita até ${MAX_SELECTED} peças: ${ficaramDeFora} que atendem ficaram de fora da seleção.`,
      );
    }
  };

  const handleLoadMore = useCallback(() => {
    if (!runId || loadMore.isPending) return;
    loadMore.mutate(runId, {
      onError: (err) => toast.error(err instanceof Error ? err.message : "Não foi possível carregar mais"),
    });
  }, [runId, loadMore]);

  const handleAnalyze = () => {
    if (!runId || !selected.size) return;
    analyze.mutate(
      { runId, adIds: [...selected] },
      {
        onSuccess: () => {
          setSavedAnalysis(null);
          toast.success("Analisando os anúncios selecionados");
          window.scrollTo({ top: 0, behavior: "smooth" });
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Não foi possível analisar"),
      },
    );
  };

  const handleReanalyze = () => {
    if (!runId) return;
    reanalyze.mutate(
      { runId },
      {
        onSuccess: () => toast.success("Refazendo a análise"),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Não foi possível reanalisar"),
      },
    );
  };

  const handleCancel = () => {
    if (!runId) return;
    cancelRun.mutate(runId, {
      onSuccess: () => toast.success("Cancelamento solicitado"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Não foi possível cancelar"),
    });
  };

  const handleSave = (input: { titulo: string; especialidade: string }) => {
    if (!runId || !run?.analysis_md) return;
    const analysisText = run.analysis_md;
    save.mutate(
      { runId, titulo: input.titulo || undefined, especialidade: input.especialidade },
      {
        onSuccess: (res) => {
          setSavedAnalysis({ texto: analysisText, id: res.id });
          setSaveOpen(false);
          toast.success("Análise salva na Biblioteca");
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Não foi possível salvar"),
      },
    );
  };

  const alreadySaved = Boolean(run?.analysis_md && savedAnalysis?.texto === run.analysis_md);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <MineracaoHeader activeTab="Mineração" />
        <MineracaoSubnav activeTab="Nova Mineração" />

        {/* No grid de um anunciante o formulário sai: buscar dali trocaria o grid por uma busca
            nova e a pessoa perderia a volta à busca original. */}
        {anunciante ? (
          <AnuncianteBanner
            anunciante={anunciante}
            temaDeOrigem={origem.run?.tema ?? null}
            onBack={handleBack}
          />
        ) : (
          <MineracaoForm
            onStart={handleStart}
            isStarting={startRun.isPending}
            disabled={busy}
            disabledReason={busy ? "Aguarde a busca ou a análise em andamento terminar." : null}
          />
        )}

        {error && !run && (
          <div className="neu-card rounded-xl p-4">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Falha na busca antes de existir qualquer anúncio: não há grid nem pipeline para mostrar. */}
        {run?.status === "error" && !showPipeline && ads.length === 0 && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">Nenhum anúncio para “{run.tema}”</p>
            <p className="mt-1 text-sm text-muted-foreground">{run.error}</p>
          </div>
        )}

        {run && showPipeline && (
          <PipelineProgress
            run={run}
            onCancel={handleCancel}
            isCanceling={cancelRun.isPending || run.cancel_requested}
            onReanalyze={handleReanalyze}
            isReanalyzing={reanalyze.isPending}
          />
        )}

        {run?.status === "done" && run.analysis_md && (
          <AnalysisReport
            analysisMd={run.analysis_md}
            analysis={run.analysis}
            organico={analiseOrganica(cited)}
            actions={
              <>
                <Button
                  size="sm"
                  variant={alreadySaved ? "outline" : "default"}
                  onClick={() => setSaveOpen(true)}
                  disabled={alreadySaved}
                >
                  {alreadySaved ? (
                    <BookmarkCheck className="mr-1.5 h-4 w-4" />
                  ) : (
                    <BookmarkPlus className="mr-1.5 h-4 w-4" />
                  )}
                  {alreadySaved ? "Salva na Biblioteca" : "Salvar na Biblioteca"}
                </Button>
                {/* O Composer só compõe com o que está na Biblioteca — por isso o botão só aparece
                    depois de salvar, e leva o id da entrada, não o da busca. */}
                {alreadySaved && savedAnalysis && (
                  <Button size="sm" asChild>
                    <Link to={`/marketing/composer?analise=${encodeURIComponent(savedAnalysis.id)}`}>
                      <PenLine className="mr-1.5 h-4 w-4" />
                      Compor com esta análise
                    </Link>
                  </Button>
                )}
              </>
            }
          />
        )}

        {run && (ads.length > 0 || run.status === "searching") && (
          <AdGrid
            run={run}
            ads={ads}
            selectedIds={selected}
            onToggle={toggle}
            onClearSelection={() => setSelected(new Set())}
            onLoadMore={handleLoadMore}
            isLoadingMore={loadMore.isPending || run.status === "searching"}
            onAnalyze={handleAnalyze}
            isAnalyzing={analyze.isPending}
            maxSelected={MAX_SELECTED}
            citeIndex={citeIndex}
            onMineAdvertiser={setMineTarget}
            onAsk={handleAsk}
            isAsking={ask.isPending}
            onClearQuestion={handleClearQuestion}
            onSelectMatching={handleSelectMatching}
          />
        )}

        <AlertDialog open={Boolean(mineTarget)} onOpenChange={(open) => !open && setMineTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Minerar os anúncios de {mineTarget?.page_name || "este anunciante"}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Abre uma busca nova só com os anúncios que este anunciante tem no ar, sem filtro de
                qualidade. Costuma gastar 1 crédito por bloco de anúncios. A busca atual fica
                guardada, com o que você marcou, e dá para voltar a ela.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleMineAdvertiser}>Minerar anunciante</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {run && (
          <SaveToLibraryDialog
            open={saveOpen}
            onOpenChange={setSaveOpen}
            defaultTitle={run.tema}
            selectedCount={cited.length}
            onSave={handleSave}
            isSaving={save.isPending}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
