/**
 * Baixa as fontes da lista do Brand kit (`shared/brand-kit.js` › FONTES) para `public/fonts/posts/`
 * e escreve `src/posts/fontes.css` com os @font-face.
 *
 * Por que hospedar: o nginx do site serve uma CSP com `style-src`/`font-src 'self'` (é por isso que
 * a Inter já é auto-hospedada — ver `index.html`). Um <link> para o Google Fonts seria bloqueado no
 * preview da tela, e o preview tem de usar a MESMA fonte que o render do worker.
 *
 * Só o subconjunto `latin` (cobre o português inteiro: á, ã, ç, ê…) e só os pesos que os templates
 * usam (400 e 700). Rodar de novo é seguro: apaga a pasta e baixa tudo de novo.
 *
 *   node scripts/baixar-fontes-posts.mjs
 *
 * As famílias são todas OFL ou Apache 2.0, que permitem hospedar.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FONTES } from "../shared/brand-kit.js";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destino = path.join(raiz, "public/fonts/posts");
const PESOS = [400, 700];
// O Google devolve woff2 só para navegador moderno: sem este UA, vem ttf.
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });
const regras = [];

for (const { id: familia } of FONTES) {
  const url =
    "https://fonts.googleapis.com/css2?family=" +
    encodeURIComponent(familia).replace(/%20/g, "+") +
    `:wght@${PESOS.join(";")}&display=block`;
  const css = await (await fetch(url, { headers: { "User-Agent": UA } })).text();
  // Um bloco por (peso, subconjunto), com o nome do subconjunto no comentário antes dele.
  const blocos = [...css.matchAll(/\/\* ([a-z-]+) \*\/\s*@font-face\s*{([^}]*)}/g)];
  // Fonte variável: o Google devolve o MESMO arquivo para os dois pesos. Aí vai um arquivo só, com
  // `font-weight: 400 700` — baixar duas cópias dobraria o peso da pasta sem mudar nada.
  const porArquivo = new Map();
  for (const [, subconjunto, corpo] of blocos) {
    if (subconjunto !== "latin") continue;
    const peso = Number(/font-weight:\s*(\d+)/.exec(corpo)?.[1]);
    const arquivo = /src:\s*url\(([^)]+)\)/.exec(corpo)?.[1];
    const faixa = /unicode-range:\s*([^;]+);/.exec(corpo)?.[1];
    if (!PESOS.includes(peso) || !arquivo) continue;
    const item = porArquivo.get(arquivo) || { pesos: [], faixa };
    item.pesos.push(peso);
    porArquivo.set(arquivo, item);
  }
  for (const [arquivo, { pesos, faixa }] of porArquivo) {
    const variavel = pesos.length > 1;
    const nome = `${slug(familia)}${variavel ? "" : `-${pesos[0]}`}.woff2`;
    const bytes = Buffer.from(await (await fetch(arquivo)).arrayBuffer());
    writeFileSync(path.join(destino, nome), bytes);
    regras.push(
      `@font-face {\n  font-family: "${familia}";\n  font-style: normal;\n` +
        `  font-weight: ${variavel ? `${Math.min(...pesos)} ${Math.max(...pesos)}` : pesos[0]};\n` +
        `  font-display: block;\n  src: url("/fonts/posts/${nome}") format("woff2");\n` +
        (faixa ? `  unicode-range: ${faixa};\n` : "") +
        "}"
    );
    console.log(`${familia} ${pesos.join("/")}: ${bytes.length} bytes`);
  }
}

writeFileSync(
  path.join(raiz, "src/posts/fontes.css"),
  "/* GERADO por scripts/baixar-fontes-posts.mjs — não editar à mão. */\n\n" + regras.join("\n\n") + "\n"
);
console.log(`${regras.length} @font-face em src/posts/fontes.css`);
