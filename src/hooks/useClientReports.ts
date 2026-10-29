/**
 * Relatórios de período — histórico, criação e polling.
 *
 * Polling pelo mesmo motivo dos outros artefatos de agente: a chamada leva minutos e o worker grava o
 * resultado no banco, não na resposta HTTP. A tela só pergunta enquanto houver algum `running`.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  algumRodando,
  apagarRelatorio,
  criarRelatorio,
  listarRelatorios,
  obterRelatorio,
  renomearRelatorio,
  type NovoRelatorio,
  type Relatorio,
  type RelatorioResumo,
} from "@/lib/clientReportsApi";

const POLL_MS = 4000;

const LISTA = (cliente: string | null) => ["marketing-relatorios", cliente ?? "todos"];
const UM = (id: string | null) => ["marketing-relatorio", id ?? "nenhum"];

function useToken() {
  const { session } = useAuth();
  return session?.access_token ?? "";
}

/** O histórico daquele cliente. Sem cliente, não pergunta nada. */
export function useClientReports(cliente: string | null) {
  const token = useToken();
  const query = useQuery({
    queryKey: LISTA(cliente),
    enabled: Boolean(token && cliente),
    queryFn: () => listarRelatorios(token, cliente),
    refetchInterval: (q) => (algumRodando(q.state.data?.relatorios ?? []) ? POLL_MS : false),
    staleTime: 0,
  });
  return {
    relatorios: query.data?.relatorios ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}

/** Um relatório inteiro — é este o endpoint de polling enquanto ele está sendo escrito. */
export function useClientReport(id: string | null) {
  const token = useToken();
  const query = useQuery({
    queryKey: UM(id),
    enabled: Boolean(token && id),
    queryFn: () => obterRelatorio(token, id as string),
    refetchInterval: (q) => (q.state.data?.relatorio?.status === "running" ? POLL_MS : false),
    staleTime: 0,
  });
  return {
    relatorio: query.data?.relatorio ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}

/**
 * Pede um relatório novo.
 *
 * Escreve a linha `running` no cache ANTES da resposta, pelo mesmo motivo de `useAdSpy`,
 * `useRefreshBrief` e `useAdComposer`: o worker responde 202 e segue trabalhando, e como o polling é
 * decidido pelo que está em cache, uma lista sem a linha nova deixaria a tela parada até um F5. Se a
 * requisição falhar, o estado volta ao que era.
 */
export function useCreateClientReport() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NovoRelatorio) => criarRelatorio(token, input),
    onMutate: async (input) => {
      const key = LISTA(input.cliente);
      await qc.cancelQueries({ queryKey: key });
      const antes = qc.getQueryData<{ relatorios: RelatorioResumo[] }>(key);
      const agora = new Date().toISOString();
      const per = input.snapshot?.periodo;
      qc.setQueryData(key, (old: { relatorios: RelatorioResumo[] } | undefined) => ({
        relatorios: [
          {
            id: `pendente-${agora}`,
            cliente: input.cliente,
            nome_exibicao: null,
            periodo_de: per?.de ?? "",
            periodo_ate: per?.ate ?? "",
            periodo_kind: per?.kind ?? null,
            periodo_label: per?.label ?? null,
            comparacao_de: input.snapshot?.comparacao?.de ?? null,
            comparacao_ate: input.snapshot?.comparacao?.ate ?? null,
            comparacao_regra: input.snapshot?.comparacao?.regra ?? null,
            prioridade: null,
            avisos: [],
            fontes: null,
            status: "running" as const,
            error: null,
            criado_por: null,
            criado_em: agora,
            atualizado_em: agora,
            canDelete: false,
          },
          ...(old?.relatorios ?? []),
        ],
      }));
      return { antes, key };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.antes) qc.setQueryData(ctx.key, ctx.antes);
    },
    onSettled: (_d, _e, input) => void qc.invalidateQueries({ queryKey: LISTA(input.cliente) }),
  });
}

/**
 * Renomeia um relatório.
 *
 * Atualiza o cache otimisticamente nos DOIS lugares onde o nome aparece — a lista do histórico e o
 * relatório aberto —, porque renomear sem ver o nome mudar na hora parece que não funcionou, e a
 * pessoa clica de novo. Erro desfaz os dois.
 */
export function useRenameClientReport(cliente: string | null) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, titulo }: { id: string; titulo: string }) =>
      renomearRelatorio(token, id, titulo),
    onMutate: async ({ id, titulo }) => {
      await qc.cancelQueries({ queryKey: LISTA(cliente) });
      const antesLista = qc.getQueryData(LISTA(cliente));
      const antesUm = qc.getQueryData(UM(id));
      const novo = titulo.trim() || null;

      qc.setQueryData(LISTA(cliente), (old: { relatorios: RelatorioResumo[] } | undefined) =>
        old
          ? { ...old, relatorios: old.relatorios.map((r) => (r.id === id ? { ...r, titulo: novo } : r)) }
          : old,
      );
      qc.setQueryData(UM(id), (old: { relatorio: Relatorio } | undefined) =>
        old ? { ...old, relatorio: { ...old.relatorio, titulo: novo } } : old,
      );
      return { antesLista, antesUm, id };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.antesLista) qc.setQueryData(LISTA(cliente), ctx.antesLista);
      if (ctx?.antesUm) qc.setQueryData(UM(ctx.id), ctx.antesUm);
    },
    onSettled: (_d, _e, { id }) => {
      void qc.invalidateQueries({ queryKey: LISTA(cliente) });
      void qc.invalidateQueries({ queryKey: UM(id) });
    },
  });
}

export function useDeleteClientReport(cliente: string | null) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apagarRelatorio(token, id),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: UM(id) });
      void qc.invalidateQueries({ queryKey: LISTA(cliente) });
    },
  });
}
