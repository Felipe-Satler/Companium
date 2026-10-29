import { useMemo, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import {
  ClientStatusEntry,
  GoalStatus,
  MetaClientRow,
  StatusCounts,
  LIMITE_FORA_DA_META,
  clientsByStatus,
  countClientStatuses,
  countsTotal,
} from "@/utils/metasStatus";
import { prettyClientLabel } from "@/data/clienteAliases";
import { STATUS_COLOR, STATUS_LABEL, STATUS_ORDER } from "./metasChartTheme";

interface Pizza {
  title: string;
  subtitle: string;
  counts: StatusCounts;
  /** Linhas que formam esta pizza — a lista de clientes que o clique abre. */
  rows: MetaClientRow[];
}

function toSlices(counts: StatusCounts) {
  return STATUS_ORDER.map((s) => ({ status: s, name: STATUS_LABEL[s], value: counts[s], color: STATUS_COLOR[s] })).filter(
    (d) => d.value > 0,
  );
}

// Todas as pizzas têm o MESMO tamanho — a geral e as de squad são comparadas entre si, e
// tamanhos diferentes fazem a maior parecer "mais cheia" mesmo com a mesma proporção.
const LARGURA_BASE = 248;
// Largura do painel que desliza para fora ao clicar.
const LARGURA_DETALHE = 236;

function ListaClientes({ status, entries }: { status: GoalStatus; entries: ClientStatusEntry[] }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLOR[status] }} />
        <span className="text-[11px] font-semibold text-foreground">{STATUS_LABEL[status]}</span>
        <span className="text-[10px] text-muted-foreground">({entries.length})</span>
      </div>
      {entries.length === 0 ? (
        <p className="text-[10px] text-muted-foreground pl-3.5 mb-2">Nenhum cliente.</p>
      ) : (
        <ul className="mb-2 space-y-0.5">
          {entries.map((e) => (
            <li key={e.client} className="flex items-baseline justify-between gap-2 pl-3.5">
              <span className="text-[11px] text-muted-foreground truncate" title={prettyClientLabel(e.client)}>
                {prettyClientLabel(e.client)}
              </span>
              {/* Quantas métricas sustentam o veredito: no "fora", 3 estouradas pesa mais
                  que 1, e é isso que diz por onde começar. */}
              <span className="text-[10px] tabular-nums text-muted-foreground/70 shrink-0">{e.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PizzaCard({ pizza, aberta, onToggle }: { pizza: Pizza; aberta: boolean; onToggle: () => void }) {
  const slices = useMemo(() => toSlices(pizza.counts), [pizza.counts]);
  const total = countsTotal(pizza.counts);
  const pctOk = total > 0 ? Math.round((pizza.counts.ok / total) * 100) : 0;
  // Só calcula as listas quando o painel abre — a tela pode ter dezenas de pizzas.
  const listas = useMemo(() => (aberta ? clientsByStatus(pizza.rows) : null), [aberta, pizza.rows]);

  return (
    // shrink-0: é o que faz a fileira ESTOURAR a largura e o container rolar na horizontal em
    // vez de espremer as pizzas. A largura do card não é fixa — ela cresce junto com o painel
    // de detalhe, e é essa mudança que a transição anima.
    <div className="neu-card rounded-xl p-4 shrink-0 flex items-stretch">
      <div style={{ width: LARGURA_BASE - 32 }} className="shrink-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={aberta}
          className="w-full text-left group"
          title={aberta ? "Fechar a lista de clientes" : "Ver os clientes de cada grupo"}
        >
          <div className="flex items-center gap-1">
            <p className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors" title={pizza.title}>
              {pizza.title}
            </p>
            <ChevronRight
              className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-300 motion-reduce:transition-none ${aberta ? "rotate-90" : ""}`}
            />
          </div>
          <p className="text-[11px] text-muted-foreground mb-2">{pizza.subtitle}</p>
        </button>

        <div className="relative" style={{ height: 150 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="name"
                innerRadius={42}
                outerRadius={62}
                paddingAngle={2}
                stroke="none"
                onClick={onToggle}
                className="cursor-pointer"
              >
                {slices.map((d) => (
                  <Cell key={d.status} fill={d.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, name: string) => [`${value} (${total > 0 ? Math.round((value / total) * 100) : 0}%)`, name]}
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Centro do donut: o número que resume o card. */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-xl font-bold text-foreground">{pctOk}%</span>
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground">na meta</span>
          </div>
        </div>

        <div className="mt-2 space-y-1">
          {STATUS_ORDER.map((s) => (
            <div key={s} className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLOR[s] }} />
                {STATUS_LABEL[s]}
              </span>
              <span className="font-medium text-foreground tabular-nums">{pizza.counts[s]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Painel de detalhe: a largura anima de 0 até LARGURA_DETALHE, empurrando a borda do
          card para a direita. overflow-hidden recorta o conteúdo durante a animação, e o
          conteúdo tem largura FIXA para não refluir enquanto o painel abre. */}
      <div
        className="overflow-hidden transition-[width] duration-300 ease-out motion-reduce:transition-none shrink-0"
        style={{ width: aberta ? LARGURA_DETALHE : 0 }}
        aria-hidden={!aberta}
      >
        <div style={{ width: LARGURA_DETALHE }} className="pl-4 ml-4 border-l border-border/60 h-full">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-foreground">Clientes</span>
            <button
              type="button"
              onClick={onToggle}
              title="Fechar"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="max-h-[300px] overflow-y-auto pr-1">
            {listas &&
              STATUS_ORDER.map((s) => <ListaClientes key={s} status={s} entries={listas[s]} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

interface MetasPizzasProps {
  rows: MetaClientRow[];
  /** Squads marcados (ids) → uma pizza por squad, além da geral. */
  squadLabels: Map<string, string>;
}

/**
 * Fileira de pizzas: a primeira soma TODOS os clientes visíveis; depois vem uma por squad.
 * Cada fatia conta pares cliente × métrica (um cliente com 5 métricas pesa 5), que é o que
 * responde "quanto do que a gente acompanha está dentro da meta".
 *
 * Clicar numa pizza estende o card para a direita e lista os clientes de cada grupo. Só uma
 * fica aberta por vez — duas abertas empurrariam a fileira para longe e o gestor perderia a
 * comparação, que é justamente o motivo de as pizzas estarem lado a lado.
 */
export function MetasPizzas({ rows, squadLabels }: MetasPizzasProps) {
  const [abertaId, setAbertaId] = useState<string | null>(null);

  const pizzas = useMemo<Pizza[]>(() => {
    const all = countClientStatuses(rows);
    const out: Pizza[] = [
      {
        title: "Todos os clientes",
        subtitle: `${rows.length} cliente(s)`,
        counts: all,
        rows,
      },
    ];

    // Uma pizza por squad presente nas linhas (ordem alfabética do rótulo).
    const bySquad = new Map<string, MetaClientRow[]>();
    for (const r of rows) {
      if (r.squad == null) continue;
      const list = bySquad.get(r.squad);
      if (list) list.push(r);
      else bySquad.set(r.squad, [r]);
    }
    const squads = [...bySquad.keys()].sort((a, b) =>
      (squadLabels.get(a) ?? a).localeCompare(squadLabels.get(b) ?? b, "pt-BR"),
    );
    for (const id of squads) {
      const list = bySquad.get(id)!;
      const counts = countClientStatuses(list);
      out.push({
        title: squadLabels.get(id) ?? id,
        subtitle: `${list.length} cliente(s)`,
        counts,
        rows: list,
      });
    }
    return out;
  }, [rows, squadLabels]);

  return (
    <div className="neu-card rounded-xl p-4">
      <h3 className="text-sm font-semibold text-foreground mb-1">Metas por cliente</h3>
      <p className="text-[11px] text-muted-foreground mb-3">
        Cada fatia conta um cliente: fora da meta é quem estourou {LIMITE_FORA_DA_META} métrica(s)
        ou mais no período. Clique numa pizza para ver quem está em cada grupo.
      </p>
      <div className="flex items-start gap-3 overflow-x-auto pb-2">
        {pizzas.map((p) => (
          <PizzaCard
            key={p.title}
            pizza={p}
            aberta={abertaId === p.title}
            onToggle={() => setAbertaId((cur) => (cur === p.title ? null : p.title))}
          />
        ))}
      </div>
    </div>
  );
}
