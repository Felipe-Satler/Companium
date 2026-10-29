import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Library, Loader2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MineracaoHeader } from "@/components/marketing/mineracao/MineracaoHeader";
import { AnalysisReport } from "@/components/marketing/mineracao/AnalysisReport";
import { analiseOrganica } from "@/components/marketing/mineracao/relatorioTexto";
import { AdCard } from "@/components/marketing/mineracao/AdCard";
import { RelatorioResultado } from "@/components/marketing/clientes/RelatorioResultado";
import { EtapasComposer } from "@/components/marketing/composer/EtapasComposer";
import {
  InsumosEtapa,
  type AbrirInsumo,
  type Selecao,
} from "@/components/marketing/composer/InsumosEtapa";
import {
  ehDocEstudoDeCopy,
  ehDocResumoEstrategico,
  idsDoResumoEstrategico,
} from "@/components/marketing/composer/filtrarInsumos";
import { PreviewInsumoDialog } from "@/components/marketing/composer/PreviewInsumoDialog";
import { RevisaoComposicao } from "@/components/marketing/composer/RevisaoComposicao";
import { ConceitosComposicao } from "@/components/marketing/composer/ConceitosComposicao";
import { ComposerSubnav } from "@/components/marketing/composer/ComposerSubnav";
import { CancelarComposicao } from "@/components/marketing/composer/CancelarComposicao";
import {
  carregarRascunho,
  rascunhoInicial,
  salvarRascunho,
  type EtapaComposer,
} from "@/components/marketing/composer/rascunhoComposer";
import {
  useCriativo,
  useCriativos,
  useLibrary,
  useLibraryEntry,
  useStartCriativoInterno,
} from "@/hooks/useAdSpy";
import { PreparoCriativo } from "@/components/marketing/composer/PreparoCriativo";
import { analisePorAnuncio, MAX_CRIATIVOS } from "@/components/marketing/composer/criativoInterno";
import { DissecacaoCriativo } from "@/components/marketing/mineracao/DissecacaoCriativo";
import { nomeDoCriativo } from "@/components/marketing/mineracao/criativoTexto";
import {
  useCancelComposition,
  useComposition,
  useCreateComposition,
  useDeleteComposition,
} from "@/hooks/useAdComposer";
import { useClientDocs, useDocumentoConteudo } from "@/hooks/useClientDocs";
import { rotuloSubpaginas } from "@/lib/clientDocsApi";
import { useClientReport, useClientReports } from "@/hooks/useClientReports";
import { useClientesVisiveis } from "@/hooks/useClientesVisiveis";
import { useEspecialidades } from "@/hooks/useEspecialidades";
import { useProjetosLista } from "@/hooks/useProjetosLista";
import { planoDe, progressoDosConceitos, type EntradaComposicao } from "@/lib/adComposerApi";
import { acompanhar, pedirPermissaoDeAviso } from "@/lib/acompanhamento";
import { nomeDoRelatorio } from "@/utils/relatorioMarkdown";
import { MAX_ANUNCIOS } from "../../shared/ad-formats";

type EtapaId = EtapaComposer;

/** Pedidos prontos: um clique escreve a quantidade e os usos, e a pessoa completa com o ângulo. */
const PEDIDOS = [
  "Um Reels",
  "3 anúncios: um Reels e dois Stories",
  "Um carrossel de feed e um Meta Ads",
  "5 anúncios, um para cada uso",
  "Google Ads de busca",
];

const SELECAO_VAZIA: Selecao = {
  analiseId: null,
  // Ligados por padrão: é o caso comum, e assim quem compõe VÊ o que vai junto em vez de o
  // contexto entrar por trás.
  brief: true,
  relatorios: new Set<string>(),
  documentos: new Set<string>(),
  criativos: new Set<string>(),
  interno: null,
  incluirNumeros: false,
};

