import { Check, Lock } from "lucide-react";
import { CRMTotals } from "@/hooks/useCRMClienteData";
import { FatBasis, OrcamentoParado, investimentoComImposto, INVESTIMENTO_IMPOSTO_RATE } from "@/utils/crmCalculations";
import { cn } from "@/lib/utils";
import { MetaCardsCtx, MetaKey } from "@/hooks/useClientesMetas";
import { MetaSlot } from "@/components/clientes/MetaValueLine";
import { FocusStrip } from "@/components/clientes/FocusStrip";
import { SectionLabel } from "@/components/clientes/SectionLabel";
import { CRMOverrideEdit } from "@/components/clientes/crm/CRMOverrideEdit";
import { CRMOverridesCtx } from "@/hooks/useCRMOverrides";

function fmt(val: number) {
  // Sempre o valor inteiro exato (com separador de milhar), sem abreviar p/ "Mil"/"Mi".
  return val.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function fmtCurrency(val: number) {
  return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Percentual de conversão de uma etapa do funil (parte ÷ base). null quando a base é 0.
function fmtRate(part: number, base: number) {
  if (!base || base <= 0) return null;
  const pct = (part / base) * 100;
  return `${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function MetricCard({ value, label, highlight, accent, sub, extra }: { value: string; label: string; highlight?: boolean; accent?: string; sub?: string; extra?: React.ReactNode }) {
  return (
    <div className="neu-card rounded-2xl p-5 flex flex-col items-center justify-center gap-1">
      <p className={`text-2xl font-bold ${accent || (highlight ? "text-primary" : "text-foreground")}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider text-center">{label}</p>
      {sub && <p className="text-[10px] text-emerald-600/90 dark:text-emerald-400/90 text-center mt-0.5">{sub}</p>}
      {extra}
    </div>
  );
}

// Card de par (count + valor). Quando `selectable`, vira um botão de escolha da base
// do Faturamento Bruto: o card ativo entra na soma; clicar em outro troca a base.
function MetricPairCard({
  left,
  right,
  selectable,
  active,
  disabled,
  onSelect,
  metaSlot,
  overrideSlot,
  valorOverrideSlot,
  rate,
  rateLabel,
  rateTitle,
}: {
  left: { value: string; label: string };
  right: { value: string; label: string };
  selectable?: boolean;
  active?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  /** % de conversão desta etapa do funil (badge ao lado do número). */
  rate?: string | null;
  /** Texto após a % explicando a base (ex.: "das agendadas"). */
  rateLabel?: string;
  /** Tooltip do badge de conversão. */
  rateTitle?: string;
  /** Caixas Real|Meta renderizadas DENTRO do card (não-<button>, c/ stopPropagation). */
  metaSlot?: React.ReactNode;
  /** Controle de correção manual da CONTAGEM (não-<button>, c/ stopPropagation). */
  overrideSlot?: React.ReactNode;
  /** Controle de correção manual do VALOR em R$ (não-<button>, c/ stopPropagation). */
  valorOverrideSlot?: React.ReactNode;
}) {
  const inner = (
    // Coluna do painel de Faturamento (padrão do print): status no topo, rótulo, valor +
    // valor secundário na mesma linha e o planejado (barra) embaixo.
    <div className="flex h-full flex-col gap-2 p-5">
      {selectable && (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider",
            active ? "text-emerald-600" : "text-muted-foreground"
          )}
        >
          {active ? (
            <Check className="h-3 w-3" />
          ) : (
            <span className="h-3 w-3 rounded-full border border-muted-foreground/50" />
          )}
          {active ? "No faturamento" : "Usar"}
        </span>
      )}
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{left.label}</p>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-2xl font-bold text-foreground tabular-nums leading-none">{left.value}</span>
        {rate && (
          <span
            title={rateTitle ?? "Percentual de conversão desta etapa do funil do CRM"}
            className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary tabular-nums leading-none"
          >
            {rate}{rateLabel ? ` ${rateLabel}` : ""}
          </span>
        )}
        <span className="text-sm text-muted-foreground tabular-nums">{right.value}</span>
      </p>
      {(overrideSlot || valorOverrideSlot) && (
        <div className="flex flex-col items-start gap-0.5">
          {overrideSlot}
          {valorOverrideSlot}
        </div>
      )}
      {metaSlot}
    </div>
  );

  if (!selectable) {
    return <div className="h-full">{inner}</div>;
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "h-full w-full text-left transition-colors",
        active ? "bg-emerald-500/[0.06]" : "hover:bg-secondary/40",
        disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
      )}
    >
      {inner}
    </button>
  );
}

