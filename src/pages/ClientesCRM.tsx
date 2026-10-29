import { useCallback, useEffect, useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { useClientesFilters } from "@/contexts/ClientesFiltersContext";
import { useAuth } from "@/contexts/AuthContext";
import { useClientesData } from "@/hooks/useClientesData";
import { canonicalizeAdsClient, clientCmpKey, prettyClientLabel, adsMedicoForClient, foldMergedAdsClient, clientMatchKey } from "@/data/clienteAliases";
import { useMetaCardsCtx, MetaKey } from "@/hooks/useClientesMetas";
import { MetasAlert } from "@/components/clientes/MetasAlert";
import { SectionLabel } from "@/components/clientes/SectionLabel";

const CRM_FIELDS: MetaKey[] = ["investimento", "leadsCRM", "cplCRM", "consultaAgendada", "consultaRealizada", "procedimentoAgendado", "procedimentoRealizado", "faturamento", "roas"];

// Modos do SELECT de comparação da tela CRM. "off" = sem comparação.
type CompareMode = "off" | "periodo" | "cliente" | "especialidade" | "maturidade";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, Filter, X } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ClientesHeader } from "@/components/clientes/ClientesHeader";
import { CRMMetricsPanel } from "@/components/clientes/crm/CRMMetricsPanel";
import { CRMComparacao, CohortSpec } from "@/components/clientes/crm/CRMComparacaoPeriodos";
import { CRMClientTable } from "@/components/clientes/crm/CRMClientTable";
import { CRMFunilConversao } from "@/components/clientes/crm/CRMFunilConversao";
import { CRMEvolutionCharts } from "@/components/clientes/crm/CRMEvolutionCharts";
import { CRMTempoEtapas } from "@/components/clientes/crm/CRMTempoEtapas";
import { CRMFunilOrigem } from "@/components/clientes/crm/CRMFunilOrigem";
import { CRMFunilTag } from "@/components/clientes/crm/CRMFunilTag";
import { useCRMClienteData } from "@/hooks/useCRMClienteData";
import { procedimentoKey } from "@/utils/crmCalculations";
import { periodLabel } from "@/utils/dateRange";
import { useEspecialidades } from "@/hooks/useEspecialidades";
import { useProjetosLista } from "@/hooks/useProjetosLista";
import { useClienteInicioBanco } from "@/hooks/useClienteInicioBanco";
import { resolveProjeto, mesesDeCasa, CRM_MATURIDADE_FAIXAS, clienteNaFaixaMaturidadeCrm, crmMaturidadeJanela, CrmMaturidadeId } from "@/data/squads";
import { OrigemMultiSelect } from "@/components/clientes/OrigemMultiSelect";
import { TagsMultiSelect } from "@/components/clientes/TagsMultiSelect";
import { MedicoMultiSelect } from "@/components/clientes/MedicoMultiSelect";
import { ProcedimentoMultiSelect } from "@/components/clientes/ProcedimentoMultiSelect";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { CarteiraToggle } from "@/components/clientes/CarteiraToggle";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export default function ClientesCRM() {
  // Só admin/crm_editor podem EXECUTAR as ações do CRM (editar planejado + escolher a base
  // de faturamento). Os demais veem tudo em modo leitura. A trava real é a RLS do banco.
  const { canEditCrm, canEditCrmNumbers, clientUser, canCompararPeriodos } = useAuth();
  // Filtros COMPARTILHADOS com as demais telas de /clientes.
  const { filters, patch, clear } = useClientesFilters();
  const clientFilter = filters.client;
  const origemFilter = filters.origem;
  const medicoFilter = filters.medico;
  const tagsFilter = filters.tags ?? [];
  const tagsMode = filters.tagsMode ?? "include";
  const dateFrom = filters.dateFrom;
  const dateTo = filters.dateTo;

  const dateFromStr = dateFrom ? format(dateFrom, "yyyy-MM-dd") : undefined;
  // `dateTo` é inclusivo em todo o stack — hooks normalizam para endOfDayBRT
  // ao consultar colunas TIMESTAMP, e inRange/queries em DATE comparam
  // YYYY-MM-DD inclusivamente. Sem `to` (dia único) → colapsa para from..from.
  const dateToStr = dateTo ? format(dateTo, "yyyy-MM-dd") : dateFromStr;

  // Filtro por TEMPO DE MATURIDADE (tempo de DADOS do cliente no banco) — LOCAL da tela CRM.
  // Escolha ÚNICA ("all" = sem filtro). As faixas "Primeiros N meses" se sobrepõem por limite
  // INFERIOR (primeiros 12 ⊂ primeiros 6 ⊂ primeiros 3): o cliente aparece quando JÁ acumulou
  // ≥ N meses de dados, então todos com ≥3 meses caem em "Primeiros 3 meses".
  // A maturidade vem do primeiro dado real no banco (início pelo banco → mesesDeCasa).
  // Declarado ANTES do fetch de Ads porque, quando ATIVO, o período global some e os Ads
  // passam a ser puxados por HISTÓRICO INTEIRO (o recorte vira a janela por cliente, client-side).
  const [maturidadeSel, setMaturidadeSel] = useState<CrmMaturidadeId | "all">("all");
  const matActive = maturidadeSel !== "all";

  // Reaproveita o pipeline da página "Relatório Geral": o `useClientesData` constrói o
  // `canonicalMap` (unifica nomes de conta do Ads ↔ slug do Kommo via buildClientCanonicalMap),
  // que é o que o fetch interno do useCRMClienteData NÃO faz (ele só usa normalizeClientName,
  // que não remove o sufixo "- CA x.y.z | Groohub" e por isso os ads não casavam com o CRM).
  // Passamos os ads já canonicalizados como externalAdsRows; o "Leads tráfego" = leads + conversas.
  // Usuário-cliente: escopa o fetch de Ads às contas do cliente pelos nomes crus EXATOS
  // (ads_names = os mesmos da RLS, que fazem a tela Meta funcionar). Escopar pelo slug falhava
  // quando o slug difere do nome da conta de Ads. Equipe (clientUser=null) segue igual (traz tudo).
  // Com maturidade ativa, o período global não vale: puxa o histórico inteiro de Ads (datas
  // nulas) e o recorte fino por cliente acontece client-side (pela janela de maturidade).
  const adsFromStr = matActive ? undefined : dateFromStr;
  const adsToStr = matActive ? undefined : dateToStr;
  const { data: adsDataForCRM, canonicalMap, clients: allClients, loading: adsLoading } = useClientesData(adsFromStr, adsToStr, clientUser?.adsNames);
  const adsRowsForCRM = useMemo(
    () => adsDataForCRM.map((r) => ({
      Client: canonicalMap.canonicalByAdsName.get(r.Client) || foldMergedAdsClient(canonicalizeAdsClient(r.Client)),
      // Dia preservado p/ a evolução mensal de investimento/leads tráfego (por mês).
      Dia: r.Dia,
      Lead: r.Lead,
      Mensagens_iniciadas: r.Conversa,
      Valor_usado_BRL: r.Valor_usado_BRL,
      Fonte_Ads: r.Fonte_Ads,
      // Médico dono da conta (ex.: "Dr. Moacir" / "Dra. Lia") — derivado do NOME CRU do
      // Ads, ANTES da fusão do cliente. Deixa o filtro de médico dividir o leads tráfego
      // entre médicos que compartilham o mesmo cliente do CRM. null = não se divide.
      medico: adsMedicoForClient(r.Client),
    })),
    [adsDataForCRM, canonicalMap]
  );

  // Filtro por TIPO de procedimento — LOCAL da tela CRM (é por cliente, não entra nos
  // filtros compartilhados). Zera sempre que o cliente muda: os nomes de procedimento são
  // específicos de cada cliente.
  const [procedimentoFilter, setProcedimentoFilter] = useState<string[]>([]);
  useEffect(() => { setProcedimentoFilter([]); }, [clientFilter]);

  // COMPARAÇÃO — LOCAL da tela CRM (não entra nos filtros compartilhados). Um SELECT escolhe O
  // QUE comparar e cada modo revela seus operandos (lado A e lado B):
  //  - "periodo": mesmo recorte de cliente em DUAS janelas de datas (A = filtro atual; B escolhido);
  //  - "cliente": dois clientes diferentes na MESMA janela (o período atual);
  //  - "especialidade"/"maturidade": duas coortes diferentes (conjuntos de clientes) na mesma janela.
  const [compareMode, setCompareMode] = useState<CompareMode>("off");
  const [compareFrom, setCompareFrom] = useState<Date | undefined>(undefined);
  const [compareTo, setCompareTo] = useState<Date | undefined>(undefined);
  const [cmpClientA, setCmpClientA] = useState<string>("");
  const [cmpClientB, setCmpClientB] = useState<string>("");
  const [cmpEspA, setCmpEspA] = useState<string>("");
  const [cmpEspB, setCmpEspB] = useState<string>("");
  const [cmpMatA, setCmpMatA] = useState<CrmMaturidadeId | "">("");
  const [cmpMatB, setCmpMatB] = useState<CrmMaturidadeId | "">("");
  // Ao entrar no modo "periodo", sugere o MÊS ANTERIOR ao início do período atual como período B.
  const onChangeCompareMode = (m: CompareMode) => {
    setCompareMode(m);
    if (m === "periodo" && !compareFrom) {
      const base = dateFrom ?? new Date();
      setCompareFrom(startOfMonth(subMonths(base, 1)));
      setCompareTo(endOfMonth(subMonths(base, 1)));
    }
  };

  // Especialidades (tabela `clientes`) e projetos (tempo de casa). Carregados ANTES do hook de
  // dados do CRM porque alimentam a lista de clientes filtrada (`clientList`) passada a ele.
  const { especialidadeOptions, getEspecialidades } = useEspecialidades();
  const { index: projetosIndex } = useProjetosLista();
  const especialidadeFilter = filters.especialidade;

  // MATURIDADE pelo TEMPO DE BANCO: o tempo de casa do cliente é contado a partir do primeiro
  // dado real no banco (o MAIS ANTIGO entre Ads e CRM), caindo na `data_inicio` do projetos_lista
  // só como fallback quando o cliente ainda não tem dado no banco. Só busca quando a maturidade
  // está realmente em uso (filtro ou comparação por maturidade) — senão nem dispara as queries.
  const maturidadeEmUso = maturidadeSel !== "all" || compareMode === "maturidade";
  const { inicioByCanonical } = useClienteInicioBanco(canonicalMap, maturidadeEmUso);
  // INÍCIO REAL DO CLIENTE = a data MAIS ANTIGA entre o primeiro dado do banco (Ads/CRM) e a
  // `data_inicio` do cadastro (projetos_lista). Antes o cadastro era só fallback (`?? ...`), o
  // que encurtava o tempo de casa quando a ingestão do banco começava tarde — caso recorrente
  // de conta nova/renomeada, cujo primeiro `Dia` ingerido é recente mesmo o cliente sendo antigo.
  // Pegando o MÍNIMO das duas fontes, a maturidade conta "desde a criação", nunca mais curta do
  // que a realidade (só pode puxar o início para trás → mais clientes caem em "Primeiros 3/6").
  const getInicioCliente = useCallback(
    (c: string): Date | null => {
      const db = inicioByCanonical.get(c) ?? null;
      const proj = resolveProjeto(projetosIndex, c)?.desde ?? null;
      if (db && proj) return db.getTime() <= proj.getTime() ? db : proj;
      return db ?? proj;
    },
    [inicioByCanonical, projetosIndex],
  );

  // MESES DE CASA p/ a classificação de maturidade, com PISO de negócio = 3 meses.
  // Regra do usuário: TODO cliente ATIVO tem pelo menos 3 meses de dados no sistema. Porém a
  // ingestão do banco costuma começar tarde p/ contas novas/renomeadas (1º `Dia` recente) ou
  // nem resolve data — então o cálculo cru dava <3 meses (ou null) e esses clientes sumiam de
  // "Primeiros 3 meses" (eram ~21 de 60+). Aplicando o piso, quem não tem data confiável (ou
  // tem 1º dado recente) é tratado como o MÍNIMO garantido de 3 meses → aparece em "Primeiros
  // 3". As faixas EXATAS (4-6, 7-12, 13+) continuam honestas: um piso de 3 nunca entra nelas,
  // e quem tem tempo real maior é classificado pelo valor real. `getInicioCliente` segue
  // mostrando a data real (ou "sem data") na lista, então o piso não mascara o que está exibido.
  const getMesesMaturidade = useCallback(
    (c: string): number => {
      const desde = getInicioCliente(c);
      const real = desde ? mesesDeCasa(desde) : null;
      return Math.max(real ?? 3, 3);
    },
    [getInicioCliente],
  );

  // Lista de clientes (slug canônico) que atendem AO MESMO TEMPO ao filtro de especialidade e
  // ao de maturidade. CRÍTICO: devolve `undefined` quando NENHUM dos dois está ativo (nunca
  // `[]`, que o hook interpretaria como "nenhum cliente" e zeraria os totais em silêncio).
  // Com um cliente ESPECÍFICO filtrado, a maturidade deixa de ser COORTE e vira a janela de
  // datas DAQUELE cliente (tratada via `maturityWindows`) — então ela NÃO restringe mais a
  // lista (senão um cliente que ainda não "completou" a faixa seria excluído e zeraria tudo).
  const clientList = useMemo<string[] | undefined>(() => {
    const byEsp = especialidadeFilter && especialidadeFilter !== "all";
    const singleClient = clientFilter !== "all";
    const byMatCohort = maturidadeSel !== "all" && !singleClient;
    if (!byEsp && !byMatCohort) return undefined;
    return allClients.filter((c) => {
      if (byEsp && !getEspecialidades(c).includes(especialidadeFilter)) return false;
      if (byMatCohort) {
        if (!clienteNaFaixaMaturidadeCrm(getMesesMaturidade(c), maturidadeSel)) return false;
      }
      return true;
    });
  }, [especialidadeFilter, maturidadeSel, clientFilter, allClients, getEspecialidades, getMesesMaturidade]);

  // JANELA DE MATURIDADE POR CLIENTE. Com faixa ativa, o período GLOBAL some e cada cliente da
  // coorte é recortado pela SUA fatia de maturidade (ex.: "Primeiros 3 meses" = os 3 primeiros
  // meses de casa DAQUELE cliente; "Entre 4 e 6 meses" = a fatia 4–6 dele; e assim por diante).
  // Monta o mapa canônico→{from,to} (datas) que vai client-side ao pipeline, e os LIMITES da
  // UNIÃO de todas as janelas (usados só como período "efetivo" para o planejado/rótulos — o
  // fetch de dados puxa histórico inteiro e o recorte fino é por cliente). null quando "all".
  const { maturityWindows, matFrom, matTo } = useMemo(() => {
    if (!matActive) {
      return { maturityWindows: null as Map<string, { from: string; to: string }> | null, matFrom: undefined as string | undefined, matTo: undefined as string | undefined };
    }
    const map = new Map<string, { from: string; to: string }>();
    let lo: string | undefined;
    let hi: string | undefined;
    // Cliente ESPECÍFICO filtrado: a janela vale só pra ELE (mostra a fatia de maturidade dele,
    // mesmo que ainda não tenha completado a faixa inteira). Sem cliente filtrado: a COORTE =
    // quem já cumpriu a faixa (clienteNaFaixaMaturidadeCrm).
    const selKey = clientFilter !== "all" ? clientMatchKey(clientFilter) : null;
    for (const c of allClients) {
      if (selKey) {
        if (clientMatchKey(c) !== selKey) continue;
      } else if (!clienteNaFaixaMaturidadeCrm(getMesesMaturidade(c), maturidadeSel)) {
        continue;
      }
      const janela = crmMaturidadeJanela(maturidadeSel, getInicioCliente(c));
      if (!janela) continue;
      const from = format(janela.from, "yyyy-MM-dd");
      const to = format(janela.to, "yyyy-MM-dd");
      map.set(c, { from, to });
      if (!lo || from < lo) lo = from;
      if (!hi || to > hi) hi = to;
    }
    // Com maturidade ATIVA devolve SEMPRE o mapa (mesmo vazio): mapa vazio = "ninguém tem essa
    // janela" → o pipeline mostra ZERO (e não o histórico inteiro). Só devolve null quando a
    // maturidade está desligada, aí o período global volta a mandar.
    return { maturityWindows: map, matFrom: lo, matTo: hi };
  }, [matActive, maturidadeSel, clientFilter, allClients, getMesesMaturidade, getInicioCliente]);

  // Datas EFETIVAS do planejado/alertas: no modo maturidade, os limites da união das janelas
  // da coorte; senão, o período global do filtro compartilhado.
  const effMetaFrom = matActive && matFrom ? new Date(`${matFrom}T00:00:00`) : dateFrom;
  const effMetaTo = matActive && matTo ? new Date(`${matTo}T00:00:00`) : dateTo;

  // Médicos (clientes) que caem na especialidade selecionada — listados logo abaixo dos filtros
  // para conferir, a olho, se TODOS os médicos da especialidade estão presentes e se falta algum.
  // Considera APENAS a especialidade (ignora maturidade/demais filtros) e usa o rótulo oficial.
  const especialidadeMedicos = useMemo<string[]>(() => {
    if (!especialidadeFilter || especialidadeFilter === "all") return [];
    return allClients
      .filter((c) => getEspecialidades(c).includes(especialidadeFilter))
      .map((c) => prettyClientLabel(c))
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [especialidadeFilter, allClients, getEspecialidades]);

  // Clientes que caem na faixa de maturidade selecionada — listados logo abaixo dos filtros
  // para conferir, a olho, se TODOS os clientes daquela faixa estão presentes e se falta algum.
  // Considera APENAS a maturidade (ignora especialidade/demais filtros) e usa o rótulo oficial.
  const maturidadeClientes = useMemo<{ nome: string; inicio: Date | null; meses: number | null }[]>(() => {
    if (maturidadeSel === "all") return [];
    return allClients
      .map((c) => {
        const desde = getInicioCliente(c);
        const meses = desde ? mesesDeCasa(desde) : null;
        // Classifica pelo piso de negócio (≥3 meses); exibe a data/meses REAIS.
        return { c, desde, meses, mesesClass: getMesesMaturidade(c) };
      })
      .filter(({ mesesClass }) => clienteNaFaixaMaturidadeCrm(mesesClass, maturidadeSel))
      .map(({ c, desde, meses }) => ({ nome: prettyClientLabel(c), inicio: desde, meses }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [maturidadeSel, allClients, getInicioCliente, getMesesMaturidade]);

  // Quando especialidade E maturidade estão selecionadas ao mesmo tempo, em vez de duas listas
  // separadas mostramos UMA só com os clientes que atendem aos DOIS filtros juntos (interseção).
  // `clientList` já é exatamente essa interseção quando ambos estão ativos (undefined quando não).
  const especialidadeMaturidadeClientes = useMemo<string[]>(() => {
    const byEsp = especialidadeFilter && especialidadeFilter !== "all";
    const byMat = maturidadeSel !== "all";
    if (!byEsp || !byMat || !clientList) return [];
    return clientList
      .map((c) => prettyClientLabel(c))
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [especialidadeFilter, maturidadeSel, clientList]);

  // Planejado + correção manual (override) por PROCEDIMENTO — habilitado para Dr. Diego Rezende
  // e Dr. Pablo Fonseca. Quando um deles está selecionado E há exatamente UM procedimento
  // filtrado, tanto o planejado (cadastro + leitura) quanto as correções dos números do CRM
  // passam a valer só p/ esse procedimento. Sem filtro (ou ≥2 procedimentos), ou qualquer
  // outro cliente, cai no geral ('') — idêntico ao de sempre. O planejado reusa a MESMA coluna
  // de escopo `medico` da tabela clientes_meta (nenhum dos dois tem planejado por médico, então
  // não há colisão com a Lia); as correções embutem o mesmo token na assinatura do override.
  // Valor chaveado pela procedimentoKey normalizada (imune a caixa/acento); prefixo `proc:`
  // deixa o escopo autoexplicativo e distinto de qualquer nome de médico.
  const PROC_SCOPE_CLIENTS = useMemo(
    () => [clientMatchKey("Diego_Rezende"), clientMatchKey("Pablo_Fonseca")],
    []
  );
  const procedimentoScope = useMemo(() => {
    if (clientFilter === "all" || !PROC_SCOPE_CLIENTS.includes(clientMatchKey(clientFilter))) return "";
    const sel = procedimentoFilter.filter((v) => v && v !== "all");
    return sel.length === 1 ? `proc:${procedimentoKey(sel[0])}` : "";
  }, [clientFilter, procedimentoFilter, PROC_SCOPE_CLIENTS]);

  // `needsLeadTimes = !clientUser`: o gráfico "Tempo Médio entre Etapas" (CRMTempoEtapas) só
  // aparece para a equipe (bloco !clientUser). Como o fetch de lead-times é caro e saiu do gate
  // de primeiro paint, só o pedimos quando a tela realmente vai renderizá-lo.
  // Com maturidade ativa, o período global não vai ao hook (undefined): o fetch puxa histórico
  // inteiro e `maturityWindows` recorta cada cliente à SUA janela de maturidade, client-side.
  const crmFromStr = matActive ? undefined : dateFromStr;
  const crmToStr = matActive ? undefined : dateToStr;
  const { totals, computedTotals, funnelData, leadTimes, origemFunnel, tagFunnel, monthlyEvolution, orcamentoParado, origens, tags: tagOptions, medicos, procedimentos, procActive, clientTable, loading, error, resolveBasis, setBasis, savingBasis, overrides, overridePeriodLabel } = useCRMClienteData(clientFilter, crmFromStr, crmToStr, origemFilter, medicoFilter, adsRowsForCRM, clientList, procedimentoFilter, procedimentoScope, !clientUser, maturityWindows, tagsFilter, tagsMode);

  // O `client` compartilhado pode vir de outra tela numa forma canônica ligeiramente
  // diferente; mapeia p/ a entrada equivalente da lista local (por cmpKey) pro dropdown
  // destacar a opção certa. A filtragem do hook é por clientMatchKey, então é tolerante.
  const clientForUI = useMemo(() => {
    if (clientFilter === "all") return "all";
    const sel = clientCmpKey(clientFilter);
    return allClients.find((c) => clientCmpKey(c) === sel) ?? clientFilter;
  }, [clientFilter, allClients]);

  // A escolha da base do Faturamento Bruto só faz sentido com um único cliente
  // selecionado (a config é por cliente). No agregado o card fica informativo.
  const selectedClient = clientFilter !== "all" ? clientFilter : undefined;
  const selectedBasis = selectedClient ? resolveBasis(selectedClient) : undefined;

  // Planejado por MÉDICO — clientes cujo planejado é definido por médico dentro do mesmo
  // cliente do CRM: Lia Garrido (contas de Ads SEPARADAS Lia/Moacir), Dra. Carla Gouveia
  // (conta ÚNICA dividida pelo NOME da campanha) e Instituto Aurum (DUAS contas, uma por
  // médico — Dr. Davi Colares / Dr. Filipe Kato — agrupadas num cliente só). Quando um
  // deles está selecionado E há
  // EXATAMENTE um médico filtrado, o planejado (cadastro + leitura) passa a valer só para esse
  // médico — assim dá p/ definir metas realistas por médico e acompanhar cada um. Sem médico
  // (ou vários), ou qualquer outro cliente, cai no planejado geral ('') — igual a sempre.
  // O rótulo do médico tem de ser o MESMO do Kommo/split (ex.: "Dra. Carla Gouveia"), senão o
  // planejado salvo não casa com o médico filtrado — ver ADS_CAMPAIGN_MEDICO_SPLIT.
  const MEDICO_SCOPE_CLIENTS = useMemo(
    () => [clientMatchKey("Lia_Garrido"), clientMatchKey("Carla_Gouveia"), clientMatchKey("Instituto_Aurum")],
    []
  );
  const medicoScope = useMemo(() => {
    if (clientFilter === "all" || !MEDICO_SCOPE_CLIENTS.includes(clientMatchKey(clientFilter))) return "";
    const sel = (Array.isArray(medicoFilter) ? medicoFilter : [medicoFilter]).filter((v) => v && v !== "all");
    return sel.length === 1 ? sel[0] : "";
  }, [clientFilter, medicoFilter, MEDICO_SCOPE_CLIENTS]);

  // Diego/Pablo e Lia são clientes distintos: no máximo um dos escopos está ativo por vez.
  const metaScope = medicoScope || procedimentoScope;

  // Metas do CRM (consultas, faturamento, roas) — rateadas p/ o período; edição p/ cliente único.
  // `allSlugs` do alerta "clientes sem planejado" segue a LISTA EXIBIDA: quando há filtro de
  // especialidade/maturidade ativo, `clientList` é o subconjunto filtrado; sem filtro é `undefined`
  // e cai em `allClients`. Assim o banner só cobra planejado de clientes que estão de fato na lista
  // atual (antes usava sempre `allClients` e acusava clientes fora do recorte filtrado).
  const metas = useMetaCardsCtx(clientFilter, effMetaFrom, effMetaTo, { fields: CRM_FIELDS, allSlugs: clientList ?? allClients, medico: metaScope, allowEdit: canEditCrm });

  // Especialidades reais (tabela `clientes`) — sobrescrevem o valor estático que vinha de
  // calcClientTable. Um cliente pode ter várias; exibimos todas separadas por vírgula.
  // Evolução mensal + linha de meta por série (rateada por mês). Leads, consultas e
  // procedimentos têm meta cadastrada em clientes_meta.
  // ROAS e CPL são TAXAS: o alvo não se rateia por dias (um CPL de R$15 é R$15 em
  // qualquer recorte). Usa o valor cadastrado (mês-âncora) como linha constante; no
  // agregado ("all") getMonthValue devolve null → sem linha (taxa não soma entre clientes).
  const metaRoasConst = metas.getMonthValue("roas");
  const metaCplConst = metas.getMonthValue("cplCRM");
  const evolutionData = useMemo(
    () => monthlyEvolution.map((m) => ({
      ...m,
      metaLeads: metas.getMonthlyMeta("leadsCRM", m.month),
      metaConsultasAgendadas: metas.getMonthlyMeta("consultaAgendada", m.month),
      metaConsultasRealizadas: metas.getMonthlyMeta("consultaRealizada", m.month),
      metaProcedimentosAgendados: metas.getMonthlyMeta("procedimentoAgendado", m.month),
      metaProcedimentosRealizados: metas.getMonthlyMeta("procedimentoRealizado", m.month),
      // Absolutos (rateados por mês): investimento e faturamento.
      metaInvestimento: metas.getMonthlyMeta("investimento", m.month),
      metaFaturamento: metas.getMonthlyMeta("faturamento", m.month),
      // Taxas (constantes): ROAS e CPL.
      metaRoas: metaRoasConst,
      metaCpl: metaCplConst,
    })),
    [monthlyEvolution, metas, metaRoasConst, metaCplConst]
  );

  // getEspecialidades/especialidadeOptions já vêm do useEspecialidades chamado acima.
  const clientTableComEsp = useMemo(
    () => clientTable.map((r) => ({
      ...r,
      especialidade: getEspecialidades(r.client).join(", ") || "—",
    })),
    [clientTable, getEspecialidades]
  );

  // Operandos da comparação (lado A e lado B) montados a partir do modo escolhido. Devolve
  // `null` quando a comparação está desligada, sem período atual, ou faltando algum operando —
  // aí o painel de comparação simplesmente não aparece. Coorte vazia (especialidade/maturidade
  // sem clientes) recebe um slug-sentinela que não casa nada, p/ o lado somar ZERO (e não "tudo",
  // que é como o hook interpreta uma lista vazia).
  const compareCohorts = useMemo<{ a: CohortSpec; b: CohortSpec } | null>(() => {
    if (!canCompararPeriodos || compareMode === "off") return null;
    if (!dateFromStr || !dateToStr) return null;
    const NO_MATCH = ["__sem_cliente__"];
    const curDates = { from: dateFromStr, to: dateToStr, periodFrom: dateFrom, periodTo: dateTo };
    const espList = (esp: string) => {
      const l = allClients.filter((c) => getEspecialidades(c).includes(esp));
      return l.length ? l : NO_MATCH;
    };
    const matList = (mat: CrmMaturidadeId) => {
      const l = allClients.filter((c) => clienteNaFaixaMaturidadeCrm(getMesesMaturidade(c), mat));
      return l.length ? l : NO_MATCH;
    };
    const matLabel = (id: CrmMaturidadeId) => CRM_MATURIDADE_FAIXAS.find((f) => f.id === id)?.label ?? id;

    if (compareMode === "periodo") {
      if (!compareFrom || !compareTo) return null;
      const baseSlug = clientFilter !== "all" ? clientFilter : "all";
      return {
        a: { label: periodLabel(dateFrom, dateTo), clientFilter: baseSlug, clientList, ...curDates, metaSlug: baseSlug, metaScope },
        b: { label: periodLabel(compareFrom, compareTo), clientFilter: baseSlug, clientList, from: format(compareFrom, "yyyy-MM-dd"), to: format(compareTo, "yyyy-MM-dd"), periodFrom: compareFrom, periodTo: compareTo, metaSlug: baseSlug, metaScope },
      };
    }
    if (compareMode === "cliente") {
      if (!cmpClientA || !cmpClientB) return null;
      return {
        a: { label: prettyClientLabel(cmpClientA), clientFilter: cmpClientA, ...curDates, metaSlug: cmpClientA, metaScope: "" },
        b: { label: prettyClientLabel(cmpClientB), clientFilter: cmpClientB, ...curDates, metaSlug: cmpClientB, metaScope: "" },
      };
    }
    if (compareMode === "especialidade") {
      if (!cmpEspA || !cmpEspB) return null;
      return {
        a: { label: cmpEspA, clientFilter: "all", clientList: espList(cmpEspA), ...curDates, metaSlug: "all", metaScope: "" },
        b: { label: cmpEspB, clientFilter: "all", clientList: espList(cmpEspB), ...curDates, metaSlug: "all", metaScope: "" },
      };
    }
    // maturidade
    if (!cmpMatA || !cmpMatB) return null;
    return {
      a: { label: matLabel(cmpMatA), clientFilter: "all", clientList: matList(cmpMatA), ...curDates, metaSlug: "all", metaScope: "" },
      b: { label: matLabel(cmpMatB), clientFilter: "all", clientList: matList(cmpMatB), ...curDates, metaSlug: "all", metaScope: "" },
    };
  }, [canCompararPeriodos, compareMode, dateFromStr, dateToStr, dateFrom, dateTo, compareFrom, compareTo, clientFilter, clientList, metaScope, cmpClientA, cmpClientB, cmpEspA, cmpEspB, cmpMatA, cmpMatB, allClients, getEspecialidades, getMesesMaturidade]);

  if (error) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <ClientesHeader activeTab="CRM" />
          <div className="neu-card rounded-lg p-8 text-center mt-6">
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <ClientesHeader activeTab="CRM" />

        {/* Filters */}
        <div className="neu-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Filtros</span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <CarteiraToggle />
            {/* Período: some quando a maturidade está ativa — aí cada cliente é recortado pela
                SUA janela de maturidade (ex.: os primeiros 3 meses dele), não por uma data global. */}
            {matActive ? (
              <span className="neu-inset rounded-lg px-3 py-1.5 text-xs text-muted-foreground">
                Período:{" "}
                <span className="font-semibold text-primary">
                  {CRM_MATURIDADE_FAIXAS.find((f) => f.id === maturidadeSel)?.label ?? maturidadeSel}
                </span>{" "}
                de cada cliente
              </span>
            ) : (
              <DateRangePicker
                from={dateFrom}
                to={dateTo}
                onChange={({ from, to }) => patch({ dateFrom: from, dateTo: to })}
              />
            )}

            {clientUser ? (
              <span className="neu-inset rounded-lg px-3 py-1.5 text-xs text-muted-foreground">
                Cliente: <span className="font-semibold text-primary">{prettyClientLabel(clientFilter)}</span>
              </span>
            ) : (
              <SearchableSelect
                value={clientForUI}
                onValueChange={(v) => patch({ client: v, medico: [] })}
                options={allClients.map((c) => ({ value: c, label: prettyClientLabel(c) }))}
                placeholder="Todos os clientes"
                searchPlaceholder="Buscar cliente..."
                emptyText="Nenhum cliente encontrado."
                allOption={{ value: "all", label: "Todos os clientes" }}
              />
            )}

            {/* Especialidade (tabela `clientes`) — escolha única; filtra a carteira. */}
            <SearchableSelect
              value={especialidadeFilter}
              onValueChange={(v) => patch({ especialidade: v })}
              options={especialidadeOptions.map((e) => ({ value: e, label: e }))}
              placeholder="Todas as especialidades"
              searchPlaceholder="Buscar especialidade..."
              emptyText="Nenhuma especialidade encontrada."
              allOption={{ value: "all", label: "Todas as especialidades" }}
            />

            {/* Tempo de maturidade (tempo de casa) — escolha única; faixas sobrepostas. */}
            <SearchableSelect
              value={maturidadeSel}
              onValueChange={(v) => {
                const next = v as CrmMaturidadeId | "all";
                setMaturidadeSel(next);
                // Maturidade ativa recorta por JANELA por cliente — incompatível com comparação
                // por período/coorte. Desliga a comparação para o modo ficar funcional (e sem
                // nenhum seletor de período solto na tela).
                if (next !== "all") {
                  setCompareMode("off");
                  setCmpClientA(""); setCmpClientB(""); setCmpEspA(""); setCmpEspB(""); setCmpMatA(""); setCmpMatB("");
                }
              }}
              options={CRM_MATURIDADE_FAIXAS.map((f) => ({ value: f.id, label: f.label }))}
              placeholder="Todas as maturidades"
              searchPlaceholder="Buscar maturidade..."
              emptyText="Nenhuma maturidade."
              allOption={{ value: "all", label: "Todas as maturidades" }}
            />

            <OrigemMultiSelect
              value={origemFilter}
              onChange={(v) => patch({ origem: v })}
              options={origens}
            />

            {tagOptions.length > 0 && (
              <TagsMultiSelect
                value={tagsFilter}
                onChange={(v) => patch({ tags: v })}
                options={tagOptions}
                mode={tagsMode}
                onModeChange={(m) => patch({ tagsMode: m })}
              />
            )}

            {medicos.length > 1 && (
              <MedicoMultiSelect
                value={medicoFilter}
                onChange={(v) => patch({ medico: v })}
                options={medicos}
              />
            )}

            {/* Filtro por tipo de procedimento — só aparece com 1 cliente que tem ≥2
                procedimentos distintos (ex.: Dr. Diego Rezende: Rinoplastia × Transplante Capilar). */}
            {procedimentos.length > 1 && (
              <ProcedimentoMultiSelect
                value={procedimentoFilter}
                onChange={setProcedimentoFilter}
                options={procedimentos}
              />
            )}

            {/* COMPARAÇÃO — no FIM da linha (após as origens). Um select escolhe O QUE comparar e
                cada modo revela seus operandos (lado A vs lado B). Só p/ quem foi LIBERADO na
                Administração (canCompararPeriodos). Não mexe nos filtros compartilhados. Oculta
                quando a maturidade está ativa (o recorte vira a janela por cliente, sem período). */}
            {canCompararPeriodos && !matActive && (
              <>
                <SearchableSelect
                  value={compareMode}
                  onValueChange={(v) => onChangeCompareMode(v as CompareMode)}
                  options={[
                    { value: "off", label: "Sem comparação" },
                    { value: "periodo", label: "Comparar períodos" },
                    { value: "cliente", label: "Comparar clientes" },
                    { value: "especialidade", label: "Comparar especialidades" },
                    { value: "maturidade", label: "Comparar maturidades" },
                  ]}
                  placeholder="Comparar..."
                  searchPlaceholder="Buscar modo..."
                  emptyText="Nenhum modo."
                  allOption={null}
                  triggerClassName={cn(compareMode !== "off" && "ring-1 ring-violet-500/40 text-violet-600 dark:text-violet-400")}
                />

                {compareMode === "periodo" && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-violet-600 dark:text-violet-400">vs</span>
                    <DateRangePicker
                      from={compareFrom}
                      to={compareTo}
                      onChange={({ from, to }) => { setCompareFrom(from); setCompareTo(to); }}
                      placeholder="Período de comparação"
                      className="border border-violet-500/40 text-violet-600 dark:text-violet-400"
                    />
                  </span>
                )}

                {compareMode === "cliente" && (
                  <span className="inline-flex items-center gap-1.5">
                    <SearchableSelect
                      value={cmpClientA}
                      onValueChange={setCmpClientA}
                      options={allClients.map((c) => ({ value: c, label: prettyClientLabel(c) }))}
                      placeholder="Cliente A"
                      searchPlaceholder="Buscar cliente..."
                      emptyText="Nenhum cliente."
                      allOption={null}
                    />
                    <span className="text-[11px] font-medium text-violet-600 dark:text-violet-400">vs</span>
                    <SearchableSelect
                      value={cmpClientB}
                      onValueChange={setCmpClientB}
                      options={allClients.map((c) => ({ value: c, label: prettyClientLabel(c) }))}
                      placeholder="Cliente B"
                      searchPlaceholder="Buscar cliente..."
                      emptyText="Nenhum cliente."
                      allOption={null}
                    />
                  </span>
                )}

                {compareMode === "especialidade" && (
                  <span className="inline-flex items-center gap-1.5">
                    <SearchableSelect
                      value={cmpEspA}
                      onValueChange={setCmpEspA}
                      options={especialidadeOptions.map((e) => ({ value: e, label: e }))}
                      placeholder="Especialidade A"
                      searchPlaceholder="Buscar especialidade..."
                      emptyText="Nenhuma especialidade."
                      allOption={null}
                    />
                    <span className="text-[11px] font-medium text-violet-600 dark:text-violet-400">vs</span>
                    <SearchableSelect
                      value={cmpEspB}
                      onValueChange={setCmpEspB}
                      options={especialidadeOptions.map((e) => ({ value: e, label: e }))}
                      placeholder="Especialidade B"
                      searchPlaceholder="Buscar especialidade..."
                      emptyText="Nenhuma especialidade."
                      allOption={null}
                    />
                  </span>
                )}

                {compareMode === "maturidade" && (
                  <span className="inline-flex items-center gap-1.5">
                    <SearchableSelect
                      value={cmpMatA}
                      onValueChange={(v) => setCmpMatA(v as CrmMaturidadeId)}
                      options={CRM_MATURIDADE_FAIXAS.map((f) => ({ value: f.id, label: f.label }))}
                      placeholder="Maturidade A"
                      searchPlaceholder="Buscar maturidade..."
                      emptyText="Nenhuma maturidade."
                      allOption={null}
                    />
                    <span className="text-[11px] font-medium text-violet-600 dark:text-violet-400">vs</span>
                    <SearchableSelect
                      value={cmpMatB}
                      onValueChange={(v) => setCmpMatB(v as CrmMaturidadeId)}
                      options={CRM_MATURIDADE_FAIXAS.map((f) => ({ value: f.id, label: f.label }))}
                      placeholder="Maturidade B"
                      searchPlaceholder="Buscar maturidade..."
                      emptyText="Nenhuma maturidade."
                      allOption={null}
                    />
                  </span>
                )}
              </>
            )}

            {(dateFrom || dateTo || clientFilter !== "all" || especialidadeFilter !== "all" || maturidadeSel !== "all" || origemFilter.length > 0 || medicoFilter.length > 0 || tagsFilter.length > 0 || procedimentoFilter.length > 0 || compareMode !== "off") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { clear(); setProcedimentoFilter([]); setMaturidadeSel("all"); setCompareMode("off"); setCmpClientA(""); setCmpClientB(""); setCmpEspA(""); setCmpEspB(""); setCmpMatA(""); setCmpMatB(""); }}
                className="flex items-center gap-1.5 text-xs font-medium bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/20 hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
                Limpar filtros
              </Button>
            )}
          </div>

          {/* Especialidade E maturidade selecionadas → UMA lista única com a INTERSEÇÃO (clientes
              que atendem aos dois filtros juntos), em vez das duas listas separadas abaixo. */}
          {especialidadeFilter !== "all" && maturidadeSel !== "all" && (
            <div className="mt-3 border-t border-border/60 pt-3">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                Clientes em <span className="font-semibold text-foreground">{especialidadeFilter}</span>
                {" + "}
                <span className="font-semibold text-foreground">
                  {CRM_MATURIDADE_FAIXAS.find((f) => f.id === maturidadeSel)?.label ?? maturidadeSel}
                </span>
                {" "}({especialidadeMaturidadeClientes.length})
              </div>
              {especialidadeMaturidadeClientes.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {especialidadeMaturidadeClientes.map((nome) => (
                    <span key={nome} className="neu-inset rounded-lg px-2.5 py-1 text-xs text-foreground">
                      {nome}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">Nenhum cliente atende aos dois filtros.</span>
              )}
            </div>
          )}

          {/* Médicos da especialidade selecionada — logo abaixo dos filtros, para conferir se
              todos os médicos daquela especialidade aparecem e se falta algum. Só quando a
              maturidade NÃO está filtrada (senão vale a lista única de interseção acima). */}
          {especialidadeFilter !== "all" && maturidadeSel === "all" && (
            <div className="mt-3 border-t border-border/60 pt-3">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                Médicos em <span className="font-semibold text-foreground">{especialidadeFilter}</span>
                {" "}({especialidadeMedicos.length})
              </div>
              {especialidadeMedicos.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {especialidadeMedicos.map((nome) => (
                    <span key={nome} className="neu-inset rounded-lg px-2.5 py-1 text-xs text-foreground">
                      {nome}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">Nenhum médico cadastrado nesta especialidade.</span>
              )}
            </div>
          )}

          {/* Clientes da faixa de maturidade selecionada — logo abaixo dos filtros, para conferir
              se todos os clientes daquela faixa aparecem e se falta algum. Só quando a
              especialidade NÃO está filtrada (senão vale a lista única de interseção acima). */}
          {maturidadeSel !== "all" && especialidadeFilter === "all" && (
            <div className="mt-3 border-t border-border/60 pt-3">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                Clientes em{" "}
                <span className="font-semibold text-foreground">
                  {CRM_MATURIDADE_FAIXAS.find((f) => f.id === maturidadeSel)?.label ?? maturidadeSel}
                </span>
                {" "}({maturidadeClientes.length})
              </div>
              {maturidadeClientes.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {maturidadeClientes.map(({ nome, inicio, meses }) => (
                    <span
                      key={nome}
                      className="neu-inset rounded-lg px-2.5 py-1 text-xs text-foreground"
                      title={inicio ? `Início no banco: ${format(inicio, "dd/MM/yyyy")}` : "Sem data de início no banco"}
                    >
                      {nome}
                      {inicio && (
                        <span className="ml-1.5 text-[10px] text-muted-foreground">
                          {format(inicio, "MMM/yy", { locale: ptBR })}
                          {meses != null ? ` · ${meses} ${meses === 1 ? "mês" : "meses"}` : ""}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">Nenhum cliente nesta faixa de maturidade.</span>
              )}
            </div>
          )}
        </div>

        {/* Área de dados: skeleton enquanto o CRM carrega (o cabeçalho + filtros já aparecem
            na hora, então a página responde imediatamente em vez de segurar tudo). O carregamento
            de especialidades NÃO trava mais a tela — a coluna preenche quando chega.
            Inclui `adsLoading`: enquanto os dados de Ads (leads tráfego/CPL) ainda estão
            carregando/retentando, mantém o skeleton em vez de pintar 0 — só mostra números
            quando os dois lados (CRM + Ads) chegam. */}
        {loading || adsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton-loading h-24 rounded-lg" />
            ))}
          </div>
        ) : (
          <>
            {/* Alerta de metas não preenchidas no mês */}
            <MetasAlert metas={metas} clienteLabel={selectedClient ? prettyClientLabel(selectedClient) : undefined} />

            {/* Comparação (A vs B). Montada só quando o modo está ligado e ambos os operandos
                foram escolhidos (compareCohorts != null) — os hooks dos dois lados só disparam
                aqui, sem custo quando desligado. origem/médico/procedimento seguem aplicados. */}
            {compareCohorts && (
              <CRMComparacao
                cohortA={compareCohorts.a}
                cohortB={compareCohorts.b}
                origemFilter={origemFilter}
                medicoFilter={medicoFilter}
                procedimentoFilter={procedimentoFilter}
                adsScopeNames={clientUser?.adsNames}
              />
            )}

            {/* Metrics */}
            <CRMMetricsPanel
              totals={totals}
              computedTotals={computedTotals}
              selectedClient={selectedClient}
              basis={selectedBasis}
              // Sem permissão de CRM → onChangeBasis undefined desliga a escolha da base (só leitura).
              onChangeBasis={canEditCrm ? (b) => { if (selectedClient) void setBasis(selectedClient, b).catch(() => {}); } : undefined}
              saving={savingBasis}
              metas={metas}
              orcamentoParado={orcamentoParado}
              canEditCrm={canEditCrm}
              // Com o filtro de procedimento ativo, os números viram a coorte do procedimento.
              // As correções manuais só são editáveis quando há ESCOPO de procedimento
              // (Diego/Pablo + exatamente 1 procedimento) — aí a assinatura do override leva o
              // segmento "proc:" e cola só nessa coorte. Com ≥2 procedimentos (ou cliente sem
              // escopo), seguem desativadas (recorte ambíguo, igual antes).
              canEditNumbers={canEditCrmNumbers && (!procActive || !!procedimentoScope)}
              overrides={procActive && !procedimentoScope ? undefined : overrides}
              overridePeriodLabel={overridePeriodLabel}
            />

            {/* Evolução mensal (leads, consultas, procedimentos) — barras + linha de meta, acima do funil */}
            <SectionLabel>Evolução mensal</SectionLabel>
            <CRMEvolutionCharts data={evolutionData} />

            {/* Conta de cliente (clientUser): do Funil de conversão pra baixo é retirado —
                só cards + evolução mensal. Equipe (clientUser=null) vê tudo. */}
            {!clientUser && (
              <>
                {/* Funnel */}
                <SectionLabel>Funil de conversão</SectionLabel>
                <CRMFunilConversao data={funnelData} />

                {/* Lead Times */}
                <CRMTempoEtapas data={leadTimes} />

                {/* Origem Funnel */}
                <CRMFunilOrigem data={origemFunnel} />

                {/* Tag Funnel (só aparece quando há tags atribuídas) */}
                <CRMFunilTag data={tagFunnel} />

                {/* Table */}
                <SectionLabel>Desempenho por cliente</SectionLabel>
                <CRMClientTable data={clientTableComEsp} origemFilter={origemFilter} />
              </>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
