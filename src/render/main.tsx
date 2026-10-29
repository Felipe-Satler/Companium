/**
 * Entrada da página de render (`render.html`).
 *
 * O worker (`apps/ad-spy-worker/post-render.js`) abre esta página num Chrome sem tela, no tamanho
 * do canvas, e chama `window.__renderizar({ post, indice, marca, imagens })`. A promessa só resolve
 * quando o slide está PRONTO para a foto: fontes carregadas, imagens decodificadas, ajuste de fonte
 * aplicado. Aí o worker fotografa `#palco`.
 *
 * Devolve o que não saiu como devia (texto que não coube nem na fonte mínima, fonte que não
 * carregou, imagem que falhou) — o worker grava como aviso da arte, em vez de entregar uma peça com
 * defeito sem dizer nada.
 *
 * As imagens chegam como data URL: esta página não tem token nenhum para pedir o bucket.
 */

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { PROPORCOES } from "../../shared/post-templates";
import { SlideDaArte } from "@/posts/SlideDaArte";
import { carregarFonte, fontesFaltando } from "@/posts/fontes";
import type { PropsDoSlide } from "@/posts/tipos";

type Pedido = Omit<PropsDoSlide, "largura" | "altura">;

const palco = document.getElementById("palco") as HTMLElement;
// Por CSSOM, e não num <style> do render.html: a CSP do site bloqueia estilo inline no HTML.
document.documentElement.style.margin = "0";
document.body.style.margin = "0";
document.body.style.background = "#ffffff";
let raiz: Root | null = null;

const quadro = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

async function renderizar(pedido: Pedido) {
  const { largura, altura } = PROPORCOES[pedido.post.proporcao] ?? PROPORCOES["4:5"];
  palco.style.width = `${largura}px`;
  palco.style.height = `${altura}px`;

  const familias = [pedido.marca.fontes.titulo, pedido.marca.fontes.texto];
  await Promise.all(familias.map((f) => carregarFonte(f)));

  raiz?.unmount();
  raiz = createRoot(palco);
  flushSync(() => raiz!.render(<SlideDaArte {...pedido} />));

  // O template espera as fontes de novo por conta própria e reajusta o texto num efeito: dois
  // quadros dão tempo a esse efeito e ao layout que ele dispara.
  await quadro();
  await quadro();

  const imagens = Array.from(palco.querySelectorAll("img"));
  const imagensComFalha: string[] = [];
  await Promise.all(
    imagens.map((img) =>
      img.decode().catch(() => {
        imagensComFalha.push(img.getAttribute("data-imagem") || "imagem");
      })
    )
  );
  await document.fonts.ready;
  await quadro();

  const avisos: { campo: string; tipo: string; detalhe: string }[] = [];
  palco.querySelectorAll('[data-transborda="1"]').forEach((el) => {
    const campo = el.getAttribute("data-campo") || "texto";
    avisos.push({ campo, tipo: "nao_coube", detalhe: "o texto não coube nem na fonte mínima — encurte" });
  });
  for (const f of fontesFaltando(familias)) {
    avisos.push({ campo: "fonte", tipo: "fonte_ausente", detalhe: `a fonte "${f}" não carregou; saiu a de reserva` });
  }
  for (const i of imagensComFalha) {
    avisos.push({ campo: i, tipo: "imagem_falhou", detalhe: "a imagem não carregou" });
  }
  return { avisos, largura, altura };
}

declare global {
  interface Window {
    __renderizar: typeof renderizar;
    __PRONTA__: boolean;
  }
}

window.__renderizar = renderizar;
window.__PRONTA__ = true;
