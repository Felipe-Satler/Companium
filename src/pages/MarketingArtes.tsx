import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MetasMultiSelect } from "@/components/clientes/metas/MetasMultiSelect";
import { MineracaoHeader } from "@/components/marketing/mineracao/MineracaoHeader";
import { ArteAberta } from "@/components/marketing/oficina/ArteAberta";
import { ArteCard } from "@/components/marketing/oficina/ArteCard";
import { OficinaSubnav } from "@/components/marketing/oficina/OficinaSubnav";
import { filtrarArtes, type FiltroDeArtes } from "@/components/marketing/oficina/filtrarArtes";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CHAVE_ARTES_SALVAS, chaveDaArte, useArtesSalvas, useToken } from "@/hooks/useArtes";
import { useEspecialidades } from "@/hooks/useEspecialidades";
import { apagarArte } from "@/lib/artesApi";

/**
 * Oficina de Artes › Artes Salvas: todas as artes da carteira, com filtro por cliente, especialidade,
 * uso e formato de origem. Abrir uma mostra como ela fica no Instagram, no Facebook e no WhatsApp.
 *
 * A arte aberta vai na URL (`?arte=`): é o link que a Nova arte manda ("Ver nas Artes Salvas") e o
 * que se cola para mostrar uma arte a alguém da equipe.
 */

const TODOS = "__todos__";

export default function MarketingArtes() {
  const [params, setParams] = useSearchParams();
  const token = useToken();
  const qc = useQueryClient();
  const aberta = params.get("arte");
  const { data: artes, isLoading, error } = useArtesSalvas();
  const { especialidadeOptions, getEspecialidades, loading: espLoading } = useEspecialidades();
  const [filtro, setFiltro] = useState<FiltroDeArtes>({ cliente: null, especialidades: [], uso: null, formato: null });

  const clientes = useMemo(() => {
    const vistos = new Map<string, string>();
    for (const a of artes ?? []) if (!vistos.has(a.cliente)) vistos.set(a.cliente, a.nome_exibicao || a.cliente);
    return [...vistos].map(([value, label]) => ({ value, label })).sort((x, y) => x.label.localeCompare(y.label, "pt-BR"));
  }, [artes]);

  const visiveis = useMemo(() => filtrarArtes(artes ?? [], filtro, getEspecialidades), [artes, filtro, getEspecialidades]);

  const abrir = (id: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (id) n.set("arte", id);
      else n.delete("arte");
      return n;
    });

  const apagar = async (id: string) => {
    try {
      await apagarArte(token, id);
      qc.removeQueries({ queryKey: chaveDaArte(id) });
      await qc.invalidateQueries({ queryKey: CHAVE_ARTES_SALVAS });
      void qc.invalidateQueries({ queryKey: ["marketing-artes"] });
      abrir(null);
      toast.success("Arte apagada.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível apagar a arte.");
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <MineracaoHeader activeTab="Oficina de Artes" />
        <OficinaSubnav activeTab="Artes Salvas" />

        {aberta ? (
          <ArteAberta id={aberta} onVoltar={() => abrir(null)} onApagar={apagar} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <SearchableSelect
                options={clientes}
                value={filtro.cliente ?? TODOS}
                onValueChange={(v) => setFiltro((f) => ({ ...f, cliente: v && v !== TODOS ? v : null }))}
                allOption={{ value: TODOS, label: "Todos os clientes" }}
                searchPlaceholder="Buscar cliente"
                triggerClassName="h-9 w-56 text-xs"
              />
              <MetasMultiSelect
                title="Especialidades"
                options={especialidadeOptions.map((e) => ({ id: e, label: e }))}
                selected={filtro.especialidades}
                onChange={(especialidades) => setFiltro((f) => ({ ...f, especialidades }))}
                placeholder={espLoading ? "Carregando…" : "Todas as especialidades"}
                pluralNoun="especialidades"
                disabled={espLoading}
                searchable
              />
              <Select value={filtro.uso ?? TODOS} onValueChange={(v) => setFiltro((f) => ({ ...f, uso: v === TODOS ? null : (v as FiltroDeArtes["uso"]) }))}>
                <SelectTrigger className="h-9 w-40 text-xs" aria-label="Uso">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS} className="text-xs">Orgânico e pago</SelectItem>
                  <SelectItem value="organico" className="text-xs">Orgânico</SelectItem>
                  <SelectItem value="pago" className="text-xs">Pago</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filtro.formato ?? TODOS} onValueChange={(v) => setFiltro((f) => ({ ...f, formato: v === TODOS ? null : v }))}>
                <SelectTrigger className="h-9 w-44 text-xs" aria-label="Formato de origem">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS} className="text-xs">Feed e Meta Ads</SelectItem>
                  <SelectItem value="instagram_feed" className="text-xs">Instagram Feed</SelectItem>
                  <SelectItem value="meta_ads" className="text-xs">Meta Ads</SelectItem>
                </SelectContent>
              </Select>
              {artes && (
                <span className="text-xs text-muted-foreground">
                  {visiveis.length} de {artes.length} arte{artes.length === 1 ? "" : "s"}
                </span>
              )}
            </div>

            {isLoading ? (
              <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> carregando as artes…
              </p>
            ) : error ? (
              <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Não foi possível carregar as artes."}</p>
            ) : !artes?.length ? (
              <p className="text-sm text-muted-foreground">Nenhuma arte ainda. Crie a primeira em "Nova arte".</p>
            ) : !visiveis.length ? (
              <p className="text-sm text-muted-foreground">Nenhuma arte com esses filtros.</p>
            ) : (
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(222px,1fr))]">
                {visiveis.map((a) => (
                  <ArteCard key={a.id} arte={a} onAbrir={() => abrir(a.id)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
