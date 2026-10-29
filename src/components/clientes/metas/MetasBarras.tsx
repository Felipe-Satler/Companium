import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList } from "recharts";
import { MetaKey, META_LABELS } from "@/hooks/useClientesMetas";
import { prettyClientLabel } from "@/data/clienteAliases";
import { BarFilter, GoalStatus, MetaClientRow, clientsForField, countsByField } from "@/utils/metasStatus";
import { STATUS_COLOR, STATUS_LABEL, STATUS_ORDER } from "./metasChartTheme";

interface MetasBarrasProps {
  rows: MetaClientRow[];
  fields: MetaKey[];
  /** id → rótulo do squad, para os gráficos menores por squad. */
  squadLabels: Map<string, string>;
  /** Barra que está filtrando a tabela (fica destacada; as outras do mesmo gráfico esmaecem). */
  filtro?: BarFilter | null;
  /** Clique numa barra → filtra a tabela pelos clientes daquela métrica × grupo. */
  onFiltrar?: (filtro: BarFilter) => void;
}

// Largura por métrica: garante espaço para as três barras + rótulo. Abaixo da largura do
// container o gráfico ocupa tudo; acima, o wrapper rola na horizontal.
const PX_POR_METRICA = 150;
const PX_POR_METRICA_MINI = 108;

// Largura FIXA da coluna, igual à dos gráficos de evolução do CRM (barSize 26 quando há uma
// série, 18 quando há várias). Fixa e não `maxBarSize` porque com 9 métricas o cálculo
// automático deixava as barras finas demais — o cap nunca chegava a valer.
const LARGURA_BARRA = 26;
const LARGURA_BARRA_MINI = 18;

// Barras que NÃO são a que está filtrando a tabela: esmaecidas, para a filtrada saltar.
const OPACIDADE_FORA_DO_FILTRO = 0.3;

// As três barras de uma métrica ficam COLADAS (barGap 0) e os grupos ficam bem afastados
// (barCategoryGap), para o olho ler cada métrica como um bloco só. Sem isso as nove métricas
// viram uma fileira contínua de barras em que não se enxerga onde uma acaba e outra começa.
const BAR_GAP = 0;
const BAR_CATEGORY_GAP = "42%";

interface Ponto {
  field: MetaKey;
  label: string;
  ok: number;
  off: number;
  none: number;
}

/** Uma barra do gráfico: a métrica e a cor (grupo) dela. */
interface Barra {
  field: MetaKey;
  status: GoalStatus;
}

/**
 * Estado de UM gráfico (o geral ou o de um squad): qual métrica está com a lista aberta e
 * qual barra dele está filtrando a tabela.
 *
 * Clicar numa barra abre a lista da métrica E filtra a tabela pela cor clicada. Clicar em
 * outra cor da mesma métrica só troca o filtro — a lista continua aberta. Clicar de novo na
 * MESMA barra fecha a lista; o filtro fica (quem tira é o botão "Limpar filtro" da tabela).
 */
function useDetalhe(squad: string | null, filtro: BarFilter | null | undefined, onFiltrar?: (f: BarFilter) => void) {
  const [aberta, setAberta] = useState<Barra | null>(null);
  // O filtro é um só para a tela; só destaca a barra no gráfico de onde o clique veio.
  const destaque = filtro && filtro.squad === squad ? filtro : null;

  const pick = (field: MetaKey, status: GoalStatus) => {
    const mesmaBarra = aberta?.field === field && aberta.status === status;
    // Filtro limpo pelo botão com a lista ainda aberta: o clique reaplica o filtro em vez
    // de fechar a lista.
    const jaFiltrada = !onFiltrar || (destaque?.field === field && destaque.status === status);
    setAberta(mesmaBarra && jaFiltrada ? null : { field, status });
    onFiltrar?.({ field, status, squad });
  };

  return { aberta: aberta?.field ?? null, destaque, pick, fechar: () => setAberta(null) };
}

function useDados(rows: MetaClientRow[], fields: MetaKey[]): Ponto[] {
  return useMemo(() => {
    const counts = countsByField(rows, fields);
    return fields.map((f) => {
      const c = counts.get(f) ?? { ok: 0, off: 0, none: 0 };
      return { field: f, label: META_LABELS[f], ok: c.ok, off: c.off, none: c.none };
    });
  }, [rows, fields]);
}

