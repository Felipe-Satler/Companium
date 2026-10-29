import { AlertTriangle, Calendar, Library, Loader2, Trash2 } from "lucide-react";
import { planoDe, progressoDe, type ComposicaoResumo } from "@/lib/adComposerApi";
import { getFormato } from "../../../../shared/ad-formats";
import { AvaliacaoControles } from "@/components/marketing/AvaliacaoControles";
import type { AvaliacoesPorId } from "@/lib/avaliacoesApi";

/**
 * As composições salvas, em cards.
 *
 * Toda composição é salva — não há botão de salvar, porque o worker grava a linha antes mesmo de o
 * agente responder. O card diz o que dá para decidir sem abrir: de quem é, quantos anúncios e para
 * que usos, e o que foi pedido.
 */

function quando(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "Instagram Reels", "Instagram Stories ×2": os usos do conjunto, contados. */
function usosDe(c: ComposicaoResumo) {
  const contagem = new Map<string, number>();
  for (const item of planoDe(c)) {
    // Formato null é o caso antigo em que o agente não declarou um válido: a composição é só prosa.
    const rotulo = item.formato ? (getFormato(item.formato)?.label ?? item.formato) : "só prosa";
    contagem.set(rotulo, (contagem.get(rotulo) ?? 0) + 1);
  }
  return [...contagem].map(([rotulo, n]) => (n > 1 ? `${rotulo} ×${n}` : rotulo));
}

type Props = {
  compositions: ComposicaoResumo[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  apagando: string | null;
  avaliacoes?: AvaliacoesPorId;
};

export function ComposicoesGrid({ compositions, onSelect, onDelete, apagando, avaliacoes = {} }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {compositions.map((c) => {
        const plano = planoDe(c);
        const { terminados, total } = progressoDe(plano);
        const usos = usosDe(c);
        const rigidos = (c.avisos ?? []).filter((a) => a.tipo === "excede_limite_rigido").length;
        const nome = c.nome_exibicao || c.cliente;
        return (
          <article
            key={c.id}
            className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md"
          >
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              className="flex flex-1 flex-col gap-2 p-4 text-left"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="line-clamp-2 text-sm font-semibold">{nome}</h3>
                {total > 0 && (
                  <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                    {total} anúncio{total === 1 ? "" : "s"}
                  </span>
                )}
              </div>

              {c.status === "running" && (
                <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {total ? `escrevendo… ${terminados} de ${total} prontos` : "escrevendo…"}
                </p>
              )}
              {c.status === "error" && (
                <p className="text-[11px] font-medium text-destructive">falhou</p>
              )}
              {/* Na etapa de Conceitos Estratégicos: ainda não há anúncio, e a vez é de quem pediu. */}
              {c.status === "conceitos" && (
                <p>
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                    aguardando conceitos
                  </span>
                </p>
              )}
              {/* Pronta mas não salva: alguém ainda vai rever. É o que diferencia, na lista, o que
                  já pode ir ao cliente do que ainda pode mudar. */}
              {c.status === "revisao" && (
                <p>
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  em revisão
                </span>
                </p>
              )}

              {usos.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {usos.map((u) => (
                    <span
                      key={u}
                      className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
                    >
                      {u}
                    </span>
                  ))}
                </div>
              )}

              {/* O pedido é o que distingue duas composições do mesmo cliente no mesmo dia. */}
              {c.extra_prompt && (
                <p className="line-clamp-2 text-xs text-muted-foreground">“{c.extra_prompt}”</p>
              )}

              <div className="mt-auto space-y-1 pt-1 text-[11px] text-muted-foreground">
                <p className="flex items-center gap-1">
                  {c.analise_titulo ? (
                    <>
                      <Library className="h-3 w-3 shrink-0" />
                      <span className="truncate">{c.analise_titulo}</span>
                    </>
                  ) : (
                    "sem análise"
                  )}
                </p>
                <p className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {quando(c.criado_em)}
                </p>
                {rigidos > 0 && (
                  <p className="inline-flex items-center gap-1 font-medium text-destructive">
                    <AlertTriangle className="h-3 w-3" />
                    {rigidos} acima do limite
                  </p>
                )}
              </div>
            </button>
            {/* FORA do botão que abre a composição: votar e etiquetar não podem abri-la, e botão
                dentro de botão não é HTML válido. */}
            <div className="border-t border-border px-3 py-1.5">
              <AvaliacaoControles alvo="composicao" id={c.id} avaliacao={avaliacoes[c.id]} compacto />
            </div>

            {c.canDelete && (
              <div className="flex justify-end border-t border-border px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => onDelete(c.id)}
                  disabled={apagando === c.id}
                  aria-label={`Apagar composição de ${nome}`}
                  className="inline-flex items-center gap-1 rounded p-1 text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  {apagando === c.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Apagar
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
