/**
 * Formatos de anúncio — DADO COMPARTILHADO entre o frontend e o worker.
 *
 * Mora fora de `src/` e é JavaScript puro pelo mesmo motivo de `shared/client-aliases.js`: o
 * seletor da tela e o prompt do agente leem a MESMA definição. Sem isso, a tela ofereceria um
 * formato que o agente não sabe escrever, ou o agente devolveria campos que a tela não sabe
 * mostrar — e nenhum dos dois daria erro.
 *
 * ## Por que os limites estão aqui
 *
 * Um headline de Google Ads tem 30 caracteres. Uma ideia com 34 não é uma ideia: é uma reescrita
 * pendente, e quem for colar no Ads Manager descobre isso no pior momento. Os limites entram no
 * prompt e são conferidos DEPOIS da resposta — modelo erra contagem de caractere, e a tela dizendo
 * "34/30" é mais honesta do que um texto que parece pronto e não é.
 *
 * `limiteRigido: true`  = a plataforma REJEITA acima disso.
 * `limiteRigido: false` = a plataforma aceita, mas corta na exibição (é recomendação).
 */

/**
 * @typedef {object} CampoFormato
 * @property {string} id
 * @property {string} label
 * @property {"texto"|"lista"} tipo
 * @property {number} [limite]        limite de caracteres (por item, quando `tipo: "lista"`)
 * @property {boolean} [limiteRigido] true = plataforma rejeita; false = só corta na exibição
 * @property {{min: number, max: number}} [itens] quantos itens, quando `tipo: "lista"`
 * @property {string} ajuda          o que este campo é — vai para o prompt e para a tela
 */

export const AD_FORMATS = [
  {
    id: "instagram_reels",
    label: "Instagram Reels",
    midia: "video",
    disponivel: true,
    resumo: "Vídeo vertical curto. O gancho nos 3 primeiros segundos decide se alguém assiste.",
    campos: [
      {
        id: "gancho",
        label: "Gancho (3 primeiros segundos)",
        tipo: "texto",
        limite: 90,
        limiteRigido: false,
        ajuda: "A primeira frase falada ou escrita. Cria lacuna ou nomeia a objeção; não é saudação.",
      },
      {
        id: "roteiro",
        label: "Roteiro falado",
        tipo: "texto",
        ajuda: "O que a pessoa fala, cena a cena, em linguagem de quem fala — não de quem escreve.",
      },
      {
        id: "texto_na_tela",
        label: "Texto na tela",
        tipo: "lista",
        itens: { min: 2, max: 6 },
        limite: 40,
        limiteRigido: false,
        ajuda: "Uma linha por cena. Curto o bastante para ler de relance no celular.",
      },
      {
        id: "legenda",
        label: "Legenda",
        tipo: "texto",
        limite: 2200,
        limiteRigido: true,
        ajuda: "Os 125 primeiros caracteres são o que aparece antes do 'mais' — é ali que se ganha o clique.",
      },
      {
        id: "direcao_visual",
        label: "Direção de vídeo",
        tipo: "texto",
        ajuda: "Enquadramento, cenário, ritmo de corte, o que precisa aparecer. Direção, não roteiro técnico.",
      },
    ],
  },
  {
    id: "instagram_stories",
    label: "Instagram Stories",
    midia: "video",
    disponivel: true,
    resumo: "Sequência de 3 a 5 telas, vertical, consumida em segundos e com o dedo pronto para pular.",
    campos: [
      {
        id: "sequencia",
        label: "Sequência de telas",
        tipo: "lista",
        itens: { min: 3, max: 5 },
        ajuda: "Uma tela por item: o que se vê e o que se fala nela, na ordem.",
      },
      {
        id: "texto_na_tela",
        label: "Texto na tela",
        tipo: "lista",
        itens: { min: 3, max: 5 },
        limite: 40,
        limiteRigido: false,
        ajuda: "Um por tela, na mesma ordem da sequência.",
      },
      {
        id: "cta",
        label: "Chamada para ação",
        tipo: "texto",
        limite: 30,
        limiteRigido: false,
        ajuda: "O que fazer agora. Cabe no sticker de link, então é curto.",
      },
      {
        id: "direcao_visual",
        label: "Direção de imagem/vídeo",
        tipo: "texto",
        ajuda: "O que gravar ou fotografar em cada tela.",
      },
    ],
  },
  {
    id: "instagram_feed",
    label: "Instagram Feed",
    midia: "imagem",
    disponivel: true,
    resumo: "Post estático ou carrossel. A legenda é cortada no 'mais' e a primeira linha carrega tudo.",
    campos: [
      {
        id: "abertura",
        label: "Abertura (antes do 'mais')",
        tipo: "texto",
        limite: 125,
        limiteRigido: false,
        ajuda: "O que aparece sem clicar em 'mais'. Se não prender aqui, o resto da legenda não existe.",
      },
      {
        id: "legenda",
        label: "Legenda completa",
        tipo: "texto",
        limite: 2200,
        limiteRigido: true,
        ajuda: "A legenda inteira, começando pela abertura acima.",
      },
      {
        id: "carrossel",
        label: "Estrutura do carrossel",
        tipo: "lista",
        itens: { min: 0, max: 10 },
        ajuda: "Um item por card, na ordem. Lista vazia quando for post único.",
      },
      {
        id: "direcao_foto",
        label: "Direção de foto",
        tipo: "texto",
        ajuda: "O que fotografar, como enquadrar, o que precisa estar visível.",
      },
    ],
  },
  {
    id: "meta_ads",
    label: "Meta Ads (anúncio)",
    midia: "imagem",
    disponivel: true,
    resumo: "Anúncio pago no Facebook/Instagram. Os campos são os do Gerenciador de Anúncios.",
    campos: [
      {
        id: "primary_text",
        label: "Texto principal",
        tipo: "texto",
        limite: 125,
        limiteRigido: false,
        ajuda: "Corta em ~125 caracteres no celular. O que vier depois disso é bônus, não argumento.",
      },
      {
        id: "headline",
        label: "Título",
        tipo: "texto",
        limite: 40,
        limiteRigido: false,
        ajuda: "A linha em negrito abaixo do criativo.",
      },
      {
        id: "description",
        label: "Descrição",
        tipo: "texto",
        limite: 30,
        limiteRigido: false,
        ajuda: "A linha de apoio. Some em vários posicionamentos, então não pode carregar o argumento.",
      },
      {
        id: "direcao_criativo",
        label: "Direção de criativo",
        tipo: "texto",
        ajuda: "O que a imagem ou o vídeo mostra. Sem antes/depois — o conselho de classe proíbe.",
      },
    ],
  },
  {
    id: "google_ads",
    label: "Google Ads (busca)",
    midia: "texto",
    disponivel: true,
    resumo:
      "Anúncio responsivo de busca: o Google combina títulos e descrições sozinho, então cada um " +
      "precisa fazer sentido isolado.",
    campos: [
      {
        id: "headlines",
        label: "Títulos",
        tipo: "lista",
        itens: { min: 3, max: 15 },
        limite: 30,
        limiteRigido: true,
        ajuda:
          "O Google RECUSA acima de 30 caracteres. Cada título aparece sozinho, em qualquer ordem: " +
          "nenhum pode depender do anterior para fazer sentido.",
      },
      {
        id: "descriptions",
        label: "Descrições",
        tipo: "lista",
        itens: { min: 2, max: 4 },
        limite: 90,
        limiteRigido: true,
        ajuda: "O Google RECUSA acima de 90 caracteres.",
      },
    ],
  },
  {
    // Registrado e desabilitado, igual às fontes da Mineração: a estrutura é real desde já, o que
    // falta é decidir os campos com quem for usar.
    id: "tiktok",
    label: "TikTok",
    midia: "video",
    disponivel: false,
    resumo: "Em breve.",
    campos: [],
  },
];

