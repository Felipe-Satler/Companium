/**
 * Hooks da Mineração (ad spy) e da Biblioteca de Análises.
 *
 * react-query, não o idioma `useEffect` + `dataCache.ts` das listas pesadas do Supabase: é recurso
 * de endpoint com mutations — mesma categoria de Biblioteca.tsx —, e `refetchInterval` dá o
 * polling de graça.
 *
 * Polling (e não streaming) de propósito: busca e análise levam segundos a minutos, e atrás do
 * nginx a desconexão do browser é indetectável — então o worker grava o progresso na run e a UI lê.
 */

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  deleteCriativo,
  getCriativo,
  listCriativos,
  setCriativoFavorite,
  startCriativo,
  startCriativoInterno,
  atualizarCriativo,
  type FiltroCriativos,
  type OrigemCriativo,
  type SpyCriativoResumo,
  askGrid,
  clearQuestion,
  type SpyQuestion,
  analyzeSelected,
  cancelRun,
  deleteLibraryEntry,
  fetchAdVideo,
  getLibraryEntry,
  getRun,
  isRunActive,
  listLibrary,
  loadMore,
  mediaUrl,
  pesquisarTermos,
  probeTerms,
  reanalyzeRun,
  saveToLibrary,
  setLibraryFavorite,
  startRun,
  type LibraryEntrySummary,
  type SpyMediaKind,
  type SpyAd,
  type SpyRun,
  type SpyRunStatus,
  type SpySettings,
  type SpySourceId,
  type StartRunInput,
} from "@/lib/adSpyApi";

const POLL_MS = 2000;

function useToken() {
  const { session } = useAuth();
  return session?.access_token ?? "";
}

// ---- busca --------------------------------------------------------------------------------

/**
 * A run e seus anúncios. Faz polling só enquanto o worker está trabalhando (buscando bloco ou
 * analisando); parado em "esperando seleção" não custa requisição nenhuma.
 */
export function useSpyRun(runId: string | null) {
  const token = useToken();
  const query = useQuery({
    queryKey: ["ad-spy-run", runId],
    enabled: Boolean(token && runId),
    queryFn: () => getRun(token, runId as string),
    // A pergunta ao grid roda ao lado do `status` da run, com estado próprio: também liga o polling.
    refetchInterval: (q) => {
      const r = q.state.data?.run;
      return isRunActive(r?.status) || r?.question?.status === "running" ? POLL_MS : false;
    },
    staleTime: 0,
  });
  return {
    run: query.data?.run ?? null,
    ads: query.data?.ads ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}

/**
 * Religa o polling depois de pôr o worker para trabalhar.
 *
 * `statusOtimista` existe porque o worker responde 202 e segue trabalhando: entre o 202 e a run
 * mudar de estado no banco há uma janela, e um refetch feito nela lê o estado ANTIGO. Como
 * `refetchInterval` decide a partir do que está em cache, ler o estado antigo DESLIGA o polling —
 * a análise rodava no servidor e a tela ficava parada, sem pipeline, até um F5. Escrever o estado
 * esperado no cache liga o polling na hora; o próximo poll confirma ou corrige pelo servidor.
 */
function useRunMutation<TVars>(
  fn: (token: string, vars: TVars) => Promise<unknown>,
  runIdOf: (v: TVars) => string,
  statusOtimista?: SpyRunStatus,
) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => fn(token, vars),
    onSuccess: (_d, vars) => {
      const key = ["ad-spy-run", runIdOf(vars)];
      if (statusOtimista) {
        qc.setQueryData(key, (old: { run: SpyRun; ads: SpyAd[] } | undefined) =>
          old ? { ...old, run: { ...old.run, status: statusOtimista } } : old,
        );
      }
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}

/**
 * Pergunta ao grid. Mesma razão do `statusOtimista` acima: o worker responde 202 e segue, então a
 * pergunta entra no cache como "rodando" na hora — é o que liga o polling e mostra o progresso.
 */
export function useAskGrid() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { runId: string; pergunta: string }) => askGrid(token, v.runId, v.pergunta),
    onSuccess: (res, v) => {
      const key = ["ad-spy-run", v.runId];
      qc.setQueryData(key, (old: { run: SpyRun; ads: SpyAd[] } | undefined) => {
        if (!old) return old;
        const anterior = old.run.question;
        // Mesma conta do worker (`trocarPergunta`): a pergunta pedida traz as respostas que já
        // tem — as da tela ou as de uma guardada —, e a que estava na tela vai para as guardadas.
        const todas = [
          ...(anterior?.texto && Object.keys(anterior.respostas ?? {}).length
            ? [{ texto: anterior.texto, concluido_em: anterior.concluido_em, respostas: anterior.respostas }]
            : []),
          ...(anterior?.outras ?? []),
        ];
        const question: SpyQuestion = {
          id: "otimista",
          texto: v.pergunta,
          status: "running",
          error: null,
          pedido_em: new Date().toISOString(),
          concluido_em: null,
          total: res.total,
          feito: 0,
          respostas: todas.find((q) => q.texto === v.pergunta)?.respostas ?? {},
          outras: todas.filter((q) => q.texto !== v.pergunta).slice(0, 4),
        };
        return { ...old, run: { ...old.run, question } };
      });
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}

