// Voto e tag de qualidade — o MESMO sistema para análises da Mineração e composições do Composer.
//
// Endpoint separado das listas de propósito (ver a rota no worker): a tela busca a lista de itens de
// um lado e as avaliações do outro, e cruza por id. O custo é uma requisição a mais; o ganho é que
// este sistema não depende de alterar as rotas de `/library` e `/compositions`, que são de outra
// frente e mudam com frequência.

import { spyRequest } from "@/lib/adSpyApi";
import type { AlvoAvaliacao, Voto } from "../../shared/avaliacao-tags";

/** O que a tela precisa saber de um item para desenhar os controles. */
export type AvaliacaoItem = {
  positivos: number;
  negativos: number;
  /** `positivos - negativos`. É o que a tela mostra e por onde a ordenação "mais votados" passa. */
  saldo: number;
  /** O voto DESTA pessoa. Sem ele o botão não aparece marcado e ela vota de novo achando que não contou. */
  meuVoto: Voto;
  tag: string | null;
};

/** Mapa por id do alvo. Item sem nenhuma avaliação simplesmente não aparece aqui. */
export type AvaliacoesPorId = Record<string, AvaliacaoItem>;

export const listarAvaliacoes = (token: string, alvo: AlvoAvaliacao) =>
  spyRequest<{ itens: AvaliacoesPorId }>(`/avaliacoes/${alvo}`, token);

/** `voto: null` tira o voto — é o toggle de clicar no mesmo botão de novo. */
export const votar = (token: string, alvo: AlvoAvaliacao, id: string, voto: Voto) =>
  spyRequest<{ ok: true }>(`/avaliacoes/${alvo}/${encodeURIComponent(id)}/voto`, token, {
    method: "PUT",
    body: JSON.stringify({ voto }),
  });

/** `tag: null` limpa. Trocar é sobrescrever: há UMA tag por item. */
export const definirTag = (token: string, alvo: AlvoAvaliacao, id: string, tag: string | null) =>
  spyRequest<{ ok: true; tag: string | null }>(
    `/avaliacoes/${alvo}/${encodeURIComponent(id)}/tag`,
    token,
    { method: "PUT", body: JSON.stringify({ tag }) },
  );

/** O valor de um item que ainda não tem avaliação nenhuma. */
export const AVALIACAO_VAZIA: AvaliacaoItem = {
  positivos: 0,
  negativos: 0,
  saldo: 0,
  meuVoto: null,
  tag: null,
};
