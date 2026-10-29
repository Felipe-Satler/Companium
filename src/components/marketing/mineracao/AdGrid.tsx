import { useMemo, useState } from "react";
import { Info, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AdCard } from "@/components/marketing/mineracao/AdCard";
import { PerguntaGrid } from "@/components/marketing/mineracao/PerguntaGrid";
import { ordenarPorResposta, respostaDe, temRespostas } from "@/components/marketing/mineracao/perguntaGrid";
import { PLATFORM_LABEL, type SpyAd, type SpyRun, type SpySettings } from "@/lib/adSpyApi";

type Props = {
  run: SpyRun;
  ads: SpyAd[];
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  onClearSelection: () => void;
  onLoadMore: () => void;
  isLoadingMore: boolean;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  maxSelected: number;
  /** adId -> número com que a análise o cita (#n). Só quando há análise concluída. */
  citeIndex?: Map<number, number>;
  /** Começa uma busca só com os anúncios do anunciante desta peça. */
  onMineAdvertiser?: (ad: SpyAd) => void;
  /** "Perguntar ao grid". Sem `onAsk` a barra da pergunta não aparece. */
  onAsk?: (pergunta: string) => void;
  isAsking?: boolean;
  onClearQuestion?: () => void;
  onSelectMatching?: (ids: number[]) => void;
};

/**
 * Os filtros de qualidade que a busca está de fato usando, em português.
 *
 * O de replicação aparece mesmo desligado: é o que mais gera dúvida ("pedi 6 e vieram de 1"), e
 * ver "sem filtro de replicação" escrito responde sozinho se o valor chegou ao worker.
 */
function filtrosAtivos(
  settings: Partial<SpySettings> | null | undefined,
  sources: string[] = ["meta"],
): string[] {
  // Run antiga pode não ter todas as chaves: o default é sempre "sem esse filtro".
  const s = settings ?? {};
  // "Instagram › Anúncios" é a Biblioteca da Meta filtrada: os filtros de anúncio Meta valem nela.
  const temMeta = ["meta", "instagram_ads", "meta_advertiser"].some((f) => sources.includes(f));
  const temAnuncio = temMeta || sources.includes("tiktok") || sources.some((f) => f.startsWith("google"));
  // Fontes orgânicas: as de visualização como prova.
  const temOrganico = sources.some(
    (f) =>
      (f.startsWith("instagram") && f !== "instagram_ads") ||
      f.startsWith("youtube") ||
      (f.startsWith("tiktok") && f !== "tiktok"),
  );
  const out: string[] = [];
  // Cada filtro só vale para a fonte que tem o dado (ver makeQualityGate no worker), e o chip diz
  // isso quando a busca mistura fontes — senão "5+ anúncios com o criativo" parece valer para reel.
  const so = (rotulo: string) => (sources.length > 1 ? ` (${rotulo})` : "");
  if (temAnuncio && (s.minDaysRunning ?? 0) > 0) out.push(`no ar há ${s.minDaysRunning}+ dias${so("anúncios")}`);
  if (temMeta) {
    out.push(
      (s.minCollationCount ?? 0) > 1
        ? `${s.minCollationCount}+ anúncios com o criativo${so("Meta")}`
        : "sem filtro de replicação",
    );
  }
  if (temOrganico && (s.minViews ?? 0) > 0) {
    out.push(`${s.minViews!.toLocaleString("pt-BR")}+ visualizações${so("orgânico")}`);
  }
  if (temOrganico && (s.minEngagementPct ?? 0) > 0) {
    out.push(`${s.minEngagementPct!.toLocaleString("pt-BR")}%+ de engajamento${so("orgânico")}`);
  }
  if (sources.some((f) => f.startsWith("instagram") && f !== "instagram_ads") && (s.minViewsPerFollower ?? 0) > 0) {
    out.push(`visualizações ≥ ${s.minViewsPerFollower!.toLocaleString("pt-BR")}× os seguidores${so("Instagram")}`);
  }
  if (sources.includes("tiktok") && (s.minTikTokAudience ?? 0) > 0) {
    out.push(`alcance ≥ ${s.minTikTokAudience!.toLocaleString("pt-BR")}${so("TikTok")}`);
  }
  if ((s.maxPerAdvertiser ?? 0) > 0) out.push(`máx. ${s.maxPerAdvertiser} por anunciante`);
  if ((s.minCopyChars ?? 0) > 0) out.push(`texto com ${s.minCopyChars}+ caracteres`);
  return out;
}

/**
 * Grupo do filtro por fonte. Anúncio Meta achado pela trilha "Instagram › Anúncios" é agrupado à
 * parte, com o mesmo nome que o selo do card mostra.
 */
const grupo = (ad: SpyAd) => (ad.source === "meta" && ad.found_via === "instagram_ads" ? "instagram_ads" : ad.source);
const ROTULO_GRUPO: Record<string, string> = { ...PLATFORM_LABEL, instagram_ads: "Instagram Ads" };

