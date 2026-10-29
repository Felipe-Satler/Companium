// Ad Composer — de 1 a 8 anúncios por composição, a partir de análise + resumo + relatórios.
//
// Vive no MESMO worker da Mineração (`/api/spy/compositions`), então a requisição e o tratamento de
// erro vêm de `adSpyApi` — inclusive as mensagens que distinguem "falta o bloco do nginx" de "o
// worker está rodando código velho", que é o erro que aparece primeiro depois de um deploy.

import { spyRequest } from "@/lib/adSpyApi";
import type { AvisoLimite } from "../../shared/ad-formats";
import type { AvatarEstudo, IdentificacaoEstudo } from "../../shared/estudo-copy";

/**
 * conceitos = o agente sugere um Conceito Estratégico por anúncio e quem pediu aprova (desde
 * 20/10/2026); running = o agente está escrevendo (a tela faz polling); revisao = pronta, esperando
 * quem pediu rever e salvar (desde 19/10/2026); ok = salva; error = falhou.
 */
export type ComposicaoStatus = "conceitos" | "running" | "revisao" | "ok" | "error";

// ---- Conceitos Estratégicos (20/10/2026) ----------------------------------------------------------

/**
 * Um Conceito Estratégico: Avatar + Nível de consciência + Ângulo + Formato, cada parte pelo id do
 * catálogo da composição (`CatalogoCopy`). O formato de SAÍDA não faz parte: é o uso do anúncio.
 */
export type ConceitoEstrategico = {
  /** "A1": um avatar do Estudo de Copy. */
  avatar_id: string;
  nivel: "inconsciente" | "consciente_problema" | "consciente_solucao" | "consciente_produto";
  /** "G2": um ângulo do catálogo. */
  angulo_id: string;
  /** "C1": uma das análises de criativo escolhidas — o FORMATO do conceito. */
  criativo_ref: string;
  justificativa: string;
};

export type ConceitoRejeitado = ConceitoEstrategico & { motivo: string; por: string | null; em: string };

/**
 * O conceito de UM anúncio. `pendente` = espera quem compõe decidir sobre os insumos; `gerando` = o
 * agente está sugerindo; `sugerido` = esperando aprovação; `erro` = não houve conceito diferente.
 */
export type SlotConceito = {
  n: number;
  formato_saida: string;
  status: "pendente" | "gerando" | "sugerido" | "aprovado" | "erro";
  conceito: ConceitoEstrategico | null;
  /** Mesmo conceito de outro anúncio, em outro formato de saída (só com "seguir assim mesmo"). */
  reciclado: boolean;
  rejeitados: ConceitoRejeitado[];
  error: string | null;
};

export type AnguloCatalogo = { id: string; nome: string; descricao: string; trechos: string[] };

/** O que a composição leu do Estudo de Copy, os ângulos e os formatos (análises de criativo). */
export type CatalogoCopy = {
  estudo: { page_id: string | null; nome: string | null };
  identificacao: IdentificacaoEstudo;
  assinatura: string;
  tem_rqe: boolean;
  estudo_tem_preco: boolean;
  avatares: AvatarEstudo[];
  /**
   * "estudo" = lidos pelo código no modelo padrão; "agente" = o Estudo não segue o modelo (os
   * clientes mais antigos, com "Buyer Personas" em subpáginas) e o agente os achou.
   */
  avatares_origem?: "estudo" | "agente" | null;
  faltando: string[];
  angulos: AnguloCatalogo[];
  criativos: { id: string; criativo_id: string; nome: string; nivel: string }[];
};

/**
 * O material não basta para conceitos diferentes em todos os anúncios. `bloqueante` = não há como
 * seguir (sem Estudo legível, sem avatares); `seguir` = quem compõe escolheu seguir reciclando.
 */
export type InsumosInsuficientes = { motivo: string; sugestao: string; bloqueante: boolean; seguir: boolean };

/**
 * O que de fato alimentou a composição.
 *
 * As três são opcionais no worker, e a tela MOSTRA quais entraram: uma ideia feita sem o resumo do
 * cliente é uma ideia diferente de uma feita com ele, e quem lê precisa saber disso antes de
 * confiar nela.
 */
