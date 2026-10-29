// O que se deriva de `anuncios`, e o que a revisão faz com eles. Sem I/O, porque tem vários
// chamadores — quem escreve a composição (`composer.js`), quem fecha uma que ficou órfã
// (`orfas.js`) e as rotas de revisão (`index.js`) — e nenhum deve arrastar os outros. O único
// import é o catálogo de formatos, que também é puro.

import { getFormato, validarLimites } from "../../shared/ad-formats.js";

/**
 * O que a LISTAGEM precisa de cada anúncio: formato, ângulo e estado.
 *
 * Coluna própria (`plano`) porque `anuncios` carrega a copy inteira de até oito peças, e a tela de
 * composições salvas lista dezenas de linhas. É derivada de `anuncios` aqui, num lugar só, para as
 * duas colunas não terem como discordar.
 */
export function resumoDoPlano(anuncios) {
  return anuncios.map((a) => ({ formato: a.formato, angulo: a.angulo, status: a.status }));
}

/** Os avisos de limite de todos os anúncios, cada um dizendo de qual anúncio é. */
export function avisosDoConjunto(anuncios) {
  return anuncios.flatMap((a, i) => (a.avisos ?? []).map((aviso) => ({ ...aviso, anuncio: i })));
}

// ---------------------------------------------------------------------------------------------
// Revisão (19/10/2026): editar à mão, pedir revisão ao agente, desfazer.
// ---------------------------------------------------------------------------------------------

/** Quantas versões anteriores ficam guardadas por composição. As mais antigas saem primeiro. */
export const MAX_VERSOES = 30;

/**
 * Os campos de um anúncio como a tela os mandou, conferidos contra a spec do formato DELE.
 *
 * Campo que o formato não pede é descartado, texto vira string aparada, lista vira lista de strings
 * sem itens vazios — a mesma normalização da resposta do agente, para um anúncio editado à mão ser
 * indistinguível, na forma, de um escrito pelo agente. Os avisos de limite são recalculados: é o
 * que faz o "34/30" sumir quando a pessoa encurta o título.
 *
 * @returns {{ composicao: object, avisos: object[] } | null}  null = formato desconhecido
 */
export function normalizarCampos(formatoId, campos) {
  const formato = getFormato(formatoId);
  if (!formato) return null;
  const fonte = campos && typeof campos === "object" && !Array.isArray(campos) ? campos : {};
  const composicao = {};
  for (const campo of formato.campos) {
    const valor = fonte[campo.id];
    composicao[campo.id] =
      campo.tipo === "lista"
        ? (Array.isArray(valor) ? valor : [])
            .map((v) => (typeof v === "string" ? v.trim() : ""))
            .filter(Boolean)
            .slice(0, 50)
        : typeof valor === "string"
          ? valor.trim().slice(0, 10000)
          : "";
  }
  return { composicao, avisos: validarLimites(formato.id, composicao) };
}

/**
 * Guarda a versão ATUAL de um anúncio antes de ela ser trocada (por edição ou por revisão).
 *
 * Só a copy, o que basta para voltar: o formato e o ângulo não mudam numa revisão.
 */
export function comVersaoAnterior(versoes, { indice, anuncio, motivo, por = null, em = new Date().toISOString() }) {
  const lista = Array.isArray(versoes) ? versoes : [];
  return [
    ...lista,
    {
      indice,
      motivo,
      por,
      em,
      composicao: anuncio.composicao ?? null,
      composicao_md: anuncio.composicao_md ?? null,
      avisos: anuncio.avisos ?? [],
    },
  ].slice(-MAX_VERSOES);
}

/**
 * Tira a versão mais recente de UM anúncio da pilha.
 *
 * @returns {{ versao: object|null, resto: object[] }}
 */
export function tirarUltimaVersao(versoes, indice) {
  const lista = Array.isArray(versoes) ? versoes : [];
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (lista[i]?.indice === indice) {
      return { versao: lista[i], resto: [...lista.slice(0, i), ...lista.slice(i + 1)] };
    }
  }
  return { versao: null, resto: lista };
}