/**
 * Grid de anúncios em blocos.
 *
 * Buscar mais é SEMPRE um clique, nunca a rolagem. Já foi automático, com um sentinela no fim do
 * grid, e isso torna possível gastar crédito sem querer: rolar para rever os anúncios que já
 * vieram disparava a busca seguinte. Cada busca custa até (N/4)*10 créditos, então continuar tem
 * de ser decisão de quem clica.
 */
export function AdGrid({
  run,
  ads,
  selectedIds,
  onToggle,
  onClearSelection,
  onLoadMore,
  isLoadingMore,
  onAnalyze,
  isAnalyzing,
  maxSelected,
  citeIndex,
  onMineAdvertiser,
  onAsk,
  isAsking = false,
  onClearQuestion,
  onSelectMatching,
}: Props) {
  // Busca "minerar este anunciante": todas as peças são da mesma página. O cabeçalho dela mora na
  // página (AnuncianteBanner), no lugar do formulário; aqui só importa não oferecer a mesma busca.
  const anunciante = run.sources.includes("meta_advertiser") ? run.settings?.advertiser ?? null : null;
  const searching = run.status === "searching";
  const analyzing = run.status === "running";
  const { exhausted, note, creditsUsed, found, rejected, target, creditBudget } = run.search;

  const count = selectedIds.size;
  const atCap = count >= maxSelected;

  // Filtro por fonte: só aparece quando a busca trouxe mais de uma. Filtra a VISÃO, não a seleção —
  // uma peça marcada continua marcada (e contando) quando some do filtro.
  const [fonte, setFonte] = useState<string | null>(null);
  const porFonte = useMemo(() => {
    const m = new Map<string, number>();
    for (const ad of ads) m.set(grupo(ad), (m.get(grupo(ad)) ?? 0) + 1);
    return m;
  }, [ads]);
  const misturada = porFonte.size > 1;
  // Com pergunta respondida, o grid sai na ordem dela (e mantém a da busca dentro de cada grupo).
  const question = run.question;
  const respondido = temRespostas(question);
  const ordenados = useMemo(() => ordenarPorResposta(ads, question), [ads, question]);
  const visiveis = misturada && fonte ? ordenados.filter((a) => grupo(a) === fonte) : ordenados;

  if (!ads.length && searching) {
    return (
      <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[520px] rounded-xl" />
        ))}
      </div>
    );
  }

  // A barra flutuante é `fixed` e fica centralizada embaixo, exatamente onde vive o rodapé do grid
  // ("Buscar mais anúncios"). Enquanto ela estiver na tela, o conteúdo reserva a altura dela —
  // senão ela cobre justamente o botão que a pessoa precisa clicar para continuar a busca.
  const barraVisivel = count > 0 && !analyzing;

  return (
    <div className={`space-y-4 ${barraVisivel ? "pb-24" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {misturada
            ? `${ads.length} peça${ads.length === 1 ? "" : "s"} encontrada${ads.length === 1 ? "" : "s"}`
            : `${ads.length} anúncio${ads.length === 1 ? "" : "s"} encontrado${ads.length === 1 ? "" : "s"}`}
        </h2>
        {searching && creditsUsed > 0 && (
          <span className="text-xs text-muted-foreground">
            {creditsUsed} crédito{creditsUsed === 1 ? "" : "s"} usado{creditsUsed === 1 ? "" : "s"} até agora
          </span>
        )}
      </div>

      {/* Filtros COMO O WORKER OS GRAVOU (run.settings vem do banco), não como o formulário os
          mandou. É a diferença entre "o filtro não pegou" e "o filtro pegou e a fonte é que
          respondeu isso" — sem ela, só dá para adivinhar. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* O stub de desenvolvimento inventa os ids, então nenhum link abre na Meta. Sem isso a
            tela é indistinguível de dados reais — já custou horas de caça a um bug que não existia. */}
        {run.meta_provider === "stub" && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
            dados de exemplo — os links não abrem na Meta
          </span>
        )}
        {filtrosAtivos(run.settings, run.sources).map((f) => (
          <span
            key={f}
            className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          >
            {f}
          </span>
        ))}
      </div>

      {/* A ação principal fica aqui em cima também: a barra flutuante depende de posicionamento
          e o topo do grid é onde a pessoa está olhando quando termina de selecionar. */}
      {barraVisivel && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-sm font-medium tabular-nums">
            {count} selecionado{count === 1 ? "" : "s"}
            {atCap && <span className="ml-1 text-xs text-muted-foreground">(máximo {maxSelected})</span>}
          </span>
          <Button variant="ghost" size="sm" onClick={onClearSelection} className="h-8 text-xs">
            <X className="mr-1 h-3.5 w-3.5" />
            Limpar
          </Button>
          <Button size="sm" onClick={onAnalyze} disabled={isAnalyzing || searching} className="h-8">
            {isAnalyzing ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            Analisar selecionados
          </Button>
        </div>
      )}

      {onAsk && ads.length > 0 && (
        <PerguntaGrid
          // Trocar de busca (ou de pergunta, por outra aba) recomeça o campo com o texto certo.
          key={`${run.id}:${question?.texto ?? ""}`}
          ads={ads}
          question={question}
          onAsk={onAsk}
          isAsking={isAsking}
          onClear={() => onClearQuestion?.()}
          onSelectMatching={(ids) => onSelectMatching?.(ids)}
          disabled={searching || analyzing}
        />
      )}

      {misturada && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por fonte">
          {[null, ...porFonte.keys()].map((f) => {
            const ativo = fonte === f;
            const n = f === null ? ads.length : porFonte.get(f) ?? 0;
            return (
              <button
                key={f ?? "todas"}
                type="button"
                aria-pressed={ativo}
                onClick={() => setFonte(f)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  ativo
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {f === null ? "Todas" : ROTULO_GRUPO[f] ?? f} <span className="tabular-nums opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visiveis.map((ad) => (
          <AdCard
            key={ad.id}
            ad={ad}
            selected={selectedIds.has(ad.id)}
            onToggle={analyzing ? undefined : onToggle}
            selectDisabled={atCap}
            citeIndex={citeIndex?.get(ad.id)}
            // Dentro da busca de um anunciante, o botão levaria à mesma busca de novo.
            onMineAdvertiser={anunciante?.pageId === ad.page_id ? undefined : onMineAdvertiser}
            mineDisabled={searching || analyzing}
            resposta={respondido ? respostaDe(question, ad) : undefined}
            origemCriativo={{ runId: run.id }}
          />
        ))}
        {searching &&
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={`s${i}`} className="h-[520px] rounded-xl" />)}
      </div>

      {/* Rodapé da busca: balanço, nota, fim ou botão de carregar mais */}
      <div className="flex flex-col items-center gap-2 py-2 text-center">
        {/* Balanço do que a busca custou. Só com a busca parada: enquanto roda, os números ainda
            estão mudando e um placar que pula distrai mais do que informa. */}
        {!searching && (found > 0 || rejected > 0) && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{found}</span> anúncio
            {found === 1 ? "" : "s"} encontrado{found === 1 ? "" : "s"} de {target} pedido
            {target === 1 ? "" : "s"} ·{" "}
            <span className="font-medium text-foreground">{rejected}</span> descartado
            {rejected === 1 ? "" : "s"} pelos filtros ·{" "}
            <span className="font-medium text-foreground">{creditsUsed}</span> de {creditBudget}{" "}
            crédito{creditBudget === 1 ? "" : "s"} usado{creditsUsed === 1 ? "" : "s"}
          </p>
        )}
        {note && (
          <p className="flex max-w-2xl items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {note}
          </p>
        )}
        {!exhausted && run.status === "awaiting_selection" && (
          <>
            <Button variant="outline" size="sm" onClick={onLoadMore} disabled={isLoadingMore}>
              {isLoadingMore ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Buscar mais anúncios
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Cada busca pode gastar até {creditBudget} crédito{creditBudget === 1 ? "" : "s"}.
            </p>
          </>
        )}
        {searching && ads.length > 0 && (
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> buscando mais anúncios…
          </p>
        )}
      </div>

      {/* Barra de seleção flutuante.
          `fixed`, não `sticky`: o DashboardLayout põe todo o conteúdo dentro de um
          `<main class="overflow-auto">` cujo pai só tem `min-h-screen`, então esse main cresce até
          caber o conteúdo e quem rola é o body. Um elemento `sticky` ancorado num scrollport que
          nunca rola nunca gruda — ficava no fim do grid, abaixo de todos os cards. */}
      {barraVisivel && (
        <div className="fixed bottom-6 left-1/2 z-30 flex w-fit -translate-x-1/2 flex-wrap items-center gap-3 rounded-full border border-border bg-card px-4 py-2 shadow-lg">
          <span className="text-sm font-medium tabular-nums">
            {count} selecionado{count === 1 ? "" : "s"}
            {atCap && <span className="ml-1 text-xs text-muted-foreground">(máximo {maxSelected})</span>}
          </span>
          <Button variant="ghost" size="sm" onClick={onClearSelection} className="h-8 text-xs">
            <X className="mr-1 h-3.5 w-3.5" />
            Limpar
          </Button>
          <Button size="sm" onClick={onAnalyze} disabled={isAnalyzing || searching} className="h-8 rounded-full">
            {isAnalyzing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
            Analisar selecionados
          </Button>
        </div>
      )}
    </div>
  );
}
