import {
  DollarSign,
  Users,
  Target,
  TrendingUp,
  CalendarCheck,
  Stethoscope,
  BarChart3,
} from "lucide-react";

interface RelatorioGeralSummaryProps {
  adsTotals: {
    spend: number;
    leads: number;
    impressions: number;
    clicks: number;
    reach: number;
  };
  crmTotals: {
    leadsCRM: number;
    consultasAgendadas: number;
    valorConsultasAgendadas: number;
    consultasRealizadas: number;
    valorConsultasRealizadas: number;
    procedimentosAgendados: number;
    valorProcedimentosAgendados: number;
    procedimentosRealizados: number;
    valorProcedimentosRealizados: number;
    faturamentoBruto: number;
    roas: number;
    investimentoTotal: number;
  };
  metaTotals: { spend: number; leads: number };
  googleTotals: { spend: number; leads: number };
}

function fmt(val: number) {
  // Sempre o valor inteiro exato (com separador de milhar), sem abreviar p/ "Mil"/"Mi".
  return val.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function fmtCurrency(val: number) {
  return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function KPICard({ label, value, accent, icon: Icon, secondary }: { label: string; value: string; accent?: string; icon: React.ElementType; secondary?: string }) {
  return (
    <div className="neu-card rounded-xl p-4 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-full neu-inset text-muted-foreground shrink-0">
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <p className={`text-xl font-bold ${accent || "text-foreground"}`}>{value}</p>
      {secondary && <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">{secondary}</p>}
    </div>
  );
}

function SourceCompareCard({ metaSpend, metaLeads, googleSpend, googleLeads }: { metaSpend: number; metaLeads: number; googleSpend: number; googleLeads: number }) {
  const totalSpend = metaSpend + googleSpend;
  const metaPct = totalSpend > 0 ? (metaSpend / totalSpend) * 100 : 0;
  const googlePct = totalSpend > 0 ? (googleSpend / totalSpend) * 100 : 0;
  const metaCPL = metaLeads > 0 ? metaSpend / metaLeads : 0;
  const googleCPL = googleLeads > 0 ? googleSpend / googleLeads : 0;

  return (
    <div className="neu-card rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full neu-inset text-primary shrink-0">
          <BarChart3 className="h-3.5 w-3.5" />
        </span>
        Meta Ads vs Google Ads
      </h3>

      {/* Split bar */}
      <div className="space-y-2">
        <div className="flex h-3 rounded-full overflow-hidden bg-secondary">
          <div className="bg-primary transition-all" style={{ width: `${metaPct}%` }} />
          <div className="bg-chart-2 transition-all" style={{ width: `${googlePct}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>Meta {metaPct.toFixed(0)}%</span>
          <span>Google {googlePct.toFixed(0)}%</span>
        </div>
      </div>

      {/* Comparison table */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div />
        <div className="font-semibold text-primary">Meta</div>
        <div className="font-semibold text-chart-2">Google</div>

        <div className="text-muted-foreground text-left">Investimento</div>
        <div className="font-medium text-foreground">{fmtCurrency(metaSpend)}</div>
        <div className="font-medium text-foreground">{fmtCurrency(googleSpend)}</div>

        <div className="text-muted-foreground text-left">Leads</div>
        <div className="font-medium text-foreground">{fmt(metaLeads)}</div>
        <div className="font-medium text-foreground">{fmt(googleLeads)}</div>

        <div className="text-muted-foreground text-left">CPL</div>
        <div className="font-medium text-foreground">{fmtCurrency(metaCPL)}</div>
        <div className="font-medium text-foreground">{fmtCurrency(googleCPL)}</div>
      </div>
    </div>
  );
}

function CRMFunnelMini({ crmTotals }: { crmTotals: RelatorioGeralSummaryProps["crmTotals"] }) {
  const stages = [
    { label: "Leads CRM", count: crmTotals.leadsCRM },
    { label: "Consultas Agend.", count: crmTotals.consultasAgendadas },
    { label: "Consultas Realiz.", count: crmTotals.consultasRealizadas },
    { label: "Proced. Agend.", count: crmTotals.procedimentosAgendados },
    { label: "Proced. Realiz.", count: crmTotals.procedimentosRealizados },
  ];
  const max = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div className="neu-card rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full neu-inset text-primary shrink-0">
          <Stethoscope className="h-3.5 w-3.5" />
        </span>
        Funil CRM Resumido
      </h3>
      <div className="space-y-2">
        {stages.map((s, i) => {
          const pct = (s.count / max) * 100;
          const rate = i > 0 && stages[i - 1].count > 0
            ? ((s.count / stages[i - 1].count) * 100).toFixed(1)
            : null;
          return (
            <div key={s.label} className="flex items-center gap-3">
              <span className="text-[10px] text-muted-foreground w-28 shrink-0 truncate">{s.label}</span>
              <div className="flex-1 h-5 bg-secondary rounded-full overflow-hidden relative">
                <div
                  className="h-full bg-primary/60 rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-foreground">
                  {fmt(s.count)}
                </span>
              </div>
              {rate && (
                <span className="text-[10px] text-muted-foreground w-12 text-right">{rate}%</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RelatorioGeralSummary({ adsTotals, crmTotals, metaTotals, googleTotals }: RelatorioGeralSummaryProps) {
  const avgCPL = adsTotals.leads > 0 ? adsTotals.spend / adsTotals.leads : 0;
  const ctr = adsTotals.impressions > 0 ? (adsTotals.clicks / adsTotals.impressions) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Top KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPICard label="Investimento Total" value={fmtCurrency(adsTotals.spend)} accent="text-primary" icon={DollarSign} />
        <KPICard label="Leads Tráfego" value={fmt(adsTotals.leads)} accent="text-primary" icon={Target} />
        <KPICard label="CPL Médio" value={fmtCurrency(avgCPL)} icon={DollarSign} />
        <KPICard label="Leads CRM" value={fmt(crmTotals.leadsCRM)} accent="text-blue-600 dark:text-blue-400" icon={Users} />
        <KPICard label="Faturamento Bruto" value={fmtCurrency(crmTotals.faturamentoBruto)} accent="text-emerald-600 dark:text-emerald-400" icon={TrendingUp} />
        <KPICard label="ROAS" value={`${crmTotals.roas.toFixed(2)}x`} accent="text-emerald-600 dark:text-emerald-400" icon={TrendingUp} />
      </div>

      {/* Second row: CRM quick metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPICard label="Consultas Agendadas" value={fmt(crmTotals.consultasAgendadas)} secondary={fmtCurrency(crmTotals.valorConsultasAgendadas)} icon={CalendarCheck} />
        <KPICard label="Consultas Realizadas" value={fmt(crmTotals.consultasRealizadas)} secondary={fmtCurrency(crmTotals.valorConsultasRealizadas)} icon={CalendarCheck} />
        <KPICard label="Proced. Agendados" value={fmt(crmTotals.procedimentosAgendados)} secondary={fmtCurrency(crmTotals.valorProcedimentosAgendados)} icon={Stethoscope} />
        <KPICard label="Proced. Realizados" value={fmt(crmTotals.procedimentosRealizados)} secondary={fmtCurrency(crmTotals.valorProcedimentosRealizados)} icon={Stethoscope} />
      </div>

      {/* Third row: Source comparison + CRM funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SourceCompareCard
          metaSpend={metaTotals.spend}
          metaLeads={metaTotals.leads}
          googleSpend={googleTotals.spend}
          googleLeads={googleTotals.leads}
        />
        <CRMFunnelMini crmTotals={crmTotals} />
      </div>
    </div>
  );
}
