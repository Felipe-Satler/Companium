import * as React from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { baixarPlanilhaRemota, normalizarLinkPlanilha } from "@/lib/planilhaRemota";

import { toast } from "sonner";
import {
  RefreshCw,
  Upload,
  Briefcase,
  Info,
  Table2,
  LayoutDashboard,
  CalendarRange,
  X,
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useGestaoData, type GestaoCliente } from "@/hooks/useGestaoData";
import { titleCase, normalizarNome } from "@/lib/utils";
import { parseGestaoPlanilha } from "@/components/gestao/parseGestaoPlanilha";
import { GestaoKPIs, isAtivo, ativoNoMes, mesesEntre } from "@/components/gestao/GestaoKPIs";
import { GestaoTable } from "@/components/gestao/GestaoTable";
import { GestaoInsightsSquads } from "@/components/gestao/GestaoInsightsSquads";
import { GestaoInsightsClientes } from "@/components/gestao/GestaoInsightsClientes";
import { GestaoDashboard } from "@/components/gestao/GestaoDashboard";
import { intervaloBI, listarMeses, mesAtual, mesLabel } from "@/components/gestao/useGestaoBI";

/**
 * Endpoint da própria origem (mantém o CSP `connect-src 'self'`). O backend
 * (apps/gestao-proxy) baixa a planilha oficial — cujo endereço fica SÓ no
 * servidor, na env GESTAO_SHEET_URL — e a devolve aqui, com cache no servidor.
 * O frontend nunca conhece a URL do Google.
 */
const GESTAO_PLANILHA_ENDPOINT = "/api/gestao/planilha";

/** Mês vigente (yyyy-MM) e ano vigente, derivados da data atual. */
const MES_ATUAL = mesAtual();
const anoAtual = Number(MES_ATUAL.slice(0, 4));
/** Padrões dos filtros de data: início = janeiro do ano vigente; fim = mês vigente. */
const INICIO_PADRAO = `${anoAtual}-01`;
const FIM_PADRAO = MES_ATUAL;

/**
 * Filtros persistem em memória entre trocas de aba e navegação de página (o
 * componente desmonta/remonta ao mudar de rota). Um reload completo volta aos
 * padrões (início em janeiro do ano vigente, fim no mês vigente).
 */
const filtrosGestao = {
  inicio: INICIO_PADRAO as string,
  fim: FIM_PADRAO as string,
  squad: "todos",
  plano: "todos",
  especialidade: "todos",
  status: "todos",
};

export const TODOS_MESES = "todos";
const OPCOES_MES = [
  { value: TODOS_MESES, label: "Todos os Meses" },
  // A aba `MRR Calculado` traz meses futuros PROJETADOS; o seletor para no mês
  // corrente para que projeção nunca seja exibida como realizado.
  ...listarMeses(`${anoAtual - 3}-01`, mesAtual())
    .reverse()
    .map((m) => ({
      value: m,
      label: mesLabel(m),
    })),
];

const LS_LINK = "companium.gestao.linkPlanilha";

const ym = (d: string | null | undefined) => (d ? d.slice(0, 7) : null);

