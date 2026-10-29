import { useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Facebook,
  FileAudio,
  Globe,
  Image as ImageIcon,
  Instagram,
  MessageCircle,
  Play,
  PauseCircle,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AbrirMenu, BaixarVideoButton, MinerarAnuncianteButton } from "@/components/marketing/mineracao/AdActions";
import { AdDetailDialog } from "@/components/marketing/mineracao/AdDetailDialog";
import { HeadlinePill, PerformanceLine, SourceBadge } from "@/components/marketing/mineracao/AdSourceBits";
import { dateLine, foundViaLabel, idLabel, sublabel } from "@/components/marketing/mineracao/adSourceText";
import { useSpyMedia } from "@/hooks/useAdSpy";
import { RespostaNoCard } from "@/components/marketing/mineracao/PerguntaGrid";
import { type OrigemCriativo, type SpyAd, type SpyResposta } from "@/lib/adSpyApi";

const PLATFORM_ICONS: Record<string, { icon: typeof Facebook; label: string }> = {
  FACEBOOK: { icon: Facebook, label: "Facebook" },
  INSTAGRAM: { icon: Instagram, label: "Instagram" },
  MESSENGER: { icon: MessageCircle, label: "Messenger" },
  AUDIENCE_NETWORK: { icon: Globe, label: "Audience Network" },
  THREADS: { icon: MessageCircle, label: "Threads" },
};

