import { useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  FileAudio,
  Image as ImageIcon,
  PauseCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AbrirMenu, BaixarVideoButton, MinerarAnuncianteButton } from "@/components/marketing/mineracao/AdActions";
import { HeadlinePill, PerformanceLine, SourceBadge } from "@/components/marketing/mineracao/AdSourceBits";
import { dateLine, idLabel } from "@/components/marketing/mineracao/adSourceText";
import { useSpyMedia } from "@/hooks/useAdSpy";
import { AnalisarCriativoButton } from "@/components/marketing/mineracao/AnalisarCriativo";
import { isOrganicAd, PLATFORM_LABEL, type OrigemCriativo, type SpyAd } from "@/lib/adSpyApi";

type Props = {
  ad: SpyAd | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: boolean;
  onToggle?: (id: number) => void;
  selectDisabled?: boolean;
  onMineAdvertiser?: (ad: SpyAd) => void;
  mineDisabled?: boolean;
  /** De onde a peça veio. Sem ela, não há "Analisar Criativo". */
  origemCriativo?: OrigemCriativo;
  especialidadeCriativo?: string;
};

/**
 * O anúncio inteiro, sem corte.
 *
 * O card da grade tem altura fixa para o grid não ficar serrilhado, então o texto vive cortado em
 * quatro linhas — e é justamente o texto que interessa numa pesquisa de criativo. Aqui nada é
 * cortado: copy inteira, transcrição inteira, e o vídeo tocando.
 *
 * O vídeo vem do `media_url`, que é o link assinado da CDN da Meta — o mesmo que a Biblioteca usa.
 * Ele EXPIRA em algumas horas, e por isso todo o bloco tem fallback: se não tocar, mostra a
 * thumbnail (essa é rehospedada e não expira) com o link para a Biblioteca. Diferente da página de
 * Meta Ads dos Clientes, onde o mp4 vem da própria conta de anúncios e é durável.
 */
export function AdDetailDialog({
  ad,
  open,
  onOpenChange,
  selected,
  onToggle,
  selectDisabled,
  onMineAdvertiser,
  mineDisabled,
  origemCriativo,
  especialidadeCriativo,
}: Props) {
  const [videoFalhou, setVideoFalhou] = useState(false);
  const thumb = useSpyMedia(ad?.id ?? 0, "thumb", Boolean(open && ad?.thumb_path));
  const avatar = useSpyMedia(ad?.id ?? 0, "avatar", Boolean(open && ad?.avatar_path));

  // Trocar de anúncio sem fechar o diálogo tem de limpar a falha do anterior.
  useEffect(() => setVideoFalhou(false), [ad?.id]);

  if (!ad) return null;

  const started = dateLine(ad);
  const organico = isOrganicAd(ad);
  const podeTocar = ad.media_type === "video" && Boolean(ad.media_url) && !videoFalhou;

  // YouTube não expõe o arquivo do vídeo, mas o player embutido toca — e não expira, ao contrário
  // dos links de CDN das outras fontes. youtube-nocookie: não grava cookie de rastreio até o play.
  const youtubeId = ad.source === "youtube" && /^[A-Za-z0-9_-]{6,20}$/.test(ad.external_id ?? "") ? ad.external_id : null;

  const media = youtubeId ? (
    <iframe
      src={`https://www.youtube-nocookie.com/embed/${youtubeId}`}
      title={`Short de ${ad.page_name || "canal desconhecido"}`}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      className="h-full w-full bg-black"
    />
  ) : podeTocar ? (
    <video
      src={ad.media_url as string}
      poster={thumb ?? undefined}
      controls
      playsInline
      preload="metadata"
      onError={() => setVideoFalhou(true)}
      className="h-full w-full bg-black object-contain"
    />
  ) : thumb ? (
    <img src={thumb} alt="" className="h-full w-full object-contain" />
  ) : (
    <div className="flex h-full w-full items-center justify-center">
      <ImageIcon className="h-10 w-10 text-muted-foreground/60" />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6 text-base">
            {avatar ? (
              <img src={avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
            ) : null}
            <span className="truncate">{ad.page_name || "(anunciante desconhecido)"}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-2">
          {/* Mídia */}
          <div className="space-y-2">
            <div className="aspect-[4/5] overflow-hidden rounded-lg bg-black/70">{media}</div>
            {videoFalhou && (
              <p className="text-xs text-muted-foreground">
                O vídeo não está mais disponível por aqui — o link da CDN{" "}
                {ad.source === "meta" ? "da Meta" : `do ${PLATFORM_LABEL[ad.source] ?? ad.source}`} expira em
                algumas horas. Abra na origem, pelo menu "Abrir", para assistir.
              </p>
            )}
            {/* Os mesmos controles do card, e não botões largos: quem vê a miniatura e quem abre
                o detalhe procura a mesma coisa no mesmo formato. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <AbrirMenu ad={ad} />
              <BaixarVideoButton ad={ad} />
              <MinerarAnuncianteButton ad={ad} onMine={onMineAdvertiser} disabled={mineDisabled} />
              <AnalisarCriativoButton ad={ad} origem={origemCriativo} especialidadePadrao={especialidadeCriativo} />
            </div>
          </div>

          {/* Texto e dados */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <SourceBadge ad={ad} />
              <HeadlinePill ad={ad} />
              {ad.is_active !== null && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    ad.is_active
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {ad.is_active ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <PauseCircle className="h-3.5 w-3.5" />
                  )}
                  {ad.is_active ? "Ativo" : "Inativo"}
                </span>
              )}
            </div>

            <PerformanceLine ad={ad} />

            {ad.title && <h3 className="text-sm font-semibold">{ad.title}</h3>}

            {ad.ad_copy ? (
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {ad.source === "youtube"
                    ? "Descrição do short"
                    : ad.source === "tiktok_organic"
                      ? "Legenda do vídeo"
                      : organico
                        ? "Legenda do post"
                        : "Texto do anúncio"}
                </p>
                <p className="whitespace-pre-line text-sm leading-relaxed">{ad.ad_copy}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">(sem texto)</p>
            )}

            {ad.transcript && ad.transcript.trim() && (
              <div>
                <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <FileAudio className="h-3 w-3" />
                  Transcrição
                </p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {ad.transcript}
                </p>
              </div>
            )}

            <dl className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
              {ad.cta_text && <div>Botão: {ad.cta_text}</div>}
              {typeof ad.metrics?.pageLikes === "number" && (
                <div>
                  Página do anunciante: {ad.metrics.pageLikes.toLocaleString("pt-BR")} curtidas (tamanho, não
                  desempenho do anúncio)
                </div>
              )}
              {ad.link_url && <div className="truncate">Destino: {ad.link_url}</div>}
              {started && <div>{started}</div>}
              {ad.source === "meta" && ad.publisher_platform?.length ? (
                <div>Plataformas: {ad.publisher_platform.join(", ")}</div>
              ) : null}
              {ad.external_id && (
                <div>
                  {idLabel(ad)}: {ad.external_id}
                </div>
              )}
            </dl>

            {onToggle && (
              <Button
                variant={selected ? "outline" : "default"}
                size="sm"
                className="w-full"
                disabled={selectDisabled && !selected}
                onClick={() => onToggle(ad.id)}
              >
                <Check className="mr-1.5 h-4 w-4" />
                {selected ? "Remover da análise" : "Selecionar para a análise"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
