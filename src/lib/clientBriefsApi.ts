// Resumos de Marketing › Clientes. Vivem no mesmo worker da Mineração (`/api/spy`), então a
// requisição e o tratamento de erro vêm de `adSpyApi` — inclusive as mensagens que distinguem
// "falta o bloco do nginx" de "o worker está rodando código velho".

import { spyRequest } from "@/lib/adSpyApi";

/** running = o agente está escrevendo (a tela faz polling); ok | error = terminou. */
export type BriefStatus = "running" | "ok" | "error";

export type BriefRisco = {
  titulo: string;
  gravidade: "alta" | "media" | "baixa";
  detalhe: string;
};

/** Os números que o agente viu — sempre de uma semana FECHADA. */
export type BriefMetricas = {
  investimento: number | null;
  leadsCRM: number | null;
  leadsTrafego: number | null;
  consultasAgendadas: number | null;
  faturamentoBruto: number | null;
  roas: number | null;
} | null;

export type ClientBrief = {
  /** Slug canônico — a MESMA chave de `ProjetosIndex.ativos[].padrao`. É por ela que o card casa. */
  cliente: string;
  nome_exibicao: string | null;
  brief_md: string | null;
  brief: {
    /** O Contexto Operacional: como a operação roda, segundo o ClickUp. Sem número. */
    contexto_operacional: string | null;
    riscos: BriefRisco[];
    /**
     * Setembro de 2026: o resumo falava de número e tinha estas três chaves. Ficam declaradas e
     * opcionais porque as linhas gravadas ANTES da reestruturação continuam na tabela (o upsert é por
     * cliente, e o job só reescreve quem precisa). São lidas como fallback, nunca escritas.
     */
    contexto?: string | null;
    resultados?: string | null;
    situacao?: string | null;
  } | null;
  /**
   * LEGADO. Os números das semanas fechadas que embasavam o texto antigo. Linha nova grava `{}`: o
   * Contexto Operacional não fala de número, e quem faz leitura de resultado é o Relatório.
   */
  metricas: { atual: BriefMetricas; anterior: BriefMetricas } | null;
  fontes: { clickup?: boolean; supabase?: boolean } | null;
  status: BriefStatus;
  error: string | null;
  agent_id: string | null;
  /**
   * A semana FECHADA (segunda..domingo). Em linha nova significa "situação apurada nesta semana"; em
   * linha antiga, "semana analisada" — e é a presença de `metricas.atual` que distingue as duas.
   */
  semana_de: string | null;
  semana_ate: string | null;
  atualizado_em: string;
  atualizado_por: string | null;
};

export const listBriefs = (token: string) =>
  spyRequest<{ briefs: ClientBrief[] }>("/briefs", token);

export const refreshBrief = (token: string, cliente: string) =>
  spyRequest<{ ok: true }>(`/briefs/${encodeURIComponent(cliente)}/refresh`, token, {
    method: "POST",
  });

/** Enquanto algum resumo está sendo escrito, a tela precisa perguntar de novo. */
export const algumRodando = (briefs: ClientBrief[]) => briefs.some((b) => b.status === "running");
