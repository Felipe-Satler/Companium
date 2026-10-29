/**
 * Paleta do Brand kit — gerador LOCAL, sem API de terceiros.
 *
 * As APIs de paleta que existem (Colormind, Huemint) são gratuitas só para uso não comercial, e a
 * Colormind só responde em HTTP sem TLS. Uma agência gerando paleta de cliente é uso comercial, e
 * depender de um serviço "sem garantia de uptime" para um botão da Central de Clientes seria
 * trocar uma decisão de design por uma de licença. Gerar aqui custa ~150 linhas e nada mais.
 *
 * ## Como gera
 *
 * Em OKLCH, e não em HSL: no HSL um amarelo e um azul com a mesma "luminosidade" têm brilhos
 * percebidos completamente diferentes, então uma harmonia de matizes sai com uma cor gritando e
 * outra sumindo. No OKLCH o L é o brilho percebido, e a harmonia sai equilibrada.
 *
 * Os papéis não são simétricos, e é de propósito — é como uma peça de saúde costuma ser montada:
 *   - **primária**: a cor forte da marca (fundo da capa, títulos). Escura o bastante para texto
 *     branco por cima;
 *   - **secundária**: o acento (destaques, CTA), num matiz harmônico ao da primária;
 *   - **terciária**: a cor CLARA de fundo, quase neutra, com um toque do matiz da primária. É sobre
 *     ela que o texto corrido vai.
 *
 * Uma cor travada (a da paleta fixa que a pessoa quer manter) entra como está, e as outras são
 * geradas em volta dela.
 *
 * ## O contraste é conferido, não prometido
 *
 * `avisosDaPaleta` diz quando o texto ficaria ilegível (WCAG < 4,5 para texto normal). Não recusa
 * nada: a paleta fixa do cliente é a do cliente, e quem decide trocar é a pessoa. O gerador, esse
 * sim, só devolve paletas que passam.
 *
 * JavaScript puro, sem import: roda no navegador, no worker e nos testes.
 */

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** "#abc", "abc", "#AABBCC" -> "#AABBCC". Qualquer outra coisa -> null. */
export function normalizarHex(valor) {
  const m = HEX.exec(String(valor ?? "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `#${h.toUpperCase()}`;
}

function hexParaRgb(hex) {
  const h = normalizarHex(hex);
  if (!h) return null;
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

function rgbParaHex(rgb) {
  return `#${rgb
    .map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

const paraLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const deLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB (0..1) -> OKLCH { l, c, h }. Fórmulas de Björn Ottosson (2020). */
export function rgbParaOklch(rgb) {
  const [r, g, b] = rgb.map(paraLinear);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: (h + 360) % 360 };
}

/** OKLCH -> sRGB (0..1), SEM cortar: pode sair do gamut, e `dentroDoGamut` diz se saiu. */
function oklchParaRgbBruto({ l, c, h }) {
  const rad = (h * Math.PI) / 180;
  const A = c * Math.cos(rad);
  const B = c * Math.sin(rad);
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ].map(deLinear);
}

const dentroDoGamut = (rgb) => rgb.every((c) => c >= -0.0005 && c <= 1.0005);

/**
 * OKLCH -> "#RRGGBB". Fora do gamut do sRGB, reduz o croma (e só o croma) até caber: mantém o
 * brilho e o matiz, que são o que a harmonia escolheu, e abre mão de saturação.
 */
export function oklchParaHex({ l, c, h }) {
  let croma = c;
  let rgb = oklchParaRgbBruto({ l, c: croma, h });
  for (let i = 0; i < 40 && !dentroDoGamut(rgb); i += 1) {
    croma *= 0.92;
    rgb = oklchParaRgbBruto({ l, c: croma, h });
  }
  return rgbParaHex(rgb);
}

export function hexParaOklch(hex) {
  const rgb = hexParaRgb(hex);
  return rgb ? rgbParaOklch(rgb) : null;
}

/** Luminância relativa WCAG 2.x. */
function luminancia(hex) {
  const rgb = hexParaRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(paraLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razão de contraste WCAG entre duas cores (1 a 21). null se alguma não for cor. */
export function contraste(a, b) {
  const la = luminancia(a);
  const lb = luminancia(b);
  if (la == null || lb == null) return null;
  const [claro, escuro] = la > lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (escuro + 0.05);
}

export const TEXTO_CLARO = "#FFFFFF";
export const TEXTO_ESCURO = "#141414";

/** A cor de texto (branco ou quase preto) que mais contrasta com o fundo. */
export function textoSobre(fundo) {
  const claro = contraste(fundo, TEXTO_CLARO) ?? 0;
  const escuro = contraste(fundo, TEXTO_ESCURO) ?? 0;
  return claro >= escuro ? TEXTO_CLARO : TEXTO_ESCURO;
}

/** WCAG AA para texto normal. Título grande aceitaria 3, mas a arte também tem texto corrido. */
export const CONTRASTE_MINIMO = 4.5;

export const PAPEIS_DA_PALETA = ["primaria", "secundaria", "terciaria"];

/**
 * O que ficaria ilegível com esta paleta, nas combinações que os templates usam de verdade:
 * texto sobre a primária (capa), primária sobre a terciária (título no fundo claro) e texto sobre
 * a secundária (o botão de CTA).
 *
 * @returns {{ par: string, contraste: number, detalhe: string }[]}
 */
export function avisosDaPaleta(paleta) {
  const p = paleta || {};
  const avisos = [];
  const conferir = (par, fundo, frente, detalhe) => {
    const r = contraste(fundo, frente);
    if (r != null && r < CONTRASTE_MINIMO) {
      avisos.push({ par, contraste: Math.round(r * 10) / 10, detalhe });
    }
  };
  if (p.primaria) conferir("texto_na_primaria", p.primaria, textoSobre(p.primaria), "texto sobre a primária fica difícil de ler");
  if (p.primaria && p.terciaria) conferir("primaria_na_terciaria", p.terciaria, p.primaria, "título na primária sobre o fundo claro fica fraco");
  if (p.secundaria) conferir("texto_na_secundaria", p.secundaria, textoSobre(p.secundaria), "texto sobre a secundária (o CTA) fica difícil de ler");
  return avisos;
}

const HARMONIAS = [
  { id: "analoga", label: "análoga", desvio: () => 35 },
  { id: "complementar", label: "complementar", desvio: () => 180 },
  { id: "complementar_dividida", label: "complementar dividida", desvio: (r) => (r() < 0.5 ? 150 : 210) },
  { id: "triade", label: "tríade", desvio: (r) => (r() < 0.5 ? 120 : 240) },
];

const entre = (r, min, max) => min + r() * (max - min);

/**
 * Uma paleta nova.
 *
 * `travadas` são as cores que a pessoa quer manter (qualquer subconjunto dos três papéis): entram
 * como estão. Sem a primária travada, o matiz base é sorteado.
 *
 * Tenta algumas vezes até achar uma combinação sem aviso de contraste entre as cores GERADAS. As
 * travadas não são alteradas mesmo que não passem — são do cliente —, então o resultado pode vir
 * com aviso, e quem chama mostra.
 *
 * `aleatorio` existe para o teste ser determinístico.
 *
 * @param {{ travadas?: { primaria?: string, secundaria?: string, terciaria?: string },
 *           aleatorio?: () => number }} [opcoes]
 * @returns {{ primaria: string, secundaria: string, terciaria: string, harmonia: string }}
 */
export function gerarPaleta({ travadas = {}, aleatorio = Math.random } = {}) {
  const fixa = Object.fromEntries(
    PAPEIS_DA_PALETA.map((p) => [p, normalizarHex(travadas?.[p])]).filter(([, v]) => v)
  );
  const base = fixa.primaria ? hexParaOklch(fixa.primaria) : null;

  let melhor = null;
  for (let tentativa = 0; tentativa < 24; tentativa += 1) {
    const harmonia = HARMONIAS[Math.floor(aleatorio() * HARMONIAS.length)];
    const h = base ? base.h : entre(aleatorio, 0, 360);
    const primaria =
      fixa.primaria || oklchParaHex({ l: entre(aleatorio, 0.38, 0.52), c: entre(aleatorio, 0.09, 0.17), h });
    const hSec = (h + harmonia.desvio(aleatorio)) % 360;
    const secundaria =
      fixa.secundaria || oklchParaHex({ l: entre(aleatorio, 0.55, 0.72), c: entre(aleatorio, 0.1, 0.18), h: hSec });
    const terciaria =
      fixa.terciaria || oklchParaHex({ l: entre(aleatorio, 0.95, 0.98), c: entre(aleatorio, 0.008, 0.025), h });
    const paleta = { primaria, secundaria, terciaria, harmonia: harmonia.label };
    const avisos = avisosDaPaleta(paleta);
    if (!avisos.length) return paleta;
    if (!melhor || avisos.length < melhor.avisos) melhor = { paleta, avisos: avisos.length };
  }
  return melhor.paleta;
}
