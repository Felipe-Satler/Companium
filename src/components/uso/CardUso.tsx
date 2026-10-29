import type { ReactNode } from "react";
import { Activity } from "lucide-react";

export function CardUso({ titulo, subtitulo, acao, children }: { titulo: string; subtitulo?: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="neu-card p-4">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
          {subtitulo && <p className="text-xs text-muted-foreground">{subtitulo}</p>}
        </div>
        {acao}
      </header>
      {children}
    </section>
  );
}

export function Vazio({ texto = "Nenhum uso registrado para este filtro." }: { texto?: string }) {
  return (
    <div className="neu-card flex flex-col items-center justify-center gap-2 p-10 text-center">
      <Activity className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{texto}</p>
    </div>
  );
}
