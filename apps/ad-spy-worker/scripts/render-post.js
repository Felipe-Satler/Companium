/**
 * Renderiza um post a partir de um arquivo JSON, sem banco e sem agente — para testar template e
 * render na mão.
 *
 *   node scripts/render-post.js --entrada scripts/exemplo-post.json --saida /tmp/arte \
 *     [--url http://localhost:8080/render.html] [--png]
 *
 * O JSON é { post, marca, imagens }, com `imagens` no formato do render ({ logo, logo_escuro,
 * fotos: [] }). Cada imagem pode ser um caminho de arquivo local: vira data URL aqui.
 *
 * Sai um arquivo por slide (`<saida>/arte-01.jpg`…) e os avisos do render no terminal.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fecharRender, renderizarSlides } from "../post-render.js";
import { nomeDoArquivoDoSlide } from "../../../shared/post-templates.js";

function arg(nome, padrao = null) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : padrao;
}

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const comoDataUrl = (v, base) => {
  if (!v || String(v).startsWith("data:")) return v || null;
  const arquivo = path.resolve(base, v);
  const mime = MIME[path.extname(arquivo).toLowerCase()] || "application/octet-stream";
  return `data:${mime};base64,${readFileSync(arquivo).toString("base64")}`;
};

const entrada = arg("entrada");
const saida = arg("saida", "./arte");
if (!entrada) {
  console.error("uso: node scripts/render-post.js --entrada post.json --saida pasta [--url URL] [--png]");
  process.exit(2);
}
const base = path.dirname(path.resolve(entrada));
const { post, marca, imagens = {} } = JSON.parse(readFileSync(entrada, "utf8"));
const png = process.argv.includes("--png");

const inicio = Date.now();
try {
  const slides = await renderizarSlides({
    post,
    marca,
    imagens: {
      logo: comoDataUrl(imagens.logo, base),
      logo_escuro: comoDataUrl(imagens.logo_escuro, base),
      fotos: (imagens.fotos || []).map((f) => comoDataUrl(f, base)),
    },
    formato: png ? "png" : "jpeg",
    url: arg("url") || undefined,
    log: (m) => console.error(m),
  });
  mkdirSync(saida, { recursive: true });
  for (const s of slides) {
    const nome = nomeDoArquivoDoSlide("arte", s.indice, png ? "png" : "jpg");
    writeFileSync(path.join(saida, nome), s.bytes);
    console.log(`${nome}  ${s.bytes.length} bytes${s.avisos.length ? `  avisos: ${JSON.stringify(s.avisos)}` : ""}`);
  }
  console.log(`${slides.length} slide(s) em ${Date.now() - inicio} ms`);
} finally {
  await fecharRender();
}
