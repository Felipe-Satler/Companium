/**
 * Render das artes estáticas: post renderizável -> JPEG (ou PNG), um arquivo por slide.
 *
 * Abre a página de render do site (`render.html`, POST_RENDER_URL) num Chrome sem tela, no tamanho
 * exato do canvas, entrega o post por `window.__renderizar` e fotografa o `#palco`. O desenho é do
 * template React — o MESMO que a tela mostra como preview —, então o arquivo é o preview.
 *
 * ## Um Chrome, um render por vez
 *
 * O Chrome é aberto no primeiro pedido e reaproveitado (abrir custa ~1 s; renderizar um slide com
 * ele quente, ~0,5 s). Fecha sozinho depois de POST_RENDER_OCIOSO_MS sem uso: ocupa ~300 MB, e o
 * serviço divide 6 GB com o Whisper. Os pedidos passam por uma fila de um: dois carrosséis ao
 * mesmo tempo não dobram a memória.
 *
 * O navegador é o mesmo da Mineração: `CHROME_BIN`, ou o Chrome instalado (`channel: "chrome"`).
 * Sem nenhum dos dois (máquina de desenvolvimento), cai para o Chromium do Playwright.
 *
 * ## JPEG para entregar
 *
 * O Instagram recomprime tudo o que recebe; mandar JPEG de qualidade alta (92) em sRGB é o que menos
 * perde nessa recompressão. PNG fica disponível para quem quiser o arquivo sem perda.
 */

import { chromium } from "playwright";
import { CHROME_BIN, POST_RENDER_OCIOSO_MS, POST_RENDER_URL } from "./config.js";
import { PROPORCOES } from "../../shared/post-templates.js";

let navegador = null;
let abrindo = null;
let timerOcioso = null;
let fila = Promise.resolve();

async function abrirNavegador(log) {
  if (navegador?.isConnected()) return navegador;
  if (abrindo) return abrindo;
  const args = ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"];
  abrindo = (async () => {
    try {
      return await chromium.launch({
        headless: true,
        ...(CHROME_BIN ? { executablePath: CHROME_BIN } : { channel: "chrome" }),
        args,
      });
    } catch (err) {
      log(`[render] Chrome indisponível (${err?.message?.split("\n")[0]}); usando o Chromium do Playwright`);
      return chromium.launch({ headless: true, args });
    }
  })();
  try {
    navegador = await abrindo;
    return navegador;
  } finally {
    abrindo = null;
  }
}

function agendarFechamento() {
  clearTimeout(timerOcioso);
  timerOcioso = setTimeout(() => {
    const n = navegador;
    navegador = null;
    void n?.close().catch(() => {});
  }, POST_RENDER_OCIOSO_MS);
  timerOcioso.unref?.();
}

/** Fecha o Chrome agora (desligamento do worker, testes). */
export async function fecharRender() {
  clearTimeout(timerOcioso);
  const n = navegador;
  navegador = null;
  await n?.close().catch(() => {});
}

/**
 * Renderiza os slides pedidos (todos, sem `indices`).
 *
 * @param {{ post: object, marca: object, imagens: { logo?: string, logo_escuro?: string, fotos: string[] },
 *           indices?: number[], formato?: "jpeg"|"png", qualidade?: number, url?: string,
 *           log?: (m: string) => void }} pedido   as imagens já como data URL
 * @returns {Promise<{ indice: number, bytes: Buffer, avisos: object[] }[]>}
 */
export function renderizarSlides(pedido) {
  const vez = fila.then(() => renderizarAgora(pedido));
  // A fila segue mesmo que este render falhe: um erro não pode travar os próximos.
  fila = vez.catch(() => {});
  return vez;
}

async function renderizarAgora({
  post,
  marca,
  imagens,
  indices = null,
  formato = "jpeg",
  qualidade = 92,
  url = POST_RENDER_URL,
  log = () => {},
}) {
  const { largura, altura } = PROPORCOES[post.proporcao] ?? PROPORCOES["4:5"];
  const quais = (indices ?? post.slides.map((_, i) => i)).filter((i) => i >= 0 && i < post.slides.length);
  const browser = await abrirNavegador(log);
  clearTimeout(timerOcioso);
  const contexto = await browser.newContext({
    viewport: { width: largura, height: altura },
    deviceScaleFactor: 1,
    locale: "pt-BR",
  });
  try {
    const pagina = await contexto.newPage();
    const erros = [];
    pagina.on("pageerror", (e) => erros.push(e.message));
    await pagina.goto(url, { waitUntil: "load", timeout: 30000 });
    await pagina.waitForFunction(() => window.__PRONTA__ === true, null, { timeout: 15000 }).catch(() => {
      throw new Error(
        `A página de render (${url}) não ficou pronta` +
          (erros.length ? `: ${erros[0]}` : ". O site foi publicado com render.html?")
      );
    });

    const saida = [];
    for (const indice of quais) {
      const r = await pagina.evaluate((p) => window.__renderizar(p), { post, indice, marca, imagens });
      const bytes = await pagina.locator("#palco").screenshot({
        type: formato,
        ...(formato === "jpeg" ? { quality: qualidade } : {}),
        animations: "disabled",
      });
      saida.push({ indice, bytes, avisos: r?.avisos ?? [] });
    }
    return saida;
  } finally {
    await contexto.close().catch(() => {});
    agendarFechamento();
  }
}