/**
 * Marketing › Composer › Nova Composição — de insumo a um conjunto de anúncios.
 *
 * Fluxo guiado em quatro etapas, e não um formulário longo: cliente → insumos → intenção →
 * resultado. O cabeçalho mostra o que já foi decidido em cada etapa, porque é isso que dá a
 * sensação de estar construindo algo — não a animação.
 *
 * O FORMATO não é escolhido aqui, nem a QUANTIDADE. Quem decide os dois é o agente, lendo o
 * material e o pedido escrito na etapa de intenção ("três anúncios: um Reels e dois Stories"):
 * decidir "vai ser um Reels" antes de ver o conteúdo era decidir no vazio. Uma composição tem de 1
 * a 8 anúncios, cada um escrito para o uso dele.
 *
 * Ao sair e voltar, a tela continua de onde estava (cliente, etapa, insumos, pedido, a composição
 * em curso): o estado fica no navegador (`rascunhoComposer`). "Nova composição" é o que limpa.
 *
 * O Resumo Estratégico do cliente (Central de Copy) também é obrigatório desde 26/10/2026, e vem
 * MARCADO por padrão: todo cliente tem um, e é a tela que o escolhe ao abrir os documentos.
 *
 * O Estudo de Copy do cliente e ao menos uma análise de criativo são OBRIGATÓRIOS desde 20/10/2026:
 * é deles que saem os Conceitos Estratégicos (avatar, nível e ângulo do Estudo; o formato, da
 * dissecação). A análise da Biblioteca, obrigatória de 17 a 20/10, voltou a ser opcional. O worker
 * confere de novo.
 *
 * Esta tela só mostra a composição que ACABOU de ser pedida. As anteriores moram em Composições
 * Salvas (`MarketingComposicoes`), na subnavegação — a mesma divisão da Mineração.
 *
 * Só equipe interna: `/marketing/composer` não está na CLIENT_USER_ALLOWED do ProtectedRoute, e o
 * worker recusa quem tem linha em `user_client_scope`. Dois guardas, como o resto de /marketing.
 */