export function useClearQuestion() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => clearQuestion(token, runId),
    onSuccess: (_d, runId) => {
      const key = ["ad-spy-run", runId];
      // Limpar tira a ordenação da tela; o que já foi lido continua guardado (o servidor confirma).
      qc.setQueryData(key, (old: { run: SpyRun; ads: SpyAd[] } | undefined) =>
        old?.run.question
          ? { ...old, run: { ...old.run, question: { ...old.run.question, texto: "", status: "idle" as const, respostas: {} } } }
          : old,
      );
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}

/** Sugestão de palavras-chave. Mutation porque é uma rodada de agente — lenta e sob demanda. */
export function usePesquisarTermos() {
  const token = useToken();
  return useMutation({
    mutationFn: (v: { nicho: string; contexto?: string }) =>
      pesquisarTermos(token, v.nicho, v.contexto),
  });
}

/** Sonda de palavras-chave. Mutation e não query: gasta crédito, então só roda quando se pede. */
export function useProbeTerms() {
  const token = useToken();
  return useMutation({
    mutationFn: (v: { termos: string[]; settings: Partial<SpySettings>; fontes?: SpySourceId[] }) =>
      probeTerms(token, v.termos, v.settings, v.fontes),
  });
}

export function useStartSpyRun() {
  const token = useToken();
  return useMutation({ mutationFn: (input: StartRunInput) => startRun(token, input) });
}

export const useLoadMore = () =>
  useRunMutation((token, runId: string) => loadMore(token, runId), (id) => id, "searching");

export const useAnalyzeSelected = () =>
  useRunMutation(
    (token, v: { runId: string; adIds: number[] }) => analyzeSelected(token, v.runId, v.adIds),
    (v) => v.runId,
    "running",
  );

export const useReanalyzeSpyRun = () =>
  useRunMutation(
    (token, v: { runId: string; extraPrompt?: string }) => reanalyzeRun(token, v.runId, v.extraPrompt),
    (v) => v.runId,
    "running",
  );

export const useCancelSpyRun = () =>
  useRunMutation((token, runId: string) => cancelRun(token, runId), (id) => id);

/**
 * Baixa o vídeo do anúncio para o computador.
 *
 * O download em si é DOM puro (âncora temporária + object URL) porque não existe API de "salvar
 * arquivo" que funcione em todo navegador. O `revokeObjectURL` no fim importa: sem ele o blob —
 * dezenas de MB — fica preso na memória da aba até recarregar a página.
 */
export function useDownloadVideo() {
  const token = useToken();
  return useMutation({
    mutationFn: async (adId: number) => {
      const { blob, filename } = await fetchAdVideo(token, adId);
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      return filename;
    },
  });
}

