// Documentos do ClickUp de um cliente (aba Documentos de Marketing › Central de Clientes).
//
// "Documento" aqui é uma **página** de Doc. No ClickUp da Groohub o documento de um cliente é uma
// página dentro de um Doc coletivo — "Mapeamento do Cliente" tem uma página por cliente —, então é
// a página que a aba lista, que o preview abre e que o Composer recebe como insumo. O tipo manteve
// o nome `ClientDoc` porque é como a pessoa chama a coisa; `docNome` é o Doc que a contém.
//
// Leitura pura: ao contrário do resumo e do relatório, aqui não há agente, não há `status` e não há
// polling — o worker lê o ClickUp e devolve a lista na hora. O token do ClickUp fica NO WORKER e
// nunca chega ao browser, que é o motivo de isto passar por `/api/spy` em vez de falar com a API da
// ClickUp direto daqui.

import { spyRequest } from "@/lib/adSpyApi";

export type ClientDoc = {
  /** O `page_id` da página no ClickUp. É o que o preview e as `entradas` do Composer carregam. */
  id: string;
  /** O título da página ("Mapeamento - Dra. Amanda Duarte"). */
  nome: string;
  /** O Doc que contém a página ("Mapeamento do Cliente"). A tela agrupa por ele. */
  docNome: string | null;
  /** Link para a página no ClickUp. A API não devolve URL; o worker a monta. */
  url: string | null;
  /** O caminho inteiro, de fora para dentro: "MktOps › Mapeamento do Cliente › Ativo". */
  local: string | null;
  /**
   * Como foi atribuído a este cliente, do mais forte para o mais fraco:
   * `pagina` (o título da própria página nomeia o cliente — o sinal forte e o caso comum),
   * `pagina_pai` (uma página ancestral o nomeia), `tarefa` (o Doc inteiro é dele pela tarefa-pai),
   * `pasta` (espaço/pasta/lista com o nome do cliente) ou `nome` (só o título do Doc casou).
   * `null` não chega aqui: a listagem é por cliente.
   *
   * A tela mostra a diferença em vez de apresentar tudo como a mesma certeza — e importa mais
   * agora que o conteúdo alimenta o Composer: documento mal atribuído viraria peça criativa feita
   * com a estratégia de outro cliente.
   */
  via: "pagina" | "pagina_pai" | "tarefa" | "pasta" | "nome";
  /**
   * O tipo da allowlist (`shared/clickup-doc-tipos.js`), ou `null` quando não reconhecido — e `null`
   * é o caso da MAIORIA dos documentos, de propósito.
   */
  tipo: string | null;
  /**
   * O corpo foi ingerido e está disponível. `false` significa uma de três coisas: tipo fora da
   * allowlist (decisão), o sync ainda não chegou nele, ou o token não tem acesso ao documento. É o
   * que separa "documento que serve de insumo ao Composer" de "documento que é só um link".
   */
  temConteudo: boolean;
  /** Os títulos das páginas acima desta, de fora para dentro (vazio na página de primeiro nível). */
  caminho?: string[];
  /**
   * Quantas subpáginas (de qualquer nível, do mesmo cliente) esta página tem. Escolher a página traz
   * o conteúdo de todas junto (desde 20/10/2026), e a tela diz isso no card.
   */
  subpaginas?: number;
  criadoEm: string | null;
  atualizadoEm: string | null;
  arquivado: boolean;
  publico: boolean;
};

export type ClientDocsResposta = {
  documentos: ClientDoc[];
  /**
   * `clickup: false` = **não conseguimos ler**, e `erro` diz por quê. Não é o mesmo que uma lista
   * vazia, que significa "lemos e este cliente não tem documento". Confundir os dois é o jeito mais
   * fácil de esta aba mentir.
   */
  fontes: { clickup?: boolean } | null;
  erro?: string | null;
  /** Quando o índice do workspace foi lido. Ele é compartilhado e em cache no worker. */
  lidoEm?: string | null;
  /** A varredura bateu no teto de páginas — a lista pode estar incompleta. */
  truncado?: boolean;
};

export const listClientDocs = (token: string, cliente: string, recarregar = false) =>
  spyRequest<ClientDocsResposta>(
    `/clientes/${encodeURIComponent(cliente)}/documentos${recarregar ? "?recarregar=1" : ""}`,
    token,
  );

/**
 * O CORPO de um documento, para o preview e para alimentar a composição.
 *
 * Três estados distintos, e a tela precisa dos três:
 *   `conteudo_md` string             -> o conteúdo
 *   null + `fontes.clickup: true`    -> lemos, e o documento não tem corpo
 *   null + `fontes.clickup: false`   -> NÃO conseguimos ler (`erro` diz por quê)
 *
 * Os dois últimos aparecem como "Conteúdo não encontrado no servidor"; a diferença vai no rodapé.
 * O terceiro também cobre "não lemos por decisão" — tipo fora da allowlist —, e aí `erro` traz a
 * razão em vez de uma falha.
 */
export type ConteudoDocumento = {
  conteudo_md: string | null;
  fontes: { clickup?: boolean } | null;
  erro: string | null;
  lidoEm: string | null;
};

export const obterConteudoDocumento = (token: string, cliente: string, docId: string) =>
  spyRequest<ConteudoDocumento>(
    `/clientes/${encodeURIComponent(cliente)}/documentos/${encodeURIComponent(docId)}/conteudo`,
    token,
  );

/** "com 1 subpágina", "com 3 subpáginas" — o selo da página que traz subpáginas junto. */
export function rotuloSubpaginas(n: number | null | undefined): string | null {
  if (!n || n < 1) return null;
  return `com ${n} subpágina${n === 1 ? "" : "s"}`;
}
