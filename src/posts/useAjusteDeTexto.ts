import { useLayoutEffect, type RefObject } from "react";

/**
 * O maior tamanho de fonte (entre `min` e `max`) em que o texto cabe na caixa — largura do elemento
 * e `alturaMax` —, achado por busca binária no DOM de verdade.
 *
 * `alturaMax: "pai"` mede a altura do elemento de cima: é o título que ocupa o espaço que SOBROU no
 * layout (com foto, o painel de texto é menor e o título tem de caber no que restou, não num número
 * fixo).
 *
 * É medir, e não estimar por número de caracteres: "Implante" e "Mmmmmmmm" têm o mesmo tamanho em
 * caracteres e larguras bem diferentes, e a quebra de linha é do navegador. Como o preview e o
 * render rodam no mesmo motor (Chrome) e com o mesmo arquivo de fonte, o tamanho achado é o mesmo
 * nos dois.
 *
 * Quando nem o `min` cabe, o elemento ganha `data-transborda="1"`: o render devolve isso como aviso
 * ("o título não coube"), em vez de entregar uma arte com texto cortado sem dizer nada.
 *
 * `deps` é o que muda o tamanho do texto: o próprio texto, a fonte, se ela terminou de carregar.
 */
export function useAjusteDeTexto(
  ref: RefObject<HTMLElement>,
  { min, max, alturaMax }: { min: number; max: number; alturaMax: number | "pai" },
  deps: unknown[]
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const limite = alturaMax === "pai" ? el.parentElement?.clientHeight ?? 0 : alturaMax;
    const cabe = (px: number) => {
      el.style.fontSize = `${px}px`;
      return el.scrollHeight <= limite + 1 && el.scrollWidth <= el.clientWidth + 1;
    };
    let lo = min;
    let hi = max;
    if (cabe(hi)) {
      el.removeAttribute("data-transborda");
      return;
    }
    if (!cabe(lo)) {
      el.setAttribute("data-transborda", "1");
      return;
    }
    // Invariante: `lo` cabe e `hi` não.
    while (hi - lo > 1) {
      const meio = Math.floor((lo + hi) / 2);
      if (cabe(meio)) lo = meio;
      else hi = meio;
    }
    cabe(lo);
    el.removeAttribute("data-transborda");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max, alturaMax, ...deps]);
}
