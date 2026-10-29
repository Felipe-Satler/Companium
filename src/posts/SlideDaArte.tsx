import { PROPORCOES } from "../../shared/post-templates";
import { SlideEditorial } from "./templates/Editorial";
import type { PropsDoSlide } from "./tipos";

/**
 * O slide no tamanho real do canvas, pelo template do post. É o MESMO componente na tela (dentro de
 * `PreviewDoSlide`, encolhido) e na página de render do worker (no tamanho real) — e é isso que faz o
 * preview ser a arte.
 */

const COMPONENTES: Record<string, (p: PropsDoSlide) => JSX.Element> = {
  editorial: SlideEditorial,
};

export function SlideDaArte(props: Omit<PropsDoSlide, "largura" | "altura">) {
  const Componente = COMPONENTES[props.post.template.id] ?? SlideEditorial;
  const { largura, altura } = PROPORCOES[props.post.proporcao] ?? PROPORCOES["4:5"];
  return <Componente {...props} largura={largura} altura={altura} />;
}

/**
 * O slide encolhido para caber em `largura` px de tela. Escala o canvas INTEIRO com `transform` — as
 * medidas de dentro continuam em px de 1080, então a quebra de linha e o ajuste de fonte são os
 * mesmos do arquivo final.
 */
export function PreviewDoSlide({ largura: larguraNaTela, ...props }: Omit<PropsDoSlide, "largura" | "altura"> & { largura: number }) {
  const { largura, altura } = PROPORCOES[props.post.proporcao] ?? PROPORCOES["4:5"];
  const escala = larguraNaTela / largura;
  return (
    <div style={{ width: larguraNaTela, height: altura * escala, overflow: "hidden", position: "relative" }}>
      <div style={{ width: largura, height: altura, transform: `scale(${escala})`, transformOrigin: "top left" }}>
        <SlideDaArte {...props} />
      </div>
    </div>
  );
}
