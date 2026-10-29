/**
 * Templates de arte estática e o "post renderizável" — DADO COMPARTILHADO entre o worker (o agente
 * que destrincha a composição recebe estes slots e limites; o render abre a página com eles), a tela
 * (preview e edição) e os componentes React que desenham.
 *
 * Pelo mesmo motivo de `ad-formats.js`: se o agente e o template lessem definições diferentes, o
 * agente escreveria um título de 120 caracteres para um espaço de 70, e ninguém daria erro — a fonte
 * só encolheria até o ilegível.
 *
 * ## O post renderizável (`post_renderizavel@1`)
 *
 * É a entrada do render, e não a composição: a composição diz O QUE o anúncio fala; o post diz o que
 * vai escrito em CADA página da arte, em que papel, com qual foto, e se a identificação do médico
 * entra. Regenerar a arte (outro template, um texto corrigido) é refazer o post, sem refazer a
 * composição.
 *
 *   {
 *     schema: "post_renderizavel@1",
 *     template: { id, versao }, proporcao: "4:5",
 *     slides: [{ papel, titulo, apoio, destaque, cta, foto, alt }],
 *     legenda, hashtags,
 *     identificacao: { nome, crm, uf, rqe, linha, naArte, naLegenda, naoEspecialista },
 *     elementos: { logo: true, endereco: false, … },   // as chaves da pré-etapa
 *     uso, circula_fora,
 *     fundo: { estilo, semente, granulado, versao } | null   // shared/fundos.js; null = liso
 *   }
 *
 * ## Papéis de slide
 *
 * `unico` é o post de uma imagem só. Num carrossel, o primeiro é `capa`, o último PODE ser `cta`, e o
 * meio é `conteudo`. Cada papel é um layout, com os seus slots e limites.
 */

export const SCHEMA_DO_POST = "post_renderizavel@1";

/** As proporções em px. Só 4:5 tem template hoje; as outras ficam registradas para os próximos. */
export const PROPORCOES = {
  "4:5": { largura: 1080, altura: 1350, label: "Feed 4:5" },
  "1:1": { largura: 1080, altura: 1080, label: "Quadrado 1:1" },
  "9:16": { largura: 1080, altura: 1920, label: "Stories 9:16" },
};

/** O teto do Instagram para carrossel. */
export const MAX_SLIDES = 10;

export const PAPEIS = ["unico", "capa", "conteudo", "cta"];

/**
 * @typedef {object} Slot
 * @property {"titulo"|"apoio"|"destaque"|"cta"} id
 * @property {string} label
 * @property {number} limite      caracteres. Acima disso a fonte encolhe até o mínimo e a tela avisa.
 * @property {boolean} [obrigatorio]
 * @property {string} ajuda       vai para o prompt do agente
 */

const TITULO = (limite, ajuda) => ({ id: "titulo", label: "Título", limite, obrigatorio: true, ajuda });
const APOIO = (limite, ajuda) => ({ id: "apoio", label: "Texto de apoio", limite, ajuda });
const CTA = (limite, obrigatorio = false) => ({
  id: "cta",
  label: "Chamada (botão)",
  limite,
  obrigatorio,
  ajuda: "O que fazer agora, como texto de botão: 'Agende sua avaliação'. Sem número de telefone — o contato vem do Brand kit.",
});

export const TEMPLATES = [
  {
    id: "editorial",
    // 1.1.0 (29/10/2026): fundo abstrato opcional (`post.fundo`). Arte sem fundo sai igual à 1.0.0.
    versao: "1.1.0",
    label: "Editorial",
    resumo: "Capa na cor primária com título grande; páginas de conteúdo no fundo claro.",
    proporcoes: ["4:5"],
    layouts: {
      unico: {
        label: "Post único",
        aceitaFoto: true,
        slots: [
          TITULO(70, "A frase da arte. Curta, lida de relance no feed — é o gancho do anúncio, não a legenda."),
          APOIO(160, "Uma ou duas frases que completam o título. Opcional."),
          CTA(40),
        ],
      },
      capa: {
        label: "Capa do carrossel",
        aceitaFoto: true,
        slots: [
          { id: "destaque", label: "Selo", limite: 30, ajuda: "Opcional. Um rótulo curto acima do título ('Medicina do Sono')." },
          TITULO(70, "O gancho do carrossel: faz a pessoa querer passar para o lado."),
          APOIO(140, "Opcional. Uma frase que promete o que as próximas páginas entregam."),
        ],
      },
      conteudo: {
        label: "Página de conteúdo",
        aceitaFoto: true,
        slots: [
          TITULO(60, "A ideia desta página, em uma linha."),
          APOIO(280, "O desenvolvimento da ideia, em até três frases curtas."),
        ],
      },
      cta: {
        label: "Página final (chamada)",
        aceitaFoto: false,
        slots: [
          TITULO(60, "O fechamento: por que agir agora, sem urgência falsa."),
          APOIO(140, "Opcional. O que acontece quando a pessoa entra em contato."),
          CTA(40, true),
        ],
      },
    },
  },
];