// ---- Biblioteca ---------------------------------------------------------------------------

export function useSaveToLibrary() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { runId: string; especialidade: string; titulo?: string }) =>
      saveToLibrary(token, v.runId, { especialidade: v.especialidade, titulo: v.titulo }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ad-spy-library"] }),
  });
}

/**
 * Liga/desliga a estrela.
 *
 * Escreve no cache ANTES da resposta: a estrela é um clique de opinião, e esperar a ida e volta ao
 * servidor para ela acender faz a lista parecer travada. Se a requisição falhar, o valor volta ao
 * que era e a tela não mente sobre o que está salvo.
 */
export function useToggleFavorite() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; favorito: boolean }) => setLibraryFavorite(token, v.id, v.favorito),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["ad-spy-library"] });
      const antes = qc.getQueriesData<{ entries: LibraryEntrySummary[] }>({
        queryKey: ["ad-spy-library"],
      });
      for (const [key] of antes) {
        qc.setQueryData(key, (old: { entries: LibraryEntrySummary[] } | undefined) =>
          old
            ? {
                ...old,
                entries: old.entries.map((e) => (e.id === v.id ? { ...e, favorito: v.favorito } : e)),
              }
            : old,
        );
      }
      return { antes };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.antes ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["ad-spy-library"] }),
  });
}

export function useLibrary(especialidades: string[]) {
  const token = useToken();
  const query = useQuery({
    // Ordena para "A,B" e "B,A" caírem no mesmo cache.
    queryKey: ["ad-spy-library", [...especialidades].sort()],
    enabled: Boolean(token),
    queryFn: () => listLibrary(token, especialidades),
  });
  return {
    entries: query.data?.entries ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}

export function useLibraryEntry(id: string | null) {
  const token = useToken();
  const query = useQuery({
    queryKey: ["ad-spy-library-entry", id],
    enabled: Boolean(token && id),
    queryFn: () => getLibraryEntry(token, id as string),
  });
  return {
    entry: query.data?.entry ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}

export function useDeleteLibraryEntry() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteLibraryEntry(token, id),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: ["ad-spy-library-entry", id] });
      void qc.invalidateQueries({ queryKey: ["ad-spy-library"] });
    },
  });
}

// ---- mídia --------------------------------------------------------------------------------

/**
 * Busca uma imagem rehospedada como blob URL.
 *
 * O bucket é privado e o worker exige bearer token, que `<img src>` não manda — então os bytes vêm
 * por aqui e vão para a tag como object URL, revogado no unmount para não vazar um blob por card.
 */
export function useSpyMedia(adId: number | null, kind: SpyMediaKind, hasMedia: boolean) {
  const token = useToken();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !adId || !hasMedia) return;
    let objectUrl: string | null = null;
    let cancelled = false;

    fetch(mediaUrl(adId, kind), { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        /* imagem ausente é cosmético; o card mostra o fallback */
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, adId, kind, hasMedia]);

  return url;
}

// ---- seleção de run -----------------------------------------------------------------------

/**
 * Lembra a busca aberta entre recarregamentos. Uma busca/análise dura mais que uma visita à
 * página; perder o id no F5 largaria a pessoa sem o grid que ela estava montando. sessionStorage
 * (por aba), para duas abas poderem acompanhar buscas diferentes.
 */
const LAST_RUN_KEY = "ad-spy:last-run";

export function useLastRunId() {
  const [runId, setRunId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(LAST_RUN_KEY);
    } catch {
      return null;
    }
  });

  const select = useCallback((id: string | null) => {
    setRunId(id);
    try {
      if (id) sessionStorage.setItem(LAST_RUN_KEY, id);
      else sessionStorage.removeItem(LAST_RUN_KEY);
    } catch {
      /* ignora; o id ainda vive no estado desta visita */
    }
  }, []);

  return [runId, select] as const;
}

