import { useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MineracaoHeader } from "@/components/marketing/mineracao/MineracaoHeader";
import { MetasMultiSelect } from "@/components/clientes/metas/MetasMultiSelect";
import {
  ClientBriefCard,
  type ClienteCard,
  type ResumoMetricas,
} from "@/components/marketing/clientes/ClientBriefCard";
import { ClientBriefDialog } from "@/components/marketing/clientes/ClientBriefDialog";
import { clientMatchKey } from "@/data/clienteAliases";
import { chavesCandidatas, mesesDeCasa, resolveProjeto } from "@/data/squads";
import { recarregarClientesVisiveis, useClientesVisiveis } from "@/hooks/useClientesVisiveis";
import { useCRMClienteData } from "@/hooks/useCRMClienteData";
import { useClientBriefs, useRefreshBrief } from "@/hooks/useClientBriefs";
import { useEspecialidades } from "@/hooks/useEspecialidades";
import { useProjetosLista } from "@/hooks/useProjetosLista";
import { norm } from "@/lib/texto";

/**
 * Janela dos números do card. Últimos 30 dias: é "como o cliente está agora", que é para o que
 * esta tela serve. Nada a ver com o resumo do agente — ele é semanal e não fala de número.
 */
const DIAS = 30;

function janela() {
  const ate = new Date();
  const de = new Date(ate.getTime() - (DIAS - 1) * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { de: iso(de), ate: iso(ate) };
}

/**
 * Marketing › Clientes — um card por cliente ATIVO, com o resumo do agente e os números do período.
 *
 * Só equipe interna: /marketing/clientes não está na CLIENT_USER_ALLOWED do ProtectedRoute, e o
 * worker recusa quem tem linha em `user_client_scope`.
 */
export default function MarketingClientes() {
  // Arma o filtro de ativos/ocultos. Sem isso `index.ativos` não sabe quem está ativo.
  useClientesVisiveis();

  const { de, ate } = useMemo(janela, []);
  const { index, loading: projetosLoading, reload: recarregarLista } = useProjetosLista();
  const { getEspecialidades, especialidadeOptions, loading: espLoading } = useEspecialidades();
  const { clientTable, loading: crmLoading } = useCRMClienteData("all", de, ate);
  const { briefs, isLoading: briefsLoading, error } = useClientBriefs();
  const refresh = useRefreshBrief();

  const [busca, setBusca] = useState("");
  const [especialidades, setEspecialidades] = useState<string[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [recarregando, setRecarregando] = useState(false);

  /**
   * Relê a planilha para pegar cliente novo. Sob demanda, e não a cada visita, porque a lista é a
   * mesma por semanas — e porque o job semanal é que escreve os resumos, não isto: aqui o cliente
   * novo aparece na hora, com o card vazio e o botão de atualizar disponível.
   */
  const atualizarLista = async () => {
    setRecarregando(true);
    try {
      // Os dois: `recarregarClientesVisiveis` rearma o filtro de ativos/ocultos, `reload` relê a
      // planilha. Só um dos dois deixaria o cliente novo de fora do gate ou da lista.
      await Promise.all([recarregarClientesVisiveis(), recarregarLista()]);
      toast.success("Lista de clientes atualizada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível atualizar a lista");
    } finally {
      setRecarregando(false);
    }
  };

  const briefPor = useMemo(() => new Map(briefs.map((b) => [b.cliente, b])), [briefs]);

  /** Métricas exatas da página Clientes, indexadas pela chave de casamento do cliente. */
  const metricaPorChave = useMemo(() => {
    const m = new Map<string, ResumoMetricas>();
    for (const row of clientTable) {
      const k = clientMatchKey(row.client);
      if (!k) continue;
      m.set(k, {
        investimento: row.investimento,
        leadsCRM: row.leadsCRM,
        consultasAgendadas: row.consultasAgendadas,
        faturamentoBruto: row.faturamentoBrutoRealizados,
        roas: row.roas,
      });
    }
    return m;
  }, [clientTable]);

  const clientes: ClienteCard[] = useMemo(
    () =>
      index.ativos.map((a) => {
        const proj = resolveProjeto(index, a.padrao);
        return {
          padrao: a.padrao,
          nome: a.nome,
          especialidades: getEspecialidades(a.padrao) ?? [],
          plano: proj?.plano ?? null,
          squad: proj?.squad ?? null,
          mesesDeCasa: proj?.desde ? mesesDeCasa(proj.desde) : null,
        };
      }),
    [index, getEspecialidades],
  );

  const visiveis = useMemo(() => {
    const termo = norm(busca.trim());
    return clientes.filter((c) => {
      if (especialidades.length && !c.especialidades.some((e) => especialidades.includes(e))) {
        return false;
      }
      if (!termo) return true;
      return norm(c.nome).includes(termo);
    });
  }, [clientes, busca, especialidades]);

  const metricaDe = (c: ClienteCard) => {
    // O número pode estar gravado sob o médico OU sob a clínica: vale a primeira chave que casar.
    for (const k of chavesCandidatas(c.nome)) {
      const m = metricaPorChave.get(k);
      if (m) return m;
    }
    return undefined;
  };

  const pedirAtualizacao = (padrao: string) =>
    refresh.mutate(padrao, {
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "Não foi possível atualizar o resumo"),
    });

  const carregando = projetosLoading || briefsLoading;
  const clienteAberto = clientes.find((c) => c.padrao === aberto) ?? null;

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <MineracaoHeader activeTab="Central de Clientes" />

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar cliente"
              aria-label="Buscar cliente por nome"
              className="h-9 pl-8 text-xs"
            />
          </div>
          <MetasMultiSelect
            title="Especialidades"
            options={especialidadeOptions.map((e) => ({ id: e, label: e }))}
            selected={especialidades}
            onChange={setEspecialidades}
            placeholder={espLoading ? "Carregando…" : "Todas as especialidades"}
            pluralNoun="especialidades"
            disabled={espLoading}
            searchable
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={atualizarLista}
            disabled={recarregando}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${recarregando ? "animate-spin" : ""}`} />
            Atualizar lista
          </Button>
          {!carregando && (
            <span className="text-xs text-muted-foreground">
              {visiveis.length} cliente{visiveis.length === 1 ? "" : "s"} ativo
              {visiveis.length === 1 ? "" : "s"}
              {crmLoading && " · carregando números…"}
            </span>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {carregando ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-64 rounded-xl" />
            ))}
          </div>
        ) : visiveis.length === 0 ? (
          <div className="neu-card rounded-xl p-10 text-center text-sm text-muted-foreground">
            {clientes.length === 0
              ? "Nenhum cliente ativo na planilha de projetos."
              : "Nenhum cliente com esses filtros."}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visiveis.map((c) => (
              <ClientBriefCard
                key={c.padrao}
                cliente={c}
                brief={briefPor.get(c.padrao)}
                metricas={metricaDe(c)}
                onOpen={() => setAberto(c.padrao)}
                onRefresh={() => pedirAtualizacao(c.padrao)}
                isRefreshing={refresh.isPending && refresh.variables === c.padrao}
              />
            ))}
          </div>
        )}

        <ClientBriefDialog
          cliente={clienteAberto}
          brief={aberto ? briefPor.get(aberto) : undefined}
          open={Boolean(aberto)}
          onOpenChange={(v) => !v && setAberto(null)}
          onRefresh={() => aberto && pedirAtualizacao(aberto)}
        />
      </div>
    </DashboardLayout>
  );
}
