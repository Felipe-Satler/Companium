/**
 * Agrupa composições por cliente e ordena os dois níveis. **Puro**, para ter teste sem tela.
 *
 * A visão em lista existe porque a grade de cards responde mal a uma pergunta que é frequente: "o
 * que já compusemos para ESTE cliente?". Numa grade ordenada por data, as composições de um cliente
 * ficam espalhadas entre as dos outros, e a resposta exige varrer tudo. Agrupado e em ordem
 * alfabética, a pessoa vai direto ao nome.
 *
 * ## Por que a ordenação é um registro, e não um `sort` inline
 *
 * O pedido já veio com o próximo passo embutido — "por enquanto ordenadas por data, mas quero
 * adicionar outros critérios depois". Um registro faz o critério novo custar uma entrada aqui, com
 * o `label` que a tela mostra vindo do mesmo lugar que a função de comparação: assim não existe
 * "opção que o seletor oferece e a lista não sabe ordenar".
 */

import { planoDe, type ComposicaoResumo } from "@/lib/adComposerApi";

export type GrupoCliente = {
  /** O slug — chave estável, usada em `key` e no estado de expansão. */
  cliente: string;
  /** O nome que a pessoa lê. Cai para o slug quando a linha não tem `nome_exibicao`. */
  nome: string;
  composicoes: ComposicaoResumo[];
};

/** Quantos anúncios a composição tem, pelo plano gravado. */
const anunciosDe = (c: ComposicaoResumo) => planoDe(c).length;

const ms = (iso: string | null | undefined) => {
  const t = new Date(String(iso ?? "")).getTime();
  // Data inválida vai para o fim em ordem decrescente, em vez de virar 1970 e embaralhar a lista.
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};

/**
 * Os critérios de ordenação DENTRO de um cliente.
 *
 * `id` é o que vai na URL/estado, `label` é o que a tela mostra, `comparar` é o que ordena. Para
 * acrescentar um critério, acrescente uma entrada — nada mais precisa mudar.
 */
export const ORDENACOES = [
  {
    id: "recentes",
    label: "Mais recentes",
    comparar: (a: ComposicaoResumo, b: ComposicaoResumo) => ms(b.criado_em) - ms(a.criado_em),
  },
  {
    id: "antigas",
    label: "Mais antigas",
    comparar: (a: ComposicaoResumo, b: ComposicaoResumo) => ms(a.criado_em) - ms(b.criado_em),
  },
  {
    id: "mais_anuncios",
    label: "Mais anúncios",
    comparar: (a: ComposicaoResumo, b: ComposicaoResumo) =>
      // Empate de quantidade volta para a data: duas composições de 3 anúncios numa ordem aleatória
      // mudariam de lugar entre renderizações, e lista que se mexe sozinha parece defeito.
      anunciosDe(b) - anunciosDe(a) || ms(b.criado_em) - ms(a.criado_em),
  },
] as const;

export type OrdenacaoId = (typeof ORDENACOES)[number]["id"];

export const ORDENACAO_PADRAO: OrdenacaoId = "recentes";

/** A ordenação por id, caindo no padrão quando o id não existe (URL antiga, estado salvo velho). */
export function ordenacaoPor(id: string | null | undefined) {
  return ORDENACOES.find((o) => o.id === id) ?? ORDENACOES[0];
}

/**
 * Composições -> grupos por cliente, em ordem alfabética de NOME.
 *
 * Alfabética pelo nome exibido e com `localeCompare` em pt-BR: ordenar pelo slug poria "Dr. Ana"
 * sob a letra do slug (`ana_...`) e quebraria a única coisa que a visão em lista promete, que é
 * achar o cliente pela letra. O `sensitivity: "base"` faz acento e caixa não criarem duas posições
 * para o mesmo nome.
 */
export function agruparPorCliente(
  compositions: ComposicaoResumo[],
  ordenacao: OrdenacaoId = ORDENACAO_PADRAO,
): GrupoCliente[] {
  const grupos = new Map<string, GrupoCliente>();

  for (const c of compositions) {
    const chave = c.cliente || c.nome_exibicao || "(sem cliente)";
    const atual = grupos.get(chave);
    if (atual) {
      atual.composicoes.push(c);
      // O nome vem da primeira linha que tiver um: linhas antigas podem não ter `nome_exibicao`,
      // e cair para o slug quando QUALQUER linha do grupo sabe o nome seria perder informação.
      if (!atual.nome || atual.nome === chave) atual.nome = c.nome_exibicao || atual.nome;
    } else {
      grupos.set(chave, { cliente: chave, nome: c.nome_exibicao || chave, composicoes: [c] });
    }
  }

  const { comparar } = ordenacaoPor(ordenacao);
  const lista = [...grupos.values()];
  for (const g of lista) g.composicoes.sort(comparar);
  lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));
  return lista;
}
