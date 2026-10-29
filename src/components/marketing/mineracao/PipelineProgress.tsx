import {
  AlertCircle,
  Check,
  Ban,
  Download,
  FileAudio,
  Loader2,
  Radar,
  Sparkles,
  Database,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { runProgress } from "@/hooks/useAdSpy";
import { type SpyRun, type SpyStage, type SpyStageKey } from "@/lib/adSpyApi";

const STAGE_ICONS: Record<SpyStageKey, typeof Radar> = {
  discover: Radar,
  collect: Database,
  download: Download,
  transcribe: FileAudio,
  analyze: Sparkles,
};

/** What each stage is actually doing, so the pipeline explains itself instead of just ticking. */
const STAGE_HINTS: Record<SpyStageKey, string> = {
  discover: "Buscando anúncios na biblioteca e aplicando os filtros de qualidade",
  collect: "Guardando os anúncios encontrados",
  download: "Baixando os vídeos e as imagens dos anúncios",
  transcribe: "Transcrevendo o áudio dos vídeos",
  analyze: "Lendo os anúncios selecionados e escrevendo o relatório",
};

function elapsed(stage: SpyStage): string | null {
  if (!stage.started_at) return null;
  const end = stage.ended_at ? Date.parse(stage.ended_at) : Date.now();
  const secs = Math.max(0, Math.round((end - Date.parse(stage.started_at)) / 1000));
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/**
 * Na v2 este painel só aparece depois que a pessoa mandou analisar — e nesse ponto os anúncios
 * selecionados já estão no banco. Então uma falha aqui nunca perde o corpus.
 */
const ANALYSIS_STAGES = new Set(["download", "transcribe", "analyze"]);

/**
 * O que fazer depois de uma falha — depende de ONDE ela aconteceu.
 *
 * "Refazer análise" refaz só a etapa do agente (`reanalyzeRun` no worker), sem baixar nem
 * transcrever. Se a falha foi no download ou na transcrição, refazer a análise rodaria sem os
 * vídeos e o áudio; o caminho certo é mandar analisar de novo pelo grid, que refaz tudo.
 */
function proximoPasso(stages: SpyStage[]): string {
  const falhou = stages.find((s) => s.status === "error")?.key;
  if (falhou === "download" || falhou === "transcribe") {
    return "Os anúncios selecionados continuam salvos. Como a falha foi antes da análise, use “Analisar selecionados”, no grid abaixo, para baixar e transcrever de novo.";
  }
  const transcreveu = stages.some((s) => s.key === "transcribe" && s.status === "done");
  return transcreveu
    ? "Os anúncios selecionados e as transcrições continuam salvos — use “Refazer análise” para tentar de novo sem buscar nem transcrever outra vez."
    : "Os anúncios selecionados continuam salvos — use “Refazer análise” para tentar de novo sem buscar outra vez.";
}

function StageRow({ stage }: { stage: SpyStage }) {
  const Icon = STAGE_ICONS[stage.key] ?? Radar;
  const running = stage.status === "running";
  const done = stage.status === "done";
  const failed = stage.status === "error";
  const skipped = stage.status === "skipped";

  const hasBar = running && typeof stage.total === "number" && stage.total > 0;
  const pct = hasBar ? Math.min(100, Math.round((stage.done / (stage.total as number)) * 100)) : 0;
  const time = elapsed(stage);

  return (
    <li className="flex gap-3">
      {/* Marker column */}
      <div className="flex flex-col items-center">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
            done
              ? "bg-primary/15 text-primary"
              : running
                ? "bg-primary text-primary-foreground"
                : failed
                  ? "bg-destructive/15 text-destructive"
                  : "neu-inset text-muted-foreground"
          }`}
        >
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : done ? (
            <Check className="h-4 w-4" />
          ) : failed ? (
            <AlertCircle className="h-4 w-4" />
          ) : skipped ? (
            <Ban className="h-3.5 w-3.5" />
          ) : (
            <Icon className="h-4 w-4" />
          )}
        </div>
        {/* Connector; the last row's is harmless since the list clips it. */}
        <div className="mt-1 w-px flex-1 bg-border last:hidden" />
      </div>

      {/* Content column */}
      <div className="min-w-0 flex-1 pb-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span
            className={`text-sm font-medium ${
              running
                ? "text-foreground"
                : done
                  ? "text-foreground"
                  : failed
                    ? "text-destructive"
                    : "text-muted-foreground"
            }`}
          >
            {stage.label}
          </span>
          {typeof stage.total === "number" && stage.total > 0 && (running || done) && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {stage.done}/{stage.total}
            </span>
          )}
          {time && (running || done || failed) && (
            <span className="text-xs tabular-nums text-muted-foreground">· {time}</span>
          )}
        </div>

        <p className="mt-0.5 text-xs text-muted-foreground">
          {stage.note ?? (running ? STAGE_HINTS[stage.key] : skipped ? "pulada" : "")}
        </p>

        {hasBar && <Progress value={pct} className="mt-2 h-1" />}
      </div>
    </li>
  );
}

type Props = {
  run: SpyRun;
  onCancel?: () => void;
  isCanceling?: boolean;
  onReanalyze?: () => void;
  isReanalyzing?: boolean;
};

export function PipelineProgress({
  run,
  onCancel,
  isCanceling,
  onReanalyze,
  isReanalyzing,
}: Props) {
  const { pct, current } = runProgress(run);
  // Só a análise: a busca em blocos mostra o próprio progresso no grid.
  const active = run.status === "running";

  return (
    <div className="neu-card rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">Análise dos selecionados</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {run.status === "done" && "Concluída"}
            {run.status === "error" && "Falhou"}
            {run.status === "awaiting_selection" && "Cancelada — ajuste a seleção e analise de novo"}
            {run.status === "running" && (current ? `${current}…` : "Em andamento…")}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {active && <span className="text-sm font-semibold tabular-nums">{pct}%</span>}
          {active && onCancel && (
            <Button variant="outline" size="sm" onClick={onCancel} disabled={isCanceling}>
              <X className="mr-1 h-3.5 w-3.5" />
              {isCanceling ? "Cancelando…" : "Cancelar"}
            </Button>
          )}
          {(run.status === "done" || run.status === "error") && onReanalyze && (
            <Button variant="outline" size="sm" onClick={onReanalyze} disabled={isReanalyzing}>
              <RotateCcw className={`mr-1 h-3.5 w-3.5 ${isReanalyzing ? "animate-spin" : ""}`} />
              {isReanalyzing ? "Reanalisando…" : "Refazer análise"}
            </Button>
          )}
        </div>
      </div>

      {active && <Progress value={pct} className="h-1.5" />}

      <ol className="mt-1">
        {(run.stages ?? []).filter((s) => ANALYSIS_STAGES.has(s.key)).map((s) => (
          <StageRow key={s.key} stage={s} />
        ))}
      </ol>

      {run.error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-xs font-medium text-destructive">Erro</p>
          <p className="mt-1 text-xs text-muted-foreground">{run.error}</p>
          {/* Se a coleta passou, o corpus está salvo e nada se perdeu — vale dizer, senão a
              pessoa assume que precisa minerar tudo de novo. */}
          {onReanalyze && (
            <p className="mt-2 text-xs text-muted-foreground">{proximoPasso(run.stages ?? [])}</p>
          )}
        </div>
      )}
    </div>
  );
}