const optionsFrom = (rows: GestaoCliente[], key: keyof GestaoCliente) =>
  Array.from(new Set(rows.map((r) => (r[key] as string | null) ?? "").filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map((v) => ({ value: v, label: titleCase(v) }));

/** Valor-sentinela da opção "Sem Definição" do filtro Equipe (clientes sem líder). */
const SEM_LIDER = "__sem_definicao__";

/** Cliente pertence à equipe selecionada? Comparação por nome normalizado. */
const matchEquipe = (r: GestaoCliente, squad: string) => {
  if (squad === SEM_LIDER) return !(r.lider_revops ?? "").trim();
  return normalizarNome(r.lider_revops) === normalizarNome(squad);
};

export default function Gestao() {
  const {
    rows,
    importacao,
    mrrOficial,
    cadastro,
    origemMrr,
    loading,
    cacheDesatualizado,
    remoteAvailable,
    replaceAll,
  } = useGestaoData();
  const [importando, setImportando] = React.useState(false);
  const [view, setView] = React.useState<"insights" | "equipes" | "dashboard">("dashboard");
  const [inicio, setInicio] = React.useState(filtrosGestao.inicio);
  const [fim, setFim] = React.useState(filtrosGestao.fim);
  const [squad, setSquad] = React.useState(filtrosGestao.squad);
  const [plano, setPlano] = React.useState(filtrosGestao.plano);
  const [especialidade, setEspecialidade] = React.useState(filtrosGestao.especialidade);
  const [status, setStatus] = React.useState(filtrosGestao.status);

  // Mantém o store em memória sincronizado — restaura os filtros ao voltar pra página/aba.
  React.useEffect(() => {
    filtrosGestao.inicio = inicio;
    filtrosGestao.fim = fim;
    filtrosGestao.squad = squad;
    filtrosGestao.plano = plano;
    filtrosGestao.especialidade = especialidade;
    filtrosGestao.status = status;
  }, [inicio, fim, squad, plano, especialidade, status]);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [linkDialog, setLinkDialog] = React.useState(false);
  const [linkUrl, setLinkUrl] = React.useState("");
  const [linkSalvo, setLinkSalvo] = React.useState<string | null>(null);
  const [sincronizando, setSincronizando] = React.useState(false);

  React.useEffect(() => {
    try {
      const salvo = localStorage.getItem(LS_LINK);
      if (salvo) {
        setLinkSalvo(salvo);
        setLinkUrl(salvo);
      }
    } catch {
      // ignore
    }
  }, []);

  // "Todos os meses" sempre vale para os dois campos.
  const handleInicio = (v: string) => {
    if (v === TODOS_MESES) {
      setInicio(TODOS_MESES);
      setFim(TODOS_MESES);
      return;
    }
    setInicio(v);
    if (fim === TODOS_MESES) setFim(FIM_PADRAO > v ? FIM_PADRAO : v);
  };
  const handleFim = (v: string) => {
    if (v === TODOS_MESES) {
      setInicio(TODOS_MESES);
      setFim(TODOS_MESES);
      return;
    }
    setFim(v);
    if (inicio === TODOS_MESES) setInicio(`${v.slice(0, 4)}-01` <= v ? `${v.slice(0, 4)}-01` : v);
  };

  const resetFiltros = () => {
    setInicio(INICIO_PADRAO);
    setFim(FIM_PADRAO);
    setSquad("todos");
    setPlano("todos");
    setEspecialidade("todos");
    setStatus("todos");
  };

  // Intervalo efetivo: "todos" desativa o recorte e a ordem é normalizada
  // para que início > fim não zere os resultados.
  const semIntervalo = inicio === TODOS_MESES || fim === TODOS_MESES;
  const inicioEf = semIntervalo ? null : inicio <= fim ? inicio : fim;
  const fimEf = semIntervalo ? null : inicio <= fim ? fim : inicio;

  /**
   * Status pela mesma regra do card "Clientes Ativos": ativo = ativo no mês de
   * referência (último mês do período); inativo = esteve na base do período
   * mas não está ativo nesse mês.
   */
  const matchStatus = React.useMemo(() => {
    const janela = intervaloBI(rows, inicioEf, fimEf);
    const mesesJanela = mesesEntre(janela.inicio, janela.fim);
    return (r: GestaoCliente, s: string) => {
      if (s === "ativo") return ativoNoMes(r, janela.fim);
      if (s === "inativo")
        return mesesJanela.some((m) => ativoNoMes(r, m)) && !ativoNoMes(r, janela.fim);
      return true;
    };
  }, [rows, inicioEf, fimEf]);

  const filteredRows = React.useMemo(() => {
    let list = rows;
    if (inicioEf && fimEf) {
      list = list.filter((r) => {
        const inicioRow = ym(r.data_inicio_ref) ?? ym(r.data_inicio);
        const fimRow = ym(r.data_fim_ref);
        const avisoRow = ym(r.data_aviso_previo_ref) ?? ym(r.data_aviso_previo);
        if (inicioRow && inicioRow >= inicioEf && inicioRow <= fimEf) return true;
        if (fimRow && fimRow >= inicioEf && fimRow <= fimEf) return true;
        if (avisoRow && avisoRow >= inicioEf && avisoRow <= fimEf) return true;
        // Cliente ativo durante o intervalo (começou até o fim e não encerrou antes do início)
        if (isAtivo(r) && (!inicioRow || inicioRow <= fimEf) && (!fimRow || fimRow >= inicioEf))
          return true;
        return false;
      });
    }
    if (squad !== "todos") list = list.filter((r) => matchEquipe(r, squad));
    if (plano !== "todos") list = list.filter((r) => (r.plano ?? "") === plano);
    if (especialidade !== "todos")
      list = list.filter((r) => (r.especialidade ?? "") === especialidade);
    if (status !== "todos") list = list.filter((r) => matchStatus(r, status));
    return list;
  }, [rows, inicioEf, fimEf, squad, plano, especialidade, status, matchStatus]);

  // Insights Equipes: os filtros globais de Equipe/Plano/Especialidade valem,
  // mas o recorte de data é próprio da seção (a data global não se aplica).
  const rowsEquipes = React.useMemo(() => {
    let list = rows;
    if (squad !== "todos") list = list.filter((r) => matchEquipe(r, squad));
    if (plano !== "todos") list = list.filter((r) => (r.plano ?? "") === plano);
    if (especialidade !== "todos")
      list = list.filter((r) => (r.especialidade ?? "") === especialidade);
    if (status !== "todos") list = list.filter((r) => matchStatus(r, status));
    return list;
  }, [rows, squad, plano, especialidade, status, matchStatus]);

  /**
   * Opções do filtro Equipe: vêm da coluna "Lider RevOps" da aba
   * `Cadastro e Configuracoes` (ordem da planilha, só líderes em atividade),
   * mais "Sem Definição". Sem a aba, cai no comportamento antigo (valores do DB).
   * "Todas as Equipes" continua somando TODOS os clientes — o cadastro só muda
   * o MENU, nunca a conta.
   */
  const equipeOptions = React.useMemo(() => {
    const base = cadastro?.lideres.length
      ? cadastro.lideres.map((n) => ({ value: n, label: titleCase(n) }))
      : optionsFrom(rows, "lider_revops");
    return [...base, { value: SEM_LIDER, label: "Sem Definição" }];
  }, [cadastro, rows]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportando(true);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseGestaoPlanilha(buffer);
      if (!parsed.clientes.length) {
        toast.error("Nenhuma linha válida encontrada na planilha (abas 'Lista'/'DB' ou 'Base').");
        return;
      }
      const res = await replaceAll(parsed.clientes, file.name, null, {
        mrrOficial: parsed.mrrOficial,
        origemMrr: parsed.mrrOficial ? "oficial" : parsed.temUpsells ? "upsell" : "aproximado",
        cadastro: parsed.cadastro,
      });
      toast.success(
        `${parsed.clientes.length} clientes importados${res.persistido === "local" ? " (salvos neste navegador)" : ""}.`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao importar a planilha.");
    } finally {
      setImportando(false);
    }
  };

  /** Baixa e importa a planilha viva publicada na web (link .xlsx). */
  const sincronizarLink = React.useCallback(
    async (url: string, salvar: boolean, silencioso = false) => {
      setSincronizando(true);
      try {
        const { buffer, url: urlFinal } = await baixarPlanilhaRemota(url);
        const parsed = parseGestaoPlanilha(buffer);
        if (!parsed.clientes.length) {
          if (!silencioso)
            toast.error("Nenhuma linha válida encontrada na planilha (abas 'Lista'/'DB' ou 'Base').");
          return false;
        }
        await replaceAll(parsed.clientes, urlFinal, null, {
          mrrOficial: parsed.mrrOficial,
          origemMrr: parsed.mrrOficial ? "oficial" : parsed.temUpsells ? "upsell" : "aproximado",
          cadastro: parsed.cadastro,
        });
        if (salvar) {
          try {
            localStorage.setItem(LS_LINK, urlFinal);
          } catch {
            // ignore
          }
          setLinkSalvo(urlFinal);
          setLinkUrl(urlFinal);
        }
        if (!silencioso)
          toast.success(`${parsed.clientes.length} clientes sincronizados da planilha online.`);
        return true;
      } catch (err) {
        if (!silencioso)
          toast.error(
            err instanceof Error ? err.message : "Falha ao conectar com a planilha online.",
            {
              action: {
                label: "Tentar novamente",
                onClick: () => void sincronizarLink(url, salvar),
              },
            }
          );
        return false;
      } finally {
        setSincronizando(false);
      }
    },
    [replaceAll]
  );

  const desconectarLink = () => {
    try {
      localStorage.removeItem(LS_LINK);
    } catch {
      // ignore
    }
    setLinkSalvo(null);
    setLinkUrl("");
    setLinkDialog(false);
    toast.success("Planilha online desconectada. Os dados atuais foram mantidos.");
  };

  const handleAtualizar = () => {
    if (linkSalvo) void sincronizarLink(linkSalvo, true);
    // Sem link manual conectado: recarrega a planilha oficial pelo backend,
    // forçando o servidor a rebaixar o arquivo (ignora o TTL do cache).
    else void sincronizarLink(`${GESTAO_PLANILHA_ENDPOINT}?force=1`, false);
  };

  /**
   * Dados guardados neste navegador por uma versão anterior da leitura da
   * planilha são recarregados sozinhos (uma única vez) a partir do link salvo.
   */
  const jaRessincronizou = React.useRef(false);
  React.useEffect(() => {
    if (!cacheDesatualizado || sincronizando || jaRessincronizou.current) return;
    jaRessincronizou.current = true;
    void sincronizarLink(linkSalvo ?? GESTAO_PLANILHA_ENDPOINT, false, true);
  }, [cacheDesatualizado, linkSalvo, sincronizando, sincronizarLink]);

  /**
   * Primeira carga: sem planilha guardada e sem link salvo, sincroniza sozinho a
   * planilha oficial publicada, para a tela nunca começar vazia.
   */
  const jaAutoCarregou = React.useRef(false);
  React.useEffect(() => {
    if (loading || sincronizando || jaAutoCarregou.current) return;
    if (linkSalvo) return; // o efeito de cache desatualizado / botão cuidam do resto
    if (rows.length > 0) return;
    jaAutoCarregou.current = true;
    void sincronizarLink(GESTAO_PLANILHA_ENDPOINT, false, true);
  }, [loading, sincronizando, linkSalvo, rows.length, sincronizarLink]);

  // A planilha (online, via backend ou link manual) está conectada quando há
  // dados carregados. Controla o rótulo/realce do botão "Conectar planilha online".
  const planilhaConectada = Boolean(linkSalvo) || rows.length > 0;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1600px] space-y-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="neu-inset flex h-11 w-11 items-center justify-center rounded-full text-primary">
              <Briefcase className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Gestão</h1>
              <p className="text-sm text-muted-foreground">
                Visão interna da carteira de clientes · uso restrito a administradores
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFile}
            />
            <Button
              variant="ghost"
              className="neu-button h-9 text-xs"
              onClick={() => inputRef.current?.click()}
              disabled={importando}
            >
              <Upload className="mr-2 h-3.5 w-3.5" />
              {importando ? "Importando..." : "Importar arquivo"}
            </Button>
            <Button
              variant="ghost"
              className={`h-9 text-xs ${planilhaConectada ? "neu-button-primary" : "neu-button"}`}
              onClick={() => setLinkDialog(true)}
              title={linkSalvo ?? "Conectar a uma planilha publicada na web"}
            >
              <Link2 className="mr-2 h-3.5 w-3.5" />
              {planilhaConectada ? "Planilha online conectada" : "Conectar planilha online"}
            </Button>
            <Button
              variant="ghost"
              className="neu-button-primary h-9 text-xs"
              onClick={handleAtualizar}
              disabled={loading || sincronizando}
            >
              <RefreshCw
                className={`mr-2 h-3.5 w-3.5 ${loading || sincronizando ? "animate-spin" : ""}`}
              />
              {sincronizando ? "Sincronizando..." : linkSalvo ? "Sincronizar planilha" : "Atualizar visualização"}
            </Button>
          </div>
        </header>

        <div className="neu-inset flex flex-wrap items-center gap-2 rounded-lg px-4 py-2.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 text-primary" />
          {importacao ? (
            <span className="flex flex-wrap items-center gap-2">
              <span>
                Última importação: {new Date(importacao.criado_em).toLocaleString("pt-BR")}
                {importacao.criado_por ? ` por ${importacao.criado_por}` : ""} ·{" "}
                {importacao.nome_arquivo ?? "planilha"} · {importacao.total_linhas} linhas
              </span>
              <span
                className="neu-inset rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                title={
                  origemMrr === "oficial"
                    ? "MRR vindo da aba 'MRR Calculado' da planilha."
                    : origemMrr === "upsell"
                      ? "MRR recalculado com a aba 'Upsell Downsell'."
                      : "Sem as abas 'Upsell Downsell'/'MRR Calculado': o MRR pós-upsell é aproximado pelo MRR Atual."
                }
              >
                MRR{" "}
                {origemMrr === "oficial"
                  ? "oficial"
                  : origemMrr === "upsell"
                    ? "calculado"
                    : "aproximado"}
              </span>
            </span>
          ) : (
            <span>
              Nenhuma planilha carregada ainda. Use "Importar arquivo" (.xlsx) ou "Conectar link"
              para se conectar a uma planilha publicada na web.
            </span>
          )}
          {!remoteAvailable && (
            <span className="text-destructive">
              · Armazenamento compartilhado indisponível: os dados estão salvos apenas neste
              navegador.
            </span>
          )}
        </div>

        <div className="neu-card flex flex-col gap-4 p-4 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex items-center gap-2 pr-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:border-r sm:border-border/40">
            <CalendarRange className="h-4 w-4 text-primary" />
            <span>FILTROS</span>
          </div>
          <div className="flex flex-wrap items-end gap-3 sm:items-center">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                Mês de Início
              </label>
              <SearchableSelect
                value={inicio}
                onValueChange={handleInicio}
                options={OPCOES_MES}
                allOption={null}
                placeholder="Mês de Início"
                triggerClassName="h-8 text-[11px]"
              />
            </div>
            <div className="hidden h-8 w-px bg-border/50 sm:block" aria-hidden="true" />
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                Mês de Fim
              </label>
              <SearchableSelect
                value={fim}
                onValueChange={handleFim}
                options={OPCOES_MES}
                allOption={null}
                placeholder="Mês de Fim"
                triggerClassName="h-8 text-[11px]"
              />
            </div>
            <div className="hidden h-8 w-px bg-border/50 sm:block" aria-hidden="true" />
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Equipe</label>
              <SearchableSelect
                value={squad}
                onValueChange={setSquad}
                options={equipeOptions}
                allOption={{ value: "todos", label: "Todas as Equipes" }}
                placeholder="Equipe"
                triggerClassName="h-8 text-[11px]"
              />
            </div>
            <div className="hidden h-8 w-px bg-border/50 sm:block" aria-hidden="true" />
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Plano</label>
              <SearchableSelect
                value={plano}
                onValueChange={setPlano}
                options={optionsFrom(rows, "plano")}
                allOption={{ value: "todos", label: "Todos os Planos" }}
                placeholder="Plano"
                triggerClassName="h-8 text-[11px]"
              />
            </div>
            <div className="hidden h-8 w-px bg-border/50 sm:block" aria-hidden="true" />
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Especialidade</label>
              <SearchableSelect
                value={especialidade}
                onValueChange={setEspecialidade}
                options={optionsFrom(rows, "especialidade")}
                allOption={{ value: "todos", label: "Todas as Especialidades" }}
                placeholder="Especialidade"
                triggerClassName="h-8 text-[11px]"
              />
            </div>
            <div className="hidden h-8 w-px bg-border/50 sm:block" aria-hidden="true" />
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Status</label>
              <SearchableSelect
                value={status}
                onValueChange={setStatus}
                options={[
                  { value: "ativo", label: "Ativo" },
                  { value: "inativo", label: "Inativo" },
                ]}
                allOption={{ value: "todos", label: "Todos os Status" }}
                placeholder="Status"
                triggerClassName="h-8 text-[11px]"
              />
            </div>
            <div className="hidden h-8 w-px bg-border/50 sm:block" aria-hidden="true" />
            <Button
              variant="ghost"
              onClick={resetFiltros}
              className="neu-button h-8 gap-1.5 px-3 text-[11px]"
              title="Limpar filtros"
            >
              <X className="h-3.5 w-3.5" />
              Limpar
            </Button>
          </div>
        </div>

        <GestaoKPIs
          rows={filteredRows}
          rowsCLT={rowsEquipes}
          loading={loading}
          inicio={inicioEf}
          fim={fimEf}
          mrrOficial={filteredRows.length === rows.length ? mrrOficial : null}
        />

        <div className="neu-inset inline-flex max-w-full gap-1 overflow-x-auto rounded-full p-1">
          <button
            type="button"
            onClick={() => setView("dashboard")}
            className={`neu-tab flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-xs ${
              view === "dashboard" ? "neu-button-primary" : ""
            }`}
            data-state={view === "dashboard" ? "active" : "inactive"}
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => setView("insights")}
            className={`neu-tab flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-xs ${
              view === "insights" ? "neu-button-primary" : ""
            }`}
            data-state={view === "insights" ? "active" : "inactive"}
          >
            <Table2 className="h-3.5 w-3.5" />
            Insights: Clientes
          </button>
          <button
            type="button"
            onClick={() => setView("equipes")}
            className={`neu-tab flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-xs ${
              view === "equipes" ? "neu-button-primary" : ""
            }`}
            data-state={view === "equipes" ? "active" : "inactive"}
          >
            <Table2 className="h-3.5 w-3.5" />
            Insights: Equipes
          </button>
        </div>

        {view === "dashboard" ? (
          <GestaoDashboard
            rows={filteredRows}
            rowsCLT={rowsEquipes}
            loading={loading}
            inicio={inicio}
            fim={fim}
            gestor={squad}
            mrrOficial={mrrOficial}
          />
        ) : null}

        <div className={`space-y-4 ${view === "insights" ? "" : "hidden"}`}>
          <GestaoInsightsClientes rows={filteredRows} rowsCLT={rowsEquipes} inicio={inicio} fim={fim} />
          <GestaoTable rows={filteredRows} loading={loading} />
        </div>

        <div className={view === "equipes" ? "" : "hidden"}>
          <GestaoInsightsSquads
            rows={rowsEquipes}
            inicioGlobal={inicio}
            fimGlobal={fim}
            pessoasAtivas={cadastro?.pessoasAtivas ?? null}
          />
        </div>
      </div>

      <Dialog open={linkDialog} onOpenChange={setLinkDialog}>
        <DialogContent className="neu-card border-border/40 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-4 w-4 text-primary" />
              Conectar planilha online
            </DialogTitle>
            <DialogDescription className="text-xs">
              Cole o link de export .xlsx da planilha publicada na web. Links do Google Sheets são
              convertidos automaticamente para o formato de export.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/.../export?format=xlsx"
              className="neu-inset h-9 border-0 text-xs"
            />
            {linkUrl.trim() && (
              <p className="break-all text-[11px] text-muted-foreground">
                Será usado: {normalizarLinkPlanilha(linkUrl)}
              </p>
            )}
            {linkSalvo && (
              <p className="text-[11px] text-primary">Conectado atualmente a esta planilha.</p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {linkSalvo ? (
              <Button variant="ghost" className="neu-button h-9 text-xs" onClick={desconectarLink}>
                <X className="mr-2 h-3.5 w-3.5" />
                Desconectar
              </Button>
            ) : (
              <span />
            )}
            <Button
              variant="ghost"
              className="neu-button-primary h-9 text-xs"
              disabled={sincronizando || !linkUrl.trim()}
              onClick={async () => {
                const ok = await sincronizarLink(linkUrl, true);
                if (ok) setLinkDialog(false);
              }}
            >
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${sincronizando ? "animate-spin" : ""}`} />
              {sincronizando ? "Conectando..." : "Conectar e sincronizar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
