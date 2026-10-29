/**
 * Fundos abstratos das artes — desenhados pelo próprio template, sem IA (29/10/2026).
 *
 * Degradês, ondas, formas orgânicas e padrões geométricos feitos em SVG a partir da PALETA da arte e
 * de uma SEMENTE. A mesma semente dá o mesmo fundo no preview, no arquivo do worker e, depois, nos
 * reels: o fundo não é uma imagem guardada, é uma receita.
 *
 * Por que sem IA, por enquanto: o servidor não tem chave de API de imagem (os agentes entram pela
 * assinatura, que não dá acesso a ela). Um fundo abstrato não precisa de modelo: custo zero, sem
 * espera, sem risco de texto ou pessoa aparecer, e sem selo de "conteúdo de IA" no feed.
 *
 * ## O texto continua legível, por construção
 *
 * As formas são variações PEQUENAS do brilho da cor de fundo (OKLCH) e o acento entra com pouca
 * opacidade. Depois de sortear, cada forma é conferida: a cor dela, misturada ao fundo, contra a cor
 * do texto daquele fundo. A que derrubaria o contraste abaixo de 4,5 (ou abaixo do que o próprio
 * fundo liso já tem, se a paleta do cliente já vier fraca) perde opacidade até passar.
 *
 * JavaScript puro, sem I/O: roda na tela, no render e nos testes.
 */

import { contraste, hexParaOklch, normalizarHex, oklchParaHex, textoSobre } from "./paleta.js";

export const VERSAO_DOS_FUNDOS = 1;

export const ESTILOS_DE_FUNDO = [
  { id: "liso", label: "Liso" },
  { id: "degrade", label: "Degradê" },
  { id: "ondas", label: "Ondas" },
  { id: "organico", label: "Formas orgânicas" },
  { id: "geometrico", label: "Geométrico" },
];

const ESTILO_IDS = new Set(ESTILOS_DE_FUNDO.map((e) => e.id));
const MAX_SEMENTE = 2 ** 31 - 1;

/** O fundo como vai no post: `{ estilo, semente, granulado, versao }`, ou null (liso). */
export function normalizarFundo(bruto) {
  if (!bruto || typeof bruto !== "object" || !ESTILO_IDS.has(bruto.estilo) || bruto.estilo === "liso") return null;
  const semente = Number.isInteger(bruto.semente) ? Math.abs(bruto.semente) % MAX_SEMENTE : 1;
  return { estilo: bruto.estilo, semente, granulado: bruto.granulado === true, versao: VERSAO_DOS_FUNDOS };
}

/** Uma variação nova do estilo — é o "Sortear variação" da tela. */
export function sortearFundo(estilo, { granulado = false, aleatorio = Math.random } = {}) {
  return normalizarFundo({ estilo, semente: Math.floor(aleatorio() * MAX_SEMENTE) + 1, granulado });
}

