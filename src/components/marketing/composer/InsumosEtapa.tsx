import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  Library,
  Loader2,
  Lock,
  Microscope,
  Search,
  Sparkles,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { CriativosInternosDoCliente } from "@/components/marketing/composer/CriativosInternos";
import {
  MAX_CRIATIVOS,
  numerosDoAnuncio,
  type CriativoInternoEscolhido,
} from "@/components/marketing/composer/criativoInterno";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { MetasMultiSelect } from "@/components/clientes/metas/MetasMultiSelect";
import { InsumoCard } from "@/components/marketing/composer/InsumoCard";
import { AnaliseCard } from "@/components/marketing/composer/AnaliseCard";
import { ordenarAnalises } from "@/components/marketing/composer/ordenarAnalises";
import {
  categoriasDasAnalises,
  ehDocEstudoDeCopy,
  ehDocResumoEstrategico,
  filtrarDocumentos,
  filtrarPorCategoria,
  filtrarRelatorios,
  mantendoSelecionados,
} from "@/components/marketing/composer/filtrarInsumos";
import { filtrarAnalises } from "@/lib/bibliotecaFiltro";
import { filtrarCriativos, nomeDoCriativo } from "@/components/marketing/mineracao/criativoTexto";
import {
  NIVEL_CONSCIENCIA_LABEL,
  type LibraryEntrySummary,
  type SpyCriativoResumo,
} from "@/lib/adSpyApi";
import type { RelatorioResumo } from "@/lib/clientReportsApi";
import { rotuloSubpaginas, type ClientDoc } from "@/lib/clientDocsApi";
import { nomeDoRelatorio } from "@/utils/relatorioMarkdown";

/** O que a etapa de insumos devolve para a página. `analise` e `interno` são únicos; o resto, conjunto. */
export type Selecao = {
  analiseId: string | null;
  brief: boolean;
  relatorios: Set<string>;
  documentos: Set<string>;
  /**
   * As análises de criativo de CONCORRENTES (dissecações prontas). Várias desde 20/10/2026: cada uma
   * é um formato possível para os Conceitos Estratégicos. Ao menos uma análise de criativo — esta
   * ou o interno — é obrigatória para compor.
   */
  criativos: Set<string>;
  /** O criativo do PRÓPRIO cliente — no máximo um (dissecado antes de compor, se ainda não foi). */
  interno: CriativoInternoEscolhido | null;
  /** Criativo interno: mandar também os números dele ao agente. Desligado por padrão. */
  incluirNumeros: boolean;
};


export type AbrirInsumo =
  | { tipo: "analise"; id: string }
  | { tipo: "relatorio"; id: string }
  | { tipo: "documento"; id: string }
  | { tipo: "criativo"; id: string };

type Props = {
  especialidadesDoCliente: string[];
  analises: LibraryEntrySummary[];
  relatorios: RelatorioResumo[];
  documentos: ClientDoc[];
  criativos?: SpyCriativoResumo[];
  carregandoCriativos?: boolean;
  /** O cliente da composição. Com ele, a chave "Criativos Internos do Cliente" aparece. */
  cliente?: string;
  carregandoAnalises?: boolean;
  carregandoRelatorios?: boolean;
  carregandoDocumentos?: boolean;
  /** Documentos existem, mas o ClickUp não respondeu. Diferente de "não há documento". */
  clickupIndisponivel?: boolean;
  selecao: Selecao;
  onSelecao: (s: Selecao) => void;
  onAbrir: (a: AbrirInsumo) => void;
};

const ISO = (d: Date) => format(d, "yyyy-MM-dd");

