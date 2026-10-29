/**
 * O vocabulário de tags de qualidade — de análises da Mineração e de composições do Composer.
 *
 * Em `shared/` pelo mesmo motivo de `ad-formats.js`: a tela desenha o chip e o worker valida a tag
 * a partir da MESMA lista. "Tag que a tela oferece e o worker recusa" não existe.
 *
 * ## Voto e tag não dizem a mesma coisa
 *
 * O **voto** é por pessoa e diz se a peça presta. A **tag** é do item, uma só, e diz **o que fazer
 * com ele**. Se a tag também significasse "bom/ruim", seria um segundo voto — pior, porque com uma
 * opinião só. Por isso nenhuma tag aqui é um adjetivo de qualidade: todas são um encaminhamento.
 *
 * São SEIS, e não dez, porque vocabulário compartilhado que ninguém decora não é usado de forma
 * consistente — e tag usada de forma inconsistente é pior que tag nenhuma, já que parece dado.
 *
 * `Genérico` e `Risco CFM` são, de propósito, as regras 2 e 3 do `composeragent`. Marcar quando ele
 * as viola transforma a tag em dado sobre o AGENTE, não só sobre a peça.
 *
 * `No ar` é a única que é fato, não julgamento. É a que vai valer mais daqui a seis meses, quando
 * alguém perguntar o que de fato foi produzido.
 */

/**
 * Cada tag traz a cor e o ÍCONE porque cor sozinha não é sinal acessível: falha para cerca de 8% dos
 * homens (deuteranopia) e some em captura de tela em escala de cinza. O ícone é o que sobrevive, e o
 * rótulo é o que não depende de nenhum dos dois.
 *
 * `icone` é o nome do componente em `lucide-react`; quem renderiza faz o mapa, para o `shared/` não
 * depender de biblioteca de UI (ele é lido pelo worker, que não tem React).
 */
export const TAGS_AVALIACAO = [
  {
    id: "referencia",
    label: "Referência",
    icone: "Star",
    cor: "amber",
    descricao: "O ângulo vale reaproveitar em outros clientes.",
  },
  {
    id: "no_ar",
    label: "No ar",
    icone: "CheckCircle2",
    cor: "emerald",
    descricao: "Virou peça publicada.",
  },
  {
    id: "ajustar",
    label: "Ajustar",
    icone: "PenLine",
    cor: "blue",
    descricao: "A ideia serve; o texto precisa de uma passagem.",
  },
  {
    id: "generico",
    label: "Genérico",
    icone: "Copy",
    cor: "zinc",
    descricao: "Serve a qualquer clínica, logo não serve a nenhuma.",
  },
  {
    id: "risco_cfm",
    label: "Risco CFM",
    icone: "ShieldAlert",
    cor: "red",
    descricao: "Promessa de resultado, antes/depois ou depoimento de paciente.",
  },
  {
    id: "arquivar",
    label: "Arquivar",
    icone: "Archive",
    cor: "slate",
    descricao: "Não usar, e não apagar.",
  },
];

export const TAG_IDS = TAGS_AVALIACAO.map((t) => t.id);

/**
 * Os tipos de item que o sistema cobre. É o mesmo sistema para todos, de propósito.
 * `criativo` (17/10/2026) é a análise de UM anúncio, em Mineração › Análises de Criativos.
 */
export const ALVOS = ["analise", "composicao", "criativo"];

export function getTag(id) {
  return TAGS_AVALIACAO.find((t) => t.id === id) ?? null;
}

/** Tag desconhecida é tratada como ausência, nunca como uma tag nova. */
export function tagValida(id) {
  return TAG_IDS.includes(String(id ?? ""));
}

export function alvoValido(tipo) {
  return ALVOS.includes(String(tipo ?? ""));
}

/**
 * Normaliza um voto para `1`, `-1` ou `null`.
 *
 * `null` é "sem voto" e é o que o toggle produz ao clicar no mesmo botão de novo — não existe um
 * terceiro estado "neutro" guardado, porque "votei neutro" e "não votei" seriam indistinguíveis na
 * contagem e a contagem é a única coisa que a tela mostra.
 */
export function normalizarVoto(v) {
  const n = Number(v);
  if (n === 1) return 1;
  if (n === -1) return -1;
  return null;
}