function Grafico({
  data,
  altura,
  minWidth,
  compacto,
  destaque,
  onPick,
}: {
  data: Ponto[];
  altura: number;
  minWidth: number;
  compacto?: boolean;
  /** Barra destacada (a que filtra a tabela). null = nenhuma, todas com a cor cheia. */
  destaque?: Barra | null;
  /** Clique numa barra → abre o detalhamento daquela métrica (e diz QUAL cor foi clicada). */
  onPick?: (field: MetaKey, status: GoalStatus) => void;
}) {
  return (
    <div className="overflow-x-auto pb-2">
      <div style={{ minWidth }} className="w-full">
        <ResponsiveContainer width="100%" height={altura}>
          <BarChart
            data={data}
            margin={{ top: 16, right: 8, left: 0, bottom: 8 }}
            barGap={BAR_GAP}
            barCategoryGap={BAR_CATEGORY_GAP}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: compacto ? 9 : 10, fill: "hsl(var(--muted-foreground))" }}
              interval={0}
              angle={-15}
              textAnchor="end"
              height={compacto ? 46 : 56}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: compacto ? 9 : 10, fill: "hsl(var(--muted-foreground))" }}
              width={compacto ? 26 : 32}
            />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            {!compacto && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {STATUS_ORDER.map((s) => (
              <Bar
                key={s}
                dataKey={s}
                name={STATUS_LABEL[s]}
                fill={STATUS_COLOR[s]}
                radius={[3, 3, 0, 0]}
                barSize={compacto ? LARGURA_BARRA_MINI : LARGURA_BARRA}
                onClick={onPick ? (d: unknown) => onPick((d as { payload?: Ponto })?.payload?.field as MetaKey, s) : undefined}
                className={onPick ? "cursor-pointer" : undefined}
              >
                {destaque &&
                  data.map((p) => (
                    <Cell
                      key={p.field}
                      fillOpacity={p.field === destaque.field && s === destaque.status ? 1 : OPACIDADE_FORA_DO_FILTRO}
                    />
                  ))}
                <LabelList
                  dataKey={s}
                  position="top"
                  fontSize={compacto ? 8 : 10}
                  fill="hsl(var(--muted-foreground))"
                />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Uma coluna do detalhamento: o grupo, quantos clientes e a lista de nomes. */
function ColunaDetalhe({ status, clientes }: { status: GoalStatus; clientes: string[] }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLOR[status] }} />
        <span className="text-[11px] font-semibold text-foreground">{STATUS_LABEL[status]}</span>
        <span className="text-[10px] text-muted-foreground">({clientes.length})</span>
      </div>
      {clientes.length === 0 ? (
        <p className="text-[10px] text-muted-foreground pl-3.5">Nenhum cliente.</p>
      ) : (
        <ul className="space-y-0.5 max-h-[220px] overflow-y-auto pr-1">
          {clientes.map((c) => (
            <li key={c} className="text-[11px] text-muted-foreground pl-3.5 truncate" title={prettyClientLabel(c)}>
              {prettyClientLabel(c)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Detalhamento de UMA métrica, aberto PARA BAIXO ao clicar numa barra.
 *
 * A animação é de grid-template-rows 0fr → 1fr: é o jeito de animar altura sem fixar um valor
 * em pixels (a lista tem tamanho variável, e max-height chutado ou corta a lista ou faz a
 * animação "esperar" no fim).
 */
function DetalheMetrica({
  field,
  rows,
  onClose,
}: {
  field: MetaKey | null;
  rows: MetaClientRow[];
  onClose: () => void;
}) {
  const listas = useMemo(() => (field ? clientsForField(rows, field) : null), [field, rows]);
  return (
    <div
      className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
      style={{ gridTemplateRows: field ? "1fr" : "0fr" }}
      aria-hidden={!field}
    >
      <div className="overflow-hidden">
        {field && listas && (
          <div className="neu-inset rounded-xl p-3 mt-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground">{META_LABELS[field]} · por cliente</span>
              <button type="button" onClick={onClose} title="Fechar" className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {STATUS_ORDER.map((st) => (
                <ColunaDetalhe key={st} status={st} clientes={listas[st]} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GraficoSquad({
  squad,
  titulo,
  rows,
  fields,
  filtro,
  onFiltrar,
}: {
  squad: string;
  titulo: string;
  rows: MetaClientRow[];
  fields: MetaKey[];
  filtro?: BarFilter | null;
  onFiltrar?: (filtro: BarFilter) => void;
}) {
  const data = useDados(rows, fields);
  const { aberta, destaque, pick, fechar } = useDetalhe(squad, filtro, onFiltrar);
  return (
    <div className="neu-card rounded-xl p-3">
      <p className="text-xs font-semibold text-foreground truncate" title={titulo}>
        {titulo}
      </p>
      <p className="text-[10px] text-muted-foreground mb-1">{rows.length} cliente(s)</p>
      <Grafico
        data={data}
        altura={200}
        minWidth={Math.max(fields.length * PX_POR_METRICA_MINI, 260)}
        compacto
        destaque={destaque}
        onPick={pick}
      />
      <DetalheMetrica field={aberta} rows={rows} onClose={fechar} />
    </div>
  );
}

/**
 * Quantos clientes estão dentro/fora/sem meta em CADA métrica selecionada.
 * Três barras por métrica — uma por grupo, as mesmas cores da pizza.
 *
 * Abaixo do gráfico geral vem um gráfico menor POR SQUAD (duas colunas), para comparar os
 * squads entre si sem perder a leitura da carteira inteira.
 *
 * Clicar numa barra abre PARA BAIXO a lista de clientes daquela métrica, separada em dentro /
 * fora / sem meta. Cada gráfico (o geral e o de cada squad) tem o seu próprio detalhamento,
 * então dá para abrir "Leads CRM" de um squad sem perder o que estava aberto no geral.
 *
 * O mesmo clique filtra a tabela de baixo pela COR clicada (métrica × grupo; num gráfico de
 * squad, só os clientes daquele squad). Esse filtro é um só para a tela inteira: a última
 * barra clicada vence.
 */
export function MetasBarras({ rows, fields, squadLabels, filtro, onFiltrar }: MetasBarrasProps) {
  const data = useDados(rows, fields);
  // Métrica com o detalhamento aberto (uma por vez: duas listas abertas empurrariam os
  // gráficos por squad para fora da tela).
  const { aberta, destaque, pick, fechar } = useDetalhe(null, filtro, onFiltrar);

  const porSquad = useMemo(() => {
    const bySquad = new Map<string, MetaClientRow[]>();
    for (const r of rows) {
      if (r.squad == null) continue;
      const list = bySquad.get(r.squad);
      if (list) list.push(r);
      else bySquad.set(r.squad, [r]);
    }
    return [...bySquad.entries()]
      .map(([id, list]) => ({ id, titulo: squadLabels.get(id) ?? id, rows: list }))
      .sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"));
  }, [rows, squadLabels]);

  return (
    <div className="neu-card rounded-xl p-4">
      <h3 className="text-sm font-semibold text-foreground mb-1">Clientes por métrica</h3>
      <p className="text-[11px] text-muted-foreground mb-3">
        Quantos clientes estão dentro, fora ou sem meta cadastrada em cada métrica. Clique numa
        barra para listar os clientes daquela métrica e filtrar a tabela abaixo pelo grupo clicado.
      </p>

      <Grafico
        data={data}
        altura={300}
        minWidth={Math.max(fields.length * PX_POR_METRICA, 320)}
        destaque={destaque}
        onPick={pick}
      />
      <DetalheMetrica field={aberta} rows={rows} onClose={fechar} />

      {porSquad.length > 0 && (
        <>
          <h4 className="text-xs font-semibold text-foreground mt-4 mb-2">Por squad</h4>
          {/* Uma coluna no celular, duas a partir do lg — cada squad mantém a mesma escala
              de leitura do gráfico geral. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {porSquad.map((s) => (
              <GraficoSquad
                key={s.id}
                squad={s.id}
                titulo={s.titulo}
                rows={s.rows}
                fields={fields}
                filtro={filtro}
                onFiltrar={onFiltrar}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
