/**
 * Resumos de Marketing › Clientes.
 *
 * Polling pelo mesmo motivo da Mineração: o agente leva dezenas de segundos por cliente e o worker
 * grava o resultado no banco, não na resposta HTTP. A tela só pergunta enquanto houver algum
 * resumo sendo escrito.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  algumRodando,
  listBriefs,
  refreshBrief,
  type ClientBrief,
} from "@/lib/clientBriefsApi";

const POLL_MS = 4000;
const KEY = ["marketing-client-briefs"];

function useToken() {
  const { session } = useAuth();
  return session?.access_token ?? "";
}

export function useClientBriefs() {
  const token = useToken();
  const query = useQuery({
    queryKey: KEY,
    enabled: Boolean(token),
    queryFn: () => listBriefs(token),
    refetchInterval: (q) => (algumRodando(q.state.data?.briefs ?? []) ? POLL_MS : false),
    staleTime: 0,
  });
  return {
    briefs: query.data?.briefs ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}

/**
 * Pede a reescrita de um resumo.
 *
 * Escreve `running` no cache antes da resposta pelo mesmo motivo de `useAdSpy`: o worker responde
 * 202 e segue trabalhando, e como o polling é decidido pelo que está em cache, ler o estado antigo
 * deixaria a tela parada até um F5. Se a requisição falhar, o estado volta ao que era.
 */
export function useRefreshBrief() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cliente: string) => refreshBrief(token, cliente),
    onMutate: async (cliente) => {
      await qc.cancelQueries({ queryKey: KEY });
      const antes = qc.getQueryData<{ briefs: ClientBrief[] }>(KEY);
      qc.setQueryData(KEY, (old: { briefs: ClientBrief[] } | undefined) => {
        if (!old) return old;
        const existe = old.briefs.some((b) => b.cliente === cliente);
        const briefs = existe
          ? old.briefs.map((b) =>
              b.cliente === cliente ? { ...b, status: "running" as const, error: null } : b,
            )
          : // Cliente que ainda não tem linha nenhuma: a tela precisa mostrar "escrevendo" já.
            [
              ...old.briefs,
              {
                cliente,
                nome_exibicao: null,
                brief_md: null,
                brief: null,
                metricas: null,
                fontes: null,
                status: "running" as const,
                error: null,
                agent_id: null,
                // `semana_*`, não `periodo_*`: as colunas `periodo_de/ate` foram removidas na
                // migração de 19/09 e a linha otimista ainda as escrevia — chave morta que o tipo
                // `ClientBrief` nem declara.
                semana_de: null,
                semana_ate: null,
                atualizado_em: new Date().toISOString(),
                atualizado_por: null,
              },
            ];
        return { ...old, briefs };
      });
      return { antes };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.antes) qc.setQueryData(KEY, ctx.antes);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
