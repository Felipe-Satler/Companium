/**
 * Canais de criativo do Relatório — DADO COMPARTILHADO entre o frontend e o worker.
 *
 * Mora fora de `src/` pelo mesmo motivo de `shared/ad-formats.js`: a tela monta a lista de criativos
 * e o worker a valida contra a MESMA definição. Sem isso existiria "canal que a tela manda e o worker
 * não conhece".
 *
 * ## Por que dois dos três nascem desabilitados
 *
 * Só o Meta tem criativo na base: a tabela `Criativos Meta Ads` traz thumbnail, headline, Ad_ID e
 * métrica por anúncio. Google Ads e Instagram **não têm dado de criativo em lugar nenhum** —
 * `useGoogleAdsClienteData` lê apenas o agregado `v_meta_google_ads` (cliente/dia/lead/valor), e a
 * tela de Instagram é mockup, sem fonte. Isso é ausência de ingestão, não de tela: preencher exige
 * pipeline novo, fora deste repositório.
 *
 * Ficam registrados e desabilitados — o mesmo desenho das fontes da Mineração e do formato `tiktok`
 * no Composer. A estrutura é real desde já, o adaptador é que não existe; e a tela diz "em breve" em
 * vez de deixar quem lê concluir que o cliente não anuncia nesses canais.
 */

export const CANAIS_CRIATIVO = [
  {
    id: "meta",
    label: "Meta Ads",
    disponivel: true,
    // De onde vem o dado, para quem for depurar não precisar caçar.
    fonte: "Criativos Meta Ads (via useMetaAdsCriativosData)",
    resumo: "Anúncios do Facebook e Instagram pagos, com thumbnail e métrica por anúncio.",
  },
  {
    id: "google",
    label: "Google Ads",
    disponivel: false,
    fonte: null,
    resumo:
      "Em breve. Não existe criativo de Google Ads na base — só o investimento e os leads " +
      "agregados por dia. Mostrar a verba sem o anúncio seria pior que não mostrar.",
  },
  {
    id: "instagram",
    label: "Instagram orgânico",
    disponivel: false,
    fonte: null,
    resumo:
      "Em breve. Não há ingestão de post orgânico: a tela de Social é maquete. O Instagram PAGO " +
      "já entra pelo Meta Ads acima.",
  },
];

export const CANAL_IDS = CANAIS_CRIATIVO.map((c) => c.id);

export function getCanal(id) {
  return CANAIS_CRIATIVO.find((c) => c.id === id) ?? null;
}

/** Só os que de fato trazem criativo hoje. */
export function canaisDisponiveis() {
  return CANAIS_CRIATIVO.filter((c) => c.disponivel);
}

/**
 * Quantos criativos vão no relatório.
 *
 * Teto porque o prompt tem orçamento e o carrossel tem limite de utilidade: um cliente com 60
 * anúncios no mês não gera leitura melhor mandando 60 — gera prompt maior e um carrossel que ninguém
 * percorre até o fim. Ordenados por INVESTIMENTO desc, porque é a verba que decide o que merece
 * atenção, e o total real vai junto para o texto poder dizer "24 de 61".
 */
export const MAX_CRIATIVOS_RELATORIO = 24;
