import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext"
import { safeHttpUrl } from "@/chatbot/core/url";
import {
  fetchLibrary, renamePlot, renameArtifact, deletePlot, deleteArtifact,
  type LibraryResponse,
} from "@/chatbot/react/libraryApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { FileText, BarChart3, Pencil, Trash2, Download} from "lucide-react";
import { toast } from "sonner";
import { PlotChart, type PlotSpec } from "@/components/PlotChart";


type Item =
  | { type: "plot"; id: string; name: string; createdAt: string; thumbnailUrl: string | null; spec?: unknown; pdfUrl?: string | null }
  | { type: "artifact"; id: string; name: string; kind: string; createdAt: string; downloadUrl: string };

function toItems(data: LibraryResponse): Item[] {
    const plots: Item[] = data.plots.map((p) => ({
      type: "plot",
      id: p.id,
      name: p.name,
      createdAt: (p as { createdAt?: string }).createdAt ?? new Date(0).toISOString(),
      thumbnailUrl: p.thumbnailUrl,
      spec: p.spec,
      pdfUrl: p.pdfUrl,
    }));
    const artifacts: Item[] = data.artifacts.map((a) => ({ type: "artifact", id: a.id, name: a.name, kind: a.kind, createdAt: a.createdAt, downloadUrl: a.downloadUrl }));
    return [...plots, ...artifacts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// Group items by their creation month, preserving the incoming order (already
// newest -> oldest), so sections and the cards within them stay sorted.
type MonthGroup = { key: string; label: string; items: Item[] };
function groupByMonth(items: Item[]): MonthGroup[] {
    const groups: MonthGroup[] = [];
    const index = new Map<string, number>();
    for (const item of items) {
        const d = new Date(item.createdAt);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        if (!index.has(key)) {
            const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
            index.set(key, groups.length);
            groups.push({ key, label, items: [] });
        }
        groups[index.get(key)!].items.push(item);
    }
    return groups;
}

export default function Biblioteca() {
    const { session } = useAuth();
    const token = session?.access_token ?? "";
    const qc = useQueryClient();

    const { data, isLoading, error } = useQuery({
        queryKey: ["chatbot-library"],
        queryFn: () => fetchLibrary(token),
        enabled: !!token,
    });

    const items = useMemo(() => (data ? toItems(data) : []), [data]);
    const groups = useMemo(() => groupByMonth(items), [items]);

    const [viewPlot, setViewPlot] = useState<Item | null>(null);
    const [renaming, setRenaming] = useState<Item | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [deleting, setDeleting] = useState<Item | null>(null);
    const invalidate = () => qc.invalidateQueries({ queryKey: ["chatbot-library"] });

  const renameMut = useMutation({
    mutationFn: (item: Item) =>
      item.type === "plot"
        ? renamePlot(token, item.id, renameValue.trim())
        : renameArtifact(token, item.id, renameValue.trim()),
    onSuccess: () => { toast.success("Renomeado."); setRenaming(null); invalidate(); },
    onError: (e: Error) => toast.error(e.message || "Falha ao renomear."),
  });

  const deleteMut = useMutation({
    mutationFn: (item: Item) =>
      item.type === "plot" ? deletePlot(token, item.id) : deleteArtifact(token, item.id),
    onSuccess: () => { toast.success("Excluído."); setDeleting(null); invalidate(); },
    onError: (e: Error) => toast.error(e.message || "Falha ao excluir."),
  });

  const openItem = (item: Item) => {
    if (item.type === "plot") setViewPlot(item);
    else { const safe = safeHttpUrl(item.downloadUrl); if (safe) window.open(safe, "_blank", "noopener"); }
  };
  const startRename = (item: Item) => { setRenaming(item); setRenameValue(item.name); };

  return (
    <DashboardLayout>
      <div className="flex-1 p-6 space-y-6 overflow-auto">
        <h1 className="text-xl font-semibold">Biblioteca</h1>

        {isLoading && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-lg" />)}
          </div>
        )}
        {error && <p className="text-sm text-destructive">Não foi possível carregar a biblioteca.</p>}
        {!isLoading && !error && items.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum arquivo ainda. Peça um PDF ou um gráfico ao assistente.</p>
        )}

        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.key} className="space-y-4">
              {/* Month divider: label + horizontal rule spanning the section width */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-muted-foreground whitespace-nowrap capitalize">{group.label}</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {group.items.map((item) => (
                  <div key={`${item.type}-${item.id}`} className="rounded-lg border border-border bg-card overflow-hidden flex flex-col">
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className="flex items-center justify-center h-32 bg-muted/40 hover:bg-muted transition-colors"
                    >
                      {item.type === "plot" && item.thumbnailUrl
                        ? <img src={item.thumbnailUrl} alt={item.name} className="h-full w-full object-contain" />
                        : item.type === "plot"
                          ? <BarChart3 className="h-10 w-10 text-muted-foreground" />
                          : <FileText className="h-10 w-10 text-muted-foreground" />}
                    </button>
                    <div className="p-2 flex items-center gap-1">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate" title={item.name}>{item.name || "(sem nome)"}</p>
                        <p className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleDateString("pt-BR")}</p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startRename(item)} aria-label="Renomear">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleting(item)} aria-label="Excluir">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

            <Dialog open={!!viewPlot} onOpenChange={(o) => !o && setViewPlot(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{viewPlot?.name || "Gráfico"}</DialogTitle></DialogHeader>
          {viewPlot?.type === "plot" && (
            viewPlot.spec
              ? <PlotChart spec={viewPlot.spec as PlotSpec} />
              : viewPlot.thumbnailUrl
                ? <img src={viewPlot.thumbnailUrl} alt={viewPlot.name} className="w-full rounded-md" />
                : null
          )}
          {viewPlot?.type === "plot" && viewPlot.pdfUrl && (
            <DialogFooter>
              <Button asChild variant="outline" size="sm">
                <a href={viewPlot.pdfUrl} download>
                  <Download className="h-4 w-4 mr-2" /> Baixar PDF
                </a>
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Renomear</DialogTitle></DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && renameValue.trim()) renameMut.mutate(renaming!); }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)}>Cancelar</Button>
            <Button onClick={() => renameMut.mutate(renaming!)} disabled={!renameValue.trim() || renameMut.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{deleting?.name || "arquivo"}”?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && deleteMut.mutate(deleting)} disabled={deleteMut.isPending}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}