// Orquestrador — uma composição conduzida por agente do começo ao fim.
//
// Vive no MESMO worker do Composer (`/api/spy/orquestracoes`), então a requisição e o tratamento de
// erro vêm de `adSpyApi`. Uma orquestração guarda o PERCURSO (números, diagnóstico, decisões,
// perguntas feitas aos bots); os anúncios vivem na composição que ela aponta em `composition_id`.

import { spyRequest } from "@/lib/adSpyApi";

/** running = em andamento (a tela faz polling); ok | error = terminou. */
/** revisao = a composição ficou pronta e espera quem disparou rever e salvar (desde 19/10/2026). */
/** conceitos = parada esperando quem disparou aprovar os Conceitos Estratégicos (desde 20/10/2026). */
export type OrquestracaoStatus = "conceitos" | "running" | "revisao" | "ok" | "error";

export type EtapaKey = "numeros" | "plano" | "analise" | "pedido" | "conceitos" | "composicao" | "revisao";

/**
 * Uma etapa do percurso. `error` numa etapa NÃO é orquestração em erro: a mineração pode falhar e a
 * composição sair assim mesmo, sem análise — a nota da etapa diz o que houve.
 */
export type EtapaOrquestracao = {
  key: EtapaKey;
  label: string;
  /** `aguardando` = a vez é de uma pessoa (os conceitos, a revisão), não da máquina: sem spinner. */
  status: "pending" | "running" | "aguardando" | "done" | "skipped" | "error";
  note: string | null;
  started_at: string | null;
  ended_at: string | null;
};

export type InsumoEscolhido = {
  id: string;
  titulo: string | null;
  local?: string | null;
  /** Por que o orquestrador o escolheu, em uma frase. */
  motivo: string | null;
};

export type DecisoesOrquestracao = {
  abordagem?: string | null;
  contexto_operacional?: boolean;
  analise?: { id: string | null; titulo: string | null; motivo: string | null; nova: boolean };
  /** O que ele pediu para minerar. NULL quando usou uma análise da Biblioteca (ou nenhuma). */
  mineracao?: {
    nicho: string;
    contexto: string | null;
    pergunta: string | null;
    foco: string | null;
    /** A palavra-chave que de fato trouxe anúncios, e quantas peças foram analisadas. */
    termo?: string;
    pecas?: number;
  } | null;
  relatorios?: InsumoEscolhido[];
  documentos?: InsumoEscolhido[];
  /** As análises de criativo da especialidade do cliente: os formatos dos conceitos (20/10/2026). */
  criativos?: { id: string; titulo: string | null }[];
  pedido_ao_composer?: string | null;
  /**
   * O que a rodada custou, contado pelo worker enquanto acontece. Ausente em orquestração anterior
   * a 13/10/2026 — e aí a tela mostra travessão, não zero.
   */
  custo?: {
    /** Créditos da Scrape Creators gastos nas buscas — inclusive nas que não acharam anúncio. */
    creditos: number;
    buscas: number;
    chamadas_agente: number;
    /** Peças que passaram por download, transcrição e análise. */
    pecas: number;
    anuncios: number;
  };
};

/** Uma pergunta feita a um dos bots. Pergunta e resposta vêm cortadas: é registro, não o prompt. */
export type PerguntaAoBot = {
  para: string;
  assunto: string;
  pergunta: string;
  resposta: string | null;
  erro: string | null;
  em: string;
};

export type NumerosSemana = {
  investimento?: number;
  leadsTrafego?: number;
  leadsCRM?: number;
  consultasAgendadas?: number;
  faturamentoBruto?: number;
  roas?: number | null;
};

export type OrquestracaoResumo = {
  id: string;
  cliente: string;
  nome_exibicao: string | null;
  pedido: string | null;
  status: OrquestracaoStatus;
  error: string | null;
  etapas: EtapaOrquestracao[];
  run_id: string | null;
  library_entry_id: string | null;
  composition_id: string | null;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
  canDelete: boolean;
};

export type Orquestracao = OrquestracaoResumo & {
  diagnostico_md: string | null;
  decisoes: DecisoesOrquestracao | null;
  perguntas: PerguntaAoBot[] | null;
  metricas: { atual?: NumerosSemana; anterior?: NumerosSemana | null } | null;
  semana_de: string | null;
  semana_ate: string | null;
};

export const criarOrquestracao = (
  token: string,
  input: { cliente: string; pedido?: string; pularRevisao?: boolean },
) =>
  spyRequest<{ id: string; status: OrquestracaoStatus }>("/orquestracoes", token, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const listarOrquestracoes = (token: string) =>
  spyRequest<{ orquestracoes: OrquestracaoResumo[] }>("/orquestracoes", token);

export const obterOrquestracao = (token: string, id: string) =>
  spyRequest<{ orquestracao: Orquestracao }>(`/orquestracoes/${id}`, token);

/**
 * Cancela a que está rodando. Responde antes de ela parar de fato: a linha fecha quando a chamada
 * em curso morre, e a tela vê isso pelo polling.
 */
export const cancelarOrquestracao = (token: string, id: string) =>
  spyRequest<{ ok: true }>(`/orquestracoes/${id}/cancel`, token, { method: "POST" });

/**
 * Cancelada não é um status próprio no banco (seria uma migração a mais): é `error` com este
 * começo de mensagem. A tela distingue para não chamar de "falhou" o que a pessoa mandou parar.
 */
export const foiCancelada = (o: { status: OrquestracaoStatus; error: string | null }) =>
  o.status === "error" && (o.error ?? "").startsWith("Cancelada");

export const apagarOrquestracao = (token: string, id: string) =>
  spyRequest<{ ok: true }>(`/orquestracoes/${id}`, token, { method: "DELETE" });
