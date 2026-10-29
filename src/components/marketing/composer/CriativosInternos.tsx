import { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertCircle, CheckCircle2, Circle, Loader2, Search, VideoOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  MetaAdsAnuncioCard,
  MetaAdsAnuncioDetailDialog,
} from "@/components/clientes/meta-ads/MetaAdsAnuncioCard";
import { useMetaAdsCriativosData, type AnuncioCardData } from "@/hooks/useMetaAdsCriativosData";
import { useCriativos } from "@/hooks/useAdSpy";
import type { SpyCriativoResumo } from "@/lib/adSpyApi";
import {
  analisePorAnuncio,
  escolhivel,
  estadoDoInterno,
  filtrarInternos,
  ROTULO_ESTADO,
  type EstadoInterno,
} from "@/components/marketing/composer/criativoInterno";

const SELO: Record<EstadoInterno, { icone: typeof Circle; classe: string }> = {
  dissecado: { icone: CheckCircle2, classe: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  dissecando: { icone: Loader2, classe: "bg-primary/10 text-primary" },
  impossivel: { icone: AlertCircle, classe: "bg-destructive/10 text-destructive" },
  sem_video: { icone: VideoOff, classe: "bg-muted text-muted-foreground" },
  nao_dissecado: { icone: Circle, classe: "border border-dashed border-border text-muted-foreground" },
};

/** O selo de dissecação de um criativo interno. O motivo da impossibilidade fica no tooltip. */
export function SeloDissecacao({ estado, motivo }: { estado: EstadoInterno; motivo?: string | null }) {
  const { icone: Icone, classe } = SELO[estado];
  const selo = (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${classe}`}>
      <Icone className={`h-3 w-3 ${estado === "dissecando" ? "animate-spin" : ""}`} />
      {ROTULO_ESTADO[estado]}
    </span>
  );
  const dica =
    estado === "sem_video"
      ? "Este anúncio não tem vídeo — e sem vídeo não há dissecação."
      : estado === "impossivel"
        ? motivo || "A dissecação deste criativo não foi possível."
        : null;
  if (!dica) return selo;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{selo}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{dica}</TooltipContent>
    </Tooltip>
  );
}

type Props = {
  anuncios: AnuncioCardData[];
  carregando?: boolean;
  /** A análise de cada criativo, por `Ad_ID`. */
  analises: Map<string, SpyCriativoResumo>;
  de?: Date;
  ate?: Date;
  onPeriodo: (p: { from?: Date; to?: Date }) => void;
  /** O `Ad_ID` escolhido, ou null. Escolha ÚNICA. */
  escolhido: string | null;
  onEscolher: (a: AnuncioCardData | null) => void;
};

/**
 * Os criativos do PRÓPRIO cliente, com o mesmo card da aba Meta Ads da página Clientes — quem já
 * olha os anúncios do cliente ali reconhece cada um aqui. Todos aparecem, dissecados ou não, e o
 * selo diz qual é qual.
 *
 * O card abre o detalhe (como na aba Meta Ads); escolher para a composição é a caixa acima dele,
 * separada, para clicar no card nunca escolher sem querer.
 */
export function CriativosInternos({
  anuncios,
  carregando,
  analises,
  de,
  ate,
  onPeriodo,
  escolhido,
  onEscolher,
}: Props) {
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<AnuncioCardData | null>(null);
  const visiveis = useMemo(() => {
    const passou = filtrarInternos(anuncios, busca);
    // O escolhido não some por causa da busca.
    const marcado = anuncios.find((a) => a.adId === escolhido);
    return marcado && !passou.includes(marcado) ? [marcado, ...passou] : passou;
  }, [anuncios, busca, escolhido]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome"
            aria-label="Buscar criativo interno por nome"
            className="h-9 pl-8 text-xs"
          />
        </div>
        <DateRangePicker from={de} to={ate} onChange={onPeriodo} placeholder="Período" />
        {!carregando && (
          <span className="text-[11px] text-muted-foreground">
            {visiveis.length} criativo{visiveis.length === 1 ? "" : "s"}
            {visiveis.length !== anuncios.length && ` de ${anuncios.length}`}
          </span>
        )}
      </div>

      {carregando ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-80 rounded-xl" />
          ))}
        </div>
      ) : visiveis.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
          {busca.trim()
            ? "Nenhum criativo com essa busca."
            : "Nenhum criativo deste cliente no período. Amplie as datas."}
        </div>
      ) : (
        <div className="grid max-h-[40rem] items-start gap-3 overflow-y-auto overflow-x-hidden pr-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visiveis.map((a) => {
            const analise = analises.get(a.adId);
            const estado = estadoDoInterno(a, analise);
            const pode = escolhivel(estado) && Boolean(a.adId);
            const marcado = escolhido === a.adId;
            return (
              <div
                key={a.id}
                data-criativo-interno={a.adId}
                // `min-w-0` e o card a 100%: item de grid tem largura mínima igual à do conteúdo, e o
                // card (um <button>, que encolhe ao conteúdo) tem linhas longas de campanha e cinco
                // métricas lado a lado — sem isto ele transbordava por cima do card vizinho.
                className={`min-w-0 space-y-1.5 rounded-xl border-2 p-1.5 transition-colors [&>button]:w-full [&>button]:min-w-0 ${
                  marcado ? "border-primary" : "border-transparent"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                  <label
                    className={`flex items-center gap-1.5 text-[11px] font-medium ${
                      pode ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                    }`}
                  >
                    <Checkbox
                      checked={marcado}
                      disabled={!pode}
                      onCheckedChange={() => onEscolher(marcado ? null : a)}
                      aria-label={`Usar "${a.nome}" na composição`}
                    />
                    Usar na composição
                  </label>
                  <SeloDissecacao estado={estado} motivo={analise?.error} />
                </div>
                {/* `colunas={4}` é o card compacto da aba Meta Ads: métricas em 3 colunas em vez de 5,
                    que é o que cabe na largura de uma coluna do Composer. */}
                <MetaAdsAnuncioCard anuncio={a} hiddenMetrics={new Set()} colunas={4} onSelect={setAberto} />
              </div>
            );
          })}
        </div>
      )}

      <MetaAdsAnuncioDetailDialog anuncio={aberto} open={Boolean(aberto)} onOpenChange={(v) => !v && setAberto(null)} />
    </div>
  );
}

