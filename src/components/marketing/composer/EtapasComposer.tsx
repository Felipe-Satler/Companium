import { Check } from "lucide-react";

/**
 * O cabeçalho de etapas.
 *
 * Não é um stepper genérico, e não precisa ser: o que faz a tela parecer boa aqui não é animação,
 * é **ver o que já foi escolhido acumulando**. Cada etapa concluída mostra o RESUMO do que ficou
 * decidido nela — "Dr. José Ramos", "4 insumos" — em vez de só um número verde.
 *
 * Etapa já concluída é clicável para voltar. Etapa à frente não: pular para "Resultado" sem
 * cliente escolhido só produziria uma tela vazia.
 */
export type Etapa = {
  id: string;
  label: string;
  /** O que ficou decidido nesta etapa. Vazio = ainda não decidida. */
  resumo?: string | null;
};

type Props = {
  etapas: Etapa[];
  atual: string;
  onIr: (id: string) => void;
};

export function EtapasComposer({ etapas, atual, onIr }: Props) {
  const indiceAtual = etapas.findIndex((e) => e.id === atual);

  return (
    <ol className="flex flex-wrap items-stretch gap-2">
      {etapas.map((etapa, i) => {
        const ativa = etapa.id === atual;
        const concluida = i < indiceAtual && Boolean(etapa.resumo);
        const alcancavel = i <= indiceAtual || concluida;
        return (
          <li key={etapa.id} className="min-w-[9rem] flex-1">
            <button
              type="button"
              onClick={() => alcancavel && onIr(etapa.id)}
              disabled={!alcancavel}
              aria-current={ativa ? "step" : undefined}
              className={`flex w-full flex-col items-start gap-0.5 rounded-xl border-2 px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                ativa
                  ? "border-primary bg-primary/5"
                  : concluida
                    ? "border-border bg-card hover:border-primary/40"
                    : "border-dashed border-border bg-card"
              }`}
            >
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {concluida ? (
                  <Check className="h-3 w-3 text-primary" />
                ) : (
                  <span className="tabular-nums">{i + 1}</span>
                )}
                {etapa.label}
              </span>
              <span
                className={`line-clamp-1 text-xs ${
                  etapa.resumo ? "font-medium text-foreground" : "text-muted-foreground"
                }`}
              >
                {etapa.resumo || "—"}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
