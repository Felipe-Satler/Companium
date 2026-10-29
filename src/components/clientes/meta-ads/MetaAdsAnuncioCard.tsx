import { useState } from "react";
import type { ReactNode } from "react";
import {
  Play,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
  ChevronDown,
  ImageIcon,
  Target,
  Users,
  Sparkles,
  DollarSign,
  MessageCircle,
  MousePointerClick,
  Link as LinkIcon,
  Eye,
  Activity,
  ExternalLink,
  CalendarPlus,
  CalendarClock,
  Brain,
  ThumbsUp,
  Wrench,
  AlertTriangle,
  Loader2,
  PauseCircle,
  CircleOff,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { AnuncioCardData } from "@/hooks/useMetaAdsCriativosData";
// A regra de recorte agora é compartilhada com o carrossel do Relatório.
import { proxiedImg } from "@/lib/imagemProxy";
import { useAdAnalysis, type AdAnalysis } from "@/hooks/useAdAnalysis";
import type { MetricaOcultavel, ViewMode, Colunas } from "./MetaAdsOrganizarMenu";


// Player embutido do Facebook a partir do permalink do vídeo (reel/post do anúncio). O Meta
// bloqueia o mp4 direto (source) por permissão do app, então tocamos o anúncio inline por este
// plugin oficial — é exatamente o `src` que a Graph API devolve em embed_html. show_text=false
// = só o vídeo (sem legenda/comentários).
// IMPORTANTE: o `width` é OBRIGATÓRIO — sem ele o plugin não dimensiona o player e renderiza
// TELA PRETA (era o bug dos reels). A largura NÃO decide se toca: um reel que o FB não deixa
// tocar publicamente dá "vídeo indisponível" em qualquer width (comprovado curlando o plugin —
// o reel não-público volta a mesma página-stub em 540/576/1080). Mantemos 1080 (valor do
// embed_html oficial do Graph); o iframe é escalado por CSS pra caber no player.
function fbVideoEmbedSrc(permalink: string): string {
  return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(permalink)}&show_text=false&width=1080`;
}

function formatBRL(v: number): string {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function formatNum(v: number): string {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
function formatPct(v: number): string {
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}
function formatDateTime(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------- Preview (thumbnail real ou gradiente de fallback) ----------
function Preview({
  anuncio,
  aspect,
  extraClass = "",
  playable = false,
}: {
  anuncio: AnuncioCardData;
  aspect: string;
  extraClass?: string;
  // No detalhe (modal) tocamos o vídeo inline; nos cards da grade não (o card é um <button>,
  // então lá só mostramos a thumbnail + selo de play).
  playable?: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const isAtivo = anuncio.status === "ativo";
  const hasImg = !!anuncio.thumbnail && !imgError;
  // Toca inline quando permitido: preferimos o mp4 durável (Video_URL) se existir; senão
  // embutimos o player do Facebook a partir do permalink (o mp4/source é bloqueado por permissão
  // do app Meta — só o plugin toca o vídeo completo dentro do sistema).
  const canPlayMp4 = playable && !!anuncio.videoUrl;
  const canEmbed = playable && !anuncio.videoUrl && !!anuncio.videoPermalink;
  const canPlay = canPlayMp4 || canEmbed;
  // Selo de "play": marca que o criativo é vídeo — por Video_URL/Permalink (novos) ou pela
  // heurística antiga de extensão na mídia (retrocompat p/ linhas antes das colunas de vídeo).
  const isVideo =
    !!anuncio.videoUrl ||
    !!anuncio.videoPermalink ||
    (!!anuncio.media && /\.(mp4|mov|webm|m3u8)(\?|$)/i.test(anuncio.media));

  return (
    <div className={`relative w-full ${aspect} ${extraClass} overflow-hidden bg-black/60`}>
      {canPlayMp4 ? (
        <video
          src={anuncio.videoUrl as string}
          poster={anuncio.thumbnail ? proxiedImg(anuncio.thumbnail as string) : undefined}
          controls
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full bg-black object-contain"
        />
      ) : canEmbed ? (
        <iframe
          src={fbVideoEmbedSrc(anuncio.videoPermalink as string)}
          title={anuncio.nome}
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
          allowFullScreen
          scrolling="no"
          frameBorder={0}
          className="absolute inset-0 h-full w-full bg-black"
        />
      ) : hasImg ? (
        <img
          src={proxiedImg(anuncio.thumbnail as string)}
          alt={anuncio.nome}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-emerald-900/40 via-sky-900/30 to-violet-900/30">
          <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
        </div>
      )}

      <span className="absolute left-3 top-3 z-10 rounded-lg bg-emerald-500 px-2 py-0.5 text-xs font-bold text-white">
        #{anuncio.posicao}
      </span>
      <span
        className={`absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold ${
          isAtivo ? "bg-emerald-500/25 text-emerald-700 dark:text-emerald-300" : "bg-black/40 text-muted-foreground"
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${isAtivo ? "bg-emerald-400" : "bg-muted-foreground"}`} />
        {isAtivo ? "Ativo" : "Pausado"}
      </span>
      {isVideo && !canPlay && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white/80 bg-white/10 backdrop-blur-md">
            <Play className="h-3 w-3 translate-x-0.5 fill-white text-white" />
          </span>
        </div>
      )}
    </div>
  );
}

type CardProps = {
  anuncio: AnuncioCardData;
  hiddenMetrics: Set<MetricaOcultavel>;
  layout?: ViewMode;
  colunas?: Colunas;
  onSelect: (a: AnuncioCardData) => void;
};

const RESULTADO_KEYS: MetricaOcultavel[] = ["Investimento", "Resultados", "CPR"];
const METRICAS_KEYS: MetricaOcultavel[] = [
  "Alcance",
  "Frequência",
  "Impressões",
  "Hook",
  "Hold",
  "CPM",
  "CTR Criativo",
  "CPC Link",
  "Cliques no link",
];

export function MetaAdsAnuncioCard({ anuncio, hiddenMetrics, layout = "grid", colunas = 3, onSelect }: CardProps) {
  const [expanded, setExpanded] = useState({ resultado: true, metricas: true });
  const isLista = layout === "lista";
  const aspect = isLista ? "aspect-video sm:aspect-[3/2]" : "aspect-[4/5]";
  const m = anuncio.agg;
  const showResultado = RESULTADO_KEYS.some((k) => !hiddenMetrics.has(k));
  const showMetricas = METRICAS_KEYS.some((k) => !hiddenMetrics.has(k));

  return (
    <button
      type="button"
      onClick={() => onSelect(anuncio)}
      className={`neu-card overflow-hidden rounded-xl text-left transition hover:brightness-110 ${
        isLista ? "flex flex-col sm:flex-row" : "flex flex-col"
      }`}
    >
      <Preview anuncio={anuncio} aspect={aspect} extraClass={isLista ? "sm:w-64 sm:shrink-0" : ""} />

      <div className={isLista ? "flex flex-1 flex-col" : "contents"}>
        <div className="px-3 pb-2 pt-3">
          <div className="truncate text-base font-bold leading-tight text-foreground" title={anuncio.nome}>
            {anuncio.nome}
          </div>
          <div className="mt-1.5 space-y-1 text-xs text-muted-foreground/80">
            <div className="truncate" title={anuncio.conjunto}>
              <span className="text-muted-foreground">Conjunto:</span> {anuncio.conjunto}
            </div>
            <div className="truncate" title={anuncio.campanha}>
              <span className="text-muted-foreground">Campanha:</span> {anuncio.campanha}
            </div>
          </div>
        </div>

        {/* RESULTADO */}
        {showResultado && (
          <div className="px-3 pb-2">
            <MiniPanel
              title="RESULTADO"
              tint="emerald"
              icon={<TrendingUp className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />}
              expanded={expanded.resultado}
              onToggle={() => setExpanded((p) => ({ ...p, resultado: !p.resultado }))}
            >
              <div className="grid grid-cols-3 gap-1">
                {!hiddenMetrics.has("Investimento") && (
                  <MiniMetric label="Investimento" value={formatBRL(m.gasto)} valueClass="text-emerald-600 dark:text-emerald-400" />
                )}
                {!hiddenMetrics.has("Resultados") && <MiniMetric label="Resultado" value={formatNum(m.resultado)} />}
                {!hiddenMetrics.has("CPR") && (
                  <MiniMetric label="Custo / Result." value={m.custoPorResultado > 0 ? formatBRL(m.custoPorResultado) : "—"} valueClass="text-emerald-600 dark:text-emerald-400" />
                )}
              </div>
            </MiniPanel>
          </div>
        )}

        {/* MÉTRICAS */}
        {showMetricas && (
          <div className="px-3 pb-3">
            <MiniPanel
              title="MÉTRICAS"
              tint="sky"
              icon={<BarChart3 className="h-3.5 w-3.5 text-sky-500 dark:text-sky-400" />}
              expanded={expanded.metricas}
              onToggle={() => setExpanded((p) => ({ ...p, metricas: !p.metricas }))}
            >
              <div className={`grid gap-1 ${layout === "grid" && colunas === 4 ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-5"}`}>
                {!hiddenMetrics.has("Alcance") && <MiniMetric label="Alcance" value={formatNum(m.alcance)} />}
                {!hiddenMetrics.has("Frequência") && <MiniMetric label="Frequência" value={m.frequencia.toFixed(2)} />}
                {!hiddenMetrics.has("Impressões") && <MiniMetric label="Impressões" value={formatNum(m.impressoes)} />}
                {!hiddenMetrics.has("Hook") && <MiniMetric label="Hook" value={formatPct(m.hookRate)} />}
                {!hiddenMetrics.has("Hold") && <MiniMetric label="Hold" value={formatPct(m.holdRate)} />}
                {!hiddenMetrics.has("CPM") && <MiniMetric label="CPM" value={formatBRL(m.cpm)} />}
                {!hiddenMetrics.has("CTR Criativo") && <MiniMetric label="CTR" value={formatPct(m.ctr)} />}
                {!hiddenMetrics.has("CPC Link") && <MiniMetric label="CPC" value={formatBRL(m.cpc)} />}
                {!hiddenMetrics.has("Cliques no link") && <MiniMetric label="Cliques" value={formatNum(m.cliquesLink)} />}
              </div>
            </MiniPanel>
          </div>
        )}
      </div>
    </button>
  );
}

