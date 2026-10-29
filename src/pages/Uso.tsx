import * as React from "react";
import { format, subDays } from "date-fns";
import { Activity } from "lucide-react";
import { toast } from "sonner";

import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePersistedState } from "@/hooks/usePersistedState";
import {
  buscarAgentes,
  buscarCliquesBrutos,
  buscarNavegacao,
  useUsoAgentes,
  useUsoDiario,
  useUsoHorarios,
  useUsoNavegacao,
  useUsoUsuarios,
  type UsoParams,
} from "@/hooks/useUso";
import {
  calcularKpis,
  detalhar,
  formatarDuracao,
  listarDias,
  msParaMin,
  type EscopoTelas,
  type UsoUsuario,
} from "@/lib/usage/agregar";
import { screenLabel, sectionLabel, sectionOf } from "@/lib/usage/screens";
import { baixarCsv, montarCsv } from "@/lib/usage/csv";
import { UsoFiltros, type ExportKind, type TipoFiltro } from "@/components/uso/UsoFiltros";
import { UsoTempo } from "@/components/uso/UsoTempo";
import { UsoNavegacao } from "@/components/uso/UsoNavegacao";
import { UsoAdocao } from "@/components/uso/UsoAdocao";
import { UsoSessoes } from "@/components/uso/UsoSessoes";
import { UsoAgentes } from "@/components/uso/UsoAgentes";
import { UsoEquipes } from "@/components/uso/UsoEquipes";
import { buscarUsoEquipes, useUsoEquipes } from "@/hooks/useEquipes";
import { criarMapaGrupo, nomeGrupo } from "@/lib/usage/equipes";
import { Vazio } from "@/components/uso/CardUso";

type Aba = "tempo" | "navegacao" | "adocao" | "sessoes" | "agentes" | "equipes";

const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const dataHora = (iso: string) => format(new Date(iso), "dd/MM/yyyy HH:mm:ss");

function Kpi({ rotulo, valor, dica }: { rotulo: string; valor: string; dica?: string }) {
  return (
    <div className="neu-card p-4" title={dica}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{valor}</p>
    </div>
  );
}