function Coluna({
  icone: Icone,
  titulo,
  contagem,
  /** O tamanho da lista ANTES do filtro. Quando difere, a tela mostra "X de Y". */
  total,
  carregando,
  controles,
  vazio,
  /**
   * Teto de altura + rolagem própria na lista. Opt-in porque só faz sentido em lista LONGA e de
   * itens pequenos: a coluna de análises é uma grade de cards grandes, e prendê-la num quadro
   * rolante esconderia metade das capas atrás de uma barra.
   */
  rolagem,
  sempreConteudo,
  children,
}: {
  icone: typeof FileText;
  titulo: string;
  contagem: number;
  total?: number;
  carregando?: boolean;
  controles?: React.ReactNode;
  vazio: React.ReactNode;
  rolagem?: boolean;
  /** Desenha `children` mesmo com contagem 0 (a lista tem estados vazios próprios). */
  sempreConteudo?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className="flex shrink-0 items-center gap-1.5 text-xs font-semibold">
          <Icone className="h-3.5 w-3.5 text-primary" />
          {titulo}
          {contagem > 0 && (
            <span className="font-normal text-muted-foreground">
              ({contagem}
              {/* "7 de 23" diz que há mais coisa escondida por um filtro, o que uma contagem
                  solta não diria — e é a diferença entre "só tem isso" e "filtrei demais". */}
              {total !== undefined && total !== contagem ? ` de ${total}` : ""})
            </span>
          )}
        </h3>
        {controles && <div className="min-w-0 flex-1 sm:flex-none">{controles}</div>}
      </div>
      {carregando ? (
        <div className="space-y-2">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      ) : contagem === 0 && !sempreConteudo ? (
        <div className="rounded-xl border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
          {vazio}
        </div>
      ) : (
        <div className={`space-y-2${rolagem ? " max-h-[26rem] overflow-y-auto pr-1" : ""}`}>{children}</div>
      )}
    </section>
  );
}

/**
 * Etapa 2: o que alimenta a composição.
 *
 * Tudo é card com a MESMA gramática (liga/desliga + ver conteúdo), porque tudo aqui é insumo. O
 * Contexto Operacional entra ligado: é o caso comum, e deixá-lo invisível faria a composição ser
 * alimentada por trás — quem lê a ideia não saberia com o que ela foi feita.
 *
 * A análise é escolha ÚNICA, então clicar numa troca pela outra em vez de somar.
 *
 * ## Os filtros
 *
 * As duas listas são da equipe inteira e crescem sem parar: a Biblioteca tem análise de todo nicho,
 * e um cliente antigo acumula dezenas de relatórios. Sem recorte, o caminho mais curto vira não
 * escolher insumo nenhum — que é exatamente o que esta etapa existe para evitar. Os controles são
 * os mesmos das telas onde essas listas moram (Minerações Salvas, Análises de Criativos e a aba
 * Relatório), para quem já
 * filtra lá não aprender nada novo aqui.
 *
 * Nenhum filtro esconde o que já está selecionado (ver `mantendoSelecionados`).
 */
