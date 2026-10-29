/**
 * Orquestrador — lista, disparo e polling.
 *
 * Polling pelo mesmo motivo do Composer: o worker responde 202 e segue trabalhando por minutos
 * (dezenas, quando há mineração), gravando o percurso no banco. A tela só pergunta enquanto houver
 * orquestração rodando.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  apagarOrquestracao,
  cancelarOrquestracao,
  criarOrquestracao,
  listarOrquestracoes,
  obterOrquestracao,
} from "@/lib/orquestradorApi";

const POLL_MS = 4000;
const LISTA = ["marketing-orquestracoes"];
const UMA = (id: string | null) => ["marketing-orquestracao", id ?? "nenhuma"];

function useToken() {
  const { session } = useAuth();
  return session?.access_token ?? "";
}

export function useOrquestracoes() {
  const token = useToken();
  const query = useQuery({
    queryKey: LISTA,
    enabled: Boolean(token),
    queryFn: () => listarOrquestracoes(token),
    refetchInterval: (q) =>
      (q.state.data?.orquestracoes ?? []).some((o) => o.status === "running") ? POLL_MS : false,
    staleTime: 0,
  });
  return {
    orquestracoes: query.data?.orquestracoes ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}

/** Uma orquestração inteira — o endpoint de polling enquanto ela roda. */
export function useOrquestracao(id: string | null) {
  const token = useToken();
  const query = useQuery({
    queryKey: UMA(id),
    enabled: Boolean(token && id),
    queryFn: () => obterOrquestracao(token, id as string),
    refetchInterval: (q) => (q.state.data?.orquestracao?.status === "running" ? POLL_MS : false),
    staleTime: 0,
  });
  return {
    orquestracao: query.data?.orquestracao ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}

export function useCreateOrquestracao() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { cliente: string; pedido?: string; pularRevisao?: boolean }) =>
      criarOrquestracao(token, input),
    // A lista é que decide o polling: sem reler, a linha nova só apareceria num F5.
    onSettled: () => void qc.invalidateQueries({ queryKey: LISTA }),
  });
}

export function useCancelOrquestracao() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelarOrquestracao(token, id),
    // O worker responde antes de a orquestração parar: reler já mostra a etapa fechando, e o
    // polling (que segue enquanto ela estiver `running`) mostra o fim.
    onSettled: (_d, _e, id) => {
      void qc.invalidateQueries({ queryKey: UMA(id) });
      void qc.invalidateQueries({ queryKey: LISTA });
    },
  });
}

export function useDeleteOrquestracao() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apagarOrquestracao(token, id),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: UMA(id) });
      void qc.invalidateQueries({ queryKey: LISTA });
    },
  });
}
