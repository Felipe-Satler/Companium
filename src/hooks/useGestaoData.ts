import * as React from "react";

/** Registro da aba `Upsell Downsell` (Novo MRR vigente entre dois meses). */
export type UpsellRegistro = {
  inicio_ref: string | null;
  fim_ref: string | null;
  valor: number | null;
};

/** Série mensal oficial da aba `MRR Calculado` (yyyy-MM -> soma e média). */
export type SerieMrrOficial = Record<string, { mrr: number | null; ticket: number | null }>;

/** De onde vem o MRR histórico exibido no BI. */
export type OrigemMrr = "oficial" | "upsell" | "aproximado";


export type GestaoCliente = {

  cliente: string;
  data_inicio: string | null;
  /** Coluna "Início Planejado" da Base/DB (usada no cálculo de CLT). */
  data_inicio_planejado?: string | null;
  status: string | null;
  plano: string | null;
  nmrr: number | null;
  lider_revops: string | null;
  responsavel_revops: string | null;
  especialidade: string | null;
  fonte_trafego: string | null;
  crm: string | null;
  tipo_crm: string | null;
  an_dados: string | null;
  an_performance: string | null;
  an_design: string | null;
  an_copy: string | null;
  an_edicao: string | null;
  data_inicio_ref: string | null;
  data_fim_ref: string | null;
  data_aviso_previo_ref: string | null;
  mrr_atual: number | null;
  clt_previsto: number | null;
  clt_atual: number | null;
  ltv_previsto: number | null;
  ltv_real: number | null;
  motivo_cancelamento?: string | null;
  data_aviso_previo?: string | null;
  /** Mês do primeiro upsell/downsell (aba DB) — usado para o MRR histórico. */
  primeiro_upsell_ref?: string | null;
  /** Dias proporcionais pagos no aviso prévio (aba DB). */
  aviso_dias_prop?: number | null;
  /** Mês em que o aviso prévio proporcional é faturado (aba DB). */
  aviso_mes_pgto?: string | null;
  /** Registros de upsell/downsell do cliente (aba `Upsell Downsell`). */
  upsells?: UpsellRegistro[];
  /** ID (Clickup) — chave usada pela planilha para casar os upsells. */
  id_clickup?: string | null;
  /** Coluna E do DB ("Fim Planejado") — fim do contrato original. */
  fim_planejado?: string | null;
  /** Colunas "Data de Início/Fim - Tratada" do DB (escopo do contrato vigente). */
  inicio_tratada?: string | null;
  fim_tratada?: string | null;
  /** MRR oficial por mês (yyyy-MM) vindo da aba `MRR Calculado`. */
  mrr_mensal?: Record<string, number> | null;

};

export type GestaoImportacao = {
  criado_em: string;
  criado_por: string | null;
  nome_arquivo: string | null;
  total_linhas: number;
  /** Origem do MRR histórico desta importação. */
  origem_mrr?: OrigemMrr;
};

/** Cadastro de pessoas/funções lido da aba `Cadastro e Configuracoes`. */
export type CadastroEquipe = {
  lideres: string[];
  pessoasAtivas: string[];
  porFuncao: Record<string, string[]>;
};

const LS_ROWS = "companium.gestao.clientes";
const LS_META = "companium.gestao.importacao";
const LS_MRR = "companium.gestao.mrrOficial";
const LS_CADASTRO = "companium.gestao.cadastro";
const LS_VERSAO = "companium.gestao.parserVersao";

/**
 * Versão do leitor da planilha. Suba este número sempre que a leitura mudar
 * (ex.: cruzamento por nome quando o ID falta). Dados guardados por uma versão
 * anterior são considerados desatualizados e re-sincronizados automaticamente.
 */
export const PARSER_VERSAO = 3;

