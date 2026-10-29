/**
 * Ad Composer — histórico, criação e polling.
 *
 * Polling pelo mesmo motivo dos resumos e da Mineração: o agente leva dezenas de segundos e o
 * worker grava o resultado no banco, não na resposta HTTP. A tela só pergunta enquanto houver
 * alguma composição sendo escrita.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  algumaRodando,
  apagarComposicao,
  aprovarConceito,
  cancelarComposicao,
  confirmarConceitos,
  rejeitarConceito,
  seguirComConceitos,
  desfazerAnuncio,
  editarAnuncio,
  estaTrabalhando,
  pedirRevisao,
  salvarComposicao,
  type ComposicaoCampos,
  type SlotConceito,
  criarComposicao,
  listarComposicoes,
  obterComposicao,
  type Composicao,
  type ComposicaoResumo,
  type NovaComposicao,
} from "@/lib/adComposerApi";

const POLL_MS = 4000;

const LISTA = (cliente: string | null) => ["marketing-compositions", cliente ?? "todos"];
const UMA = (id: string | null) => ["marketing-composition", id ?? "nenhuma"];

function useToken() {
  const { session } = useAuth();
  return session?.access_token ?? "";
}

/**
 * As composições salvas. Com `cliente`, só as dele; com `null`, as da carteira inteira — que é o que
 * a aba "Composições Salvas" mostra antes de alguém filtrar.
 */
export function useCompositions(cliente: string | null) {
  const token = useToken();
  const query = useQuery({
    queryKey: LISTA(cliente),
    enabled: Boolean(token),
    queryFn: () => listarComposicoes(token, cliente),
    refetchInterval: (q) => (algumaRodando(q.state.data?.compositions ?? []) ? POLL_MS : false),
    staleTime: 0,
  });
  return {
    compositions: query.data?.compositions ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}

/** Uma composição inteira — é este o endpoint de polling enquanto ela está sendo escrita. */
export function useComposition(id: string | null) {
  const token = useToken();
  const query = useQuery({
    queryKey: UMA(id),
    enabled: Boolean(token && id),
    queryFn: () => obterComposicao(token, id as string),
    refetchInterval: (q) => {
      const c = q.state.data?.composition;
      return c && estaTrabalhando(c) ? POLL_MS : false;
    },
    staleTime: 0,
  });
  return {
    composition: query.data?.composition ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}

/**
 * Pede uma composição nova.
 *
 * Escreve a linha `running` no cache ANTES da resposta, pelo mesmo motivo de `useAdSpy` e de
 * `useRefreshBrief`: o worker responde 202 e segue trabalhando, e como o polling é decidido pelo
 * que está em cache, uma lista sem a linha nova deixaria a tela parada até um F5. Se a requisição
 * falhar, o estado volta ao que era.
 *
 * O id só existe depois da resposta, então a linha otimista usa um id provisório — e é por isso que
 * `onSuccess` reinvalida: é a resposta que traz o id de verdade, com que a tela faz o polling.
 */
export function useCreateComposition() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NovaComposicao) => criarComposicao(token, input),
    onMutate: async (input) => {
      const key = LISTA(input.cliente);
      await qc.cancelQueries({ queryKey: key });
      const antes = qc.getQueryData<{ compositions: ComposicaoResumo[] }>(key);
      const agora = new Date().toISOString();
      qc.setQueryData(key, (old: { compositions: ComposicaoResumo[] } | undefined) => ({
        compositions: [
          {
            id: `pendente-${agora}`,
            cliente: input.cliente,
            nome_exibicao: null,
            library_entry_id: input.libraryEntryId ?? null,
            analise_titulo: null,
            // O formato só existe depois que o agente escolhe: a linha otimista não tem como
            // saber, e inventar um aqui faria a tela mostrar um formato que pode não ser o final.
            formato: null,
            formato_justificativa: null,
            // Vazio pelo mesmo motivo: quantos anúncios serão, só o agente sabe.
            plano: [],
            entradas: input.entradas,
            extra_prompt: input.extraPrompt ?? null,
            avisos: [],
            fontes: null,
            status: "running" as const,
            error: null,
            criado_por: null,
            criado_em: agora,
            atualizado_em: agora,
            canDelete: false,
          },
          ...(old?.compositions ?? []),
        ],
      }));
      return { antes, key };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.antes) qc.setQueryData(ctx.key, ctx.antes);
    },
    // Pelo prefixo, e não só a lista do cliente: a aba de composições salvas guarda também a lista
    // da carteira inteira, e ela precisa ganhar a linha nova.
    onSettled: () => void qc.invalidateQueries({ queryKey: ["marketing-compositions"] }),
  });
}

