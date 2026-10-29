import * as React from "react";

/**
 * Rótulo de seção (eyebrow em maiúsculo + régua) — organiza visualmente os blocos das
 * telas de /clientes seguindo o modelo aprovado. Puramente visual e ADITIVO: não move
 * nem altera nenhum conteúdo/posição, só rotula o bloco que vem abaixo.
 */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground whitespace-nowrap">
        {children}
      </span>
      <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
    </div>
  );
}