/** Progresso geral das etapas de análise, para a barra única do pipeline. */
export function runProgress(run: SpyRun | null) {
  const stages = (run?.stages ?? []).filter((s) => s.key !== "discover" && s.key !== "collect");
  if (!stages.length) return { pct: 0, current: null as string | null };
  const weight = 1 / stages.length;
  let pct = 0;
  let current: string | null = null;
  for (const s of stages) {
    if (s.status === "done" || s.status === "skipped") pct += weight;
    else if (s.status === "running") {
      current = s.label;
      const frac = s.total && s.total > 0 ? Math.min(1, (s.done || 0) / s.total) : 0.25;
      pct += weight * frac;
    }
  }
  return { pct: Math.round(Math.min(1, pct) * 100), current };
}

// ---- análises de criativos -----------------------------------------------------------------

/** Pede a dissecação de UM anúncio. Responde na hora; o resultado chega pelo polling do item. */
export function useStartCriativo() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: OrigemCriativo & { adId: number; especialidade: string; titulo?: string }) =>
      startCriativo(token, v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ad-spy-criativos"] }),
  });
}

export function useCriativos(especialidades: string[], filtro: FiltroCriativos & { enabled?: boolean } = {}) {
  const token = useToken();
  const { enabled = true, ...f } = filtro;
  const query = useQuery({
    queryKey: ["ad-spy-criativos", [...especialidades].sort(), f.origem ?? null, f.cliente ?? null],
    enabled: Boolean(token) && enabled,
    queryFn: () => listCriativos(token, especialidades, f),
    // Enquanto alguma está sendo analisada, a lista acompanha — o card troca de "analisando" para
    // a dissecação sem F5.
    refetchInterval: (q) => (q.state.data?.criativos.some((c) => c.status === "running") ? POLL_MS : false),
  });
  return {
    criativos: query.data?.criativos ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}

export function useCriativo(id: string | null) {
  const token = useToken();
  const query = useQuery({
    queryKey: ["ad-spy-criativo", id],
    enabled: Boolean(token && id),
    queryFn: () => getCriativo(token, id as string),
    refetchInterval: (q) => (q.state.data?.criativo.status === "running" ? POLL_MS : false),
  });
  return {
    criativo: query.data?.criativo ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}

export function useDeleteCriativo() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCriativo(token, id),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: ["ad-spy-criativo", id] });
      void qc.invalidateQueries({ queryKey: ["ad-spy-criativos"] });
    },
  });
}

/** A estrela, otimista como a da Biblioteca. */
export function useToggleCriativoFavorite() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; favorito: boolean }) => setCriativoFavorite(token, v.id, v.favorito),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["ad-spy-criativos"] });
      const antes = qc.getQueriesData<{ criativos: SpyCriativoResumo[] }>({ queryKey: ["ad-spy-criativos"] });
      for (const [key] of antes) {
        qc.setQueryData(key, (old: { criativos: SpyCriativoResumo[] } | undefined) =>
          old
            ? { ...old, criativos: old.criativos.map((c) => (c.id === v.id ? { ...c, favorito: v.favorito } : c)) }
            : old,
        );
      }
      return { antes };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.antes ?? []) qc.setQueryData(key, data);
    },
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: ["ad-spy-criativos"] });
      void qc.invalidateQueries({ queryKey: ["ad-spy-criativo", v.id] });
    },
  });
}

/** Pede a dissecação de um criativo DO CLIENTE (Composer › Criativos Internos). */
export function useStartCriativoInterno() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { cliente: string; metaAdId: string; titulo?: string }) => startCriativoInterno(token, v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ad-spy-criativos"] }),
  });
}

/** A especialidade (e o nome) em que a análise fica salva. */
export function useAtualizarCriativo() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; especialidade?: string; titulo?: string }) =>
      atualizarCriativo(token, v.id, { especialidade: v.especialidade, titulo: v.titulo }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ["ad-spy-criativos"] });
      void qc.invalidateQueries({ queryKey: ["ad-spy-criativo", v.id] });
    },
  });
}
