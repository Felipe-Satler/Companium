import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Library, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useBrandKit } from "@/hooks/useBrandKit";
import {
  CHAVE_ARTES_SALVAS,
  chaveDasArtesDoAnuncio,
  useArte,
  useArtesDoAnuncio,
  useToken,
} from "@/hooks/useArtes";
import { anunciosDe, type Composicao } from "@/lib/adComposerApi";
import { criarArte } from "@/lib/artesApi";
import { kitTemElemento } from "../../../../shared/brand-kit";
import { ArteEditor } from "./ArteEditor";
import { PreEtapaArte, type OpcoesDaPreEtapa } from "./PreEtapaArte";
import { FORMATOS_DE_ARTE } from "./anuncios";

/**
 * A arte de UM anúncio de uma composição salva: as artes que ele já tem (uma aba cada), a pré-etapa
 * de uma arte nova e, quando a arte fica pronta, o editor.
 *
 * As travas vêm antes de tudo, na ordem em que a pessoa resolveria: composição salva, anúncio de
 * imagem pronto, Brand kit com nome, CRM e UF. Sem o CRM no kit não há arte — ele vai em toda
 * passagem pelo agente.
 */
export function ArteDoAnuncio({
  composicao,
  indice,
  arteId,
  onArte,
}: {
  composicao: Composicao;
  indice: number;
  /** A arte aberta; null abre a mais recente do anúncio (ou a pré-etapa, se ele não tiver nenhuma). */
  arteId: string | null;
  onArte: (id: string, opcoes?: { substituir?: boolean }) => void;
}) {
  const token = useToken();
  const qc = useQueryClient();
  const { data: kitResposta, isLoading: kitCarregando } = useBrandKit(composicao.cliente);
  const kit = kitResposta?.kit ?? null;
  const artes = useArtesDoAnuncio(composicao.id, indice);
  const arte = useArte(arteId);
  const [novaArte, setNovaArte] = useState(false);
  const [enviando, setEnviando] = useState(false);

  // Sem arte escolhida, abre a mais recente deste anúncio.
  useEffect(() => {
    if (!arteId && artes.data?.length) onArte(artes.data[0].id, { substituir: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arteId, artes.data]);

  // A arte terminou de rodar: as listas (que mostram o estado de cada uma) precisam saber.
  const statusDaArte = arte.data?.status;
  useEffect(() => {
    if (statusDaArte && statusDaArte !== "running") {
      void qc.invalidateQueries({ queryKey: chaveDasArtesDoAnuncio(composicao.id, indice) });
      void qc.invalidateQueries({ queryKey: CHAVE_ARTES_SALVAS });
    }
  }, [statusDaArte, qc, composicao.id, indice]);

  const anuncio = anunciosDe(composicao)[indice];

  const gerar = async (opcoes: OpcoesDaPreEtapa) => {
    setEnviando(true);
    try {
      const { id } = await criarArte(token, { compositionId: composicao.id, indice, opcoes });
      setNovaArte(false);
      await qc.invalidateQueries({ queryKey: chaveDasArtesDoAnuncio(composicao.id, indice) });
      void qc.invalidateQueries({ queryKey: CHAVE_ARTES_SALVAS });
      onArte(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível gerar a arte.");
    } finally {
      setEnviando(false);
    }
  };

  if (kitCarregando || artes.isLoading) {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> carregando…
      </p>
    );
  }
  if (composicao.status !== "ok") {
    return <p className="text-sm text-muted-foreground">Só dá para criar arte de uma composição salva. Salve a revisão antes.</p>;
  }
  if (!anuncio || anuncio.status !== "ok" || !FORMATOS_DE_ARTE.includes(anuncio.formato ?? "")) {
    return <p className="text-sm text-muted-foreground">Só anúncios prontos de Feed do Instagram ou de Meta Ads viram arte estática.</p>;
  }
  if (!kit || !kitTemElemento(kit, "identificacao")) {
    return <AvisoSemCrm />;
  }

  const lista = artes.data ?? [];
  const mostrarPreEtapa = novaArte || (!arteId && !lista.length);
  return (
    <div className="space-y-6">
      {lista.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {lista.map((a, i) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setNovaArte(false);
                onArte(a.id);
              }}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
                a.id === arteId && !novaArte
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              Arte {lista.length - i} · {new Date(a.criado_em).toLocaleDateString("pt-BR")}
              {a.status === "running" ? " · gerando" : a.status === "error" ? " · falhou" : ""}
            </button>
          ))}
          <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setNovaArte(true)}>
            Nova arte
          </Button>
        </div>
      )}

      {mostrarPreEtapa ? (
        <PreEtapaArte kit={kit} cliente={composicao.cliente} formato={anuncio.formato!} enviando={enviando} onGerar={gerar} />
      ) : arte.isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : arte.data?.status === "running" ? (
        <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> o agente está dividindo o anúncio nas páginas da arte…
        </p>
      ) : arte.data?.status === "error" ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{arte.data.error}</p>
      ) : arte.data?.post ? (
        <div className="space-y-3">
          <ArteEditor key={arte.data.id} arte={arte.data} />
          <Link
            to={`/marketing/oficina/salvas?arte=${encodeURIComponent(arte.data.id)}`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <Library className="h-3.5 w-3.5" /> Ver nas Artes Salvas, com os mockups
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export function AvisoSemCrm() {
  return (
    <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      Cadastre nome, CRM e UF do médico no{" "}
      <Link to="/marketing/clientes" className="font-medium underline">
        Brand kit do cliente
      </Link>{" "}
      (Central de Clientes) antes de criar a arte.
    </p>
  );
}