export function useCancelComposition() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelarComposicao(token, id),
    // O worker responde antes de a composição parar: reler já mostra o estado novo quando houver,
    // e o polling (que segue enquanto ela estiver `running`) mostra o fim.
    onSettled: (_d, _e, id) => {
      void qc.invalidateQueries({ queryKey: UMA(id) });
      void qc.invalidateQueries({ queryKey: ["marketing-compositions"] });
    },
  });
}

/**
 * As ações da revisão: editar, pedir revisão, desfazer e salvar.
 *
 * Um hook só, com as quatro, porque são usadas juntas, sobre a mesma composição, e todas terminam
 * do mesmo jeito: reler a composição (e as listas, onde o selo "em revisão" mora).
 */
export function useRevisaoComposicao(id: string) {
  const token = useToken();
  const qc = useQueryClient();
  const reler = () => {
    void qc.invalidateQueries({ queryKey: UMA(id) });
    void qc.invalidateQueries({ queryKey: ["marketing-compositions"] });
    // A orquestração que espera esta composição muda de estado no "salvar".
    void qc.invalidateQueries({ queryKey: ["marketing-orquestracoes"] });
    void qc.invalidateQueries({ queryKey: ["marketing-orquestracao"] });
  };
  const editar = useMutation({
    mutationFn: ({ indice, campos }: { indice: number; campos: ComposicaoCampos }) =>
      editarAnuncio(token, id, indice, campos),
    onSettled: reler,
  });
  const revisar = useMutation({
    mutationFn: ({ indice, pedido }: { indice: number; pedido: string }) =>
      pedirRevisao(token, id, indice, pedido),
    onSettled: reler,
  });
  const desfazer = useMutation({
    mutationFn: (indice: number) => desfazerAnuncio(token, id, indice),
    onSettled: reler,
  });
  const salvar = useMutation({
    mutationFn: () => salvarComposicao(token, id),
    onSettled: reler,
  });
  return { editar, revisar, desfazer, salvar };
}

/**
 * As ações da etapa de Conceitos Estratégicos: aprovar, rejeitar (com motivo), seguir com
 * reciclagem e confirmar. Como na revisão, todas terminam relendo a composição: o conceito novo que
 * a rejeição pede chega pelo polling, que a releitura religa.
 */
export function useConceitosComposicao(id: string) {
  const token = useToken();
  const qc = useQueryClient();
  const reler = () => {
    void qc.invalidateQueries({ queryKey: UMA(id) });
    void qc.invalidateQueries({ queryKey: ["marketing-compositions"] });
    void qc.invalidateQueries({ queryKey: ["marketing-orquestracoes"] });
    void qc.invalidateQueries({ queryKey: ["marketing-orquestracao"] });
  };
  /**
   * O card muda NO CLIQUE, e volta se o worker recusar. Sem isso, aprovar só aparecia depois de a
   * ida ao worker (sessão, leitura, trava, gravação) e a releitura da composição inteira voltarem —
   * segundos sem nenhum sinal de que o clique pegou.
   */
  const otimista = (mudar: (s: SlotConceito) => SlotConceito | null) => async (n: number) => {
    await qc.cancelQueries({ queryKey: UMA(id) });
    const antes = qc.getQueryData<{ composition: Composicao }>(UMA(id));
    if (antes?.composition?.conceitos) {
      qc.setQueryData(UMA(id), {
        composition: {
          ...antes.composition,
          conceitos: antes.composition.conceitos.map((s) => (s.n === n ? (mudar(s) ?? s) : s)),
        },
      });
    }
    return { antes };
  };
  const desfazer = (_e: unknown, _v: unknown, ctx?: { antes?: { composition: Composicao } }) => {
    if (ctx?.antes) qc.setQueryData(UMA(id), ctx.antes);
  };
  const aprovar = useMutation({
    mutationFn: (n: number) => aprovarConceito(token, id, n),
    onMutate: otimista((s) => (s.status === "sugerido" ? { ...s, status: "aprovado" } : null)),
    onError: desfazer,
    onSettled: reler,
  });
  const rejeitar = useMutation({
    mutationFn: ({ n, motivo }: { n: number; motivo: string }) => rejeitarConceito(token, id, n, motivo),
    onMutate: ({ n }) => otimista((s) => ({ ...s, status: "gerando", conceito: null, error: null }))(n),
    onError: desfazer,
    onSettled: reler,
  });
  const seguir = useMutation({
    mutationFn: () => seguirComConceitos(token, id),
    onSettled: reler,
  });
  const confirmar = useMutation({
    mutationFn: () => confirmarConceitos(token, id),
    onSettled: reler,
  });
  return { aprovar, rejeitar, seguir, confirmar };
}

export function useDeleteComposition() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apagarComposicao(token, id),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: UMA(id) });
      void qc.invalidateQueries({ queryKey: ["marketing-compositions"] });
    },
  });
}

export type { Composicao, ComposicaoResumo };