const ISO = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * Os criativos do cliente com os dados ligados: a mesma busca da aba Meta Ads (por cliente e
 * período) e as análises já feitas para eles.
 *
 * Mora num componente próprio, montado só quando a chave "Criativos Internos do Cliente" está
 * ligada: a tabela de criativos é pesada, e buscá-la para quem nunca liga a chave seria custo puro.
 * Abre nos últimos 30 dias (decisão do usuário, 26/10/2026 — eram 90); as datas vão além.
 */
export function CriativosInternosDoCliente({
  cliente,
  escolhido,
  onEscolher,
}: {
  cliente: string;
  escolhido: string | null;
  /** O anúncio escolhido (ou null) e o rótulo do período, que vai junto dos números dele. */
  onEscolher: (a: AnuncioCardData | null, rotuloPeriodo: string) => void;
}) {
  const [de, setDe] = useState<Date | undefined>(() => subDays(new Date(), 30));
  const [ate, setAte] = useState<Date | undefined>(() => new Date());
  const { anuncios, loading } = useMetaAdsCriativosData(cliente, de ? ISO(de) : undefined, ate ? ISO(ate) : undefined);
  const { criativos: analises } = useCriativos([], { origem: "cliente", cliente });
  const porAnuncio = useMemo(() => analisePorAnuncio(analises), [analises]);
  const rotulo =
    de && ate
      ? `de ${format(de, "d MMM yyyy", { locale: ptBR })} a ${format(ate, "d MMM yyyy", { locale: ptBR })}`
      : "no período";

  return (
    <CriativosInternos
      anuncios={anuncios}
      carregando={loading}
      analises={porAnuncio}
      de={de}
      ate={ate}
      onPeriodo={({ from, to }) => {
        setDe(from);
        setAte(to);
      }}
      escolhido={escolhido}
      onEscolher={(a) => onEscolher(a, rotulo)}
    />
  );
}