export const TEMPLATE_PADRAO = "editorial";

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

/** O papel que a posição `i` de um conjunto de `total` slides pode ter. */
export function papeisPermitidos(i, total) {
  if (total <= 1) return ["unico"];
  if (i === 0) return ["capa"];
  if (i === total - 1) return ["conteudo", "cta"];
  return ["conteudo"];
}

const texto = (v, max = 2000) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Os slides como devem ser: só os slots do layout de cada um, textos aparados, papel permitido pela
 * posição, foto como índice válido (ou null). Não corta texto acima do limite — isso é aviso, não
 * correção: um título de 74 caracteres ainda é o título que alguém aprovou.
 *
 * @param {object[]} slides
 * @param {object} template
 * @param {{ fotos?: number }} [opcoes]  quantas fotos a pré-etapa enviou
 */
export function normalizarSlides(slides, template, { fotos = 0 } = {}) {
  const lista = (Array.isArray(slides) ? slides : []).slice(0, MAX_SLIDES);
  return lista.map((bruto, i) => {
    const s = bruto && typeof bruto === "object" ? bruto : {};
    const permitidos = papeisPermitidos(i, lista.length);
    const papel = permitidos.includes(s.papel) ? s.papel : permitidos[0];
    const layout = template.layouts[papel];
    const out = { papel };
    for (const slot of layout.slots) out[slot.id] = texto(s[slot.id], 600);
    const foto = Number.isInteger(s.foto) && s.foto >= 0 && s.foto < fotos && layout.aceitaFoto ? s.foto : null;
    out.foto = foto;
    out.alt = texto(s.alt, 400);
    return out;
  });
}

/**
 * O que está fora da spec, slide a slide: slot obrigatório vazio, texto acima do limite, carrossel
 * acima de 10. Não recusa: a tela mostra, e o render ainda sai (com a fonte no mínimo).
 *
 * @returns {{ slide: number|null, campo: string, tipo: string, detalhe: string }[]}
 */
export function validarSlides(slides, template) {
  const avisos = [];
  const lista = Array.isArray(slides) ? slides : [];
  if (!lista.length) {
    avisos.push({ slide: null, campo: "slides", tipo: "sem_slides", detalhe: "a arte não tem nenhuma página" });
  }
  if (lista.length > MAX_SLIDES) {
    avisos.push({ slide: null, campo: "slides", tipo: "slides_demais", detalhe: `${lista.length} páginas; o Instagram aceita ${MAX_SLIDES}` });
  }
  lista.forEach((s, i) => {
    const layout = template.layouts[s?.papel];
    if (!layout) return;
    for (const slot of layout.slots) {
      const v = String(s[slot.id] ?? "");
      if (slot.obrigatorio && !v.trim()) {
        avisos.push({ slide: i, campo: slot.id, tipo: "vazio", detalhe: `${slot.label} vazio` });
      } else if (v.length > slot.limite) {
        avisos.push({ slide: i, campo: slot.id, tipo: "excede_limite", detalhe: `${v.length}/${slot.limite} caracteres` });
      }
    }
    if (!String(s?.alt ?? "").trim()) {
      avisos.push({ slide: i, campo: "alt", tipo: "sem_alt", detalhe: "sem texto alternativo" });
    }
  });
  return avisos;
}

/** Todo o texto que vai DESENHADO na arte, slide a slide — é sobre ele que as regras do CFM correm. */
export function textosDaArte(slides) {
  return (Array.isArray(slides) ? slides : []).map((s) =>
    ["destaque", "titulo", "apoio", "cta"].map((k) => s?.[k] || "").filter(Boolean).join(" ")
  );
}

/** Nome de arquivo de um slide: "dr-fulano-feed-01.jpg". Sem acento nem espaço. */
export function nomeDoArquivoDoSlide(base, indice, extensao = "jpg") {
  const limpo =
    String(base || "arte")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "arte";
  return `${limpo}-${String(indice + 1).padStart(2, "0")}.${extensao}`;
}