function MiniPanel({
  title,
  tint,
  icon,
  children,
  expanded,
  onToggle,
}: {
  title: string;
  tint: "emerald" | "sky" | "violet";
  icon: ReactNode;
  children: ReactNode;
  expanded: boolean;
  onToggle: () => void;
}) {
  const ring = {
    emerald: "ring-1 ring-inset ring-emerald-500/25",
    sky: "ring-1 ring-inset ring-sky-500/25",
    violet: "ring-1 ring-inset ring-violet-500/25",
  }[tint];

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle();
  };

  return (
    <div className={`rounded-lg bg-secondary/20 p-3 ${ring}`}>
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center justify-between gap-2 rounded-lg p-1 transition hover:bg-foreground/5"
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-secondary/40">{icon}</span>
          <h4 className="text-[10px] font-bold tracking-[0.14em] text-foreground/90">{title}</h4>
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-300 ${expanded ? "" : "-rotate-90"}`} />
      </button>
      <div className={`overflow-hidden transition-all duration-300 ease-in-out ${expanded ? "mt-2 max-h-[500px] opacity-100" : "max-h-0 opacity-0"}`}>
        {children}
      </div>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  valueClass = "",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  // min-h no rótulo mantém a linha dos valores alinhada mesmo quando um label quebra em 2 linhas.
  return (
    <div className="flex h-full flex-col items-center justify-start gap-1 py-1 text-center">
      <span className="flex min-h-[2rem] items-center text-xs leading-tight text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold tabular-nums leading-none ${valueClass}`}>{value}</span>
    </div>
  );
}