export default function MarketingComposer() {
  // Arma o filtro de ativos/ocultos. Sem isso `index.ativos` não sabe quem está ativo.
  useClientesVisiveis();

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { index, loading: projetosLoading } = useProjetosLista();
  const { getEspecialidades } = useEspecialidades();
  const { entries: analises, isLoading: libLoading } = useLibrary([]);
  const { criativos, isLoading: criativosLoading } = useCriativos([], { origem: "mineracao" });

  // `?cliente=` é o que o botão "Compor" do card da Central de Clientes manda; `?analise=`, o
  // "Compor com esta análise" da Mineração e da Biblioteca. Lidos uma vez, junto com o rascunho
  // guardado: é a combinação deles que decide de onde a tela começa.
  const [inicial] = useState(() =>
    rascunhoInicial(
      searchParams.get("cliente") ?? "",
      carregarRascunho(),
      searchParams.get("analise") ?? "",
    ),
  );
  const [cliente, setCliente] = useState(inicial.cliente);
  const [etapa, setEtapa] = useState<EtapaId>(inicial.etapa);
  const [selecao, setSelecao] = useState<Selecao>(() => ({
    analiseId: inicial.analiseId,
    brief: inicial.brief,
    relatorios: new Set(inicial.relatorios),
    documentos: new Set(inicial.documentos),
    criativos: new Set(inicial.criativos),
    interno: inicial.interno,
    incluirNumeros: inicial.incluirNumeros,
  }));
  // A dissecação de criativo interno em preparo antes de compor (a etapa extra do Resultado).
  const [preparo, setPreparo] = useState<string | null>(inicial.preparo);
  const [intencao, setIntencao] = useState(inicial.intencao);
  const [abrindo, setAbrindo] = useState<AbrirInsumo | null>(null);
  const [selecionada, setSelecionada] = useState<string | null>(inicial.selecionada);
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);

  // Guarda a cada mudança: sair por qualquer caminho (menu, voltar do navegador, F5) não perde nada.
  useEffect(() => {
    salvarRascunho({
      cliente,
      etapa,
      analiseId: selecao.analiseId,
      brief: selecao.brief,
      relatorios: [...selecao.relatorios],
      documentos: [...selecao.documentos],
      criativos: [...selecao.criativos],
      interno: selecao.interno,
      incluirNumeros: selecao.incluirNumeros,
      preparo,
      intencao,
      selecionada,
    });
  }, [cliente, etapa, selecao, intencao, selecionada, preparo]);

  // A URL acompanha o cliente restaurado, para o endereço da tela continuar dizendo de quem é.
  // `?analise=` sai depois de lido: já está no rascunho, e um F5 lá na frente não pode puxar a
  // tela de volta aos insumos.
  useEffect(() => {
    if ((cliente && searchParams.get("cliente") !== cliente) || searchParams.has("analise")) {
      setSearchParams(cliente ? { cliente } : {}, { replace: true });
    }
    // Só na montagem: depois disso quem mexe na URL é `trocarCliente`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clientes = useMemo(
    () => index.ativos.map((a) => ({ value: a.padrao, label: a.nome })),
    [index],
  );
  const nomeCliente = useMemo(
    () => index.ativos.find((a) => a.padrao === cliente)?.nome ?? cliente,
    [index, cliente],
  );
  const especialidadesDoCliente = useMemo(
    () => (cliente ? getEspecialidades(cliente) ?? [] : []),
    [cliente, getEspecialidades],
  );

  // Relatórios e documentos só são buscados depois de haver cliente.
  const { relatorios, isLoading: relLoading } = useClientReports(cliente || null);
  const { documentos, clickupIndisponivel, isLoading: docsLoading } = useClientDocs(
    cliente || null,
    Boolean(cliente),
  );

  // O Resumo Estratégico vem marcado (decisão do usuário, 26/10/2026): UMA vez por cliente, quando
  // os documentos dele chegam — e de novo depois de "Nova composição" ou de trocar de cliente, que
  // zeram a marca. Uma vez só, e não a cada render, para quem o desmarcar não brigar com a tela
  // (desmarcado, ele só volta a faltar para compor: é obrigatório).
  // Estado, e não ref: "Nova composição" zera a marca sem mudar cliente nem documentos, e é a troca
  // deste valor que faz o efeito rodar de novo.
  const [resumoMarcadoPara, setResumoMarcadoPara] = useState<string | null>(null);
  useEffect(() => {
    if (!cliente || docsLoading || !documentos.length || resumoMarcadoPara === cliente) return;
    setResumoMarcadoPara(cliente);
    const ids = idsDoResumoEstrategico(documentos);
    if (!ids.length) return;
    setSelecao((s) => {
      const proximo = new Set(s.documentos);
      for (const id of ids) proximo.add(id);
      return { ...s, documentos: proximo };
    });
  }, [cliente, docsLoading, documentos, resumoMarcadoPara]);
  const { composition, error: erroComposicao } = useComposition(selecionada);

  // A composição guardada no rascunho foi apagada (ou é de outro ambiente): sem isso a etapa
  // Resultado ficaria num esqueleto de carregamento para sempre.
  useEffect(() => {
    if (selecionada && erroComposicao) setSelecionada(null);
  }, [selecionada, erroComposicao]);
  const criar = useCreateComposition();
  const dissecarInterno = useStartCriativoInterno();
  // As análises dos criativos internos deste cliente: é por elas que "Compor" decide se o interno
  // escolhido já pode entrar ou se passa antes pela dissecação.
  const { criativos: analisesInternas } = useCriativos([], {
    origem: "cliente",
    cliente,
    enabled: Boolean(cliente) && Boolean(selecao.interno),
  });

  // Conteúdo do insumo aberto. Cada hook só busca quando é a vez dele.
  const { entry: analiseAberta, isLoading: analiseLoading } = useLibraryEntry(
    abrindo?.tipo === "analise" ? abrindo.id : null,
  );
  const { relatorio: relatorioAberto, isLoading: relatorioLoading } = useClientReport(
    abrindo?.tipo === "relatorio" ? abrindo.id : null,
  );
  const { criativo: criativoAberto, isLoading: criativoLoading } = useCriativo(
    abrindo?.tipo === "criativo" ? abrindo.id : null,
  );
  const docAberto = useDocumentoConteudo(
    cliente || null,
    abrindo?.tipo === "documento" ? abrindo.id : null,
  );

  const trocarCliente = (novo: string) => {
    setResumoMarcadoPara(null);
    setCliente(novo);
    // A análise fica: é da Biblioteca, não do cliente — e é o que o "Compor com esta análise"
    // trouxe antes de a pessoa dizer para quem é o anúncio.
    setSelecao((s) => ({ ...SELECAO_VAZIA, analiseId: s.analiseId }));
    setSelecionada(null);
    setPreparo(null);
    // A URL acompanha a escolha: o link da tela continua levando ao mesmo cliente.
    setSearchParams(novo ? { cliente: novo } : {}, { replace: true });
    if (novo) setEtapa("insumos");
  };

  // O que falta para poder compor. Uma lista, e não um booleano, porque é ela que a tela mostra:
  // "falta escolher uma análise" diz o que fazer; um botão apagado não diz.
  //
  // O Estudo é reconhecido pelo nome (`ehDocEstudoDeCopy`), entre os documentos ESCOLHIDOS.
  const temEstudo = documentos.some((d) => selecao.documentos.has(d.id) && ehDocEstudoDeCopy(d));
  const temResumo = documentos.some((d) => selecao.documentos.has(d.id) && ehDocResumoEstrategico(d));
  const faltando = [
    ...(temEstudo ? [] : ["o Estudo de Copy"]),
    ...(temResumo ? [] : ["o Resumo Estratégico"]),
    ...(selecao.criativos.size || selecao.interno ? [] : ["ao menos uma análise de criativo"]),
  ];
  const podeCompor = faltando.length === 0;

  /** Volta ao começo da composição mantendo o cliente: é o "fazer outra" mais comum. */
  const novaComposicao = () => {
    setResumoMarcadoPara(null);
    setSelecao(SELECAO_VAZIA);
    setIntencao("");
    setSelecionada(null);
    setPreparo(null);
    setEtapa(cliente ? "insumos" : "cliente");
  };

  const quantosInsumos =
    (selecao.analiseId ? 1 : 0) +
    (selecao.brief ? 1 : 0) +
    selecao.relatorios.size +
    selecao.documentos.size +
    selecao.criativos.size +
    (selecao.interno ? 1 : 0);

  /** `internoId`: a dissecação do criativo interno, já pronta — ou null, sem interno. */
  const entradas = (internoId: string | null): EntradaComposicao[] => {
    const out: EntradaComposicao[] = [];
    if (selecao.brief) out.push({ tipo: "brief", id: null, titulo: "Contexto Operacional" });
    for (const id of selecao.relatorios) {
      const r = relatorios.find((x) => x.id === id);
      // O NOME, igual ao card e à aba de origem: é o rótulo que vai ficar guardado na composição,
      // e `nomeDoRelatorio` já cai para o rótulo do período quando ninguém nomeou.
      out.push({ tipo: "relatorio", id, titulo: r ? nomeDoRelatorio(r) : null });
    }
    for (const id of selecao.documentos) {
      const d = documentos.find((x) => x.id === id);
      out.push({ tipo: "documento", id, titulo: d?.nome ?? null, local: d?.local ?? null });
    }
    for (const id of selecao.criativos) {
      const achado = criativos.find((x) => x.id === id);
      out.push({ tipo: "criativo", id, titulo: achado ? nomeDoCriativo(achado) : null });
    }
    const c = selecao.interno;
    if (internoId && c) {
      out.push({
        tipo: "criativo",
        id: internoId,
        titulo: c.nome || null,
        // Os números só vão se a pessoa marcou a caixa (opcional, desligada por padrão).
        ...(selecao.incluirNumeros && c.numeros ? { numeros: c.numeros } : {}),
      });
    }
    return out;
  };

  /**
   * Compor. Com um criativo INTERNO escolhido, antes vem a dissecação dele, se ainda não existe
   * (ou a especialidade, se ela existe e ninguém a escolheu): é o passo que abre a etapa de
   * Conceitos, e a composição só começa quando ele termina (`PreparoCriativo` chama `comporCom`).
   */
  const compor = () => {
    if (!podeCompor) return;
    const c = selecao.interno;
    if (c) {
      const analise = analisePorAnuncio(analisesInternas).get(c.metaAdId);
      if (analise?.status === "done" && analise.especialidades.length > 0) {
        comporCom(analise.id);
        return;
      }
      setSelecionada(null);
      setEtapa("conceitos");
      if (analise && analise.status !== "error") {
        setPreparo(analise.id);
        return;
      }
      dissecarInterno.mutate(
        { cliente, metaAdId: c.metaAdId, titulo: c.nome || undefined },
        {
          onSuccess: (r) => setPreparo(r.id),
          onError: (err) => {
            toast.error(err instanceof Error ? err.message : "Não foi possível dissecar o criativo");
            setEtapa("intencao");
          },
        },
      );
      return;
    }
    comporCom(null);
  };

  const comporCom = (internoId: string | null) => {
    pedirPermissaoDeAviso();
    criar.mutate(
      {
        cliente,
        libraryEntryId: selecao.analiseId,
        entradas: entradas(internoId),
        extraPrompt: intencao.trim() || undefined,
      },
      {
        onSuccess: (r) => {
          setPreparo(null);
          setSelecionada(r.id);
          // Desde 20/10/2026 a composição começa nos Conceitos Estratégicos: o agente sugere um
          // por anúncio e só com todos aprovados os anúncios são escritos.
          setEtapa("conceitos");
          // Compor leva minutos: quem sair desta tela é avisado quando os anúncios ficarem prontos.
          acompanhar({ tipo: "composicao", id: r.id, nome: nomeCliente });
          toast.success("Sugerindo os conceitos estratégicos — um por anúncio.");
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Não foi possível compor"),
      },
    );
  };

  // A etapa acompanha a composição: aprovados os conceitos, ela passa a ser escrita e a tela vai ao
  // Resultado; uma composição restaurada do rascunho que ainda está nos conceitos volta para eles.
  const statusDaComposicao = composition?.status ?? null;
  useEffect(() => {
    if (etapa === "conceitos" && statusDaComposicao && statusDaComposicao !== "conceitos" && statusDaComposicao !== "error") {
      setEtapa("resultado");
    }
    if (etapa === "resultado" && statusDaComposicao === "conceitos") setEtapa("conceitos");
  }, [etapa, statusDaComposicao]);

  const cancelar = useCancelComposition();
  const apagar = useDeleteComposition();
  /**
   * "Escolher mais insumos": a composição em conceitos é DESCARTADA (cancelada e apagada — ela não
   * tem anúncio nenhum, e deixá-la em Composições Salvas como "cancelada" seria só ruído) e a tela
   * volta aos insumos, com a seleção como estava. Compor de novo começa outra.
   */
  const escolherMaisInsumos = async () => {
    const id = selecionada;
    try {
      if (id) {
        await cancelar.mutateAsync(id).catch(() => {});
        await apagar.mutateAsync(id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível descartar a composição");
      return;
    }
    setSelecionada(null);
    setEtapa("insumos");
  };

  const alternarAberto = () => {
    if (!abrindo) return;
    if (abrindo.tipo === "analise") {
      setSelecao((s) => ({ ...s, analiseId: s.analiseId === abrindo.id ? null : abrindo.id }));
      return;
    }
    if (abrindo.tipo === "criativo") {
      const proximo = new Set(selecao.criativos);
      if (proximo.has(abrindo.id)) proximo.delete(abrindo.id);
      // O mesmo teto da coluna: o preview não é uma porta dos fundos para passar dele.
      else if (proximo.size + (selecao.interno ? 1 : 0) < MAX_CRIATIVOS) proximo.add(abrindo.id);
      else {
        toast.error(`No máximo ${MAX_CRIATIVOS} análises de criativo por composição.`);
        return;
      }
      setSelecao({ ...selecao, criativos: proximo });
      return;
    }
    const chave = abrindo.tipo === "relatorio" ? "relatorios" : "documentos";
    setSelecao((s) => {
      const proximo = new Set(s[chave]);
      if (proximo.has(abrindo.id)) proximo.delete(abrindo.id);
      else proximo.add(abrindo.id);
      return { ...s, [chave]: proximo };
    });
  };

  /** O que o diálogo de preview mostra, conforme o tipo aberto. */
  const preview = (() => {
    if (!abrindo) return null;
    if (abrindo.tipo === "analise") {
      return {
        titulo: analiseAberta?.titulo || analiseAberta?.tema || "Análise",
        subtitulo: analiseAberta?.tema ? `tema minerado: ${analiseAberta.tema}` : null,
        // O MESMO componente de Análises Salvas, com as caixas de seção — público, ganchos,
        // dissecação por anúncio. Era markdown corrido aqui, e decidir se a análise serve lendo um
        // paredão de texto é decidir com menos informação do que existe.
        corpo: analiseAberta ? (
          <div className="space-y-4">
            <AnalysisReport
              analysisMd={analiseAberta.analysis_md}
              analysis={analiseAberta.analysis}
              organico={analiseOrganica(analiseAberta.ads)}
            />
            {analiseAberta.ads.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">
                  Anúncios analisados ({analiseAberta.ads.length})
                </h3>
                <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {/* A ordem do snapshot é a ordem que o agente leu, então #n bate com as citações
                      do texto acima — é o que permite conferir uma afirmação no anúncio dela. */}
                  {analiseAberta.ads.map((ad, i) => (
                    <AdCard key={ad.id} ad={ad} selected={false} citeIndex={i + 1} />
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : null,
        carregando: analiseLoading,
        motivo: null,
        selecionado: selecao.analiseId === abrindo.id,
        onToggle: alternarAberto,
      };
    }
    if (abrindo.tipo === "relatorio") {
      return {
        titulo: relatorioAberto ? nomeDoRelatorio(relatorioAberto) : "Relatório",
        subtitulo: relatorioAberto
          ? `${relatorioAberto.periodo_de} a ${relatorioAberto.periodo_ate}`
          : null,
        // O MESMO componente da aba Relatório da Central de Clientes: prioridade tipada, os quatro
        // blocos, os avisos e a tabela de números do SNAPSHOT. A prosa (`relatorio_md`) é só uma
        // parte do que o relatório é, e escolher um insumo vendo só ela esconderia justamente os
        // números que sustentam o diagnóstico.
        //
        // Sem `onRenomear`: aqui o relatório está sendo ESCOLHIDO, não editado. Renomear é na aba
        // de origem, onde a ação tem contexto e onde o histórico fica.
        corpo: relatorioAberto ? <RelatorioResultado relatorio={relatorioAberto} /> : null,
        carregando: relatorioLoading,
        // `RelatorioResultado` já diz "escrevendo…" e mostra a falha; repetir aqui daria duas
        // mensagens para o mesmo estado.
        motivo: null,
        selecionado: selecao.relatorios.has(abrindo.id),
        onToggle: alternarAberto,
      };
    }
    if (abrindo.tipo === "criativo") {
      return {
        titulo: criativoAberto ? nomeDoCriativo(criativoAberto) : "Análise de criativo",
        subtitulo: criativoAberto?.especialidades.join(", ") || null,
        // A MESMA dissecação de Análises de Criativos, ao lado do anúncio que ela lê.
        corpo: criativoAberto ? (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,280px)_1fr]">
            {criativoAberto.ad ? <AdCard ad={criativoAberto.ad} selected={false} /> : <div />}
            <DissecacaoCriativo criativo={criativoAberto} />
          </div>
        ) : null,
        carregando: criativoLoading,
        motivo: null,
        selecionado: selecao.criativos.has(abrindo.id),
        onToggle: alternarAberto,
      };
    }
    const doc = documentos.find((d) => d.id === abrindo.id);
    const subpaginas = rotuloSubpaginas(doc?.subpaginas);
    return {
      titulo: doc?.nome || "Documento",
      // O conteúdo abaixo já traz as subpáginas, cada uma sob o próprio título: o subtítulo diz
      // quantas são, para o texto mais longo que a página no ClickUp não parecer engano.
      subtitulo: [doc?.local, subpaginas ? `${subpaginas} — o conteúdo delas vem junto` : null].filter(Boolean).join(" · ") || null,
      conteudoMd: docAberto.conteudoMd,
      carregando: docAberto.isLoading,
      motivo:
        docAberto.motivo ||
        (docAberto.clickupIndisponivel
          ? "Não foi possível ler o conteúdo no ClickUp."
          : "O documento foi lido e não tem corpo de texto."),
      selecionado: selecao.documentos.has(abrindo.id),
      onToggle: alternarAberto,
    };
  })();

  // Enquanto o agente não decide o conjunto não há contagem: dizer "compondo" é o que se sabe.
  const totalAnuncios = composition ? planoDe(composition).length : 0;
  const conceitosProgresso = composition ? progressoDosConceitos(composition) : null;
  const resumoDosConceitos = conceitosProgresso?.total
    ? `${conceitosProgresso.aprovados} de ${conceitosProgresso.total} aprovado${conceitosProgresso.total === 1 ? "" : "s"}`
    : composition?.status === "conceitos"
      ? "sugerindo…"
      : null;
  const resumoDoResultado = !composition || composition.status === "conceitos"
    ? null
    : totalAnuncios
      ? `${totalAnuncios} anúncio${totalAnuncios === 1 ? "" : "s"}`
      : composition.status === "error"
        ? "falhou"
        : "compondo…";

  const etapas = [
    { id: "cliente", label: "Cliente", resumo: cliente ? nomeCliente : null },
    {
      id: "insumos",
      label: "Insumos",
      resumo: cliente && quantosInsumos ? `${quantosInsumos} selecionado(s)` : null,
    },
    {
      id: "intencao",
      label: "Intenção",
      resumo: intencao.trim() ? intencao.trim().slice(0, 40) : cliente ? "sem pedido específico" : null,
    },
    {
      id: "conceitos",
      label: "Conceitos",
      resumo: resumoDosConceitos,
    },
    {
      id: "resultado",
      label: "Resultado",
      resumo: resumoDoResultado,
    },
  ];

  const irPara = (id: string) => setEtapa(id as EtapaId);

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <MineracaoHeader activeTab="Composer" />
        <ComposerSubnav activeTab="Nova Composição" />

        <EtapasComposer etapas={etapas} atual={etapa} onIr={irPara} />

        {projetosLoading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : (
          <div className="neu-card rounded-xl p-5">
            {etapa === "cliente" && (
              <div className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold">Para quem é o anúncio?</h2>
                  <p className="text-xs text-muted-foreground">
                    Os insumos disponíveis dependem do cliente.
                  </p>
                </div>
                <SearchableSelect
                  options={clientes}
                  value={cliente}
                  onValueChange={trocarCliente}
                  placeholder="Escolha o cliente"
                  searchPlaceholder="Buscar cliente"
                  triggerClassName="max-w-sm"
                />
              </div>
            )}

            {etapa === "insumos" && cliente && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-sm font-semibold">Com o que vamos compor?</h2>
                  <p className="text-xs text-muted-foreground">
                    Clique no card para ver o conteúdo; use o botão à esquerda para incluir na
                    composição.
                  </p>
                </div>
                <InsumosEtapa
                  especialidadesDoCliente={especialidadesDoCliente}
                  analises={analises}
                  relatorios={relatorios}
                  documentos={documentos}
                  cliente={cliente}
                  criativos={criativos}
                  carregandoCriativos={criativosLoading}
                  carregandoAnalises={libLoading}
                  carregandoRelatorios={relLoading}
                  carregandoDocumentos={docsLoading}
                  clickupIndisponivel={clickupIndisponivel}
                  selecao={selecao}
                  onSelecao={setSelecao}
                  onAbrir={setAbrindo}
                />
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                  <span className="text-xs text-muted-foreground">
                    {quantosInsumos} insumo(s) selecionado(s)
                    {!podeCompor && (
                      <span className="ml-1.5 font-medium text-amber-700 dark:text-amber-400">
                        · falta escolher {faltando.join(" e ")}
                      </span>
                    )}
                  </span>
                  <Button size="sm" onClick={() => setEtapa("intencao")} disabled={!podeCompor}>
                    Continuar
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}

            {etapa === "intencao" && cliente && (
              <div className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold">O que você quer desta vez?</h2>
                  <p className="text-xs text-muted-foreground">
                    Opcional. É aqui que se pede a quantidade, de 1 a {MAX_ANUNCIOS} anúncios, o uso
                    de cada um (“três anúncios: um Reels e dois Stories”) ou um ângulo. Sem pedido,
                    o Composer escreve um anúncio, no formato que o material sustenta.
                  </p>
                </div>
                <Textarea
                  value={intencao}
                  onChange={(e) => setIntencao(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !criar.isPending) compor();
                  }}
                  placeholder="Ex.: 4 anúncios sobre medo de cirurgia — um Reels, dois Stories e um de busca"
                  rows={3}
                  maxLength={4000}
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">Sugestões:</span>
                  {PEDIDOS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() =>
                        setIntencao((atual) => (atual.trim() ? `${p} — ${atual.trim()}` : p))
                      }
                      className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      {p}
                    </button>
                  ))}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    Ctrl + Enter compõe
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                  <Button variant="ghost" size="sm" onClick={() => setEtapa("insumos")}>
                    <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                    Voltar aos insumos
                  </Button>
                  <Button size="sm" onClick={compor} disabled={criar.isPending || !podeCompor}>
                    {criar.isPending ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Compor
                  </Button>
                </div>
              </div>
            )}

            {etapa === "conceitos" && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">Conceitos estratégicos</h2>
                  {composition?.status === "conceitos" && composition.canDelete && (
                    <Button variant="ghost" size="sm" onClick={() => setConfirmandoDescarte(true)}>
                      <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                      Descartar e voltar aos insumos
                    </Button>
                  )}
                </div>
                <AlertDialog open={confirmandoDescarte} onOpenChange={setConfirmandoDescarte}>
                  <AlertDialogContent className="neu-dialog">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Descartar os conceitos?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Os conceitos sugeridos e aprovados desta composição se perdem. Os insumos
                        escolhidos continuam marcados para compor de novo.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Continuar aqui</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void escolherMaisInsumos()}>Descartar</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                {preparo && !selecionada && selecao.interno ? (
                  <PreparoCriativo
                    criativoId={preparo}
                    nome={selecao.interno.nome}
                    especialidadePadrao={especialidadesDoCliente[0]}
                    onPronto={(id) => comporCom(id)}
                    // Sem o interno, só dá para compor se houver análise de concorrente escolhida:
                    // ao menos uma análise de criativo é obrigatória.
                    podeComporSem={selecao.criativos.size > 0}
                    onSemCriativo={() => {
                      setPreparo(null);
                      setSelecao((s) => ({ ...s, interno: null, incluirNumeros: false }));
                      comporCom(null);
                    }}
                    onVoltar={() => {
                      setPreparo(null);
                      setEtapa("insumos");
                    }}
                  />
                ) : dissecarInterno.isPending ? (
                  <p className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-4 text-xs" role="status">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    Pedindo a dissecação do criativo…
                  </p>
                ) : composition?.status === "conceitos" ? (
                  <ConceitosComposicao
                    composicao={composition}
                    nome={nomeCliente}
                    onEscolherMaisInsumos={() => void escolherMaisInsumos()}
                  />
                ) : composition?.status === "error" ? (
                  <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-xs">
                    <p className="text-destructive">{composition.error || "A sugestão dos conceitos falhou."}</p>
                    <Button variant="outline" size="sm" onClick={() => setEtapa("insumos")}>
                      <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                      Voltar aos insumos
                    </Button>
                  </div>
                ) : selecionada ? (
                  <Skeleton className="h-24 rounded-lg" />
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                    Nenhuma composição nesta sessão. Volte aos insumos e componha uma.
                  </p>
                )}
              </div>
            )}

            {etapa === "resultado" && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">Anúncios</h2>
                  <div className="flex flex-wrap items-center gap-2">
                  {composition && <CancelarComposicao composicao={composition} />}
                  {composition && composition.status !== "running" && (
                    <Button variant="outline" size="sm" onClick={novaComposicao}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Nova composição
                    </Button>
                  )}
                  {/* Sair daqui não perde nada: a composição continua sendo escrita no worker e
                      aparece, com o mesmo marcador, em Composições Salvas. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      navigate(
                        selecionada
                          ? `/marketing/composer/salvas?composicao=${selecionada}`
                          : "/marketing/composer/salvas",
                      )
                    }
                  >
                    <Library className="mr-1.5 h-3.5 w-3.5" />
                    Ver em Composições Salvas
                  </Button>
                  </div>
                </div>
                {composition ? (
                  <RevisaoComposicao composicao={composition} />
                ) : selecionada ? (
                  <Skeleton className="h-24 rounded-lg" />
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                    Nenhuma composição nesta sessão. Volte aos insumos e componha uma — as
                    anteriores estão em Composições Salvas.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <PreviewInsumoDialog
          insumo={preview}
          open={Boolean(abrindo)}
          onOpenChange={(v) => !v && setAbrindo(null)}
        />
      </div>
    </DashboardLayout>
  );
}
