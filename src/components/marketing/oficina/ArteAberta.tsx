import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ExternalLink, Loader2, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useArte, useImagensDaArte } from "@/hooks/useArtes";
import { getFormato } from "../../../../shared/ad-formats";
import { ArteEditor } from "./ArteEditor";
import { MockupFacebook, MockupInstagram, MockupWhatsApp } from "./Mockups";

/**
 * Uma arte aberta nas Artes Salvas: como ela fica no Instagram, no Facebook e no WhatsApp, e a aba
 * Arquivo — o mesmo editor da Nova arte, com o ajuste de texto e o download.
 *
 * Abre no mockup do lugar onde a arte vai: pago abre no Instagram (onde o anúncio roda primeiro),
 * e uma arte marcada para circular fora do Instagram abre no WhatsApp.
 */
export function ArteAberta({
  id,
  onVoltar,
  onApagar,
}: {
  id: string;
  onVoltar: () => void;
  onApagar: (id: string) => Promise<void>;
}) {
  const { data: arte, isLoading, error } = useArte(id);
  const imagens = useImagensDaArte(arte ?? null);
  const [confirmando, setConfirmando] = useState(false);
  const [apagando, setApagando] = useState(false);

  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (error || !arte) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={onVoltar} className="-ml-2">
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Artes Salvas
        </Button>
        <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Arte não encontrada."}</p>
      </div>
    );
  }

  const formato = arte.formato_origem ? getFormato(arte.formato_origem) : null;
  const inicial = arte.opcoes?.circula_fora ? "whatsapp" : "instagram";
  const naOficina = arte.composition_id
    ? `/marketing/oficina?composicao=${encodeURIComponent(arte.composition_id)}&anuncio=${arte.anuncio_indice}&arte=${encodeURIComponent(arte.id)}`
    : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" onClick={onVoltar} className="-ml-2">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Artes Salvas
          </Button>
          <h2 className="text-lg font-semibold">{arte.post?.slides[0]?.titulo || "Arte"}</h2>
          <p className="text-xs text-muted-foreground">
            {arte.nome_exibicao || arte.cliente} · {formato?.label ?? arte.formato_origem} · anúncio {arte.anuncio_indice + 1} ·{" "}
            {arte.opcoes?.uso === "pago" ? "pago" : "orgânico"} · criada em{" "}
            {new Date(arte.criado_em).toLocaleDateString("pt-BR")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {arte.composition_id && (
            <Button asChild variant="outline" size="sm">
              <Link to={`/marketing/composer/salvas?composicao=${encodeURIComponent(arte.composition_id)}`}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Composição de origem
              </Link>
            </Button>
          )}
          {naOficina && (
            <Button asChild variant="outline" size="sm">
              <Link to={naOficina}>Outras artes deste anúncio</Link>
            </Button>
          )}
          {arte.canDelete && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmando(true)} className="text-destructive">
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Apagar
            </Button>
          )}
        </div>
      </div>

      {arte.desatualizada && (
        <p className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />O anúncio foi editado depois desta arte. Gere outra para acompanhar.
        </p>
      )}

      {arte.status === "running" ? (
        <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> o agente está dividindo o anúncio nas páginas da arte…
        </p>
      ) : arte.status === "error" || !arte.post ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {arte.error || "A arte falhou."}
        </p>
      ) : (
        <Tabs defaultValue={inicial}>
          <TabsList>
            <TabsTrigger value="instagram" className="text-xs">Instagram</TabsTrigger>
            <TabsTrigger value="facebook" className="text-xs">Facebook</TabsTrigger>
            <TabsTrigger value="whatsapp" className="text-xs">WhatsApp</TabsTrigger>
            <TabsTrigger value="arquivo" className="text-xs">Arquivo</TabsTrigger>
          </TabsList>
          <TabsContent value="instagram" className="pt-4">
            <MockupInstagram arte={arte} imagens={imagens} />
          </TabsContent>
          <TabsContent value="facebook" className="pt-4">
            <MockupFacebook arte={arte} imagens={imagens} />
          </TabsContent>
          <TabsContent value="whatsapp" className="pt-4">
            <MockupWhatsApp arte={arte} imagens={imagens} />
          </TabsContent>
          <TabsContent value="arquivo" className="pt-4">
            <ArteEditor key={arte.id} arte={arte} />
          </TabsContent>
        </Tabs>
      )}

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar esta arte?</AlertDialogTitle>
            <AlertDialogDescription>
              Ela sai das Artes Salvas e não dá para recuperar. A composição de origem não muda.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter</AlertDialogCancel>
            <AlertDialogAction
              disabled={apagando}
              onClick={async () => {
                setApagando(true);
                try {
                  await onApagar(arte.id);
                } finally {
                  setApagando(false);
                  setConfirmando(false);
                }
              }}
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