// ---------- Modal de detalhe do anúncio ----------
export function MetaAdsAnuncioDetailDialog({
  anuncio,
  open,
  onOpenChange,
}: {
  anuncio: AnuncioCardData | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  if (!anuncio) return null;
  const m = anuncio.agg;
  // Anúncio de vídeo (reel = 9:16 vertical) → player na proporção vertical p/ NÃO cortar o vídeo,
  // modal mais largo e coluna do criativo maior. O modal rola (overflow-y-auto) se ficar alto.
  const isVideoAd = !!(anuncio.videoUrl || anuncio.videoPermalink);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`max-h-[90vh] w-[95vw] overflow-y-auto ${isVideoAd ? "max-w-4xl" : "max-w-3xl"}`}>
        <DialogHeader>
          <DialogTitle className="truncate pr-6" title={anuncio.nome}>
            {anuncio.nome}
          </DialogTitle>
        </DialogHeader>

        {/* Abas: "Criativo & Métricas" (conteúdo de sempre) e "Análise IA" (leitura diária do
            desempenho, atualizada à meia-noite). Clicar troca de aba. defaultValue mantém a aba
            do criativo como padrão — nada muda pra quem só quer ver o anúncio. */}
        <Tabs defaultValue="criativo" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="criativo" className="gap-1.5">
              <BarChart3 className="h-4 w-4" />
              Criativo &amp; Métricas
            </TabsTrigger>
            <TabsTrigger value="analise" className="gap-1.5">
              <Brain className="h-4 w-4" />
              Análise IA
            </TabsTrigger>
          </TabsList>

          <TabsContent value="criativo">
            {/* Largura FIXA na coluna da mídia (não minmax(0,…)): o Preview usa w-full com filhos
                absolute → largura de conteúdo = 0. Com o mínimo 0, a coluna colapsava e o 1fr das
                métricas engolia o vídeo (ficava minúsculo). Fixar 380/300px mantém o vídeo do
                tamanho de antes; o lado das métricas encolhe via minmax(0,1fr). */}
            <div className={`grid gap-4 ${isVideoAd ? "md:grid-cols-[380px_minmax(0,1fr)]" : "md:grid-cols-[300px_minmax(0,1fr)]"}`}>
              {/* Coluna do criativo (só a mídia) */}
              <div className="space-y-3">
                <Preview anuncio={anuncio} aspect={isVideoAd ? "aspect-[9/16]" : "aspect-[4/5] max-h-[400px]"} extraClass="rounded-lg" playable />
                {/* Fallback: vídeo existe mas sem mp4 tocável (permissão ainda bloqueada ou
                    arquivo grande demais p/ re-hospedar) → abre o vídeo no Facebook. */}
                {!anuncio.videoUrl && anuncio.videoPermalink && (
                  <a
                    href={anuncio.videoPermalink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-secondary/30 px-3 py-1.5 text-xs font-medium text-sky-600 transition hover:bg-secondary/50 dark:text-sky-400"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Assistir no Facebook
                  </a>
                )}
              </div>

              {/* Coluna das métricas + infos (campanha/conjunto/headline/datas embaixo, p/ manter
                  tudo mais junto). Métricas: MESMAS de antes, unidas numa lista na ORDEM da tabela. */}
              <div className="space-y-3">
                <DetailPanel title="MÉTRICAS" icon={<BarChart3 className="h-5 w-5 text-sky-500 dark:text-sky-400" />}>
                  <DetailMetric label="Investimento" value={formatBRL(m.gasto)} valueClass="text-emerald-600 dark:text-emerald-400" icon={<DollarSign className="h-3.5 w-3.5" />} />
                  <DetailMetric label="Resultado" value={formatNum(m.resultado)} icon={<MessageCircle className="h-3.5 w-3.5" />} />
                  <DetailMetric label="Custo / Result." value={m.custoPorResultado > 0 ? formatBRL(m.custoPorResultado) : "—"} valueClass="text-emerald-600 dark:text-emerald-400" />
                  <DetailMetric label="Alcance" value={formatNum(m.alcance)} icon={<Users className="h-3.5 w-3.5" />} />
                  <DetailMetric label="Frequência" value={m.frequencia.toFixed(2)} icon={<Activity className="h-3.5 w-3.5" />} />
                  <DetailMetric label="Impressões" value={formatNum(m.impressoes)} icon={<Eye className="h-3.5 w-3.5" />} />
                  <DetailMetric label="Hook Rate (3s)" value={formatPct(m.hookRate)} icon={<Sparkles className="h-3.5 w-3.5" />} />
                  <DetailMetric label="Hold Rate (95%)" value={formatPct(m.holdRate)} icon={<Activity className="h-3.5 w-3.5" />} />
                  <DetailMetric label="CPM" value={formatBRL(m.cpm)} icon={<DollarSign className="h-3.5 w-3.5" />} />
                  <DetailMetric label="CTR (Link)" value={formatPct(m.ctr)} icon={<MousePointerClick className="h-3.5 w-3.5" />} />
                  <DetailMetric label="CPC (Link)" value={formatBRL(m.cpc)} icon={<MousePointerClick className="h-3.5 w-3.5" />} />
                  <DetailMetric label="Cliques (link)" value={formatNum(m.cliquesLink)} icon={<LinkIcon className="h-3.5 w-3.5" />} />
                </DetailPanel>
                <div className="space-y-2">
                  <InfoRow icon={<Target className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />} label="Campanha" value={anuncio.campanha} />
                  <InfoRow icon={<Users className="h-4 w-4 text-sky-500 dark:text-sky-400" />} label="Conjunto" value={anuncio.conjunto} />
                  {anuncio.headline && <InfoRow icon={<MessageCircle className="h-4 w-4 text-violet-500 dark:text-violet-400" />} label="Headline" value={anuncio.headline} />}
                  <InfoRow icon={<CalendarPlus className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />} label="Criação" value={formatDateTime(m.criadoEm)} />
                  <InfoRow icon={<CalendarClock className="h-4 w-4 text-amber-500 dark:text-amber-400" />} label="Última edição" value={formatDateTime(m.editadoEm)} />
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="analise">
            {/* Recebe o anúncio inteiro: a IA só analisa ATIVOS com gasto; pausado/inativo/sem
                gasto mostra um alerta explicando o porquê (sem consultar a análise). */}
            <AnaliseIATab anuncio={anuncio} open={open} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-secondary/20 px-3 py-2">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary/40">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="truncate text-xs font-semibold" title={value}>
          {value}
        </div>
      </div>
    </div>
  );
}