export type ComposicaoFontes = {
  analise?: boolean;
  brief?: boolean;
  /**
   * LEGADO. O insumo "números da semana fechada" saiu em 02/10/2026 e composições novas não gravam
   * esta flag. Fica declarada porque as linhas antigas a têm, e o histórico precisa continuar
   * dizendo com o que cada composição foi feita.
   */
  metricas?: boolean;
  relatorios?: number;
  documentos?: number;
  /** Documentos escolhidos cujo corpo não pôde ser lido: entraram como título e pasta. */
  documentos_sem_corpo?: number;
  /** Análises de criativo (Mineração › Análises de Criativos) que entraram no prompt. */
  criativos?: number;
};

/**
 * Um insumo escolhido. `brief` é liga/desliga e não tem id.
 *
 * `metricas` continua no tipo mas NÃO é mais produzido: o insumo "números da semana fechada" saiu
 * em 02/10/2026 e quem leva número à composição é o Relatório. O valor fica declarado porque as
 * composições ANTIGAS têm `entradas` com esse tipo, e o histórico precisa continuar legível —
 * apagá-lo do tipo não apagaria as linhas, só esconderia o que elas dizem.
 */
export type TipoEntrada = "analise" | "brief" | "metricas" | "relatorio" | "documento" | "criativo";

export type EntradaComposicao = {
  tipo: TipoEntrada;
  id: string | null;
  /** Guardado junto: relatório apagado ou documento renomeado não podem apagar a origem da ideia. */
  titulo: string | null;
  local?: string | null;
  /** Criativo interno: os números dele no período, quando a pessoa pediu para incluí-los. */
  numeros?: string | null;
};

/** As ideias por campo do formato: texto vira string, lista vira string[]. */
export type ComposicaoCampos = Record<string, string | string[]>;

/**
 * O estado de UM anúncio do conjunto. `pendente` = está na fila; `running` = é o que o agente está
 * escrevendo agora. Um anúncio em `error` não derruba a composição: os outros seguem.
 */
export type AnuncioStatus = "pendente" | "running" | "ok" | "error";

/** O que a listagem sabe de cada anúncio: para que uso é, o ângulo e se já está pronto. */
export type PlanoItem = {
  /** Id de `shared/ad-formats.js`. NULL só no caso antigo em que o agente não declarou formato. */
  formato: string | null;
  angulo: string | null;
  status: AnuncioStatus;
};

/** Um anúncio inteiro, com a copy campo a campo do formato DELE. */
export type AnuncioComposto = PlanoItem & {
  formato_justificativa: string | null;
  /** O que este anúncio faz que os outros não fazem. A prosa do CONJUNTO fica na composição. */
  composicao_md: string | null;
  composicao: ComposicaoCampos | null;
  avisos: AvisoLimite[];
  /**
   * Numa composição em revisão, `error` num anúncio `ok` é aviso, não falha: "a revisão falhou — o
   * anúncio ficou como estava".
   */
  error: string | null;
  /** Editado à mão na revisão. */
  editado?: boolean;
  /** O último pedido de revisão feito ao agente para este anúncio. */
  ultima_revisao?: string | null;
  /** O Conceito Estratégico que este anúncio executa (composição desde 20/10/2026). */
  conceito?: ConceitoEstrategico | null;
};

/** Uma versão anterior de um anúncio, guardada a cada edição ou revisão. */
export type VersaoAnuncio = {
  indice: number;
  motivo: "edicao" | "revisao";
  em: string;
};

/** O que a lista do histórico traz — sem a composição inteira, que vem no GET de uma só. */
export type ComposicaoResumo = {
  id: string;
  cliente: string;
  nome_exibicao: string | null;
  library_entry_id: string | null;
  /** Título da análise no momento em que ela alimentou esta composição. Sobrevive ao delete dela. */
  analise_titulo: string | null;
  /**
   * O formato que a composição É — escolhido pelo AGENTE, não pedido pela tela. NULL enquanto roda,
   * e também quando ele não declarou um formato válido (aí a composição é só prosa).
   */
  formato: string | null;
  /** Por que o agente escolheu esse formato, em uma frase. */
  formato_justificativa: string | null;
  /**
   * O conjunto: um item por anúncio, na ordem em que são escritos. Vazio enquanto o agente ainda
   * não decidiu quantos são — e em composição ANTERIOR a 12/10/2026, que é um anúncio só e vive
   * nas colunas `formato`/`composicao`. Use `planoDe()` em vez de ler direto.
   */
  plano?: PlanoItem[] | null;
  entradas: EntradaComposicao[] | null;
  extra_prompt: string | null;
  /** Os de todos os anúncios juntos; `anuncio` diz de qual é (ausente em composição antiga). */
  avisos: (AvisoLimite & { anuncio?: number })[];
  fontes: ComposicaoFontes | null;
  status: ComposicaoStatus;
  error: string | null;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
  canDelete: boolean;
};

