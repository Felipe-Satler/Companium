import { useState } from 'react';
import { PlotChart, type PlotSpec } from '@/components/PlotChart';
import type { ConversationItem } from '@/chatbot/core/types';
import { safeHttpUrl } from '@/chatbot/core/url';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { FileText, BarChart3, X, Download } from 'lucide-react';

/**
 * Left side panel listing the plots + documents produced in the current
 * conversation. Plots open in the shared PlotModal (like in the chat);
 * documents download directly. Each item can be "detached" (hidden from the
 * panel only) with a confirmation.
 */
export function ConversationArtifacts({ items, onOpenPlot, onDetach, className = '' }: {
  items: ConversationItem[];
  onOpenPlot: (p: { id: string; spec: PlotSpec; title: string }) => void;
  onDetach: (key: string) => void;
  className?: string;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const ordered = [...items].reverse(); // newest first

  return (
    <aside className={`flex flex-col bg-transparent ${className}`}>
      {/* Cabeçalho da seção "Gerados" — mesmo estilo de rótulo da seção "Conversas",
          reforçando que é uma área SEPARADA (mídias/PDFs) e não parte da lista acima. */}
      <div className="flex items-center justify-between px-4 pb-1 pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Gerados nesta conversa
        </span>
        {ordered.length > 0 && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {ordered.length}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {ordered.length === 0 && (
          <p className="px-1 text-xs text-muted-foreground">
            Nada gerado ainda. Peça um gráfico ou um PDF ao assistente.
          </p>
        )}

        {ordered.map((it) => {
          // it.thumbnailUrl / it.source are backend/model output — only http(s) may
          // reach an <img src> or an <a href>. Narrow by kind so TS sees the field.
          const safeThumb = it.kind === 'plot' ? safeHttpUrl(it.thumbnailUrl) : null;
          const safeSource = it.kind === 'plot' ? null : safeHttpUrl(it.source);
          return (
          <div key={it.key} className="group relative overflow-hidden rounded-lg border border-border bg-card">
            <button
              type="button"
              aria-label="Remover deste painel"
              onClick={() => setPending(it.key)}
              className="absolute right-1.5 top-1.5 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md bg-background/80 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>

            {it.kind === 'plot' ? (
              <button
                type="button"
                onClick={() => onOpenPlot({ id: it.id, spec: it.spec as PlotSpec, title: it.title || 'Gráfico' })}
                className="block w-full text-left"
              >
                <div className="flex h-28 items-center justify-center overflow-hidden bg-muted/40">
                  {safeThumb
                    ? <img src={safeThumb} alt={it.title || 'Gráfico'} className="h-full w-full object-contain" />
                    : it.spec
                      ? <div className="pointer-events-none w-full"><PlotChart spec={it.spec as PlotSpec} height={112} /></div>
                      : <BarChart3 className="h-8 w-8 text-muted-foreground" />}
                </div>
                <div className="truncate px-2 py-1.5 text-xs">{it.title || 'Gráfico'}</div>
              </button>
            ) : (
              <a href={safeSource ?? undefined} download={it.filename} className="flex items-center gap-2 px-2 py-2 text-xs">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{it.filename}</span>
                <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </a>
            )}
          </div>
          );
        })}
      </div>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover deste painel?</AlertDialogTitle>
            <AlertDialogDescription>
              O item some da coluna lateral, mas continua na conversa e na Biblioteca.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (pending) onDetach(pending); setPending(null); }}>
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
