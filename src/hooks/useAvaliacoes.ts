/**
 * Voto e tag de qualidade, para análises e composições.
 *
 * Um hook só para os dois, porque é o mesmo sistema — o `alvo` é o parâmetro. Cache por alvo, para
 * a Biblioteca e as Composições não invalidarem uma à outra.
 *
 * **As duas mutações são otimistas**, e isso não é polimento: votar é um clique que a pessoa repete
 * em sequência numa lista, e esperar a resposta a cada um faria o contador piscar atrás do dedo. O
 * estado volta sozinho se a requisição falhar.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  AVALIACAO_VAZIA,
  definirTag,
  listarAvaliacoes,
  votar,
  type AvaliacoesPorId,
} from "@/lib/avaliacoesApi";
import type { AlvoAvaliacao, Voto } from "../../shared/avaliacao-tags";

const KEY = (alvo: AlvoAvaliacao) => ["marketing-avaliacoes", alvo];

function useToken() {
  const { session } = useAuth();
  return session?.access_token ?? "";
}

export function useAvaliacoes(alvo: AlvoAvaliacao) {
  const token = useToken();
  const query = useQuery({
    queryKey: KEY(alvo),
    enabled: Boolean(token),
    queryFn: () => listarAvaliacoes(token, alvo),
    // Voto de colega não precisa chegar em tempo real, mas também não pode ficar velho a sessão
    // inteira — um minuto é o meio-termo entre "o contador mente" e "requisição a cada foco".
    staleTime: 60 * 1000,
  });
  return {
    itens: query.data?.itens ?? {},
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}

/** Aplica uma alteração a um item do cache, criando a entrada quando ela ainda não existe. */
function patch(
  old: { itens: AvaliacoesPorId } | undefined,
  id: string,
  fn: (atual: AvaliacoesPorId[string]) => AvaliacoesPorId[string],
) {
  if (!old) return old;
  const atual = old.itens[id] ?? AVALIACAO_VAZIA;
  return { ...old, itens: { ...old.itens, [id]: fn(atual) } };
}

export function useVotar(alvo: AlvoAvaliacao) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, voto }: { id: string; voto: Voto }) => votar(token, alvo, id, voto),
    onMutate: async ({ id, voto }) => {
      await qc.cancelQueries({ queryKey: KEY(alvo) });
      const antes = qc.getQueryData(KEY(alvo));
      qc.setQueryData(KEY(alvo), (old: { itens: AvaliacoesPorId } | undefined) =>
        patch(old, id, (a) => {
          // Recalcula a partir do voto ANTERIOR desta pessoa: trocar de + para − move dois pontos,
          // não um. Somar sem descontar o voto antigo era o jeito de o contador mentir até o
          // próximo refetch.
          const positivos = a.positivos - (a.meuVoto === 1 ? 1 : 0) + (voto === 1 ? 1 : 0);
          const negativos = a.negativos - (a.meuVoto === -1 ? 1 : 0) + (voto === -1 ? 1 : 0);
          return { ...a, positivos, negativos, saldo: positivos - negativos, meuVoto: voto };
        }),
      );
      return { antes };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.antes) qc.setQueryData(KEY(alvo), ctx.antes);
      // **Desfazer em silêncio é pior que falhar.** A primeira versão só revertia o cache, e o
      // sintoma era exatamente "clicar não funciona": o contador subia, voltava, e nada explicava
      // por quê — inclusive quando a causa era o worker rodando código velho, que `spyRequest` sabe
      // nomear com precisão.
      toast.error(err instanceof Error ? err.message : "Não foi possível registrar o voto");
    },
    // Sem `invalidate` no sucesso: a lista inteira voltaria a cada clique, e o voto de colega que
    // chegasse junto faria o número pular na frente de quem está votando. O `staleTime` cuida disso.
  });
}

export function useDefinirTag(alvo: AlvoAvaliacao) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tag }: { id: string; tag: string | null }) => definirTag(token, alvo, id, tag),
    onMutate: async ({ id, tag }) => {
      await qc.cancelQueries({ queryKey: KEY(alvo) });
      const antes = qc.getQueryData(KEY(alvo));
      qc.setQueryData(KEY(alvo), (old: { itens: AvaliacoesPorId } | undefined) =>
        patch(old, id, (a) => ({ ...a, tag })),
      );
      return { antes };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.antes) qc.setQueryData(KEY(alvo), ctx.antes);
      toast.error(err instanceof Error ? err.message : "Não foi possível definir a tag");
    },
  });
}
