import * as React from "react";
import { toast } from "sonner";
import type { DateRange } from "react-day-picker";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { Filter, Plus, X } from "lucide-react";
import { MetaKPIGrid, type MetaTotais } from "@/components/meta/MetaKPIGrid";
import { MetaEvolucaoChart } from "@/components/meta/MetaEvolucaoChart";
import { MetaFunilConversao } from "@/components/meta/MetaFunilConversao";
import { MetaEditDialog } from "@/components/meta/MetaEditDialog";

import { SERIES } from "@/components/meta/metaIndicadores";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { type CaptacaoMetaRow, linhaVazia, useCaptacaoMetas, valorDe } from "@/hooks/useCaptacaoMetas";
import { useCaptacaoInvestimentoReal } from "@/hooks/useCaptacaoInvestimentoReal";
import { useCaptacaoDateRange } from "@/hooks/useCaptacaoDateRange";
import { mesLabel } from "@/lib/metaDatas";
import { mesAtualStr, podeEditarMes, type MetasEditScope } from "@/lib/metasEditScope";
import { useAuth } from "@/contexts/AuthContext";

const PERIODO_EDICAO_KEY = "companium.captacao.metas.periodoEdicao";

export default function MetaPage() {
  // Edição das metas por intervalo de mês (passado/presente/futuro), concedida por usuário na
  // Administração ("Edição Metas"). admin edita os três. Substitui a antiga regra fixa do Bruno.
  const { user, canEditMetasPast, canEditMetasPresent, canEditMetasFuture } = useAuth();
  const scope: MetasEditScope = {
    past: canEditMetasPast,
    present: canEditMetasPresent,
    future: canEditMetasFuture,
  };
  // Pode abrir o editor se tiver ao menos um intervalo liberado.
  const podeEditar = scope.past || scope.present || scope.future;
  const { rows, loading, salvarMes } = useCaptacaoMetas();

  // Filtro de DATA compartilhado com as telas Meta Ads e Google Ads da Captação
  // e persistido — muda numa tela, muda nas outras e sobrevive à troca de página/aba.
  const { dateFrom, dateTo, setRange } = useCaptacaoDateRange();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  // Período de edição persistido: sobrevive ao fechar/reabrir o diálogo e ao recarregar a página.
  const [periodoEdicao, setPeriodoEdicao] = React.useState<DateRange | undefined>(() => ({
    from: startOfMonth(new Date()),
    to: new Date(),
  }));
  const [salvando, setSalvando] = React.useState(false);

  // Restaura o período salvo (somente no cliente, para não quebrar a hidratação).
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(PERIODO_EDICAO_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { from?: string; to?: string };
        if (p.from) setPeriodoEdicao({ from: new Date(p.from), to: p.to ? new Date(p.to) : undefined });
      }
    } catch {
      /* ignora */
    }
  }, []);

  React.useEffect(() => {
    if (periodoEdicao?.from) {
      localStorage.setItem(
        PERIODO_EDICAO_KEY,
        JSON.stringify({
          from: periodoEdicao.from.toISOString(),
          to: periodoEdicao.to ? periodoEdicao.to.toISOString() : undefined,
        })
      );
    } else {
      localStorage.removeItem(PERIODO_EDICAO_KEY);
    }
  }, [periodoEdicao]);

  const inicioEf = dateFrom ? format(dateFrom, "yyyy-MM") : null;
  const fimEf = dateTo ? format(dateTo, "yyyy-MM") : null;

  // Investimento REAL da captação vem do banco (Meta Ads + Google Ads das contas
  // próprias da Groohub), não mais manual. O resto dos indicadores segue de `captacao_metas`.
  const adsFrom = dateFrom ? format(startOfMonth(dateFrom), "yyyy-MM-dd") : undefined;
  const adsTo = dateTo ? format(endOfMonth(dateTo), "yyyy-MM-dd") : undefined;
  const { porMes: investRealPorMes, loading: investLoading } =
    useCaptacaoInvestimentoReal(adsFrom, adsTo);

  const filtradas = React.useMemo(() => {
    const byMes = new Map<string, CaptacaoMetaRow>();
    for (const r of rows) {
      if ((!inicioEf || r.mes >= inicioEf) && (!fimEf || r.mes <= fimEf)) byMes.set(r.mes, r);
    }
    // Meses com investimento real no período mas SEM linha manual entram só com o
    // investimento (demais indicadores ficam zerados — não há entrada manual pra eles).
    for (const mes of investRealPorMes.keys()) {
      if ((inicioEf && mes < inicioEf) || (fimEf && mes > fimEf)) continue;
      if (!byMes.has(mes)) byMes.set(mes, linhaVazia(mes));
    }
    // Sobrepõe o investimento_real de cada mês com o valor calculado do banco.
    return [...byMes.values()]
      .map((r) => ({ ...r, investimento_real: investRealPorMes.get(r.mes) ?? 0 }))
      .sort((a, b) => a.mes.localeCompare(b.mes));
  }, [rows, inicioEf, fimEf, investRealPorMes]);

  const totais = React.useMemo(() => {
    const acc: MetaTotais = {};
    for (const s of SERIES) acc[s.id] = { plan: 0, real: 0 };
    for (const r of filtradas) {
      for (const s of SERIES) {
        const alvo = acc[s.id]!;
        alvo.plan += valorDe(r, s.key, "plan", s.variante);
        alvo.real += valorDe(r, s.key, "real", s.variante);
      }
    }
    return acc;
  }, [filtradas]);

  const handleSalvar = async (novasLinhas: CaptacaoMetaRow[]) => {
    // Backstop: bloqueia meses fora dos escopos concedidos, mesmo que o período
    // persistido/selecionado abranja meses sem permissão.
    const mesAtual = mesAtualStr();
    const bloqueados = novasLinhas.filter((r) => !podeEditarMes(r.mes, mesAtual, scope));
    if (bloqueados.length) {
      toast.error(
        `Você não tem acesso para editar: ${bloqueados.map((r) => mesLabel(r.mes)).join(", ")}.`
      );
      return;
    }
    setSalvando(true);
    try {
      for (const row of novasLinhas) {
        await salvarMes(row, user?.email ?? null);
      }
      const label = novasLinhas.map((r) => mesLabel(r.mes)).join(", ");
      toast.success(`Metas de ${label} salvas.`);
      setDialogOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar metas.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="neu-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Filtros</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Mesmo seletor de período das outras telas (Clientes e Captação › Meta Ads/
                Google Ads): calendário range único com presets (Hoje, Últimos 7/30/90 dias,
                Este mês, etc.) e "Aplicar". Substitui os dois seletores de dia avulsos que
                divergiam do padrão do resto do dashboard. */}
            <DateRangePicker
              from={dateFrom}
              to={dateTo}
              onChange={({ from, to }) => setRange(from, to)}
            />

            {(dateFrom || dateTo) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRange(undefined, undefined)}
                className="flex items-center gap-1.5 text-xs font-medium bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/20 hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
                Limpar filtros
              </Button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {podeEditar && (
              <Button
                size="sm"
                onClick={() => setDialogOpen(true)}
                className="neu-button-primary border-0 h-9 px-4 text-xs font-semibold tracking-wide"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Editar metas
              </Button>
            )}
          </div>
        </div>
      </div>

      {loading || investLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton-loading h-32 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <MetaKPIGrid totais={totais} />
          <MetaEvolucaoChart rows={filtradas} />
          <MetaFunilConversao totais={totais} />
        </>
      )}

      {podeEditar && (
        <MetaEditDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          rows={rows}
          periodo={periodoEdicao}
          onPeriodoChange={setPeriodoEdicao}
          salvando={salvando}
          onSalvar={handleSalvar}
          scope={scope}
        />
      )}
    </div>
  );
}
