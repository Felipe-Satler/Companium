import type { LibraryEntrySummary } from "@/lib/adSpyApi";
import type { RelatorioResumo } from "@/lib/clientReportsApi";
import { nomeDoRelatorio } from "@/utils/relatorioMarkdown";
import { norm } from "@/lib/texto";
import { ehPaginaDeEstudo } from "../../../../shared/estudo-copy";
import { ehPaginaDeResumo, ehTopoDoResumo } from "../../../../shared/resumo-estrategico";

/**
 * Os filtros da etapa de insumos do Composer. **Lógica pura**, sem React.
 *
 * Em memória, como os da Biblioteca: as duas listas já vêm inteiras (o worker tem teto de 100 em
 * cada), então ir ao servidor a cada tecla só somaria espera. A diferença em relação à Biblioteca
 * é o filtro por especialidade: lá ele é do servidor, onde existe o índice `gin`; aqui a lista
 * inteira já está na mão, e refazer a requisição a cada clique trocaria um filtro instantâneo por
 * um que pisca.
 *
 * Fora do componente porque é testável assim, e porque exportar função de um arquivo de componente
 * quebra o fast refresh do Vite — o mesmo motivo de `ordenarAnalises` morar sozinha.
 */

export type FiltroRelatorios = {
  /** Busca pelo NOME (o que a pessoa deu, ou o rótulo do período quando não deu nenhum). */
  busca?: string;
  /** Recorte por data, em ISO `YYYY-MM-DD`. Qualquer uma das pontas pode faltar. */
  de?: string | null;
  ate?: string | null;
};

/**
 * Relatórios por nome e por recorte de data.
 *
 * **A data é por SOBREPOSIÇÃO, não por contenção.** Um relatório de 1 a 30 de setembro aparece ao
 * filtrar "15/set a 15/out": ele fala, em parte, do período pedido. Exigir que o relatório caiba
 * inteiro dentro da janela esconderia justamente o mais útil — quem procura "o que houve em
 * setembro" quer o relatório de setembro, não só os que começam e terminam dentro do recorte.
 *
 * A busca olha só o nome. O período tem campo próprio ao lado, e fazer a caixa de texto casar
 * também com data faria dois controles responderem pela mesma coisa, de formas diferentes.
 */
export function filtrarRelatorios(
  relatorios: RelatorioResumo[],
  { busca = "", de = null, ate = null }: FiltroRelatorios,
): RelatorioResumo[] {
  const termo = norm(busca.trim());
  return relatorios.filter((r) => {
    if (termo && !norm(nomeDoRelatorio(r)).includes(termo)) return false;
    // Strings ISO `YYYY-MM-DD` comparam na ordem certa como texto; nada de `Date` aqui, que é onde
    // o deslocamento de fuso costuma entrar.
    if (de && r.periodo_ate < de) return false;
    if (ate && r.periodo_de > ate) return false;
    return true;
  });
}

/**
 * O documento é (parte de) um Estudo de Copy? Pelo título da página, do Doc que a contém ou de
 * qualquer página acima dela: subpágina de Estudo de Copy é Estudo de Copy. A regra é a de
 * `shared/estudo-copy.js`, a mesma que o worker confere ao compor.
 */
export function ehDocEstudoDeCopy(d: { nome: string; docNome?: string | null; caminho?: string[] }): boolean {
  return ehPaginaDeEstudo({ nome: d.nome, docNome: d.docNome, caminho: d.caminho });
}

/**
 * O documento é (parte de) o Resumo Estratégico do cliente? Pelo título da página ou de uma página
 * acima dela — a regra de `shared/resumo-estrategico.js`, a mesma que o worker confere ao compor.
 */
export function ehDocResumoEstrategico(d: { nome: string; caminho?: string[] }): boolean {
  return ehPaginaDeResumo({ nome: d.nome, caminho: d.caminho });
}

/**
 * Os ids que o Composer marca sozinho ao abrir os documentos de um cliente: as páginas de CIMA do
 * Resumo Estratégico (escolher a página traz as subpáginas junto).
 */
export function idsDoResumoEstrategico(documentos: { id: string; nome: string; caminho?: string[] }[]): string[] {
  return documentos.filter((d) => ehTopoDoResumo({ nome: d.nome, caminho: d.caminho })).map((d) => d.id);
}

/**
 * Documentos pelo título da página e pelo caminho (Doc, pasta, espaço).
 *
 * O caminho entra porque é por ele que se reconhece um documento no ClickUp: "Mapeamento" sozinho
 * aparece em vários clientes e várias pastas, e quem procura costuma lembrar onde ele mora.
 */
export function filtrarDocumentos<T extends { nome: string; local: string | null; docNome?: string | null }>(
  documentos: T[],
  busca: string,
): T[] {
  const termo = norm(busca.trim());
  if (!termo) return documentos;
  return documentos.filter((d) =>
    [d.nome, d.local, d.docNome].some((v) => v && norm(v).includes(termo)),
  );
}

/**
 * As categorias que as análises carregadas de fato têm, em ordem alfabética.
 *
 * Tiradas da lista, e não do cadastro de especialidades que a Biblioteca usa: aqui o filtro é em
 * memória sobre o que já está na tela, e oferecer uma categoria que não devolve nada é um filtro
 * pior do que não oferecer.
 */
export function categoriasDasAnalises(entries: Pick<LibraryEntrySummary, "especialidades">[]): string[] {
  const todas = new Set<string>();
  for (const e of entries) for (const esp of e.especialidades) todas.add(esp);
  return [...todas].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/**
 * Itens de alguma das categorias pedidas. Lista vazia = sem recorte (todas). Serve às Minerações
 * Salvas e às Análises de Criativos — as duas são classificadas por especialidade.
 */
export function filtrarPorCategoria<T extends { especialidades: string[] }>(
  entries: T[],
  categorias: string[],
): T[] {
  if (!categorias.length) return entries;
  const alvo = new Set(categorias);
  return entries.filter((e) => e.especialidades.some((esp) => alvo.has(esp)));
}

/**
 * O que o filtro deixou passar, MAIS o que já está selecionado.
 *
 * Um insumo escolhido não pode desaparecer por causa de um filtro digitado depois: ele continua
 * indo para a composição, e um card invisível que entra no prompt é a pior combinação possível —
 * quem lê a ideia depois não tem como saber com o que ela foi feita. Então o filtro esconde o que
 * não interessa e nunca o que já foi decidido.
 *
 * A ordem original é preservada, para o reencaixe não jogar o item selecionado para o fim.
 */
export function mantendoSelecionados<T>(
  todos: T[],
  filtrados: T[],
  estaSelecionado: (item: T) => boolean,
): T[] {
  const passou = new Set(filtrados);
  return todos.filter((item) => passou.has(item) || estaSelecionado(item));
}