function DetailPanel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg bg-secondary/20 p-4">
      <div className="mb-3 flex items-center gap-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-secondary/40">{icon}</span>
        <h2 className="text-sm font-semibold tracking-[0.14em] text-foreground/90">{title}</h2>
      </div>
      {/* auto-fill: as métricas quebram por conta própria conforme a largura disponível (responsivo). */}
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(72px,1fr))]">{children}</div>
    </section>
  );
}

function DetailMetric({ label, value, valueClass = "", icon }: { label: string; value: string; valueClass?: string; icon?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-start gap-1 py-1 text-center">
      <span className="flex min-h-[2.2em] items-center text-[10px] leading-tight text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold tabular-nums leading-none ${valueClass}`}>{value}</span>
      {icon && <span className="mt-0.5 text-muted-foreground/70">{icon}</span>}
    </div>
  );
}

// ---------- Aba "Análise IA" (leitura diária do desempenho do anúncio) ----------
// Data-only (dia_analisado vem como "YYYY-MM-DD"; evita o -1 dia do fuso ao dar new Date()).
function formatDia(v: string | null): string {
  if (!v) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return "—";
}

const TENDENCIA_META: Record<
  NonNullable<AdAnalysis["tendencia"]>,
  { label: string; cls: string; icon: ReactNode }