export default function UsoPage() {
  React.useEffect(() => {
    document.title = "Uso do Companium | Companium";
  }, []);

  const [periodo, setPeriodo] = usePersistedState<{ from?: Date; to?: Date }>("uso-periodo", () => ({
    from: subDays(new Date(), 29),
    to: new Date(),
  }));
  const [selecionados, setSelecionados] = usePersistedState<string[]>("uso-usuarios", () => []);
  const [tipo, setTipo] = usePersistedState<TipoFiltro>("uso-tipo", () => "todos");
  const [escopo, setEscopo] = usePersistedState<EscopoTelas>("uso-telas", () => null);
  const [aba, setAba] = usePersistedState<Aba>("uso-aba", () => "tempo");
  const [exportando, setExportando] = React.useState(false);

  const { data: usuarios = [], error: erroUsuarios } = useUsoUsuarios();
  const porId = React.useMemo(() => new Map<string, UsoUsuario>(usuarios.map((u) => [u.id, u])), [usuarios]);

  const from = ymd(periodo.from ?? subDays(new Date(), 29));
  const to = ymd(periodo.to ?? periodo.from ?? new Date());
  const dias = React.useMemo(() => listarDias(from, to), [from, to]);

  // Seleção explícita manda; sem ela, o filtro Equipe/Clientes vira a lista de ids do tipo.
  const users = React.useMemo(() => {
    if (selecionados.length) return selecionados;
    if (tipo === "todos") return null;
    return usuarios.filter((u) => (tipo === "cliente" ? u.tipo === "cliente" : u.tipo !== "cliente")).map((u) => u.id);
  }, [selecionados, tipo, usuarios]);
  const params: UsoParams = React.useMemo(() => ({ from, to, users, screens: escopo }), [from, to, users, escopo]);
  const prontos = tipo === "todos" || selecionados.length > 0 || usuarios.length > 0;

  const diario = useUsoDiario(params, prontos);
  const navegacao = useUsoNavegacao(params, prontos && aba === "navegacao");
  const horarios = useUsoHorarios(params, prontos && aba === "adocao");
  const agentes = useUsoAgentes(params, prontos && (aba === "agentes" || aba === "equipes"));
  const equipes = useUsoEquipes(aba === "equipes");
  const rows = React.useMemo(() => diario.data ?? [], [diario.data]);
  const kpis = React.useMemo(() => calcularKpis(rows), [rows]);

  const nome = (id: string) => porId.get(id)?.email ?? id;
  const tipoDe = (id: string) => porId.get(id)?.tipo ?? "";
  const arquivo = (k: string) => `uso-companium_${k}_${from}_${to}.csv`;

  const exportar = async (k: ExportKind) => {
    setExportando(true);
    try {
      if (k === "diario") {
        const linhas = [...rows]
          .sort((a, b) => a.dia.localeCompare(b.dia) || nome(a.user_id).localeCompare(nome(b.user_id)))
          .map((r) => [
            r.dia,
            nome(r.user_id),
            tipoDe(r.user_id),
            sectionLabel(sectionOf(r.screen_key)),
            screenLabel(r.screen_key),
            msParaMin(r.active_ms),
            r.visits,
            r.clicks,
          ]);
        baixarCsv(montarCsv(["dia", "usuario", "tipo", "secao", "tela", "minutos_ativos", "visitas", "cliques"], linhas), arquivo("diario"));
      } else if (k === "detalhe") {
        const linhas = detalhar(rows, false).map((l) => [
          nome(l.user_id ?? ""),
          tipoDe(l.user_id ?? ""),
          sectionLabel(sectionOf(l.screen_key)),
          screenLabel(l.screen_key),
          msParaMin(l.active_ms),
          l.visits,
          l.visits ? msParaMin(l.active_ms / l.visits) : 0,
          l.clicks,
          l.ultimoDia,
        ]);
        baixarCsv(
          montarCsv(["usuario", "tipo", "secao", "tela", "minutos_ativos", "visitas", "minutos_por_visita", "cliques", "ultimo_uso"], linhas),
          arquivo("totais"),
        );
      } else if (k === "cliques") {
        const brutos = await buscarCliquesBrutos(params);
        const linhas = brutos.map((c) => [
          dataHora(c.ts),
          nome(c.user_id),
          c.session_id,
          c.seq,
          sectionLabel(sectionOf(c.screen_key)),
          screenLabel(c.screen_key),
          c.label ?? "",
          c.target_key,
        ]);
        baixarCsv(montarCsv(["data_hora", "usuario", "sessao", "ordem", "secao", "tela", "botao", "chave_botao"], linhas), arquivo("cliques"));
        if (brutos.length >= 50_000) toast.warning("Exportação limitada a 50 mil cliques. Reduza o período para ver tudo.");
      } else if (k === "equipes") {
        // Base da comparação: cada linha (dia × usuário) com a equipe em que a pessoa estava no dia.
        const [ag, eq] = await Promise.all([agentes.data ?? buscarAgentes(params), equipes.data ?? buscarUsoEquipes()]);
        const grupoDe = criarMapaGrupo(eq.membros, porId);
        const nomes = new Map(eq.equipes.map((e) => [e.id, e]));
        const soma = new Map<string, { dia: string; user_id: string; ms: number; visitas: number; cliques: number; ia_ms: number; perguntas: number; respostas: number }>();
        const linha = (dia: string, user_id: string) => {
          const chave = `${dia}|${user_id}`;
          if (!soma.has(chave)) soma.set(chave, { dia, user_id, ms: 0, visitas: 0, cliques: 0, ia_ms: 0, perguntas: 0, respostas: 0 });
          return soma.get(chave)!;
        };
        for (const r of rows) {
          const l = linha(r.dia, r.user_id);
          l.ms += r.active_ms;
          l.visitas += r.visits;
          l.cliques += r.clicks;
        }
        for (const r of ag.linhas) {
          const l = linha(r.dia, r.user_id);
          l.ia_ms += r.active_ms;
          l.perguntas += r.perguntas;
          l.respostas += r.respostas;
        }
        const linhas = [...soma.values()]
          .sort((a, b) => a.dia.localeCompare(b.dia) || nome(a.user_id).localeCompare(nome(b.user_id)))
          .map((l) => [
            l.dia,
            nome(l.user_id),
            nomeGrupo(grupoDe(l.user_id, l.dia), nomes),
            msParaMin(l.ms),
            l.visitas,
            l.cliques,
            msParaMin(l.ia_ms),
            l.perguntas,
            l.respostas,
          ]);
        baixarCsv(
          montarCsv(
            ["dia", "usuario", "equipe", "minutos_ativos", "visitas", "cliques", "minutos_agentes_ia", "perguntas_ia", "respostas_ia"],
            linhas,
          ),
          arquivo("equipes"),
        );
      } else if (k === "agentes") {
        const ag = agentes.data ?? (await buscarAgentes(params));
        const rotulo = new Map(ag.bots.map((b) => [b.id, b.label]));
        const linhas = [...ag.linhas]
          .sort((a, b) => a.dia.localeCompare(b.dia) || nome(a.user_id).localeCompare(nome(b.user_id)))
          .map((r) => [
            r.dia,
            nome(r.user_id),
            tipoDe(r.user_id),
            rotulo.get(r.bot_id) ?? r.bot_id,
            msParaMin(r.active_ms),
            r.perguntas,
            r.respostas,
            r.sessoes,
          ]);
        baixarCsv(
          montarCsv(["dia", "usuario", "tipo", "agente", "minutos_ativos", "perguntas", "textos_recebidos", "aberturas"], linhas),
          arquivo("agentes"),
        );
      } else {
        const nav = navegacao.data ?? (await buscarNavegacao(params));
        const linhas = nav.transicoes.map((t) => [
          t.de === "_inicio" ? "Início da sessão" : screenLabel(t.de, true),
          screenLabel(t.para, true),
          t.n,
          t.usuarios,
        ]);
        baixarCsv(montarCsv(["de", "para", "vezes", "usuarios"], linhas), arquivo("transicoes"));
      }
    } catch (e) {
      toast.error(`Não foi possível exportar: ${(e as Error).message}`);
    } finally {
      setExportando(false);
    }
  };

  const erro = (erroUsuarios ?? diario.error) as Error | null;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
        <header className="flex min-w-0 items-center gap-3">
          <div className="neu-inset flex size-11 shrink-0 items-center justify-center rounded-full text-primary">
            <Activity className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold text-foreground">Uso do Companium</h1>
            <p className="text-sm text-muted-foreground">Tempo ativo por tela, cliques e caminhos de navegação de cada usuário</p>
          </div>
        </header>

        <UsoFiltros
          from={periodo.from}
          to={periodo.to}
          onPeriodo={setPeriodo}
          usuarios={usuarios}
          selecionados={selecionados}
          onSelecionados={setSelecionados}
          tipo={tipo}
          onTipo={(t) => {
            setTipo(t);
            setSelecionados([]);
          }}
          escopo={escopo}
          onEscopo={setEscopo}
          onExportar={exportar}
          exportando={exportando}
        />

        {erro ? (
          <Vazio texto={`Erro ao carregar o uso: ${erro.message}`} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Kpi rotulo="Usuários ativos" valor={diario.isLoading ? "…" : kpis.usuariosAtivos.toLocaleString("pt-BR")} />
              <Kpi rotulo="Tempo ativo total" valor={diario.isLoading ? "…" : formatarDuracao(kpis.tempoTotalMs)} />
              <Kpi
                rotulo="Média por usuário/dia"
                valor={diario.isLoading ? "…" : formatarDuracao(kpis.mediaPorUsuarioDiaMs)}
                dica="Tempo ativo médio de um usuário num dia em que ele usou o Companium."
              />
              <Kpi rotulo="Visitas a telas" valor={diario.isLoading ? "…" : kpis.visitas.toLocaleString("pt-BR")} />
              <Kpi rotulo="Cliques" valor={diario.isLoading ? "…" : kpis.cliques.toLocaleString("pt-BR")} />
              <Kpi
                rotulo="Frequência"
                valor={diario.isLoading ? "…" : `${Math.round(kpis.frequencia * 100)}%`}
                dica="Média de usuários ativos por dia útil ÷ usuários ativos no período. 100% = todos usam todo dia útil."
              />
            </div>

            <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)} className="space-y-4">
              <TabsList className="neu-inset gap-1 bg-transparent p-1.5">
                <TabsTrigger value="tempo" className="neu-tab">Tempo</TabsTrigger>
                <TabsTrigger value="navegacao" className="neu-tab">Navegação</TabsTrigger>
                <TabsTrigger value="adocao" className="neu-tab">Adoção</TabsTrigger>
                <TabsTrigger value="sessoes" className="neu-tab">Sessões</TabsTrigger>
                <TabsTrigger value="agentes" className="neu-tab">Agentes de IA</TabsTrigger>
                <TabsTrigger value="equipes" className="neu-tab">Equipes</TabsTrigger>
              </TabsList>

              {diario.isLoading ? (
                <Vazio texto="Carregando…" />
              ) : (
                <>
                  <TabsContent value="tempo">
                    <UsoTempo rows={rows} dias={dias} escopo={escopo} usuarios={porId} />
                  </TabsContent>
                  <TabsContent value="navegacao">
                    {navegacao.error ? (
                      <Vazio texto={(navegacao.error as Error).message} />
                    ) : navegacao.data ? (
                      <UsoNavegacao dados={navegacao.data} escopo={escopo} />
                    ) : (
                      <Vazio texto="Carregando…" />
                    )}
                  </TabsContent>
                  <TabsContent value="adocao">
                    <UsoAdocao rows={rows} dias={dias} horarios={horarios.data} />
                  </TabsContent>
                  <TabsContent value="sessoes">
                    <UsoSessoes rows={rows} usuarios={usuarios} preSelecionado={selecionados[0] ?? null} />
                  </TabsContent>
                  <TabsContent value="equipes">
                    {equipes.error || agentes.error ? (
                      <Vazio texto={((equipes.error ?? agentes.error) as Error).message} />
                    ) : equipes.data && agentes.data ? (
                      <UsoEquipes
                        diario={rows}
                        agentes={agentes.data.linhas}
                        dados={equipes.data}
                        usuarios={usuarios}
                        dias={dias}
                        escopoUsuarios={users}
                      />
                    ) : (
                      <Vazio texto="Carregando…" />
                    )}
                  </TabsContent>
                  <TabsContent value="agentes">
                    {agentes.error ? (
                      <Vazio texto={(agentes.error as Error).message} />
                    ) : agentes.data ? (
                      <UsoAgentes dados={agentes.data} dias={dias} usuarios={porId} />
                    ) : (
                      <Vazio texto="Carregando…" />
                    )}
                  </TabsContent>
                </>
              )}
            </Tabs>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
