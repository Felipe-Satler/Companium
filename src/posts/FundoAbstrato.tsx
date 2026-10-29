import { useId, type CSSProperties } from "react";
import { desenharFundo, type FundoDoPost } from "../../shared/fundos";

/**
 * O fundo abstrato de um slide, em SVG, atrás do conteúdo.
 *
 * Fica com `z-index: -1` dentro do slide, que é um contexto de empilhamento (`isolation: isolate`):
 * pinta por cima da cor de fundo do slide e por baixo de todo o resto (foto, texto, logo), sem que o
 * template precise posicionar cada filho.
 *
 * Os ids dos degradês levam o `useId`: a grade de Artes Salvas desenha dezenas de slides na mesma
 * página, e `url(#g0)` repetido faria um card pintar com o degradê de outro.
 */
export function FundoAbstrato({
  fundo,
  base,
  acento,
  largura,
  altura,
  indice,
}: {
  fundo: FundoDoPost | null | undefined;
  base: string;
  acento: string;
  largura: number;
  altura: number;
  indice: number;
}) {
  const prefixo = useId().replace(/:/g, "");
  const desenho = desenharFundo(fundo, { base, acento, largura, altura, indice });
  if (!desenho) return null;
  const id = (g: string) => `${prefixo}-${g}`;
  const preencher = (cor: string) => (cor.startsWith("url(#") ? `url(#${id(cor.slice(5, -1))})` : cor);
  const estilo: CSSProperties = { position: "absolute", inset: 0, zIndex: -1, pointerEvents: "none" };

  return (
    <svg data-fundo={fundo?.estilo} width={largura} height={altura} viewBox={`0 0 ${largura} ${altura}`} style={estilo} aria-hidden>
      <defs>
        {desenho.gradientes.map((g) =>
          g.tipo === "linear" ? (
            <linearGradient key={g.id} id={id(g.id)} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
              {g.paradas.map((p) => (
                <stop key={p.offset} offset={p.offset} stopColor={p.cor} stopOpacity={p.opacidade ?? 1} />
              ))}
            </linearGradient>
          ) : (
            <radialGradient key={g.id} id={id(g.id)}>
              {g.paradas.map((p) => (
                <stop key={p.offset} offset={p.offset} stopColor={p.cor} stopOpacity={p.opacidade ?? 1} />
              ))}
            </radialGradient>
          )
        )}
        {desenho.granulado && (
          <filter id={id("grao")} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        )}
      </defs>
      {desenho.formas.map((f, i) => {
        const comum = { fill: preencher(f.cor), opacity: f.opacidade };
        if (f.tipo === "rect") return <rect key={i} x={f.x} y={f.y} width={f.w} height={f.h} {...comum} />;
        if (f.tipo === "circle") return <circle key={i} cx={f.cx} cy={f.cy} r={f.r} {...comum} />;
        return <path key={i} d={f.d} {...comum} />;
      })}
      {desenho.granulado && <rect width={largura} height={altura} filter={`url(#${id("grao")})`} opacity={0.07} />}
    </svg>
  );
}
