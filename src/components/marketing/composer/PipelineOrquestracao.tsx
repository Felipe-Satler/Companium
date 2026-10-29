import { AlertTriangle, Check, Loader2, Minus, UserRound } from "lucide-react";
import type { EtapaOrquestracao } from "@/lib/orquestradorApi";
import { duracao, useAgora } from "./tempoOrquestracao";

/**
 * O trilho da orquestração: as cinco etapas ligadas, com o tempo de cada uma.
 *
 * É a resposta a "quanto falta?" para uma tarefa que leva de dois a quarenta minutos. A lista de
 * etapas do percurso (`OrquestracaoPercurso`) diz O QUE houve em cada uma; este trilho diz ONDE se
 * está, de relance, e há quanto tempo — sem isso, uma etapa parada há dez minutos e uma que
 * começou agora têm o mesmo spinner.
 *
 * Usa os tokens do tema, como o resto da tela. O que lhe dá cara de "máquina" é só a fonte
 * monoespaçada nos rótulos e nos tempos.
 */

function tempoDa(etapa: EtapaOrquestracao, agora: number) {
  if (!etapa.started_at) return null;
  const inicio = Date.parse(etapa.started_at);
  const fim = etapa.ended_at
    ? Date.parse(etapa.ended_at)
    : etapa.status === "running" || etapa.status === "aguardando"
      ? agora
      : NaN;
  return duracao(fim - inicio);
}

const COR: Record<EtapaOrquestracao["status"], string> = {
  pending: "border-border bg-card text-muted-foreground",
  running: "border-primary bg-primary/10 text-primary ring-4 ring-primary/15",
  // A vez é de uma pessoa: âmbar, como o selo "em revisão" das listas.
  aguardando: "border-amber-500 bg-amber-500/10 text-amber-700 ring-4 ring-amber-500/15 dark:text-amber-400",
  done: "border-primary bg-primary text-primary-foreground",
  skipped: "border-border bg-muted text-muted-foreground",
  error: "border-destructive bg-destructive/10 text-destructive",
};

function Icone({ etapa, indice }: { etapa: EtapaOrquestracao; indice: number }) {
  if (etapa.status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  if (etapa.status === "aguardando") return <UserRound className="h-3.5 w-3.5" />;
  if (etapa.status === "done") return <Check className="h-3.5 w-3.5" />;
  if (etapa.status === "error") return <AlertTriangle className="h-3.5 w-3.5" />;
  if (etapa.status === "skipped") return <Minus className="h-3.5 w-3.5" />;
  return <span className="font-mono text-[11px] tabular-nums">{indice + 1}</span>;
}

export function PipelineOrquestracao({
  etapas,
  rodando,
}: {
  etapas: EtapaOrquestracao[];
  rodando: boolean;
}) {
  const agora = useAgora(rodando);
  return (
    <ol className="neu-card flex flex-wrap items-start gap-y-3 rounded-xl px-4 py-4">
      {etapas.map((e, i) => {
        const tempo = tempoDa(e, agora);
        // O trecho ANTES do nó acende quando a etapa já começou: o caminho percorrido fica aceso.
        const percorrido = e.status !== "pending";
        return (
          <li
            key={e.key}
            aria-current={e.status === "running" || e.status === "aguardando" ? "step" : undefined}
            className="flex min-w-[7.5rem] flex-1 items-start"
          >
            {i > 0 && (
              <span
                aria-hidden
                className={`mt-[13px] h-px flex-1 ${percorrido ? "bg-primary/60" : "bg-border"}`}
              />
            )}
            <div className="flex flex-col items-center gap-1 px-2 text-center">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full border ${COR[e.status]}`}
              >
                <Icone etapa={e} indice={i} />
              </span>
              <span
                className={`font-mono text-[10px] font-semibold uppercase leading-tight tracking-wider ${
                  e.status === "pending" ? "text-muted-foreground" : "text-foreground"
                }`}
              >
                {e.label}
              </span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {tempo ?? (e.status === "skipped" ? "pulada" : " ")}
              </span>
            </div>
            {i < etapas.length - 1 && (
              <span
                aria-hidden
                className={`mt-[13px] h-px flex-1 ${
                  e.status === "done" || e.status === "skipped" || e.status === "error"
                    ? "bg-primary/60"
                    : "bg-border"
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
