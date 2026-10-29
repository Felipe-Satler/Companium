// Relatório de período de Marketing › Clientes. Vive no MESMO worker da Mineração
// (`/api/spy/relatorios`), então a requisição e o tratamento de erro vêm de `adSpyApi` — inclusive as
// mensagens que distinguem "falta o bloco do nginx" de "o worker está rodando código velho", que é o
// erro que aparece primeiro depois de um deploy.

import { spyRequest } from "@/lib/adSpyApi";
import type { RelatorioSnapshot } from "@/utils/relatorioSnapshot";

/** running = o agente está escrevendo (a tela faz polling); ok | error = terminou. */
export type RelatorioStatus = "running" | "ok" | "error";

/** As três prioridades da spec. `null` = o agente não classificou — a tela diz isso. */
export type Prioridade = "gargalo" | "investigacao" | "oportunidade";

/** Do mais forte ao mais humilde. Valor desconhecido é rebaixado a `hipotese` pelo worker. */
export type TipoCausa = "causa" | "correlacao" | "hipotese";

export type RelatorioBlocos = {
  leitura: string | null;
  problema: {
    prioridade: Prioridade | null;
    texto: string | null;
    impacto: string | null;
    /** Códigos de criativo citados na prioridade (só no relatório de marketing). */
    criativos?: string[];
  };
  causa: { texto: string | null; tipo: TipoCausa; verificar: string | null };
  acao: { texto: string | null; responsavel: string; prazo: string };
  limitacoes: string[];
};

/** Aviso de MÁQUINA (dado parcial, override, meta ausente) — não é limitação declarada pelo agente. */
export type AvisoRelatorio = { codigo: string; metricas?: string[]; detalhe: string };

/** O que a lista do histórico traz — sem o snapshot nem a prosa, que são os campos grandes. */
export type RelatorioResumo = {
  id: string;
  cliente: string;
  nome_exibicao: string | null;
  /** O nome dado pela pessoa. `null` = sem nome, e a tela cai para o rótulo do período. */
  titulo: string | null;
  periodo_de: string;
  periodo_ate: string;
  periodo_kind: string | null;
  periodo_label: string | null;
  comparacao_de: string | null;
  comparacao_ate: string | null;
  comparacao_regra: string | null;
  prioridade: Prioridade | null;
  avisos: AvisoRelatorio[];
  fontes: Record<string, boolean> | null;
  status: RelatorioStatus;
  error: string | null;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
  canDelete: boolean;
};

export type Relatorio = RelatorioResumo & {
  comparacao_motivo: string | null;
  observacao: string | null;
  relatorio_md: string | null;
  relatorio: RelatorioBlocos | null;
  /**
   * Os números que embasaram o texto, como a tela os enviou. A tela de detalhe renderiza DAQUI, não
   * de um hook ao vivo: um relatório de agosto lido em dezembro tem de mostrar os números de agosto.
   */
  snapshot: RelatorioSnapshot | null;
  snapshot_versao: number | null;
  origem_numeros: string;
  agent_id: string | null;
};

export type NovoRelatorio = {
  cliente: string;
  snapshot: RelatorioSnapshot;
  observacao?: string;
  /**
   * O nome que a pessoa dá ao relatório. **Não entra no prompt** — serve para achá-lo no histórico.
   * Quem direciona a análise é `observacao`; manter os dois separados evita que um nome descritivo
   * mude silenciosamente o diagnóstico.
   */
  titulo?: string;
};

export const criarRelatorio = (token: string, input: NovoRelatorio) =>
  spyRequest<{ id: string; status: RelatorioStatus }>("/relatorios", token, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const listarRelatorios = (token: string, cliente?: string | null) => {
  const qs = cliente ? `?cliente=${encodeURIComponent(cliente)}` : "";
  return spyRequest<{ relatorios: RelatorioResumo[] }>(`/relatorios${qs}`, token);
};

export const obterRelatorio = (token: string, id: string) =>
  spyRequest<{ relatorio: Relatorio }>(`/relatorios/${id}`, token);

export const apagarRelatorio = (token: string, id: string) =>
  spyRequest<{ ok: true }>(`/relatorios/${id}`, token, { method: "DELETE" });

/**
 * Renomeia. Só o nome — o texto e os números não são editáveis, porque eles são o que o agente
 * escreveu sobre um período e a auditoria depende de continuarem sendo isso.
 *
 * String vazia LIMPA o nome e a tela volta ao rótulo do período; é ação legítima, não erro.
 */
export const renomearRelatorio = (token: string, id: string, titulo: string) =>
  spyRequest<{ ok: true; titulo: string | null }>(`/relatorios/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify({ titulo }),
  });

/** Enquanto algum relatório está sendo escrito, a tela precisa perguntar de novo. */
export const algumRodando = (lista: { status: RelatorioStatus }[]) =>
  lista.some((r) => r.status === "running");
