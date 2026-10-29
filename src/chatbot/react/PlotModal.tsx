import { PlotChart, type PlotSpec } from '@/components/PlotChart';

export function PlotModal({ plot, onClose, onDownload, busy }: {
    plot: { spec: PlotSpec; title: string } | null;
    onClose: () => void;
    onDownload: () => void;
    busy: boolean;
}) {
    if (!plot) return null;
    return (
        <div className="fixed inset-0 z-[2147483600] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-background text-foreground rounded-xl p-5 w-[min(900px,94vw)] max-h-[88vh] overflow-auto shadow-xl"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold truncate">{plot.title || 'Gráfico'}</h3>
          <button type="button" aria-label="Fechar" onClick={onClose}
                  className="text-xl leading-none px-2 text-muted-foreground hover:text-foreground">×</button>
        </div>
        <PlotChart spec={plot.spec} />
        <div className="flex justify-end mt-4">
          <button type="button" onClick={onDownload} disabled={busy}
                  className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
            {busy ? 'Gerando…' : '⬇ Baixar PDF'}
          </button>
        </div>
      </div>
    </div>
    );
}