> = {
  melhorando: {
    label: "Melhorando",
    cls: "bg-emerald-500/15 text-emerald-600 ring-1 ring-inset ring-emerald-500/30 dark:text-emerald-400",
    icon: <TrendingUp className="h-3.5 w-3.5" />,
  },
  estavel: {
    label: "Estável",
    cls: "bg-secondary/40 text-muted-foreground ring-1 ring-inset ring-border",
    icon: <Minus className="h-3.5 w-3.5" />,
  },
  piorando: {
    label: "Piorando",
    cls: "bg-red-500/15 text-red-600 ring-1 ring-inset ring-red-500/30 dark:text-red-400",
    icon: <TrendingDown className="h-3.5 w-3.5" />,
  },
};

function AnaliseBlock({
  title,
  items,
  tint,
  icon,
}: {
  title: string;
  items: string[];
  tint: "emerald" | "sky" | "red";
  icon: ReactNode;
}) {
  if (items.length === 0) return null;
  const ring = {
    emerald: "ring-emerald-500/25",
    sky: "ring-sky-500/25",
    red: "ring-red-500/30",
  }[tint];
  const dot = {
    emerald: "bg-emerald-500",
    sky: "bg-sky-500",
    red: "bg-red-500",
  }[tint];
  return (
    <section className={`rounded-lg bg-secondary/20 p-4 ring-1 ring-inset ${ring}`}>
      <div className="mb-2.5 flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-secondary/40">{icon}</span>
        <h3 className="text-xs font-bold tracking-[0.12em] text-foreground/90">{title}</h3>
      </div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-sm leading-snug text-foreground/90">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Alerta contextual (motivo de não haver análise). Mesmo visual de moldura pros vários casos.
function AnaliseAlerta({
  icon,
  titulo,
  texto,
  tint,
}: {
  icon: ReactNode;
  titulo: string;
  texto: string;
  tint: "amber" | "muted" | "violet";
}) {
  const ring = {
    amber: "ring-amber-500/25",
    muted: "ring-border",
    violet: "ring-violet-500/20",
  }[tint];
  const bubble = {
    amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    muted: "bg-secondary/40 text-muted-foreground",
    violet: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  }[tint];
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
      <span className={`inline-flex h-12 w-12 items-center justify-center rounded-full ${bubble}`}>{icon}</span>
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-semibold text-foreground/90">{titulo}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{texto}</p>
      </div>
    </div>
  );
}

function AnaliseIATab({ anuncio, open }: { anuncio: AnuncioCardData; open: boolean }) {
  const isAtivo = anuncio.status === "ativo";
  const temGasto = anuncio.agg.gasto > 0;
  // A IA só analisa ATIVOS com gasto. Fora disso, mostramos um alerta com o motivo e NEM
  // consultamos a tabela (enabled=false) — assim um anúncio que pausou não exibe análise velha.
  const elegivel = isAtivo && temGasto;
  const { loading, error, data } = useAdAnalysis(anuncio.adId, open && elegivel);

  // --- Casos NÃO elegíveis: alerta explicando o porquê ---
  if (!isAtivo) {
    return (
      <AnaliseAlerta
        tint="amber"
        icon={<PauseCircle className="h-6 w-6" />}
        titulo="Anúncio pausado ou inativo"
        texto="A análise da IA é gerada apenas para anúncios ativos. Reative este anúncio para que ele volte a receber a análise diária de desempenho."
      />
    );
  }
  if (!temGasto) {
    return (
      <AnaliseAlerta
        tint="muted"
        icon={<CircleOff className="h-6 w-6" />}
        titulo="Sem investimento no período"
        texto="Este anúncio está ativo, mas não teve gasto no período selecionado — não há dados de veiculação para a IA analisar. Ajuste o período ou aguarde o anúncio voltar a investir."
      />
    );
  }

  // --- Elegível: carrega/mostra a análise ---
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando análise…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-500/70" />
        <p className="text-sm text-muted-foreground">Não foi possível carregar a análise agora.</p>
      </div>
    );
  }

  // Elegível (ativo com gasto) mas ainda sem linha: o robô ainda não rodou pra este Ad_ID
  // (anúncio novo) — será gerada no próximo ciclo da meia-noite.
  if (!data) {
    return (
      <AnaliseAlerta
        tint="violet"
        icon={<Brain className="h-6 w-6" />}
        titulo="Análise ainda não gerada"
        texto="Este anúncio ativo entrou recentemente. A análise de desempenho é gerada automaticamente pela IA todos os dias à meia-noite e aparece aqui no próximo ciclo."
      />
    );
  }

  const tend = data.tendencia ? TENDENCIA_META[data.tendencia] : null;
  const nothing =
    data.pontosPositivos.length === 0 &&
    data.pontosMelhorar.length === 0 &&
    data.pontosAjustar.length === 0;

  return (
    <div className="space-y-3">
      {/* Cabeçalho: tendência + data da análise */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {tend ? (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tend.cls}`}>
            {tend.icon}
            {tend.label}
          </span>
        ) : (
          <span />
        )}
        <span className="text-[11px] text-muted-foreground">
          Atualizada em {formatDia(data.diaAnalisado)}
          {data.modelo ? ` · ${data.modelo}` : ""}
        </span>
      </div>

      {/* Resumo geral */}
      {data.resumo && (
        <div className="rounded-lg bg-gradient-to-br from-violet-500/10 to-sky-500/10 p-4 ring-1 ring-inset ring-violet-500/20">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400">
            <Sparkles className="h-3.5 w-3.5" />
            Resumo
          </div>
          <p className="text-sm font-medium leading-snug text-foreground">{data.resumo}</p>
        </div>
      )}

      <AnaliseBlock
        title="PONTOS POSITIVOS"
        items={data.pontosPositivos}
        tint="emerald"
        icon={<ThumbsUp className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />}
      />
      <AnaliseBlock
        title="A MELHORAR"
        items={data.pontosMelhorar}
        tint="sky"
        icon={<Wrench className="h-4 w-4 text-sky-500 dark:text-sky-400" />}
      />
      <AnaliseBlock
        title="AJUSTAR AGORA (URGENTE)"
        items={data.pontosAjustar}
        tint="red"
        icon={<AlertTriangle className="h-4 w-4 text-red-500 dark:text-red-400" />}
      />

      {nothing && !data.resumo && (
        <p className="py-8 text-center text-sm text-muted-foreground">Sem apontamentos nesta análise.</p>
      )}
    </div>
  );
}
