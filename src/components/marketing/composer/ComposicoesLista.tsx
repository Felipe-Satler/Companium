import { useState } from "react";
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronRight,
  Library,
  Loader2,
  Trash2,
} from "lucide-react";
import { planoDe, progressoDe, type ComposicaoResumo } from "@/lib/adComposerApi";
import { getFormato } from "../../../../shared/ad-formats";
import { AvaliacaoControles } from "@/components/marketing/AvaliacaoControles";
import type { AvaliacaoItem, AvaliacoesPorId } from "@/lib/avaliacoesApi";
import {
  agruparPorCliente,
  ORDENACAO_PADRAO,
  type OrdenacaoId,
} from "@/components/marketing/composer/agruparComposicoes";

/**
 * As composições salvas, agrupadas por cliente.
 *
 * A grade de cards responde bem a "o que foi composto ultimamente"; esta visão responde a "o que já
 * compusemos para ESTE cliente", que é a pergunta de quem vai compor de novo. Por isso o nível de
 * cima é o cliente, em ordem alfabética, e as composições só aparecem ao abrir.
 *
 * Nada abre sozinho: com a carteira inteira na tela, abrir o primeiro grupo "para não parecer
 * vazio" daria a impressão de que aquele cliente é especial. A contagem no cabeçalho é o que torna
 * o fechado informativo.
 */

function quando(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Os usos do conjunto, contados — "Reels ×2". */
function usosDe(c: ComposicaoResumo) {
  const contagem = new Map<string, number>();
  for (const item of planoDe(c)) {
    const rotulo = item.formato ? (getFormato(item.formato)?.label ?? item.formato) : "só prosa";
    contagem.set(rotulo, (contagem.get(rotulo) ?? 0) + 1);
  }
  return [...contagem].map(([rotulo, n]) => (n > 1 ? `${rotulo} ×${n}` : rotulo));
}

function Linha({
  c,
  onSelect,
  onDelete,
  apagando,
  avaliacao,
}: {
  c: ComposicaoResumo;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  apagando: string | null;
  avaliacao?: AvaliacaoItem;
}) {
  const plano = planoDe(c);
  const { terminados, total } = progressoDe(plano);
  const usos = usosDe(c);
  const rigidos = (c.avisos ?? []).filter((a) => a.tipo === "excede_limite_rigido").length;

  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <button
        type="button"
        onClick={() => onSelect(c.id)}
        className="min-w-0 flex-1 space-y-1 text-left"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3 shrink-0" />
            {quando(c.criado_em)}
          </span>
          {total > 0 && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
              {total} anúncio{total === 1 ? "" : "s"}
            </span>
          )}
          {c.status === "running" && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {total ? `${terminados} de ${total}` : "escrevendo…"}
            </span>
          )}
          {c.status === "error" && (
            <span className="text-[11px] font-medium text-destructive">falhou</span>
          )}
          {c.status === "conceitos" && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
              aguardando conceitos
            </span>
          )}
          {c.status === "revisao" && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
              em revisão
            </span>
          )}
          {rigidos > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive">
              <AlertTriangle className="h-3 w-3" />
              {rigidos} acima do limite
            </span>
          )}
        </div>

        {/* O pedido é o que distingue duas composições do mesmo cliente no mesmo dia — e nesta
            visão, onde todas são do mesmo cliente, ele é a única coisa que as distingue. */}
        {c.extra_prompt ? (
          <p className="line-clamp-1 text-xs">“{c.extra_prompt}”</p>
        ) : (
          <p className="text-xs text-muted-foreground">sem pedido específico</p>
        )}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {usos.map((u) => (
            <span key={u} className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
              {u}
            </span>
          ))}
          {c.analise_titulo && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Library className="h-3 w-3 shrink-0" />
              <span className="truncate">{c.analise_titulo}</span>
            </span>
          )}
        </div>
      </button>

      {/* Ao lado do conteúdo e fora do botão que abre: na linha o espaço é horizontal, então os
          controles ficam à direita em vez de numa faixa embaixo. */}
      <div className="shrink-0">
        <AvaliacaoControles alvo="composicao" id={c.id} avaliacao={avaliacao} compacto />
      </div>

      {c.canDelete && (
        <button
          type="button"
          onClick={() => onDelete(c.id)}
          disabled={apagando === c.id}
          aria-label={`Apagar composição de ${c.nome_exibicao || c.cliente}`}
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
        >
          {apagando === c.id ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

type Props = {
  compositions: ComposicaoResumo[];
  ordenacao?: OrdenacaoId;
  avaliacoes?: AvaliacoesPorId;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  apagando: string | null;
};

export function ComposicoesLista({
  compositions,
  ordenacao = ORDENACAO_PADRAO,
  onSelect,
  onDelete,
  apagando,
  avaliacoes = {},
}: Props) {
  const grupos = agruparPorCliente(compositions, ordenacao);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  const alternar = (cliente: string) =>
    setAbertos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(cliente)) proximo.delete(cliente);
      else proximo.add(cliente);
      return proximo;
    });

  return (
    <div className="space-y-1.5">
      {grupos.map((g) => {
        const aberto = abertos.has(g.cliente);
        const rodando = g.composicoes.filter((c) => c.status === "running").length;
        return (
          <section key={g.cliente} className="overflow-hidden rounded-xl border border-border">
            <button
              type="button"
              onClick={() => alternar(g.cliente)}
              aria-expanded={aberto}
              className="flex w-full items-center gap-2 bg-card px-3 py-2.5 text-left hover:bg-secondary/40"
            >
              {aberto ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{g.nome}</span>
              {/* A contagem fechada é o que faz o grupo valer a pena sem abrir. */}
              {rodando > 0 && (
                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {rodando} escrevendo
                </span>
              )}
              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                {g.composicoes.length}
              </span>
            </button>

            {aberto && (
              <div className="space-y-1.5 border-t border-border bg-secondary/20 p-2">
                {g.composicoes.map((c) => (
                  <Linha
                    key={c.id}
                    c={c}
                    onSelect={onSelect}
                    onDelete={onDelete}
                    apagando={apagando}
                    avaliacao={avaliacoes[c.id]}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
