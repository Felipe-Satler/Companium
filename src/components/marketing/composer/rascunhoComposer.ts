// O estado da Nova Composição, guardado no navegador para quem sair da tela e voltar continuar de
// onde estava: o cliente, a etapa, os insumos marcados, o pedido escrito e a composição em curso.
//
// `localStorage`, e não a URL: a seleção de insumos são listas de ids, e uma URL com vinte ids não
// serve para mandar a ninguém. É conforto de quem está compondo, não estado compartilhado — por
// isso vale só neste navegador, e tudo aqui tolera o armazenamento estar bloqueado.

import type { CriativoInternoEscolhido } from "@/components/marketing/composer/criativoInterno";

// "conceitos" desde 20/10/2026: entre o pedido e a escrita, quem compõe aprova um Conceito
// Estratégico por anúncio.
export const ETAPAS_COMPOSER = ["cliente", "insumos", "intencao", "conceitos", "resultado"] as const;
export type EtapaComposer = (typeof ETAPAS_COMPOSER)[number];

export type Rascunho = {
  cliente: string;
  etapa: EtapaComposer;
  analiseId: string | null;
  brief: boolean;
  relatorios: string[];
  documentos: string[];
  /** As análises de criativo de concorrentes escolhidas (várias, desde 20/10/2026). */
  criativos: string[];
  /** O criativo do próprio cliente escolhido — no máximo um. */
  interno: CriativoInternoEscolhido | null;
  incluirNumeros: boolean;
  /** A dissecação de criativo interno em preparo antes de compor (a etapa extra do Resultado). */
  preparo: string | null;
  intencao: string;
  /** A composição pedida a partir deste rascunho — a que a etapa Resultado mostra. */
  selecionada: string | null;
};

const CHAVE = "companium:composer:rascunho";

const lista = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** O criativo interno como foi guardado, ou null se o formato não for o esperado. */
function internoValido(v: unknown): CriativoInternoEscolhido | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  if (typeof c.metaAdId !== "string") return null;
  return {
    metaAdId: c.metaAdId,
    nome: typeof c.nome === "string" ? c.nome : "",
    numeros: typeof c.numeros === "string" ? c.numeros : null,
  };
}

/**
 * Os criativos de um rascunho, inclusive do formato de ANTES de 20/10/2026, que guardava um só em
 * `criativo: { tipo: "concorrente" | "interno", … }`. Sem isso, quem tinha uma composição em curso
 * no deploy voltaria à tela sem o criativo que escolheu.
 */
function criativosDoRascunho(r: Record<string, unknown>) {
  const antigo = r.criativo && typeof r.criativo === "object" ? (r.criativo as Record<string, unknown>) : null;
  const criativos = lista(r.criativos);
  if (antigo?.tipo === "concorrente" && typeof antigo.id === "string" && !criativos.includes(antigo.id)) {
    criativos.push(antigo.id);
  }
  const interno = internoValido(r.interno) ?? (antigo?.tipo === "interno" ? internoValido(antigo) : null);
  return { criativos, interno };
}

/** O rascunho guardado, ou null. Qualquer coisa estranha no armazenamento vira null, não erro. */
export function carregarRascunho(): Rascunho | null {
  try {
    const r = JSON.parse(localStorage.getItem(CHAVE) ?? "null");
    if (!r || typeof r !== "object" || typeof r.cliente !== "string") return null;
    return {
      cliente: r.cliente,
      etapa: ETAPAS_COMPOSER.includes(r.etapa) ? r.etapa : "cliente",
      analiseId: typeof r.analiseId === "string" ? r.analiseId : null,
      brief: r.brief !== false,
      relatorios: lista(r.relatorios),
      documentos: lista(r.documentos),
      ...criativosDoRascunho(r),
      incluirNumeros: r.incluirNumeros === true,
      preparo: typeof r.preparo === "string" ? r.preparo : null,
      intencao: typeof r.intencao === "string" ? r.intencao : "",
      selecionada: typeof r.selecionada === "string" ? r.selecionada : null,
    };
  } catch {
    return null;
  }
}

export function salvarRascunho(r: Rascunho) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(r));
  } catch {
    /* sem armazenamento: a tela funciona igual, só não lembra ao voltar */
  }
}

export function descartarRascunho() {
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    /* idem */
  }
}

/**
 * O que a tela abre: o rascunho guardado, a menos que o link peça OUTRO cliente.
 *
 * O botão "Compor" do card de um cliente manda `?cliente=`. Se o rascunho é de outro cliente, quem
 * clicou quer começar por este — restaurar a seleção do anterior seria compor com os documentos
 * do cliente errado. Mesmo cliente: restaura, porque é a pessoa voltando ao que estava fazendo.
 *
 * O "Compor com esta análise" (Mineração e Biblioteca) manda `?analise=`. Ela entra no lugar da
 * análise do rascunho e o resto fica — o link não diz de quem é o anúncio, então não há por que
 * jogar fora os documentos já marcados. A tela volta aos insumos para a pessoa ver a análise ao
 * lado do resto, e a composição em curso sai da tela (continua em Composições Salvas).
 */
export function rascunhoInicial(
  clienteDaUrl: string,
  guardado: Rascunho | null,
  analiseDaUrl = "",
): Rascunho {
  const base = rascunhoDoCliente(clienteDaUrl, guardado);
  if (!analiseDaUrl || base.analiseId === analiseDaUrl) return base;
  return {
    ...base,
    analiseId: analiseDaUrl,
    etapa: base.cliente ? "insumos" : "cliente",
    selecionada: null,
  };
}

function rascunhoDoCliente(clienteDaUrl: string, guardado: Rascunho | null): Rascunho {
  if (guardado && (!clienteDaUrl || guardado.cliente === clienteDaUrl)) {
    // Etapa que depende de cliente, sem cliente, não tem o que mostrar.
    return guardado.cliente ? guardado : { ...guardado, etapa: "cliente" };
  }
  return {
    cliente: clienteDaUrl,
    etapa: clienteDaUrl ? "insumos" : "cliente",
    analiseId: null,
    brief: true,
    relatorios: [],
    documentos: [],
    criativos: [],
    interno: null,
    incluirNumeros: false,
    preparo: null,
    intencao: "",
    selecionada: null,
  };
}