export const FORMATO_IDS = AD_FORMATS.map((f) => f.id);

/**
 * Quantos anúncios UMA composição pode ter.
 *
 * Mora aqui porque os dois lados precisam do mesmo número: o worker corta o plano do agente neste
 * teto, e a tela diz "de 1 a 8" na etapa de intenção. Dois números separados divergiriam, e o
 * sintoma seria a tela prometendo o que o worker não entrega.
 */
export const MAX_ANUNCIOS = 8;

export function getFormato(id) {
  return AD_FORMATS.find((f) => f.id === id) ?? null;
}

/** Só os que dá para escolher hoje. */
export function formatosDisponiveis() {
  return AD_FORMATS.filter((f) => f.disponivel);
}

/**
 * Confere a resposta do agente contra a spec do formato.
 *
 * Não corrige nada e não rejeita nada: devolve avisos. Um título de 34 caracteres ainda é uma boa
 * ideia — só não é colável como está, e quem lê precisa saber disso ANTES de colar.
 *
 * @returns {{campo: string, indice: number|null, tipo: string, detalhe: string}[]}
 */
export function validarLimites(formatoId, composicao) {
  const formato = getFormato(formatoId);
  if (!formato || !composicao || typeof composicao !== "object") return [];

  const avisos = [];
  for (const campo of formato.campos) {
    const valor = composicao[campo.id];

    if (campo.tipo === "lista") {
      const itens = Array.isArray(valor) ? valor : [];
      if (campo.itens && itens.length < campo.itens.min) {
        avisos.push({
          campo: campo.id,
          indice: null,
          tipo: "itens_de_menos",
          detalhe: `${itens.length} item(ns); o formato pede ao menos ${campo.itens.min}`,
        });
      }
      if (campo.itens && itens.length > campo.itens.max) {
        avisos.push({
          campo: campo.id,
          indice: null,
          tipo: "itens_demais",
          detalhe: `${itens.length} item(ns); o formato aceita no máximo ${campo.itens.max}`,
        });
      }
      itens.forEach((item, i) => {
        const texto = typeof item === "string" ? item : "";
        if (campo.limite && texto.length > campo.limite) {
          avisos.push({
            campo: campo.id,
            indice: i,
            tipo: campo.limiteRigido ? "excede_limite_rigido" : "excede_recomendado",
            detalhe: `${texto.length}/${campo.limite} caracteres`,
          });
        }
      });
      continue;
    }

    const texto = typeof valor === "string" ? valor : "";
    if (campo.limite && texto.length > campo.limite) {
      avisos.push({
        campo: campo.id,
        indice: null,
        tipo: campo.limiteRigido ? "excede_limite_rigido" : "excede_recomendado",
        detalhe: `${texto.length}/${campo.limite} caracteres`,
      });
    }
  }
  return avisos;
}
