import { useMemo, useState } from "react";
import { Filter } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ClientesHeader } from "@/components/clientes/ClientesHeader";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { CarteiraToggle } from "@/components/clientes/CarteiraToggle";
import { useClientesFilters } from "@/contexts/ClientesFiltersContext";
import { MetaKey, META_LABELS } from "@/hooks/useClientesMetas";
import { useMetasVisaoGeral } from "@/hooks/useMetasVisaoGeral";
import { BarFilter, METAS_FIELDS, rowsForBar } from "@/utils/metasStatus";
import { FAIXAS_MATURIDADE, MaturidadeId } from "@/data/squads";
import { OrigemMultiSelect } from "@/components/clientes/OrigemMultiSelect";
import { MetasMultiSelect } from "@/components/clientes/metas/MetasMultiSelect";
import { MetasPizzas } from "@/components/clientes/metas/MetasPizzas";
import { MetasBarras } from "@/components/clientes/metas/MetasBarras";
import { MetasTabela } from "@/components/clientes/metas/MetasTabela";
import { STATUS_LABEL } from "@/components/clientes/metas/metasChartTheme";

/**
 * Clientes › Metas — visão de carteira do planejado.
 *
 * Responde "quem está dentro da meta e quem não está", em vez de abrir cliente por cliente
 * no CRM. Só existem os 9 campos com meta cadastrada (`clientes_meta`): Meta Ads e Google
 * Ads não têm planejado próprio, então não entram aqui.
 *
 * Filtros: NADA marcado = TUDO (todos os squads, todas as métricas) — o gestor abre a tela e
 * já vê a carteira inteira; marcar é que restringe. O período é o compartilhado das telas de
 * /clientes, então trocar aqui reflete no CRM e vice-versa.
 */
export default function ClientesMetas() {
  const { filters, patch } = useClientesFilters();
  const { dateFrom, dateTo } = filters;

  const [squadSel, setSquadSel] = useState<string[]>([]);
  const [fieldSel, setFieldSel] = useState<MetaKey[]>([]);
  const [crmSel, setCrmSel] = useState<string[]>([]);
  const [maturidadeSel, setMaturidadeSel] = useState<MaturidadeId[]>([]);
  // A origem é COMPARTILHADA com CRM/Meta Ads/Google Ads (mesmo contexto de filtros das
  // outras telas de /clientes), igual ao período — escolher aqui reflete lá e vice-versa.
  const origemFilter = filters.origem;

  // Vazio = todas (as duas barras seguem a mesma regra). Memoizado porque a identidade do
  // array é dependência do cruzamento real × meta — recriá-lo a cada render refaria a conta
  // de todos os clientes à toa.
  const fields = useMemo(
    () => (fieldSel.length > 0 ? METAS_FIELDS.filter((f) => fieldSel.includes(f)) : METAS_FIELDS),
    [fieldSel],
  );

  // Objeto memoizado: é dependência do cruzamento real × meta lá dentro, então recriá-lo a
  // cada render refaria a conta de todos os clientes à toa.
  const filtros = useMemo(
    () => ({ squads: squadSel, origens: origemFilter, crm: crmSel, maturidades: maturidadeSel }),
    [squadSel, origemFilter, crmSel, maturidadeSel],
  );

  // `squads` = líderes de RevOps da planilha de projetos; o id do filtro É o nome do líder.
  const { rows, squads, origens, loading, error } = useMetasVisaoGeral(dateFrom, dateTo, fields, filtros);

  const squadOptions = useMemo(() => squads.map((s) => ({ id: s, label: s })), [squads]);
  const squadLabels = useMemo(() => new Map(squads.map((s) => [s, s])), [squads]);

  // Barra clicada em "Clientes por métrica": filtra SÓ a tabela (os gráficos seguem mostrando
  // a carteira inteira, senão o clique apagaria as outras barras). Se a métrica do filtro sai
  // da seleção lá em cima, o filtro deixa de valer em vez de esvaziar a tabela.
  const [filtroBarra, setFiltroBarra] = useState<BarFilter | null>(null);
  const filtroAtivo = filtroBarra && fields.includes(filtroBarra.field) ? filtroBarra : null;
  const rowsTabela = useMemo(() => rowsForBar(rows, filtroAtivo), [rows, filtroAtivo]);
  const filtroLabel = filtroAtivo
    ? [
        META_LABELS[filtroAtivo.field],
        STATUS_LABEL[filtroAtivo.status],
        filtroAtivo.squad != null ? (squadLabels.get(filtroAtivo.squad) ?? filtroAtivo.squad) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <ClientesHeader activeTab="Metas" />

        <div className="neu-card rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Filtros</span>
          </div>

          {/* Uma linha só: Período · Squads · Métricas. flex-wrap p/ quebrar em telas
              estreitas em vez de estourar a largura do card. */}
          <div className="flex flex-wrap items-center gap-3">
            <CarteiraToggle />

            <DateRangePicker from={dateFrom} to={dateTo} onChange={({ from, to }) => patch({ dateFrom: from, dateTo: to })} />

            <MetasMultiSelect
              title="Squads"
              options={squadOptions}
              selected={squadSel}
              onChange={setSquadSel}
              placeholder="Todos os squads"
              pluralNoun="squads"
              disabled={squadOptions.length === 0}
              hint={
                squadOptions.length === 0
                  ? "Nenhum líder de RevOps encontrado na planilha de projetos — a tela lista todos os clientes."
                  : undefined
              }
            />

            <MetasMultiSelect
              title="Métricas"
              options={METAS_FIELDS.map((f) => ({ id: f, label: META_LABELS[f] }))}
              selected={fieldSel}
              onChange={(ids) => setFieldSel(ids as MetaKey[])}
              placeholder="Todas as métricas"
              pluralNoun="métricas"
            />

            {/* Mesmo componente e mesma lista de origens da tela de CRM. */}
            <OrigemMultiSelect
              value={origemFilter}
              onChange={(v) => patch({ origem: v })}
              options={origens}
            />

            <MetasMultiSelect
              title="CRM"
              options={[
                { id: "com", label: "Com CRM" },
                { id: "sem", label: "Sem CRM" },
              ]}
              selected={crmSel}
              onChange={setCrmSel}
              placeholder="Com e sem CRM"
              pluralNoun="opções"
              hint="Conforme a planilha de projetos. Cliente sem essa informação preenchida não entra em nenhum dos dois lados."
            />

            <MetasMultiSelect
              title="Maturidade"
              options={FAIXAS_MATURIDADE.map((f) => ({ id: f.id, label: f.label }))}
              selected={maturidadeSel}
              onChange={(ids) => setMaturidadeSel(ids as MaturidadeId[])}
              placeholder="Todas as maturidades"
              pluralNoun="faixas"
              hint="Tempo de casa contado da data de início na planilha de projetos."
            />
          </div>
        </div>

        {error && (
          <div className="neu-card rounded-xl p-4 text-xs text-destructive">
            Não foi possível carregar os dados: {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            <div className="skeleton-loading h-[280px] rounded-xl" />
            <div className="skeleton-loading h-[300px] rounded-xl" />
            <div className="skeleton-loading h-[240px] rounded-xl" />
          </div>
        ) : (
          <>
            <MetasPizzas rows={rows} squadLabels={squadLabels} />
            <MetasBarras
              rows={rows}
              fields={fields}
              squadLabels={squadLabels}
              filtro={filtroAtivo}
              onFiltrar={setFiltroBarra}
            />
            <MetasTabela
              rows={rowsTabela}
              fields={fields}
              filtroLabel={filtroLabel}
              onLimparFiltro={() => setFiltroBarra(null)}
            />
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
