/**
 * Texto do aviso de coleta de uso (popup + página /privacidade). Fonte única: o popup e a página
 * leem daqui.
 *
 * AVISO_VERSAO: suba o número quando o texto mudar de forma relevante — quem já tinha visto a
 * versão anterior vê o popup de novo (o "visto" fica em usage_notice_acks por versão).
 */

export const AVISO_VERSAO = 1;
export const AVISO_ATUALIZADO_EM = "27/10/2026";

/**
 * Uso dos dados para avaliar pessoas. Pela LGPD (finalidade e transparência) isso precisa estar
 * dito ANTES: ou se promete não usar, ou se avisa que pode usar.
 * null = o texto não fala do assunto (então os dados NÃO podem ser usados para avaliar ninguém).
 */
export type PoliticaDesempenho = "nao-usa" | "pode-usar";
export const POLITICA_DESEMPENHO: PoliticaDesempenho | null = "pode-usar";

export const FRASE_DESEMPENHO: Record<PoliticaDesempenho, string> = {
  "nao-usa": "Esses dados não são usados para avaliar o desempenho individual de ninguém.",
  "pode-usar":
    "Além disso, a gestão da Groohub pode consultar o uso de cada pessoa da equipe para acompanhar a adoção das ferramentas e o desempenho individual.",
};

export const fraseDesempenho = () => (POLITICA_DESEMPENHO ? FRASE_DESEMPENHO[POLITICA_DESEMPENHO] : null);

export const TIPOS_PEDIDO = [
  { value: "copia", label: "Quero uma cópia dos meus dados de uso" },
  { value: "duvida", label: "Tenho uma dúvida" },
  { value: "oposicao", label: "Não quero que meu uso seja medido" },
  { value: "outro", label: "Outro assunto" },
] as const;

export type TipoPedido = (typeof TIPOS_PEDIDO)[number]["value"];

export const rotuloTipoPedido = (t: string) => TIPOS_PEDIDO.find((x) => x.value === t)?.label ?? t;