function initials(name: string | null) {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

type Props = {
  ad: SpyAd;
  selected: boolean;
  /** Sem `onToggle` o card é só leitura (Biblioteca). */
  onToggle?: (id: number) => void;
  selectDisabled?: boolean;
  /** Número com que a análise cita este anúncio (#n). Só aparece quando há análise. */
  citeIndex?: number;
  /** Sem `onMineAdvertiser` o botão "minerar este anunciante" não aparece. */
  onMineAdvertiser?: (ad: SpyAd) => void;
  mineDisabled?: boolean;
  /**
   * "Perguntar ao grid": `undefined` = não há pergunta respondida, o card não mostra nada;
   * `null` = há pergunta, mas esta peça ainda não foi lida.
   */
  resposta?: SpyResposta | null;
  /** De onde a peça veio, para o "Analisar Criativo" do detalhe. Sem ela, o botão não aparece. */
  origemCriativo?: OrigemCriativo;
  especialidadeCriativo?: string;
};

/**
 * Card no formato da Biblioteca de Anúncios da Meta (e da extensão Copycat): métricas de
 * veiculação em cima, o anúncio "como aparece" embaixo.
 *
 * No topo: marcar para a análise, o menu "Abrir" e baixar o vídeo — os dois últimos são os mesmos
 * componentes que o detalhe usa (AdActions), para não divergirem. O bloco do anúncio abre o
 * detalhe (AdDetailDialog), onde o texto aparece inteiro e o vídeo toca; no card ele é só
 * thumbnail com um selo de play, porque a grade precisa de altura previsível.
 */
export function AdCard({
  ad,
  selected,
  onToggle,
  selectDisabled,
  citeIndex,
  onMineAdvertiser,
  mineDisabled,
  resposta,
  origemCriativo,
  especialidadeCriativo,
}: Props) {
  const [openTranscript, setOpenTranscript] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const thumb = useSpyMedia(ad.id, "thumb", Boolean(ad.thumb_path));
  const avatar = useSpyMedia(ad.id, "avatar", Boolean(ad.avatar_path));

  const started = dateLine(ad);
  // Ícones de posicionamento só na Meta: no Instagram e no TikTok a plataforma é a própria fonte,
  // e o selo da fonte já diz.
  const platforms =
    ad.source === "meta"
      ? (ad.publisher_platform ?? []).map((p) => PLATFORM_ICONS[p]).filter(Boolean)
      : [];
  const hasTranscript = Boolean(ad.transcript && ad.transcript.trim());
  const via = foundViaLabel(ad.found_via);

  return (
    <article
      className={`flex flex-col overflow-hidden rounded-xl border-2 bg-card shadow-sm transition-colors ${
        selected ? "border-primary" : "border-border"
      }`}
    >
      <div className="space-y-3 p-3">
        {/* Ações + dias no ar */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {onToggle && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    aria-label={selected ? "Remover da análise" : "Selecionar para a análise"}
                    onClick={() => onToggle(ad.id)}
                    disabled={selectDisabled && !selected}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                    }`}
                  >
                    <Check className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {selected ? "Remover da análise" : "Selecionar para transcrever e analisar"}
                </TooltipContent>
              </Tooltip>
            )}
            <AbrirMenu ad={ad} />
            <BaixarVideoButton ad={ad} />
            <MinerarAnuncianteButton ad={ad} onMine={onMineAdvertiser} disabled={mineDisabled} />
            {typeof citeIndex === "number" && (
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-primary">
                #{citeIndex}
              </span>
            )}
          </div>

          <HeadlinePill ad={ad} />
        </div>

        {/* Fonte + status. A fonte aparece sempre: numa busca misturada é a primeira coisa a saber
            de uma peça, e numa busca só de Meta custa uma linha que já existia (a do status). */}
        <div className="flex flex-wrap items-center gap-1.5">
          <SourceBadge ad={ad} />
          {ad.is_active !== null && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                ad.is_active
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {ad.is_active ? <CheckCircle2 className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
              {ad.is_active ? "Ativo" : "Inativo"}
            </span>
          )}
          {via && <span className="text-[11px] text-muted-foreground">{via}</span>}
        </div>

        <dl className="space-y-1 text-xs text-muted-foreground">
          {ad.external_id && (
            <div>
              {idLabel(ad)}: <span className="tabular-nums text-foreground">{ad.external_id}</span>
            </div>
          )}
          {started && <div>{started}</div>}
          {platforms.length > 0 && (
            <div className="flex items-center gap-2">
              Plataformas
              {platforms.map(({ icon: Icon, label }) => (
                <Icon key={label} className="h-3.5 w-3.5 text-foreground" aria-label={label} />
              ))}
            </div>
          )}
        </dl>

        {/* O sinal de "isto está funcionando", no vocabulário da fonte: replicação na Meta,
            engajamento no orgânico, alcance no TikTok. */}
        <PerformanceLine ad={ad} />

        {resposta !== undefined && <RespostaNoCard resposta={resposta} ad={ad} />}
      </div>

      {/* O anúncio como aparece. O bloco inteiro abre o detalhe: na grade o texto vive cortado em
          quatro linhas (senão o grid fica serrilhado), e é o texto que interessa numa pesquisa de
          criativo. Ir direto para a Meta continua a um clique, no botão do topo. */}
      <button
        type="button"
        onClick={() => setDetailOpen(true)}
        aria-label={`Ver o anúncio completo de ${ad.page_name || "anunciante desconhecido"}`}
        className="mx-3 mb-3 flex flex-col overflow-hidden rounded-lg border border-border text-left transition-colors hover:border-primary/60"
      >
        <div className="flex items-center gap-2 p-2.5">
          {avatar ? (
            <img src={avatar} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
              {initials(ad.page_name)}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{ad.page_name || "(anunciante desconhecido)"}</p>
            <p className="truncate text-[11px] text-muted-foreground">{sublabel(ad)}</p>
          </div>
        </div>

        {/* O título é a manchete do anúncio, e vinha só no detalhe — ficava invisível em quem
            passa os olhos pela grade, que é como a grade é usada. */}
        {ad.title && (
          <p className="line-clamp-2 px-2.5 pb-1 text-xs font-semibold text-foreground">
            {ad.title}
          </p>
        )}

        {ad.ad_copy && (
          <p className="line-clamp-4 whitespace-pre-line px-2.5 pb-2 text-xs text-foreground/90">
            {ad.ad_copy}
          </p>
        )}

        <div className="relative flex aspect-[4/5] items-center justify-center overflow-hidden bg-muted">
          {thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <ImageIcon className="h-8 w-8 text-muted-foreground/60" />
          )}
          {ad.media_type === "video" && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-white/90 bg-black/40 text-white">
                <Play className="ml-1 h-6 w-6 fill-white" />
              </span>
            </span>
          )}
        </div>
        <span className="px-2.5 py-1.5 text-[11px] font-medium text-primary">
          {ad.source === "instagram"
            ? "Ver post completo"
            : ad.source === "tiktok_organic"
              ? "Ver vídeo completo"
            : ad.source === "youtube"
              ? "Ver short completo"
              : "Ver anúncio completo"}
        </span>
      </button>

      <AdDetailDialog
        ad={ad}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        selected={selected}
        onToggle={onToggle}
        selectDisabled={selectDisabled}
        onMineAdvertiser={onMineAdvertiser}
        mineDisabled={mineDisabled}
        origemCriativo={origemCriativo}
        especialidadeCriativo={especialidadeCriativo}
      />

      {hasTranscript && (
        <div className="border-t border-border px-3 py-2">
          <button
            type="button"
            onClick={() => setOpenTranscript((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            <FileAudio className="h-3 w-3" />
            {openTranscript ? "Ocultar transcrição" : "Ver transcrição"}
            <ChevronDown className={`h-3 w-3 transition-transform ${openTranscript ? "rotate-180" : ""}`} />
          </button>
          {openTranscript && (
            <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{ad.transcript}</p>
          )}
        </div>
      )}
    </article>
  );
}
