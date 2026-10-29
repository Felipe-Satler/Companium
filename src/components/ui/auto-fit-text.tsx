import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Mantém o conteúdo SEMPRE em uma única linha, reduzindo o font-size real quando o
 * texto não cabe na largura do container. Diferente de `transform: scale`, mexer no
 * font-size encolhe também a caixa de layout — então o valor não transborda nem fica
 * cortado pelo fundo. Usado nos KPIs de Ads, onde valores grandes (ex.: "Custo" com
 * "Todos os clientes") transbordavam.
 */
export function AutoFitText({ children, className }: { children: ReactNode; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [fontPx, setFontPx] = useState<number | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;
    const fit = () => {
      // Mede no tamanho base (definido pela classe) limpando o override antes.
      text.style.fontSize = "";
      const base = parseFloat(getComputedStyle(text).fontSize) || 16;
      const available = container.clientWidth;
      const natural = text.scrollWidth;
      if (available > 0 && natural > available) {
        // Largura do texto ∝ font-size; -1px de margem evita cortar o último dígito.
        const next = Math.max(8, (base * (available - 1)) / natural);
        text.style.fontSize = `${next}px`;
        setFontPx(next);
      } else {
        setFontPx(null);
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);
    return () => ro.disconnect();
    // Refaz a medição quando o valor muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children]);

  return (
    <div ref={containerRef} className="w-full overflow-hidden text-center">
      <span
        ref={textRef}
        className={`inline-block whitespace-nowrap ${className ?? ""}`}
        style={fontPx != null ? { fontSize: `${fontPx}px` } : undefined}
      >
        {children}
      </span>
    </div>
  );
}