const readLocal = (): {
  rows: GestaoCliente[];
  meta: GestaoImportacao | null;
  mrrOficial: SerieMrrOficial | null;
  cadastro: CadastroEquipe | null;
  versao: number;
} => {
  try {
    const rows = JSON.parse(localStorage.getItem(LS_ROWS) ?? "[]") as GestaoCliente[];
    const metaRaw = localStorage.getItem(LS_META);
    const mrrRaw = localStorage.getItem(LS_MRR);
    const cadRaw = localStorage.getItem(LS_CADASTRO);
    const versao = Number(localStorage.getItem(LS_VERSAO) ?? "0");
    return {
      rows,
      meta: metaRaw ? (JSON.parse(metaRaw) as GestaoImportacao) : null,
      mrrOficial: mrrRaw ? (JSON.parse(mrrRaw) as SerieMrrOficial) : null,
      cadastro: cadRaw ? (JSON.parse(cadRaw) as CadastroEquipe) : null,
      versao: Number.isFinite(versao) ? versao : 0,
    };
  } catch {
    return { rows: [], meta: null, mrrOficial: null, cadastro: null, versao: 0 };
  }
};

const writeLocal = (
  rows: GestaoCliente[],
  meta: GestaoImportacao,
  mrrOficial: SerieMrrOficial | null,
  cadastro: CadastroEquipe | null
) => {
  localStorage.setItem(LS_ROWS, JSON.stringify(rows));
  localStorage.setItem(LS_META, JSON.stringify(meta));
  localStorage.setItem(LS_VERSAO, String(PARSER_VERSAO));
  if (mrrOficial) localStorage.setItem(LS_MRR, JSON.stringify(mrrOficial));
  else localStorage.removeItem(LS_MRR);
  if (cadastro) localStorage.setItem(LS_CADASTRO, JSON.stringify(cadastro));
  else localStorage.removeItem(LS_CADASTRO);
};

/**
 * Persistência da aba Gestão.
 * Sem backend conectado, o módulo usa o armazenamento local do navegador
 * (mesmo fallback previsto no pacote original). Para armazenamento
 * compartilhado, aplique `sql/gestao_tables.sql` e troque as chamadas locais
 * pelo client do banco.
 */
export function useGestaoData() {
  const [rows, setRows] = React.useState<GestaoCliente[]>([]);
  const [importacao, setImportacao] = React.useState<GestaoImportacao | null>(null);
  const [mrrOficial, setMrrOficial] = React.useState<SerieMrrOficial | null>(null);
  const [cadastro, setCadastro] = React.useState<CadastroEquipe | null>(null);
  const [loading, setLoading] = React.useState(true);
  /** Dados guardados por uma versão anterior do leitor da planilha. */
  const [cacheDesatualizado, setCacheDesatualizado] = React.useState(false);
  const remoteAvailable = false;

  const load = React.useCallback(async () => {
    setLoading(true);
    const local = readLocal();
    setRows(local.rows);
    setImportacao(local.meta);
    setMrrOficial(local.mrrOficial);
    setCadastro(local.cadastro);
    setCacheDesatualizado(local.rows.length > 0 && local.versao < PARSER_VERSAO);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  /** Substitui todo o conteúdo pela nova planilha. */
  const replaceAll = React.useCallback(
    async (
      novos: GestaoCliente[],
      nomeArquivo: string,
      email: string | null,
      extra?: {
        mrrOficial?: SerieMrrOficial | null;
        origemMrr?: OrigemMrr;
        cadastro?: CadastroEquipe | null;
      }
    ) => {
      const meta: GestaoImportacao = {
        criado_em: new Date().toISOString(),
        criado_por: email,
        nome_arquivo: nomeArquivo,
        total_linhas: novos.length,
        origem_mrr: extra?.origemMrr ?? "aproximado",
      };
      const serie = extra?.mrrOficial ?? null;
      const cad = extra?.cadastro ?? null;
      writeLocal(novos, meta, serie, cad);
      setRows(novos);
      setImportacao(meta);
      setMrrOficial(serie);
      setCadastro(cad);
      setCacheDesatualizado(false);
      return { persistido: "local" as const };
    },
    []
  );

  return {
    rows,
    importacao,
    mrrOficial,
    cadastro,
    origemMrr: importacao?.origem_mrr ?? "aproximado",
    loading,
    cacheDesatualizado,
    remoteAvailable,
    refresh: load,
    replaceAll,
  };

}