export type Composicao = ComposicaoResumo & {
  /** A prosa do CONJUNTO (em composição antiga, a do único anúncio). */
  composicao_md: string | null;
  /** Só em composição antiga. Nas novas a copy está em `anuncios`. */
  composicao: ComposicaoCampos | null;
  /** Use `anunciosDe()`: ele também sabe ler a composição antiga, que não tem esta coluna. */
  anuncios?: AnuncioComposto[] | null;
  /** As versões anteriores dos anúncios, para o "desfazer". Ausente em composição antiga. */
  versoes?: VersaoAnuncio[] | null;
  metricas: Record<string, unknown> | null;
  semana_de: string | null;
  semana_ate: string | null;
  agent_id: string | null;
  /** Um por anúncio. Vazio enquanto o agente sugere — e em composição anterior a 20/10/2026. */
  conceitos?: SlotConceito[] | null;
  catalogo_copy?: CatalogoCopy | null;
  insumos_insuficientes?: InsumosInsuficientes | null;
};

export type NovaComposicao = {
  cliente: string;
  /** A análise continua sendo UMA. Os outros insumos vão em `entradas`. */
  libraryEntryId?: string | null;
  entradas: EntradaComposicao[];
  extraPrompt?: string;
};

export const criarComposicao = (token: string, input: NovaComposicao) =>
  spyRequest<{ id: string; status: ComposicaoStatus }>("/compositions", token, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const listarComposicoes = (token: string, cliente?: string | null) => {
  const qs = cliente ? `?cliente=${encodeURIComponent(cliente)}` : "";
  return spyRequest<{ compositions: ComposicaoResumo[] }>(`/compositions${qs}`, token);
};

export const obterComposicao = (token: string, id: string) =>
  spyRequest<{ composition: Composicao }>(`/compositions/${id}`, token);

/**
 * Cancela a que está rodando. Responde antes de ela parar de fato: a linha fecha quando a chamada
 * de agente em curso morre, e a tela vê pelo polling. Os anúncios já prontos ficam.
 */
export const cancelarComposicao = (token: string, id: string) =>
  spyRequest<{ ok: true }>(`/compositions/${id}/cancel`, token, { method: "POST" });

export const apagarComposicao = (token: string, id: string) =>
  spyRequest<{ ok: true }>(`/compositions/${id}`, token, { method: "DELETE" });

/**
 * O conjunto de uma composição, novo ou antigo.
 *
 * Composição antiga não tem `plano`: é UM anúncio, descrito pelas colunas da própria linha. Ler as
 * duas formas num lugar só é o que deixa a listagem e o resultado sem um `if` de legado cada um.
 * Enquanto a linha roda sem plano, devolve vazio — ainda não se sabe quantos anúncios serão.
 */
export function planoDe(c: ComposicaoResumo): PlanoItem[] {
  if (Array.isArray(c.plano) && c.plano.length) return c.plano;
  // Na etapa de conceitos ainda não há anúncio escrito; o conjunto mora em `conceitos`.
  if (c.status === "running" || c.status === "conceitos") return [];
  return [{ formato: c.formato, angulo: null, status: c.status === "error" ? "error" : "ok" }];
}

/** Os anúncios de uma composição, com a copy. Mesma regra de legado de `planoDe`. */
export function anunciosDe(c: Composicao): AnuncioComposto[] {
  if (Array.isArray(c.anuncios) && c.anuncios.length) return c.anuncios;
  if (c.status !== "ok") return [];
  return [
    {
      formato: c.formato,
      angulo: null,
      status: "ok",
      formato_justificativa: c.formato_justificativa,
      composicao_md: null,
      composicao: c.composicao,
      avisos: c.avisos ?? [],
      error: null,
    },
  ];
}

/**
 * Quantos anúncios já terminaram, de quantos. `total: 0` = o agente ainda está decidindo o conjunto.
 *
 * Anúncio que falhou conta como terminado: o marcador diz quanto falta ESPERAR, e por um anúncio
 * com erro não se espera mais nada.
 */
export function progressoDe(plano: PlanoItem[]) {
  const terminados = plano.filter((a) => a.status === "ok" || a.status === "error").length;
  return { terminados, total: plano.length };
}

/** Enquanto alguma composição está sendo escrita, a tela precisa perguntar de novo. */
export const algumaRodando = (
  lista: { status: ComposicaoStatus; plano?: PlanoItem[] | null }[],
) => lista.some(estaTrabalhando);

/**
 * Há algo sendo escrito nesta composição: ela inteira (`running`) ou, em revisão, um anúncio que o
 * agente está revisando. É o que decide o polling — sem o segundo caso, a revisão pedida só
 * apareceria num F5.
 */
export function estaTrabalhando(c: {
  status: ComposicaoStatus;
  plano?: PlanoItem[] | null;
  anuncios?: AnuncioComposto[] | null;
  conceitos?: SlotConceito[] | null;
  insumos_insuficientes?: InsumosInsuficientes | null;
}) {
  if (c.status === "running") return true;
  // Na etapa de conceitos, só enquanto o agente sugere: a primeira sugestão (nada ainda) ou um
  // anúncio `gerando`. Esperando quem compõe aprovar, não há o que perguntar — e isso pode levar
  // horas. Na LISTA, que não traz `conceitos`, nunca: abrir a composição é o que mostra o estado.
  if (c.status === "conceitos") {
    if (c.conceitos === undefined) return false;
    const slots = c.conceitos ?? [];
    return (!slots.length && !c.insumos_insuficientes) || slots.some((s) => s.status === "gerando");
  }
  if (c.status !== "revisao") return false;
  return [...(c.anuncios ?? []), ...(c.plano ?? [])].some((a) => a.status === "running");
}

/** Este anúncio tem uma versão anterior para onde o "desfazer" pode voltar. */
export const temVersaoAnterior = (c: Composicao, indice: number) =>
  (c.versoes ?? []).some((v) => v.indice === indice);

export const editarAnuncio = (
  token: string,
  id: string,
  indice: number,
  campos: ComposicaoCampos,
) =>
  spyRequest<{ ok: true; avisos: AvisoLimite[] }>(`/compositions/${id}/anuncios/${indice}`, token, {
    method: "PATCH",
    body: JSON.stringify({ campos }),
  });

/** Pede ao agente que revise UM anúncio. Responde na hora; a revisão chega pelo polling. */
export const pedirRevisao = (token: string, id: string, indice: number, pedido: string) =>
  spyRequest<{ ok: true }>(`/compositions/${id}/anuncios/${indice}/revisao`, token, {
    method: "POST",
    body: JSON.stringify({ pedido }),
  });

export const desfazerAnuncio = (token: string, id: string, indice: number) =>
  spyRequest<{ ok: true }>(`/compositions/${id}/anuncios/${indice}/desfazer`, token, {
    method: "POST",
  });

/** Fecha a revisão. Se a composição veio de uma orquestração, ela fecha junto. */
export const salvarComposicao = (token: string, id: string) =>
  spyRequest<{ ok: true }>(`/compositions/${id}/salvar`, token, { method: "POST" });

// ---- Conceitos Estratégicos: as ações de quem compõe ------------------------------------------

/** Aprova o conceito sugerido do anúncio `n` (base 0). */
export const aprovarConceito = (token: string, id: string, n: number) =>
  spyRequest<{ ok: true }>(`/compositions/${id}/conceitos/${n}/aprovar`, token, { method: "POST" });

/** Rejeita o conceito (ou pede outro, quando deu erro). O agente sugere outro; chega pelo polling. */
export const rejeitarConceito = (token: string, id: string, n: number, motivo: string) =>
  spyRequest<{ ok: true }>(`/compositions/${id}/conceitos/${n}/rejeitar`, token, {
    method: "POST",
    body: JSON.stringify({ motivo }),
  });

/** Insumos insuficientes: segue assim mesmo, reciclando conceitos em formatos de saída diferentes. */
export const seguirComConceitos = (token: string, id: string) =>
  spyRequest<{ ok: true }>(`/compositions/${id}/conceitos/seguir`, token, { method: "POST" });

/** Todos aprovados: começa a escrever os anúncios. */
export const confirmarConceitos = (token: string, id: string) =>
  spyRequest<{ ok: true }>(`/compositions/${id}/conceitos/confirmar`, token, { method: "POST" });

/** Quantos conceitos estão aprovados, de quantos anúncios. */
export function progressoDosConceitos(c: Pick<Composicao, "conceitos">) {
  const slots = c.conceitos ?? [];
  return {
    aprovados: slots.filter((s) => s.status === "aprovado").length,
    total: slots.length,
    gerando: slots.some((s) => s.status === "gerando"),
  };
}