export function InsumosEtapa({
  especialidadesDoCliente,
  analises,
  relatorios,
  documentos,
  criativos = [],
  carregandoCriativos,
  cliente,
  carregandoAnalises,
  carregandoRelatorios,
  carregandoDocumentos,
  clickupIndisponivel,
  selecao,
  onSelecao,
  onAbrir,
}: Props) {
  const [categorias, setCategorias] = useState<string[]>([]);
  const [soFavoritos, setSoFavoritos] = useState(false);
  const [buscaRelatorio, setBuscaRelatorio] = useState("");
  const [relDe, setRelDe] = useState<Date | undefined>();
  const [relAte, setRelAte] = useState<Date | undefined>();

  const opcoesCategoria = useMemo(
    () => categoriasDasAnalises(analises).map((c) => ({ id: c, label: c })),
    [analises],
  );

  const analisesVisiveis = useMemo(() => {
    const passou = filtrarAnalises(filtrarPorCategoria(analises, categorias), { soFavoritos });
    return mantendoSelecionados(analises, passou, (e) => e.id === selecao.analiseId);
  }, [analises, categorias, soFavoritos, selecao.analiseId]);

  // As análises da especialidade do cliente primeiro: evita rolar a Biblioteca inteira para achar
  // o que serve àquele nicho. A ordenação é aplicada DEPOIS do filtro, sobre o que sobrou.
  const analisesOrdenadas = useMemo(
    () => ordenarAnalises(analisesVisiveis, especialidadesDoCliente),
    [analisesVisiveis, especialidadesDoCliente],
  );

  const relatoriosVisiveis = useMemo(() => {
    const passou = filtrarRelatorios(relatorios, {
      busca: buscaRelatorio,
      de: relDe ? ISO(relDe) : null,
      ate: relAte ? ISO(relAte) : null,
    });
    return mantendoSelecionados(relatorios, passou, (r) => selecao.relatorios.has(r.id));
  }, [relatorios, buscaRelatorio, relDe, relAte, selecao.relatorios]);

  const filtrandoAnalises = categorias.length > 0 || soFavoritos;

  // Análises de Criativos: o mesmo par de filtros das Minerações Salvas (categoria e favoritos).
  // Só as que terminaram servem de insumo: a que ainda roda ou falhou não tem dissecação para dar.
  const [categoriasCri, setCategoriasCri] = useState<string[]>([]);
  const [soFavoritosCri, setSoFavoritosCri] = useState(false);
  // Só dissecações de CONCORRENTES aqui: as de criativos do cliente aparecem na lista interna.
  const criativosProntos = useMemo(
    () => criativos.filter((c) => c.status === "done" && c.origem !== "cliente"),
    [criativos],
  );
  const opcoesCategoriaCri = useMemo(
    () => categoriasDasAnalises(criativosProntos).map((c) => ({ id: c, label: c })),
    [criativosProntos],
  );
  const criativosVisiveis = useMemo(() => {
    const passou = filtrarCriativos(filtrarPorCategoria(criativosProntos, categoriasCri), {
      soFavoritos: soFavoritosCri,
    });
    return mantendoSelecionados(criativosProntos, passou, (c) => selecao.criativos.has(c.id));
  }, [criativosProntos, categoriasCri, soFavoritosCri, selecao.criativos]);
  const filtrandoCriativos = categoriasCri.length > 0 || soFavoritosCri;
  // A chave "Criativos Internos do Cliente". Começa ligada se já há um interno escolhido. Trocar de
  // lista NÃO desfaz a escolha da outra: os concorrentes marcados continuam indo.
  const [mostrarInternos, setMostrarInternos] = useState(Boolean(selecao.interno));
  const quantosCriativos = selecao.criativos.size + (selecao.interno ? 1 : 0);
  const noTetoDeCriativos = quantosCriativos >= MAX_CRIATIVOS;
  const alternarCriativo = (id: string) => {
    const proximo = new Set(selecao.criativos);
    if (proximo.has(id)) proximo.delete(id);
    else if (!noTetoDeCriativos) proximo.add(id);
    onSelecao({ ...selecao, criativos: proximo });
  };
  const escolherInterno = (c: CriativoInternoEscolhido | null) => {
    // Trocar um interno por outro não muda a conta; acrescentar o primeiro, sim.
    if (c && !selecao.interno && noTetoDeCriativos) return;
    onSelecao({ ...selecao, interno: c, incluirNumeros: c ? selecao.incluirNumeros : false });
  };
  const filtrandoRelatorios = Boolean(buscaRelatorio.trim() || relDe || relAte);

  const [verBloqueados, setVerBloqueados] = useState(false);
  // `tipo === null` (credencial ou template) e NÃO `temConteudo`: este último só diz se o corpo foi
  // pré-ingerido, e o Composer lê sob demanda o que não está em cache. Usar `temConteudo` escondia
  // documento perfeitamente utilizável — com 2 páginas pré-ingeridas de 6.057, escondia quase tudo.
  const [buscaDocumento, setBuscaDocumento] = useState("");
  const todosUteis = documentos.filter((d) => d.tipo !== null);
  const docEscolhido = (d: ClientDoc) => selecao.documentos.has(d.id);
  // A busca vale para todas as listas (Estudo, outros e de acesso), e não esconde o que já está
  // escolhido.
  const filtrarUteis = (lista: ClientDoc[]) =>
    mantendoSelecionados(lista, filtrarDocumentos(lista, buscaDocumento), docEscolhido);
  // O Estudo de Copy em destaque, no topo: é dele que saem os Conceitos Estratégicos, e é
  // obrigatório para compor. Os outros documentos ficam recolhidos por padrão (decisão do usuário,
  // 20/10/2026) — mas o que já foi escolhido continua à vista, e uma busca os mostra.
  const todosEstudos = todosUteis.filter(ehDocEstudoDeCopy);
  const estudos = filtrarUteis(todosEstudos);
  // O Resumo Estratégico (Central de Copy) também em destaque: é obrigatório desde 26/10/2026 e vem
  // marcado por padrão. Página que fosse Estudo e Resumo ao mesmo tempo fica com o Estudo.
  const todosResumos = todosUteis.filter((d) => ehDocResumoEstrategico(d) && !ehDocEstudoDeCopy(d));
  const resumos = filtrarUteis(todosResumos);
  const outros = filtrarUteis(
    todosUteis.filter((d) => !ehDocEstudoDeCopy(d) && !ehDocResumoEstrategico(d)),
  );
  const [verOutros, setVerOutros] = useState(false);
  const docsBloqueados = filtrarDocumentos(
    documentos.filter((d) => d.tipo === null),
    buscaDocumento,
  );
  const filtrandoDocumentos = Boolean(buscaDocumento.trim());
  const outrosAbertos = verOutros || filtrandoDocumentos;
  const outrosVisiveis = outrosAbertos ? outros : outros.filter(docEscolhido);
  const docsUteis = [...estudos, ...resumos, ...outros];

  const alternar = <K extends "relatorios" | "documentos">(chave: K, id: string) => {
    const proximo = new Set(selecao[chave]);
    if (proximo.has(id)) proximo.delete(id);
    else proximo.add(id);
    onSelecao({ ...selecao, [chave]: proximo });
  };

  const cardDoDocumento = (d: ClientDoc, extras: { texto: string; tom: "primario" }[] = []) => (
    <InsumoCard
      key={d.id}
      titulo={d.nome}
      subtitulo={d.local}
      chips={[
        ...extras,
        // Escolher a página traz as subpáginas junto: dizer quantas é o que evita a surpresa de um
        // "documento" que leva cinco ao prompt.
        ...(rotuloSubpaginas(d.subpaginas) ? [{ texto: rotuloSubpaginas(d.subpaginas)!, tom: "neutro" as const }] : []),
        ...(d.via === "nome" ? [{ texto: "casado pelo título", tom: "alerta" as const }] : []),
        ...(d.arquivado ? [{ texto: "arquivado", tom: "neutro" as const }] : []),
      ]}
      selecionado={selecao.documentos.has(d.id)}
      onToggle={() => alternar("documentos", d.id)}
      onAbrir={() => onAbrir({ tipo: "documento", id: d.id })}
    />
  );

  return (
    <div className="space-y-5">
      {/* O contexto do próprio cliente */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Contexto deste cliente
        </h3>
        <div className="grid gap-2">
          <InsumoCard
            titulo="Contexto Operacional"
            subtitulo="Como a operação do cliente roda hoje, segundo o ClickUp"
            selecionado={selecao.brief}
            onToggle={() => onSelecao({ ...selecao, brief: !selecao.brief })}
            onAbrir={() => onSelecao({ ...selecao, brief: !selecao.brief })}
          />
        </div>
      </section>

      {/* A análise de concorrentes — escolha única, com os cards da Biblioteca */}
      <Coluna
        icone={Library}
        titulo="Minerações Salvas"
        contagem={analisesOrdenadas.length}
        total={analises.length}
        carregando={carregandoAnalises}
        controles={
          <div className="flex flex-wrap items-center gap-2">
            <MetasMultiSelect
              title="Categorias"
              options={opcoesCategoria}
              selected={categorias}
              onChange={setCategorias}
              placeholder="Todas as categorias"
              pluralNoun="categorias"
              disabled={opcoesCategoria.length === 0}
              searchable
            />
            <Button
              type="button"
              variant={soFavoritos ? "default" : "outline"}
              size="sm"
              aria-pressed={soFavoritos}
              onClick={() => setSoFavoritos((v) => !v)}
              className="h-9"
            >
              <Star className={`mr-1.5 h-3.5 w-3.5 ${soFavoritos ? "fill-current" : ""}`} />
              Favoritos
            </Button>
          </div>
        }
        vazio={
          filtrandoAnalises
            ? // Filtro em memória: a lista existe, só não casou. Dizer isso evita a leitura de que
              // a Biblioteca está vazia.
              "Nenhuma análise com esses filtros."
            : "Nenhuma análise salva ainda. Ela é opcional — sem ela, a composição só não vai falar do que os concorrentes fazem."
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {analisesOrdenadas.map(({ entry, casa }) => (
            <AnaliseCard
              key={entry.id}
              entry={entry}
              casaComOCliente={casa}
              selecionado={selecao.analiseId === entry.id}
              // Escolha única: clicar na que já está escolhida desliga; clicar em outra troca.
              onToggle={() =>
                onSelecao({
                  ...selecao,
                  analiseId: selecao.analiseId === entry.id ? null : entry.id,
                })
              }
              onAbrir={() => onAbrir({ tipo: "analise", id: entry.id })}
            />
          ))}
        </div>
      </Coluna>

      {/* Análises de criativos: várias de concorrentes e no máximo um criativo do próprio cliente (a
          chave alterna a lista, sem desfazer a escolha da outra). Ao menos uma é obrigatória: cada
          uma é um formato possível para os Conceitos Estratégicos. */}
      <Coluna
        icone={Microscope}
        titulo="Análises de Criativos"
        contagem={mostrarInternos ? 0 : criativosVisiveis.length}
        total={mostrarInternos ? undefined : criativosProntos.length}
        carregando={mostrarInternos ? false : carregandoCriativos}
        controles={
          <div className="flex flex-wrap items-center gap-2">
            {/* A conta soma as duas listas: trocar a chave esconde uma delas, e o que está
                escolhido nela continua indo. */}
            {quantosCriativos > 0 && (
              <span className="text-[11px] text-muted-foreground" aria-live="polite">
                {quantosCriativos} de {MAX_CRIATIVOS} escolhida{quantosCriativos === 1 ? "" : "s"}
              </span>
            )}
            {cliente && (
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
                <Switch
                  checked={mostrarInternos}
                  onCheckedChange={setMostrarInternos}
                  aria-label="Criativos Internos do Cliente"
                />
                Criativos Internos do Cliente
              </label>
            )}
            {!mostrarInternos && opcoesCategoriaCri.length > 0 && (
              // Sem análise de criativo não há categoria para oferecer — e um segundo seletor
              // apagado igual ao das Minerações Salvas, logo acima, só confundiria qual é qual.
              <MetasMultiSelect
                title="Categorias"
                options={opcoesCategoriaCri}
                selected={categoriasCri}
                onChange={setCategoriasCri}
                placeholder="Todas as categorias"
                pluralNoun="categorias"
                searchable
              />
            )}
            {!mostrarInternos && (
              <Button
                type="button"
                variant={soFavoritosCri ? "default" : "outline"}
                size="sm"
                aria-pressed={soFavoritosCri}
                aria-label="Só as análises de criativo favoritas"
                onClick={() => setSoFavoritosCri((v) => !v)}
                className="h-9"
              >
                <Star className={`mr-1.5 h-3.5 w-3.5 ${soFavoritosCri ? "fill-current" : ""}`} />
                Favoritos
              </Button>
            )}
          </div>
        }
        vazio={
          mostrarInternos
            ? null
            : filtrandoCriativos
              ? "Nenhuma análise de criativo com esses filtros."
              : "Nenhuma análise de criativo ainda. Use “Analisar Criativo” num anúncio da Mineração — ao menos uma é necessária para compor."
        }
        sempreConteudo={mostrarInternos}
      >
        {mostrarInternos && cliente ? (
          <div className="space-y-2">
            <CriativosInternosDoCliente
              cliente={cliente}
              escolhido={selecao.interno?.metaAdId ?? null}
              onEscolher={(a, rotuloPeriodo) =>
                escolherInterno(
                  a
                    ? {
                        metaAdId: a.adId,
                        nome: a.nome,
                        numeros: numerosDoAnuncio(a, rotuloPeriodo) || null,
                      }
                    : null,
                )
              }
            />
            {selecao.interno && (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs">
                <Checkbox
                  checked={selecao.incluirNumeros}
                  onCheckedChange={(v) => onSelecao({ ...selecao, incluirNumeros: v === true })}
                  aria-label="Incluir os números do criativo"
                />
                <span>
                  <span className="font-medium">Incluir os números do criativo</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Investimento, resultados, custo, CTR, hook e hold de “{selecao.interno.nome}” no
                    período — o que já funcionou para o próprio cliente.
                  </span>
                </span>
              </label>
            )}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {criativosVisiveis.map((c) => {
              const marcado = selecao.criativos.has(c.id);
              return (
                <InsumoCard
                  key={c.id}
                  titulo={nomeDoCriativo(c)}
                  subtitulo={c.ad?.page_name && c.titulo ? c.ad.page_name : null}
                  chips={[
                    ...c.especialidades.map((e) => ({ texto: e, tom: "primario" as const })),
                    ...(c.dissecacao?.nivel_consciencia
                      ? [{ texto: NIVEL_CONSCIENCIA_LABEL[c.dissecacao.nivel_consciencia], tom: "neutro" as const }]
                      : []),
                    ...(c.favorito ? [{ texto: "favorita", tom: "neutro" as const }] : []),
                  ]}
                  selecionado={marcado}
                  bloqueado={!marcado && noTetoDeCriativos}
                  onToggle={() => alternarCriativo(c.id)}
                  onAbrir={() => onAbrir({ tipo: "criativo", id: c.id })}
                />
              );
            })}
          </div>
        )}
      </Coluna>

      {/* Relatórios e documentos, lado a lado */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Coluna
          icone={FileText}
          titulo="Relatórios"
          contagem={relatoriosVisiveis.length}
          total={relatorios.length}
          carregando={carregandoRelatorios}
          rolagem
          controles={
            <div className="flex flex-wrap items-center gap-2">
              {/* Cresce com o espaço que sobrar e nunca abaixo de 9rem: numa coluna de meia largura
                  um campo fixo cortava o próprio placeholder, e um campo que não cabe no que
                  escreve parece quebrado antes de ser usado. */}
              <div className="relative min-w-[9rem] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={buscaRelatorio}
                  onChange={(e) => setBuscaRelatorio(e.target.value)}
                  placeholder="Buscar"
                  aria-label="Buscar relatório por nome"
                  className="h-9 pl-8 text-xs"
                />
              </div>
              <DateRangePicker
                from={relDe}
                to={relAte}
                onChange={({ from, to }) => {
                  setRelDe(from);
                  setRelAte(to);
                }}
                placeholder="Qualquer período"
              />
            </div>
          }
          vazio={
            filtrandoRelatorios
              ? "Nenhum relatório com esses filtros. O recorte de data pega quem se sobrepõe ao período, não só quem cabe dentro dele."
              : "Este cliente ainda não tem relatório. Gere um na Central de Clientes."
          }
        >
          {relatoriosVisiveis.map((r) => (
            <InsumoCard
              key={r.id}
              // O NOME dado pela pessoa, caindo para o rótulo do período quando não há. É a mesma
              // função da aba Relatório: sem ela, três relatórios do mesmo mês com focos diferentes
              // apareceriam aqui como três linhas idênticas — exatamente o que nomear resolve, e
              // esta é a tela em que a escolha importa.
              titulo={nomeDoRelatorio(r)}
              // O período só aparece quando há NOME dado, exatamente como no histórico da aba
              // Relatório: sem nome, `nomeDoRelatorio` já devolve o rótulo do período, e repetir a
              // mesma string em duas linhas do card não informa nada. Com nome, o período continua
              // visível porque "depois da troca de oferta" não diz de quando é.
              subtitulo={r.titulo ? r.periodo_label || `${r.periodo_de} a ${r.periodo_ate}` : null}
              chips={
                r.prioridade ? [{ texto: r.prioridade, tom: "alerta" as const }] : undefined
              }
              selecionado={selecao.relatorios.has(r.id)}
              onToggle={() => alternar("relatorios", r.id)}
              onAbrir={() => onAbrir({ tipo: "relatorio", id: r.id })}
              rodape={
                r.status === "running" ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> ainda sendo escrito
                  </span>
                ) : r.status === "error" ? (
                  <span className="text-destructive">falhou ao ser escrito</span>
                ) : null
              }
            />
          ))}
        </Coluna>

        <Coluna
          icone={FolderOpen}
          titulo="Documentos"
          // `total` são só os ÚTEIS: os de acesso/credencial têm o expansor deles logo abaixo, e
          // contá-los aqui faria "3 de 9" parecer um filtro aplicado quando não há busca nenhuma.
          contagem={docsUteis.length}
          total={todosUteis.length}
          carregando={carregandoDocumentos}
          rolagem
          controles={
            documentos.length > 0 ? (
              <div className="relative min-w-[9rem] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={buscaDocumento}
                  onChange={(e) => setBuscaDocumento(e.target.value)}
                  placeholder="Buscar por título ou pasta"
                  aria-label="Buscar documento"
                  className="h-9 pl-8 text-xs"
                />
              </div>
            ) : undefined
          }
          vazio={
            filtrandoDocumentos && todosUteis.length > 0
              ? "Nenhum documento com essa busca."
              : clickupIndisponivel
              ? "Não foi possível ler o ClickUp agora — isto não quer dizer que o cliente não tenha documentos."
              : docsBloqueados.length > 0
                ? // Há documentos, nenhum com corpo. Dizer "nenhum documento" aqui seria falso, e a
                  // pessoa procuraria no ClickUp um documento que ela acabou de ver na outra aba.
                  "Todos os documentos deste cliente são de acesso/credencial ou template, então nenhum serve de insumo."
                : "Nenhum documento deste cliente no ClickUp."
          }
        >
          {/* Sem Estudo de Copy não há como compor: dizer AQUI, onde se procura o documento, e não
              só no rodapé — senão a pessoa procura na lista algo que não está nela. O ClickUp fora
              do ar não é "não tem": essa mensagem fica com o vazio da coluna. */}
          {!clickupIndisponivel && todosEstudos.length === 0 && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-800 dark:text-amber-300">
              Este cliente não tem <span className="font-semibold">Estudo de Copy</span> no ClickUp, e
              sem ele não dá para compor: os Conceitos Estratégicos saem dele. Crie no ClickUp um
              documento cujo nome comece com “Estudo de Copy”.
            </p>
          )}
          {estudos.length > 0 && (
            <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-2">
              <p className="flex items-center gap-1.5 px-1 text-[11px] font-semibold text-primary">
                <BookOpen className="h-3.5 w-3.5" />
                Estudo de Copy
              </p>
              {estudos.map((d) => cardDoDocumento(d, [{ texto: "Estudo de Copy", tom: "primario" as const }]))}
            </div>
          )}
          {!clickupIndisponivel && todosResumos.length === 0 && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-800 dark:text-amber-300">
              Este cliente não tem <span className="font-semibold">Resumo Estratégico</span> no
              ClickUp, e sem ele não dá para compor. Crie na Central de Copy do cliente uma página
              cujo nome comece com “Resumo Estratégico”.
            </p>
          )}
          {resumos.length > 0 && (
            <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-2">
              <p className="flex items-center gap-1.5 px-1 text-[11px] font-semibold text-primary">
                <BookOpen className="h-3.5 w-3.5" />
                Resumo Estratégico
                <span className="font-normal text-muted-foreground">· obrigatório, já marcado</span>
              </p>
              {resumos.map((d) => cardDoDocumento(d, [{ texto: "Resumo Estratégico", tom: "primario" as const }]))}
            </div>
          )}
          {outros.length > 0 && (
            <div className="space-y-2">
              {!filtrandoDocumentos && (
                <button
                  type="button"
                  onClick={() => setVerOutros((v) => !v)}
                  aria-expanded={verOutros}
                  className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary/40"
                >
                  {verOutros ? (
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  ) : (
                    <ChevronRight className="h-3 w-3 shrink-0" />
                  )}
                  Outros documentos ({outros.length})
                </button>
              )}
              {outrosVisiveis.map((d) => cardDoDocumento(d))}
            </div>
          )}

          {/* Documento sem corpo não alimenta composição nenhuma — selecioná-lo não acrescenta nada
              ao prompt. Por isso ele sai da lista principal: aqui, onde se ESCOLHE insumo, ele é
              ruído puro. Continua acessível porque o preview explica por que está bloqueado, e essa
              explicação é o que impede alguém de concluir que a ferramenta perdeu o documento. */}
          {docsBloqueados.length > 0 && (
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => setVerBloqueados((v) => !v)}
                aria-expanded={verBloqueados}
                className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary/40"
              >
                {verBloqueados ? (
                  <ChevronDown className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0" />
                )}
                <Lock className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />
                {docsBloqueados.length} de acesso/credencial
              </button>
              {verBloqueados &&
                docsBloqueados.map((d) => (
                  <InsumoCard
                    key={d.id}
                    titulo={d.nome}
                    subtitulo={d.local}
                    chips={[{ texto: "conteúdo não lido", tom: "alerta" as const }]}
                    selecionado={selecao.documentos.has(d.id)}
                    onToggle={() => alternar("documentos", d.id)}
                    onAbrir={() => onAbrir({ tipo: "documento", id: d.id })}
                  />
                ))}
            </div>
          )}
        </Coluna>
      </div>
    </div>
  );
}