const BASIS_LABEL: Record<FatBasis["consulta"] | FatBasis["procedimento"], string> = {
  agendadas: "Consultas agendadas",
  realizadas: "Consultas realizadas",
  agendados: "Proced. agendados",
  realizados: "Proced. realizados",
};

export function CRMMetricsPanel({
  totals,
  computedTotals,
  selectedClient,
  basis,
  onChangeBasis,
  saving,
  metas,
  orcamentoParado,
  canEditCrm = true,
  canEditNumbers = false,
  overrides,
  overridePeriodLabel,
}: {
  totals: CRMTotals;
  /** Totais CALCULADOS (sem correção manual) — referência mostrada no editor de correção. */
  computedTotals?: CRMTotals;
  /** Cliente único filtrado — habilita a escolha da base. undefined = visão agregada. */
  selectedClient?: string;
  basis?: FatBasis;
  onChangeBasis?: (b: FatBasis) => void;
  saving?: boolean;
  /** Permissão de editar o CRM — planejado + base de faturamento (admin/crm_editor). */
  canEditCrm?: boolean;
  /** Permissão SEPARADA p/ corrigir os números do CRM (admin/crm_number_editor). */
  canEditNumbers?: boolean;
  /** Metas do CRM (consultas, faturamento, roas) — rateadas p/ o período. */
  metas?: MetaCardsCtx;
  /** Leads parados na etapa "Orçamento" (retrato atual) + valor represado. */
  orcamentoParado?: OrcamentoParado;
  /** Correções manuais dos números do CRM (Leads/Consultas/Procedimentos) p/ o filtro atual. */
  overrides?: CRMOverridesCtx;
  /** Rótulo do período filtrado, mostrado no editor de correção. */
  overridePeriodLabel?: string;
}) {
  // Referência CALCULADA de cada número (prefill/tooltip do editor). Sem override, `totals`
  // já é o calculado — mas quando há correção, `totals` traz o corrigido, então usamos a base.
  const ct = computedTotals ?? totals;
  const editable = !!selectedClient && !!basis && !!onChangeBasis;
  const b = basis ?? { consulta: "realizadas", procedimento: "realizados" };
  // CPL CRM = investimento total ÷ leads CRM. É o "real" comparado ao planejado de CPL.
  const cplCRM = totals.leadsCRM > 0 ? totals.investimentoTotal / totals.leadsCRM : 0;

  const fatSub = editable
    ? `${BASIS_LABEL[b.consulta]} + ${BASIS_LABEL[b.procedimento]}`
    : undefined;

  // Planos (metas) p/ as barras da faixa de destaque. null = sem plano → sem barra.
  const metaVal = (f: MetaKey) => (metas?.values?.[f]?.value ?? null);
  const pctOf = (real: number, meta: number | null) => (meta && meta > 0 ? (real / meta) * 100 : null);
  const mLeadsCRM = metaVal("leadsCRM");
  const mConsAgend = metaVal("consultaAgendada");
  // % de consultas agendadas sobre o total de leads do CRM (mostrada no card de destaque).
  const rateConsAgend = fmtRate(totals.consultasAgendadas, totals.leadsCRM);
  const mFat = metaVal("faturamento");
  const mRoas = metaVal("roas");

  // Sub-linha "Meta Ads X · Google Y" (mantém Meta e Google separados).
  const fonteSub = (metaN: number, googleN: number) => (
    <>
      Meta Ads <b className="font-bold text-foreground">{fmt(metaN)}</b> · Google{" "}
      <b className="font-bold text-foreground">{fmt(googleN)}</b>
    </>
  );

  return (
    <div className="space-y-4">
      {/* DADOS PRINCIPAIS do CRM (card com realce): Leads CRM, Consultas Agendadas,
          Faturamento, ROAS — com barra de andamento vs. plano. */}
      <FocusStrip
        items={[
          {
            label: "Leads CRM",
            value: fmt(totals.leadsCRM),
            sub: fonteSub(totals.leadsCRMMeta, totals.leadsCRMGoogle),
            pct: pctOf(totals.leadsCRM, mLeadsCRM),
            meta: mLeadsCRM != null ? fmt(mLeadsCRM) : undefined,
          },
          {
            label: "Consultas Agendadas",
            value: String(totals.consultasAgendadas),
            sub: rateConsAgend ? (
              <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary tabular-nums">
                {rateConsAgend} dos leads
              </span>
            ) : undefined,
            pct: pctOf(totals.consultasAgendadas, mConsAgend),
            meta: mConsAgend != null ? fmt(mConsAgend) : undefined,
          },
          {
            label: "Faturamento Bruto",
            value: fmtCurrency(totals.faturamentoBruto),
            pct: pctOf(totals.faturamentoBruto, mFat),
            meta: mFat != null ? fmtCurrency(mFat) : undefined,
          },
          {
            label: "ROAS",
            value: `${totals.roas.toFixed(2)}x`,
            accent: "green",
            pct: pctOf(totals.roas, mRoas),
            meta: mRoas != null ? `${mRoas.toFixed(2).replace(".", ",")}x` : undefined,
          },
        ]}
      />

      <SectionLabel>Métricas detalhadas</SectionLabel>

      {/* Leads Tráfego (quebra Meta/Google) + Leads CRM & CPL CRM lado a lado com o
          planejado editável (movido dos painéis Meta/Google p/ cá). */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="neu-card rounded-2xl p-5 flex flex-col items-center justify-center gap-2">
          <p className="text-2xl font-bold text-primary">{fmt(totals.leadsTrafego)}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider text-center">Leads Tráfego</p>
          <div className="flex items-stretch gap-2 mt-1 w-full max-w-[260px]">
            <div className="flex-1 rounded-[10px] border border-border bg-secondary/40 px-3 py-1.5 text-center">
              <p className="text-base font-semibold text-sky-500">{fmt(totals.leadsTrafegoMeta)}</p>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Meta Ads</p>
            </div>
            <div className="flex-1 rounded-[10px] border border-border bg-secondary/40 px-3 py-1.5 text-center">
              <p className="text-base font-semibold text-amber-500">{fmt(totals.leadsTrafegoGoogle)}</p>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Google</p>
            </div>
          </div>
        </div>
        <div className="neu-card rounded-2xl p-5 md:col-span-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col items-center text-center gap-2">
              <div className="flex flex-col items-center">
                <p className="text-2xl font-bold text-primary">{fmt(totals.leadsCRM)}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Leads CRM</p>
                <CRMOverrideEdit ctx={overrides} metric="leads" computed={ct.leadsCRM} label="Leads CRM" canEdit={canEditNumbers} periodLabel={overridePeriodLabel} />
              </div>
              <MetaSlot wide metas={metas} field="leadsCRM" realText={fmt(totals.leadsCRM)} realValue={totals.leadsCRM} />
              <div className="flex items-stretch gap-2 w-full max-w-[240px] mt-1">
                <div className="flex-1 rounded-[10px] border border-border bg-secondary/40 px-3 py-1.5 text-center">
                  <p className="text-base font-semibold text-sky-500">{fmt(totals.leadsCRMMeta)}</p>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Meta Ads</p>
                </div>
                <div className="flex-1 rounded-[10px] border border-border bg-secondary/40 px-3 py-1.5 text-center">
                  <p className="text-base font-semibold text-amber-500">{fmt(totals.leadsCRMGoogle)}</p>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Google</p>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-center justify-center text-center gap-2 border-l border-border pl-4">
              <div>
                <p className="text-2xl font-bold text-primary">{totals.leadsCRM > 0 ? fmtCurrency(cplCRM) : "—"}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">CPL CRM</p>
              </div>
              <MetaSlot wide metas={metas} field="cplCRM" realText={totals.leadsCRM > 0 ? fmtCurrency(cplCRM) : "—"} realValue={totals.leadsCRM > 0 ? cplCRM : undefined} />
            </div>
          </div>
        </div>
      </div>

      {/* Ajuda contextual sobre a escolha da base do Faturamento Bruto */}
      {!canEditCrm ? (
        <p className="text-[11px] text-muted-foreground px-1 inline-flex items-center gap-1.5">
          <Lock className="h-3 w-3" />
          Somente leitura — apenas usuários autorizados na Administração podem editar o planejado e escolher a base do Faturamento Bruto.
        </p>
      ) : editable ? (
        <p className="text-[11px] text-muted-foreground px-1">
          Clique em <span className="text-foreground font-medium">uma</span> opção de consulta e <span className="text-foreground font-medium">uma</span> de procedimento para definir o Faturamento Bruto deste cliente. A escolha fica salva para todas as contas.
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground px-1 inline-flex items-center gap-1.5">
          <Lock className="h-3 w-3" />
          Selecione um único cliente no filtro para escolher a base do Faturamento Bruto. No agregado, cada cliente entra com a base salva dele.
        </p>
      )}

      {/* Faturamento: Consultas + Procedimentos num PAINEL ÚNICO (4 colunas divididas), no
          padrão do print — seletores da base quando há 1 cliente. */}
      <div className="neu-card rounded-2xl overflow-hidden grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border">
        <MetricPairCard
          left={{ value: String(totals.consultasAgendadas), label: "Consultas Agendadas" }}
          right={{ value: fmtCurrency(totals.valorConsultasAgendadas), label: "Valor Total C. Agendadas" }}
          rate={fmtRate(totals.consultasAgendadas, totals.leadsCRM)}
          rateLabel="dos leads"
          rateTitle="Percentual de leads do CRM que viraram consultas agendadas"
          selectable={editable}
          active={editable && b.consulta === "agendadas"}
          disabled={saving}
          onSelect={() => onChangeBasis?.({ ...b, consulta: "agendadas" })}
          overrideSlot={<CRMOverrideEdit ctx={overrides} metric="consultas_agendadas" computed={ct.consultasAgendadas} label="Consultas Agendadas" canEdit={canEditNumbers} periodLabel={overridePeriodLabel} triggerText="Ajustar número de consultas agendadas" />}
          valorOverrideSlot={<CRMOverrideEdit ctx={overrides} metric="valor_consultas_agendadas" computed={ct.valorConsultasAgendadas} label="Valor Total C. Agendadas" canEdit={canEditNumbers} periodLabel={overridePeriodLabel} triggerText="Ajustar valor das consultas agendadas" />}
          metaSlot={<MetaSlot wide metas={metas} field="consultaAgendada" realText={String(totals.consultasAgendadas)} realValue={totals.consultasAgendadas} />}
        />
        <MetricPairCard
          left={{ value: String(totals.consultasRealizadas), label: "Consultas Realizadas" }}
          right={{ value: fmtCurrency(totals.valorConsultasRealizadas), label: "Valor Total C. Realizadas" }}
          rate={fmtRate(totals.consultasRealizadas, totals.consultasAgendadas)}
          rateLabel="das agendadas"
          rateTitle="Percentual de consultas agendadas que viraram consultas realizadas"
          selectable={editable}
          active={editable && b.consulta === "realizadas"}
          disabled={saving}
          onSelect={() => onChangeBasis?.({ ...b, consulta: "realizadas" })}
          overrideSlot={<CRMOverrideEdit ctx={overrides} metric="consultas_realizadas" computed={ct.consultasRealizadas} label="Consultas Realizadas" canEdit={canEditNumbers} periodLabel={overridePeriodLabel} triggerText="Ajustar número de consultas realizadas" />}
          valorOverrideSlot={<CRMOverrideEdit ctx={overrides} metric="valor_consultas_realizadas" computed={ct.valorConsultasRealizadas} label="Valor Total C. Realizadas" canEdit={canEditNumbers} periodLabel={overridePeriodLabel} triggerText="Ajustar valor das consultas realizadas" />}
          metaSlot={<MetaSlot wide metas={metas} field="consultaRealizada" realText={String(totals.consultasRealizadas)} realValue={totals.consultasRealizadas} />}
        />
        <MetricPairCard
          left={{ value: String(totals.procedimentosAgendados), label: "Procedimentos Agendados" }}
          right={{ value: fmtCurrency(totals.valorProcedimentosAgendados), label: "Valor Total P. Agendados" }}
          rate={fmtRate(totals.procedimentosAgendados, totals.consultasRealizadas)}
          rateLabel="das cons. realizadas"
          rateTitle="Percentual de consultas realizadas que viraram procedimentos agendados"
          selectable={editable}
          active={editable && b.procedimento === "agendados"}
          disabled={saving}
          onSelect={() => onChangeBasis?.({ ...b, procedimento: "agendados" })}
          overrideSlot={<CRMOverrideEdit ctx={overrides} metric="procedimentos_agendados" computed={ct.procedimentosAgendados} label="Procedimentos Agendados" canEdit={canEditNumbers} periodLabel={overridePeriodLabel} triggerText="Ajustar número de procedimentos agendados" />}
          valorOverrideSlot={<CRMOverrideEdit ctx={overrides} metric="valor_procedimentos_agendados" computed={ct.valorProcedimentosAgendados} label="Valor Total P. Agendados" canEdit={canEditNumbers} periodLabel={overridePeriodLabel} triggerText="Ajustar valor dos procedimentos agendados" />}
          metaSlot={<MetaSlot wide metas={metas} field="procedimentoAgendado" realText={String(totals.procedimentosAgendados)} realValue={totals.procedimentosAgendados} />}
        />
        <MetricPairCard
          left={{ value: String(totals.procedimentosRealizados), label: "Procedimentos Realizados" }}
          right={{ value: fmtCurrency(totals.valorProcedimentosRealizados), label: "Valor Total P. Realizados" }}
          rate={fmtRate(totals.procedimentosRealizados, totals.procedimentosAgendados)}
          rateLabel="dos agendados"
          rateTitle="Percentual de procedimentos agendados que viraram procedimentos realizados"
          selectable={editable}
          active={editable && b.procedimento === "realizados"}
          disabled={saving}
          onSelect={() => onChangeBasis?.({ ...b, procedimento: "realizados" })}
          overrideSlot={<CRMOverrideEdit ctx={overrides} metric="procedimentos_realizados" computed={ct.procedimentosRealizados} label="Procedimentos Realizados" canEdit={canEditNumbers} periodLabel={overridePeriodLabel} triggerText="Ajustar número de procedimentos realizados" />}
          valorOverrideSlot={<CRMOverrideEdit ctx={overrides} metric="valor_procedimentos_realizados" computed={ct.valorProcedimentosRealizados} label="Valor Total P. Realizados" canEdit={canEditNumbers} periodLabel={overridePeriodLabel} triggerText="Ajustar valor dos procedimentos realizados" />}
          metaSlot={<MetaSlot wide metas={metas} field="procedimentoRealizado" realText={String(totals.procedimentosRealizados)} realValue={totals.procedimentosRealizados} />}
        />
      </div>

      {/* Leads enviados orçamento — segue o filtro de data (leads criados no período;
          total quando não há filtro). */}
      {orcamentoParado && (
        <div className="neu-card rounded-2xl p-5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-3">
            Orçamentos enviados em
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{fmt(orcamentoParado.count)}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Orçamentos Enviados</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{fmtCurrency(orcamentoParado.valor)}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Valor de Orçamento</p>
            </div>
          </div>
        </div>
      )}

      {/* Bottom: Investimento, Investimento + Imposto, Fat. Bruto, ROAS — metas faturamento + roas */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          value={fmtCurrency(totals.investimentoTotal)}
          label="Investimento Total"
          highlight
          extra={<MetaSlot metas={metas} field="investimento" realText={fmtCurrency(totals.investimentoTotal)} realValue={totals.investimentoTotal} />}
        />
        <MetricCard
          value={fmtCurrency(investimentoComImposto(totals.investimentoTotal))}
          label="Investimento + Imposto"
          sub={`inclui ${(INVESTIMENTO_IMPOSTO_RATE * 100).toLocaleString("pt-BR")}% de imposto`}
        />
        <MetricCard
          value={fmtCurrency(totals.faturamentoBruto)}
          label={saving ? "Faturamento Bruto · salvando…" : "Faturamento Bruto"}
          sub={fatSub}
          extra={<MetaSlot metas={metas} field="faturamento" realText={fmtCurrency(totals.faturamentoBruto)} realValue={totals.faturamentoBruto} />}
        />
        <MetricCard
          value={`${totals.roas.toFixed(2)}x`}
          label="ROAS"
          accent="text-emerald-600 dark:text-emerald-400"
          extra={<MetaSlot metas={metas} field="roas" realText={`${totals.roas.toFixed(2)}x`} realValue={totals.roas} />}
        />
      </div>
    </div>
  );
}
