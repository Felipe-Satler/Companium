import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, EyeOff, FilterX, RotateCcw } from "lucide-react";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetaKey, META_FIELDS, META_LABELS, MetaKind } from "@/hooks/useClientesMetas";
import { prettyClientLabel } from "@/data/clienteAliases";
import { MetaCell, MetaClientRow } from "@/utils/metasStatus";

function fmtValue(value: number | null, kind: MetaKind): string {
  if (value == null) return "—";
  if (!Number.isFinite(value)) return "∞";
  if (kind === "currency") return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  if (kind === "ratio") return `${value.toFixed(2)}x`;
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function fmtPct(pct: number): string {
  if (!Number.isFinite(pct)) return "∞";
  return `${Math.round(pct)}%`;
}

// Coluna congelada do cliente: fundo sólido (senão o conteúdo rolando passa POR BAIXO e
// aparece através dela) + a borda direita que marca onde a área que rola começa.
const STICKY_CLIENTE = "sticky left-0 z-10 bg-background border-r border-border";
// Separador entre métricas — cada coluna de métrica abre com uma borda à esquerda.
const SEP_METRICA = "border-l border-border/40";

/**
 * Uma célula = valor real + o quanto ele representa do planejado.
 * Verde dentro da meta, vermelho fora, "-" âmbar quando não há meta cadastrada
 * (a direção já vem resolvida no status: em custo, MENOS é melhor).
 */
function Celula({ cell, showGoal }: { cell: MetaCell; showGoal: boolean }) {
  const kind = META_FIELDS[cell.field].kind;
  const tone =
    cell.status === "ok" ? "text-emerald-500" : cell.status === "off" ? "text-red-500" : "text-amber-600 dark:text-amber-400";
  return (
    <TableCell className={`text-xs whitespace-nowrap px-3 py-2 text-left ${SEP_METRICA}`}>
      <div>
        <span className="tabular-nums text-foreground">{fmtValue(cell.real, kind)}</span>{" "}
        <span
          className={`font-semibold tabular-nums ${tone}`}
          title={
            cell.status === "none"
              ? "Sem meta cadastrada para este período"
              : `Meta do período: ${fmtValue(cell.goal, kind)}`
          }
        >
          {cell.status === "none" || cell.pct == null ? "-" : fmtPct(cell.pct)}
        </span>
      </div>
      {showGoal && (
        <div className="text-[10px] text-muted-foreground tabular-nums leading-tight">
          meta {fmtValue(cell.goal, kind)}
        </div>
      )}
    </TableCell>
  );
}

interface MetasTabelaProps {
  rows: MetaClientRow[];
  fields: MetaKey[];
  /** Descrição do filtro vindo do gráfico de barras (`rows` já chega filtrado). Ausente = sem filtro. */
  filtroLabel?: string | null;
  /** Tira o filtro do gráfico de barras e volta a mostrar a tabela inteira. */
  onLimparFiltro?: () => void;
}

export function MetasTabela({ rows, fields, filtroLabel, onLimparFiltro }: MetasTabelaProps) {
  const headClass = "text-[10px] uppercase tracking-wider whitespace-nowrap px-3 py-2";

  // Mostrar/esconder a linha da meta dentro de cada célula (botão do olho). LIGADO por padrão:
  // a tela existe para comparar realizado × meta, então o alvo aparece junto sem precisar pedir;
  // o olho serve para ENXUGAR a tabela quando o gestor só quer os números realizados.
  const [showGoals, setShowGoals] = useState(true);

  // Ordem das colunas de métrica, controlada pelo usuário. Começa na ordem dos cards do CRM.
  const [order, setOrder] = useState<MetaKey[]>(fields);

  // Ligar/desligar métricas na barra de filtros muda `fields`; a ordem escolhida aqui tem de
  // SOBREVIVER a isso: mantemos as que continuam selecionadas na posição em que o usuário as
  // pôs e acrescentamos as novas no fim. Devolver `cur` quando nada muda evita re-render em loop.
  useEffect(() => {
    setOrder((cur) => {
      const kept = cur.filter((f) => fields.includes(f));
      const added = fields.filter((f) => !kept.includes(f));
      const next = [...kept, ...added];
      return next.length === cur.length && next.every((f, i) => f === cur[i]) ? cur : next;
    });
  }, [fields]);

  const move = (index: number, delta: number) => {
    setOrder((cur) => {
      const target = index + delta;
      if (target < 0 || target >= cur.length) return cur;
      const next = [...cur];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const isDefaultOrder = order.length === fields.length && order.every((f, i) => f === fields[i]);

  // As células vêm na ordem de `fields`; indexamos por métrica para render na ordem escolhida.
  const cellsByRow = useMemo(
    () => rows.map((r) => new Map(r.cells.map((c) => [c.field, c] as const))),
    [rows],
  );

  return (
    <div className="neu-card rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border/50 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Clientes e metas</h3>
          <p className="text-[10px] text-muted-foreground mt-1">
            Cada métrica traz o realizado e, ao lado, quanto ele representa da meta do período.
            Use as setas no cabeçalho para reordenar as colunas.
          </p>
          {filtroLabel && (
            <p className="text-[10px] text-primary mt-1">
              Filtrado pelo gráfico: {filtroLabel} — {rows.length} cliente(s)
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isDefaultOrder && (
            <button
              type="button"
              onClick={() => setOrder(fields)}
              title="Restaurar a ordem original das métricas"
              className="neu-button flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Ordem original
            </button>
          )}
          {filtroLabel && onLimparFiltro && (
            <button
              type="button"
              onClick={onLimparFiltro}
              title="Tirar o filtro do gráfico e mostrar a tabela inteira"
              className="neu-button flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              <FilterX className="h-3.5 w-3.5" />
              Limpar filtro
            </button>
          )}
          <button
            type="button"
            aria-pressed={showGoals}
            onClick={() => setShowGoals((v) => !v)}
            title={showGoals ? "Esconder os valores de meta" : "Mostrar os valores de meta"}
            className={`neu-button flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium ${
              showGoals ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {showGoals ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            Metas
          </button>
        </div>
      </div>
      <div className="overflow-auto max-h-[560px] w-full">
        {/* border-separate (não collapse): com border-collapse o navegador NÃO pinta as
            bordas de células position:sticky, e a coluna congelada ficaria sem a linha que
            a separa do resto. Como o <tr> deixa de desenhar borda nesse modo, o traço entre
            linhas passa a sair das próprias células. */}
        <table className="w-full caption-bottom text-sm border-separate border-spacing-0 [&_td]:border-b [&_td]:border-border/50 [&_th]:border-b [&_th]:border-border">
          <TableHeader className="sticky top-0 z-20 bg-background">
            <TableRow>
              {/* z-30: o canto precisa ficar acima do cabeçalho (z-20) E da coluna
                  congelada (z-10), senão um dos dois passa por cima dele ao rolar. */}
              <TableHead className={`${headClass} sticky left-0 z-30 bg-background border-r border-border`}>
                Cliente
              </TableHead>
              <TableHead className={headClass}>Squad</TableHead>
              <TableHead className={headClass}>Plano</TableHead>
              {order.map((f, i) => (
                <TableHead key={f} className={`${headClass} text-left ${SEP_METRICA}`}>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      title={`Mover ${META_LABELS[f]} para a esquerda`}
                      aria-label={`Mover ${META_LABELS[f]} para a esquerda`}
                      className="text-muted-foreground hover:text-primary disabled:opacity-25 disabled:hover:text-muted-foreground"
                    >
                      <ChevronLeft className="h-3 w-3" />
                    </button>
                    <span>{META_LABELS[f]}</span>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === order.length - 1}
                      title={`Mover ${META_LABELS[f]} para a direita`}
                      aria-label={`Mover ${META_LABELS[f]} para a direita`}
                      className="text-muted-foreground hover:text-primary disabled:opacity-25 disabled:hover:text-muted-foreground"
                    >
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, ri) => (
              // `group` + group-hover na célula congelada: o fundo sólido dela esconderia o
              // hover da linha, então ela repinta junto.
              <TableRow key={row.client} className="group">
                <TableCell
                  className={`text-xs whitespace-nowrap px-3 py-2 font-medium text-left ${STICKY_CLIENTE} group-hover:bg-muted`}
                >
                  {prettyClientLabel(row.client)}
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap px-3 py-2 text-left text-muted-foreground">
                  {row.squad ?? "—"}
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap px-3 py-2 text-left text-muted-foreground">
                  {row.plano ?? "—"}
                </TableCell>
                {order.map((f) => {
                  const cell = cellsByRow[ri].get(f);
                  return cell ? <Celula key={f} cell={cell} showGoal={showGoals} /> : <TableCell key={f} />;
                })}
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={3 + order.length} className="text-xs text-muted-foreground px-3 py-6 text-center">
                  Nenhum cliente para os filtros selecionados.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </table>
      </div>
    </div>
  );
}