/** PRNG pequeno e determinístico (mulberry32): mesma semente, mesma sequência, em qualquer motor. */
function prng(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const n1 = (v) => Math.round(v * 10) / 10;
const entre = (r, min, max) => min + r() * (max - min);

/** A cor de fundo com o brilho deslocado em `delta` (OKLCH), mantendo matiz e croma. */
function variar(hex, delta) {
  const c = hexParaOklch(hex);
  if (!c) return hex;
  return oklchParaHex({ ...c, l: Math.min(0.99, Math.max(0.02, c.l + delta)) });
}

/** Mistura simples em sRGB: o que a forma com opacidade `o` vira em cima do fundo. */
export function misturar(fundo, cor, o) {
  const a = normalizarHex(fundo);
  const b = normalizarHex(cor);
  if (!a || !b) return a || b;
  const canal = (h, i) => parseInt(h.slice(i, i + 2), 16);
  return `#${[1, 3, 5]
    .map((i) => Math.round(canal(a, i) * (1 - o) + canal(b, i) * o).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

/** Um contorno orgânico fechado em volta de (cx, cy): pontos num círculo deformado, ligados por curvas. */
function blob(r, cx, cy, raio) {
  const pontos = 7;
  const p = Array.from({ length: pontos }, (_, i) => {
    const ang = (i / pontos) * Math.PI * 2;
    const rr = raio * entre(r, 0.72, 1.18);
    return [cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr];
  });
  const meio = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let d = `M${n1(meio(p[pontos - 1], p[0])[0])} ${n1(meio(p[pontos - 1], p[0])[1])}`;
  for (let i = 0; i < pontos; i += 1) {
    const atual = p[i];
    const prox = meio(p[i], p[(i + 1) % pontos]);
    d += ` Q${n1(atual[0])} ${n1(atual[1])} ${n1(prox[0])} ${n1(prox[1])}`;
  }
  return `${d} Z`;
}

/** Uma onda atravessando a arte na altura `y`, fechada até a borda de baixo (ou de cima). */
function onda(r, largura, altura, y, amplitude, paraBaixo) {
  const passos = 4;
  const fase = entre(r, 0, Math.PI * 2);
  let d = `M0 ${n1(y + Math.sin(fase) * amplitude)}`;
  for (let i = 1; i <= passos; i += 1) {
    const x = (largura / passos) * i;
    const cx = x - largura / passos / 2;
    const cy = y + Math.sin(fase + i * 1.3) * amplitude * 1.6;
    d += ` Q${n1(cx)} ${n1(cy)} ${n1(x)} ${n1(y + Math.sin(fase + i * 1.7) * amplitude)}`;
  }
  const borda = paraBaixo ? altura : 0;
  return `${d} L${largura} ${borda} L0 ${borda} Z`;
}

/** Cantos e bordas, onde o texto não costuma estar — as formas maiores nascem ali. */
function pontoNaBorda(r, largura, altura) {
  const lado = Math.floor(r() * 4);
  if (lado === 0) return [entre(r, -0.1, 1.1) * largura, entre(r, -0.15, 0.12) * altura];
  if (lado === 1) return [entre(r, 0.85, 1.15) * largura, entre(r, -0.1, 1.1) * altura];
  if (lado === 2) return [entre(r, -0.1, 1.1) * largura, entre(r, 0.88, 1.15) * altura];
  return [entre(r, -0.15, 0.15) * largura, entre(r, -0.1, 1.1) * altura];
}

/**
 * O desenho do fundo para UM slide: definições de degradê e formas, em coordenadas do canvas.
 *
 * `indice` varia a composição entre as páginas de um carrossel sem mudar o estilo: as páginas ficam
 * irmãs, não idênticas.
 *
 * @param {{ estilo: string, semente: number, granulado?: boolean } | null} fundo
 * @param {{ base: string, acento: string, largura: number, altura: number, indice?: number }} ctx
 * @returns {{ gradientes: object[], formas: { d?: string, cx?: number, cy?: number, r?: number,
 *            x?: number, y?: number, w?: number, h?: number, tipo: string, cor: string, opacidade: number }[],
 *            granulado: boolean } | null}
 */
export function desenharFundo(fundo, { base, acento, largura, altura, indice = 0 }) {
  const f = normalizarFundo(fundo);
  if (!f) return null;
  const r = prng((f.semente + indice * 7919) % MAX_SEMENTE || 1);
  const escuro = (hexParaOklch(base)?.l ?? 0.5) < 0.6;
  // Num fundo escuro (texto claro) as variações ESCURECEM, e as claras são tímidas; num fundo claro
  // (texto escuro), o contrário. É o que mantém o texto longe do tom das formas.
  const mais = escuro ? -0.07 : -0.035;
  const menos = escuro ? 0.045 : 0.02;
  const gradientes = [];
  const formas = [];

  if (f.estilo === "degrade") {
    const ang = entre(r, 0, Math.PI * 2);
    gradientes.push({
      id: "g0",
      tipo: "linear",
      x1: n1(0.5 - Math.cos(ang) / 2),
      y1: n1(0.5 - Math.sin(ang) / 2),
      x2: n1(0.5 + Math.cos(ang) / 2),
      y2: n1(0.5 + Math.sin(ang) / 2),
      paradas: [
        { offset: 0, cor: variar(base, menos) },
        { offset: 1, cor: variar(base, mais) },
      ],
    });
    formas.push({ tipo: "rect", x: 0, y: 0, w: largura, h: altura, cor: "url(#g0)", opacidade: 1 });
    // Um brilho do acento num canto.
    const [cx, cy] = pontoNaBorda(r, largura, altura);
    gradientes.push({ id: "g1", tipo: "radial", paradas: [{ offset: 0, cor: acento, opacidade: 1 }, { offset: 1, cor: acento, opacidade: 0 }] });
    formas.push({ tipo: "circle", cx: n1(cx), cy: n1(cy), r: n1(largura * entre(r, 0.45, 0.7)), cor: "url(#g1)", opacidade: entre(r, 0.18, 0.3), corReal: acento });
  } else if (f.estilo === "ondas") {
    const camadas = 3 + Math.floor(r() * 2);
    const paraBaixo = r() < 0.7;
    for (let i = 0; i < camadas; i += 1) {
      const y = paraBaixo ? altura * (0.62 + i * 0.09) : altura * (0.38 - i * 0.09);
      const ultima = i === camadas - 1;
      formas.push({
        tipo: "path",
        d: onda(r, largura, altura, y, altura * entre(r, 0.02, 0.045), paraBaixo),
        cor: ultima ? acento : variar(base, mais * (0.5 + i * 0.25)),
        opacidade: ultima ? 0.16 : 0.9,
      });
    }
  } else if (f.estilo === "organico") {
    const quantas = 3 + Math.floor(r() * 3);
    for (let i = 0; i < quantas; i += 1) {
      const [cx, cy] = pontoNaBorda(r, largura, altura);
      const deAcento = i === 0;
      formas.push({
        tipo: "path",
        d: blob(r, cx, cy, largura * entre(r, 0.22, 0.42)),
        cor: deAcento ? acento : variar(base, i % 2 ? mais : menos),
        opacidade: deAcento ? entre(r, 0.14, 0.22) : 0.85,
      });
    }
  } else if (f.estilo === "geometrico") {
    // Arcos concêntricos num canto + uma grade de pontos discreta.
    const [cx, cy] = [r() < 0.5 ? 0 : largura, r() < 0.5 ? 0 : altura];
    const aneis = 5 + Math.floor(r() * 3);
    const passo = largura * entre(r, 0.06, 0.09);
    for (let i = aneis; i >= 1; i -= 1) {
      // Anéis são linhas fortes por natureza: menos opacidade que as outras formas, e mais ainda no
      // fundo claro, onde um cinza em faixas disputa a atenção com o título.
      formas.push({ tipo: "circle", cx, cy, r: n1(passo * i * 1.4), cor: variar(base, i % 2 ? mais : menos), opacidade: escuro ? 0.75 : 0.5 });
    }
    const colunas = 6;
    const lado = largura / (colunas + 1);
    const ox = r() < 0.5 ? largura * 0.62 : largura * 0.06;
    const oy = r() < 0.5 ? altura * 0.06 : altura * 0.78;
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        formas.push({ tipo: "circle", cx: n1(ox + i * lado * 0.45), cy: n1(oy + j * lado * 0.45), r: 5, cor: acento, opacidade: 0.35 });
      }
    }
  }

  // A conferência de contraste: cada forma, misturada ao fundo, contra o texto daquele fundo.
  const texto = textoSobre(base);
  const alvo = Math.min(4.5, contraste(base, texto) ?? 4.5);
  for (const forma of formas) {
    const cores =
      forma.cor.startsWith("url(")
        ? forma.corReal
          ? [forma.corReal]
          : (gradientes.find((g) => `url(#${g.id})` === forma.cor)?.paradas ?? []).map((p) => p.cor)
        : [forma.cor];
    for (const cor of cores) {
      while (forma.opacidade > 0.02 && (contraste(misturar(base, cor, forma.opacidade), texto) ?? 21) < alvo - 0.05) {
        forma.opacidade = Math.round(forma.opacidade * 0.8 * 100) / 100;
      }
    }
    delete forma.corReal;
  }

  return { gradientes, formas, granulado: f.granulado };
}
