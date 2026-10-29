import * as XLSX from "xlsx";
import type { GestaoCliente, SerieMrrOficial, UpsellRegistro } from "@/hooks/useGestaoData";

/** Correções de grafia vindas da planilha de origem. */
const ESPECIALIDADE_FIX: Record<string, string> = {
  "oftamologia": "Oftalmologia",
};
const normalizarEspecialidade = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  if (!s) return null;
  return ESPECIALIDADE_FIX[s.toLowerCase()] ?? s;
};

/**
 * Mapa de cabeçalhos aceitos. Cobre os dois layouts possíveis:
 * - export publicado na web: aba `Lista` (+ `DB` com as colunas de referência);
 * - arquivo completo da planilha: aba `Base` (mesmas colunas da `DB`).
 */
const HEADER_MAP: Record<string, keyof GestaoCliente> = {
  "cliente": "cliente",
  "empresa": "cliente",
  "data de inicio": "data_inicio",
  "inicio real": "data_inicio",
  "inicio planejado": "data_inicio_planejado",
  "status": "status",
  "plano": "plano",
  "nmrr": "nmrr",
  "lider revops": "lider_revops",
  "responsavel revops": "responsavel_revops",
  "especialidade": "especialidade",
  "principal fonte de trafego": "fonte_trafego",
  "trafego": "fonte_trafego",
  "crm": "crm",
  "tipo crm": "tipo_crm",
  "dados": "an_dados",
  "an. dados": "an_dados",
  "an. performance": "an_performance",
  "performance": "an_performance",
  "an. design": "an_design",
  "design": "an_design",
  "an. copy": "an_copy",
  "copy": "an_copy",
  "an. edicao": "an_edicao",
  "edicao": "an_edicao",
  "data de inicio - ref mes": "data_inicio_ref",
  "data de fim - ref mes": "data_fim_ref",
  "data aviso previo - ref mes": "data_aviso_previo_ref",
  "mrr atual": "mrr_atual",
  "clt previsto": "clt_previsto",
  "clt atual": "clt_atual",
  "ltv previsto": "ltv_previsto",
  "ltv real": "ltv_real",
};

const NUMERIC: (keyof GestaoCliente)[] = [
  "nmrr",
  "mrr_atual",
  "clt_previsto",
  "clt_atual",
  "ltv_previsto",
  "ltv_real",
];

const DATES: (keyof GestaoCliente)[] = [
  "data_inicio",
  "data_inicio_planejado",
  "data_inicio_ref",
  "data_fim_ref",
  "data_aviso_previo_ref",
];

const normalizeHeader = (h: string) =>
  h
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    // colunas duplicadas viram "coluna_1" no sheet_to_json
    .replace(/_\d+$/, "");

const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const cleaned = String(v)
    .replace(/[R$\s.]/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const toDate = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const parsed = XLSX.SSF.parse_date_code(v);
    if (!parsed) return null;
    const d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
  return iso ? iso[0] : null;
};

const toText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s === "#VALUE!" || s === "#N/A" ? null : s;
};

/** Chave de casamento entre abas (nome da empresa/cliente normalizado). */
const chaveCliente = (v: unknown) => normalizeHeader(String(v ?? ""));

/** IDs do Clickup vêm com "#" em parte das abas — normalizar antes de cruzar. */
const chaveId = (v: string | null | undefined) => (v ?? "").replace(/#/g, "").trim();


const acharAba = (wb: XLSX.WorkBook, ...nomes: string[]) =>
  wb.SheetNames.find((n) => nomes.includes(normalizeHeader(n)));

const linhasDa = (wb: XLSX.WorkBook, nome: string | undefined) => {
  const aba = nome ? wb.Sheets[nome] : undefined;
  if (!aba) return [] as Record<string, unknown>[];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(aba, { defval: null });
};

/** Campos extras lidos da aba bruta (DB / Base), casados pelo nome da empresa. */
type Extras = {
  id_clickup: string | null;
  motivo_cancelamento: string | null;
  data_aviso_previo: string | null;
  data_inicio_planejado: string | null;
  /** Coluna E do DB. Vazia => CLT/LTV previstos são inexistentes (Problema 1). */
  fim_planejado: string | null;
  tem_fim_planejado: boolean;
  /** Colunas "Data de Início/Fim - Tratada" do DB (fim considera a última renovação). */
  inicio_tratada: string | null;
  fim_tratada: string | null;
  primeiro_upsell_ref: string | null;
  aviso_dias_prop: number | null;
  aviso_mes_pgto: string | null;
  an_dados: string | null;
  an_performance: string | null;
  an_design: string | null;
  an_copy: string | null;
  an_edicao: string | null;
};

const extrasDaLinha = (row: Record<string, unknown>): { cliente: string | null; extras: Extras } => {
  let cliente: string | null = null;
  const extras: Extras = {
    id_clickup: null,
    motivo_cancelamento: null,
    data_aviso_previo: null,
    data_inicio_planejado: null,
    fim_planejado: null,
    tem_fim_planejado: false,
    inicio_tratada: null,
    fim_tratada: null,
    primeiro_upsell_ref: null,
    aviso_dias_prop: null,
    aviso_mes_pgto: null,
    an_dados: null,
    an_performance: null,
    an_design: null,
    an_copy: null,
    an_edicao: null,
  };
  for (const [header, value] of Object.entries(row)) {
    const h = normalizeHeader(header);
    if (h === "empresa" || h === "cliente") cliente = cliente ?? toText(value);
    else if (h === "clickup" || h === "id (clickup)") extras.id_clickup = toText(value);
    else if (h === "motivo de cancelamento") extras.motivo_cancelamento = toText(value);
    else if (h === "inicio planejado") extras.data_inicio_planejado = toDate(value);
    else if (h === "fim planejado") {
      extras.fim_planejado = extras.fim_planejado ?? toDate(value);
      extras.tem_fim_planejado = extras.tem_fim_planejado || !!extras.fim_planejado;
    }
    else if (h === "data de inicio - tratada" || h === "inicio tratada")
      extras.inicio_tratada = toDate(value);
    else if (h === "data de fim - tratada" || h === "fim tratada")
      extras.fim_tratada = toDate(value);
    else if (h === "inicio aviso previo" || h === "data aviso previo")
      extras.data_aviso_previo = toDate(value);
    else if (h === "primeiro upsell/downsell - ref") extras.primeiro_upsell_ref = toDate(value);
    else if (h === "primeiro upsell/downsell")
      extras.primeiro_upsell_ref = extras.primeiro_upsell_ref ?? toDate(value);
    else if (h === "dias prop pag aviso previo") extras.aviso_dias_prop = toNumber(value);
    else if (h === "mes pgto aviso previo") extras.aviso_mes_pgto = toDate(value);
    // Colunas de colaboradores que só existem na aba bruta (a `Lista` não traz "Dados").
    else if (h === "dados" || h === "an. dados") extras.an_dados = extras.an_dados ?? toText(value);
    else if (h === "performance" || h === "an. performance")
      extras.an_performance = extras.an_performance ?? toText(value);
    else if (h === "design" || h === "an. design")
      extras.an_design = extras.an_design ?? toText(value);
    else if (h === "copy" || h === "an. copy") extras.an_copy = extras.an_copy ?? toText(value);
    else if (h === "edicao" || h === "an. edicao")
      extras.an_edicao = extras.an_edicao ?? toText(value);
  }
  return { cliente, extras };
};

const lerExtras = (linhas: Record<string, unknown>[]): Map<string, Extras> => {
  const mapa = new Map<string, Extras>();
  for (const row of linhas) {
    const { cliente, extras } = extrasDaLinha(row);
    if (cliente) mapa.set(chaveCliente(cliente), extras);
  }
  return mapa;
};


/**
 * Índice duplo (por ID e por nome da empresa) usado no cruzamento entre abas.
 * O ID é a chave preferida; o nome cobre linhas sem ID preenchido.
 * Nomes ambíguos (mesmo nome para IDs diferentes) são descartados do índice
 * por nome, para nunca misturar dois clientes distintos.
 */
type IndiceDuplo<T> = { porId: Map<string, T>; porNome: Map<string, T> };

const resolverPorIdOuNome = <T,>(
  idx: IndiceDuplo<T>,
  id: string | null | undefined,
  nome: string | null | undefined
): T | undefined => {
  const chave = chaveId(id);
  const porId = chave ? idx.porId.get(chave) : undefined;
  if (porId !== undefined) return porId;
  const n = chaveCliente(nome ?? "");
  return n ? idx.porNome.get(n) : undefined;
};

/**
 * Registros da aba `Upsell Downsell` indexados pelo ID (Clickup), exatamente
 * como o `SUMIFS(...; 'Upsell Downsell'!$C:$C; "="&Base!$A)` da planilha.
 * Também indexados pelo nome da empresa, como alternativa quando o ID falta.
 */
const lerUpsells = (wb: XLSX.WorkBook): IndiceDuplo<UpsellRegistro[]> => {
  const porId = new Map<string, UpsellRegistro[]>();
  const porNome = new Map<string, UpsellRegistro[]>();
  /** nome normalizado -> IDs distintos vistos (para detectar homônimos). */
  const idsPorNome = new Map<string, Set<string>>();
  const registros = linhasDa(wb, acharAba(wb, "upsell downsell"));
  for (const row of registros) {
    let id: string | null = null;
    let empresa: string | null = null;
    let inicio: string | null = null;
    let fim: string | null = null;
    let valor: number | null = null;
    for (const [header, value] of Object.entries(row)) {
      const h = normalizeHeader(header).replace(/^automatico\s*/, "");
      // Obs.: a planilha interna tem uma coluna "DATA FIM REAL" que pode antecipar o
      // fim de vigência de um upsell, mas ela não é publicada. Hoje a regra simples
      // (1º dia do mês da "Data de Fim") reproduz a planilha em 100% dos registros.
      if (h === "id (clickup)" || h === "clickup") id = toText(value);
      else if (h === "empresa" || h === "cliente") empresa = empresa ?? toText(value);
      else if (h === "ref inicio" || h === "data de inicio") inicio = inicio ?? toDate(value);
      else if (h === "ref fim" || h === "data de fim") fim = fim ?? toDate(value);
      else if (h === "novo mrr") valor = toNumber(value);
    }
    if (valor === null) continue;
    const registro: UpsellRegistro = { inicio_ref: inicio, fim_ref: fim, valor };
    const chave = chaveId(id);
    if (chave) {
      const lista = porId.get(chave) ?? [];
      lista.push(registro);
      porId.set(chave, lista);
    }
    const nome = chaveCliente(empresa ?? "");
    if (nome) {
      const ids = idsPorNome.get(nome) ?? new Set<string>();
      ids.add(chave);
      idsPorNome.set(nome, ids);
      const lista = porNome.get(nome) ?? [];
      lista.push(registro);
      porNome.set(nome, lista);
    }
  }
  for (const [nome, ids] of idsPorNome) {
    if (ids.size > 1) {
      console.warn(`[gestao] Upsell: nome "${nome}" aparece com IDs diferentes — cruzamento por nome ignorado.`);
      porNome.delete(nome);
    }
  }
  return { porId, porNome };
};


/**
 * Série mensal oficial da aba `MRR Calculado`, quando ela vier no arquivo:
 * linha 1 = meses, linha 2 = Soma (MRR), linha 3 = Média (ticket médio).
 */
const lerMrrOficial = (wb: XLSX.WorkBook): SerieMrrOficial | null => {
  const nome = acharAba(wb, "mrr calculado");
  const aba = nome ? wb.Sheets[nome] : undefined;
  if (!aba) return null;
  const grid = XLSX.utils.sheet_to_json<unknown[]>(aba, { header: 1, defval: null, raw: true });
  const [meses = [], mrrs = [], tickets = []] = grid;
  const out: SerieMrrOficial = {};
  meses.forEach((celula, i) => {
    const mes = toDate(celula)?.slice(0, 7);
    if (!mes) return;
    const mrr = toNumber(mrrs[i]);
    const ticket = toNumber(tickets[i]);
    if (mrr === null && ticket === null) return;
    out[mes] = { mrr, ticket };
  });
  return Object.keys(out).length ? out : null;
};

/**
 * MRR oficial **por cliente e por mês** da aba `MRR Calculado`.
 * Linha 1 = meses; a partir da linha com o cabeçalho `ID (Clickup)` vêm os
 * clientes, uma linha cada (coluna A = ID, coluna B = Empresa), com o valor já
 * calculado pela planilha. Indexado por ID e por nome (alternativa sem ID).
 */
const lerMrrPorCliente = (wb: XLSX.WorkBook): IndiceDuplo<Record<string, number>> => {
  const porId = new Map<string, Record<string, number>>();
  const porNome = new Map<string, Record<string, number>>();
  const nomesDuplicados = new Set<string>();
  const nome = acharAba(wb, "mrr calculado");
  const aba = nome ? wb.Sheets[nome] : undefined;
  if (!aba) return { porId, porNome };
  const grid = XLSX.utils.sheet_to_json<unknown[]>(aba, { header: 1, defval: null, raw: true });
  const meses = (grid[0] ?? []).map((c) => toDate(c)?.slice(0, 7) ?? null);
  const inicioClientes = grid.findIndex(
    (linha) => normalizeHeader(String(linha?.[0] ?? "")) === "id (clickup)"
  );
  if (inicioClientes < 0) return { porId, porNome };
  for (const linha of grid.slice(inicioClientes + 1)) {
    const id = toText(linha?.[0]);
    const empresa = toText(linha?.[1]);
    if (!id && !empresa) continue;
    const serie: Record<string, number> = {};
    meses.forEach((mes, i) => {
      if (!mes) return;
      const v = toNumber(linha?.[i]);
      if (v !== null) serie[mes] = v;
    });
    if (!Object.keys(serie).length) continue;
    if (id) porId.set(chaveId(id), serie);
    const chaveNome = chaveCliente(empresa ?? "");
    if (chaveNome) {
      if (porNome.has(chaveNome)) nomesDuplicados.add(chaveNome);
      porNome.set(chaveNome, serie);
    }
  }
  for (const dup of nomesDuplicados) {
    console.warn(`[gestao] MRR Calculado: nome "${dup}" repetido — cruzamento por nome ignorado.`);
    porNome.delete(dup);
  }
  return { porId, porNome };
};


/** Cadastro de pessoas/funções da aba `Cadastro e Configuracoes`. */
export type CadastroEquipe = {
  /** Coluna "Lider RevOps" do Bloco 1, na ordem da planilha. */
  lideres: string[];
  /** Pessoas do Bloco 2 com Status = "Ativo". */
  pessoasAtivas: string[];
  /** Bloco 1 completo: cabeçalho normalizado -> nomes (ordem da planilha). */
  porFuncao: Record<string, string[]>;
};

/** Funções reconhecidas no Bloco 1 (cabeçalho normalizado). */
const FUNCOES_CADASTRO = [
  "head de growth",
  "head comercial",
  "lider revops",
  "responsavel revops",
  "dados",
  "performance",
  "design",
  "copy",
  "edicao",
];

/**
 * Lê a aba `Cadastro e Configuracoes`:
 * - Bloco 1 (CADASTRO RESPONSAVEIS): linha de cabeçalho com as funções; cada
 *   coluna é uma lista independente que termina na primeira célula vazia.
 * - Bloco 2 (PESSOAS): linha de cabeçalho com `Pessoa` / `Status`; lista as
 *   pessoas com Status = "Ativo".
 * As colunas são resolvidas pelo TEXTO do cabeçalho normalizado, não pela letra.
 * Retorna null (com aviso no console) se a aba não existir ou vier vazia —
 * nesse caso a página mantém as listas montadas a partir do DB.
 */
const lerCadastro = (wb: XLSX.WorkBook): CadastroEquipe | null => {
  const nome = acharAba(wb, "cadastro e configuracoes");
  const aba = nome ? wb.Sheets[nome] : undefined;
  if (!aba) {
    console.warn(
      "[gestao] Aba 'Cadastro e Configuracoes' não encontrada: filtros de pessoas seguem montados a partir do DB."
    );
    return null;
  }
  const grid = XLSX.utils.sheet_to_json<unknown[]>(aba, { header: 1, defval: null, raw: true });

  // Bloco 1: linha cujo conteúdo inclui o cabeçalho "lider revops".
  const h1 = grid.findIndex((linha) =>
    (linha ?? []).some((c) => normalizeHeader(String(c ?? "")) === "lider revops")
  );
  const porFuncao: Record<string, string[]> = {};
  if (h1 >= 0) {
    const cabecalhos = (grid[h1] ?? []).map((c) => normalizeHeader(String(c ?? "")));
    cabecalhos.forEach((h, col) => {
      if (!FUNCOES_CADASTRO.includes(h)) return;
      const nomes: string[] = [];
      for (const linha of grid.slice(h1 + 1)) {
        const v = linha?.[col];
        if (v === null || v === undefined || String(v).trim() === "") break; // fim da lista
        nomes.push(String(v).trim());
      }
      if (nomes.length) porFuncao[h] = nomes;
    });
  }

  // Bloco 2: linha cujo conteúdo inclui o cabeçalho "pessoa".
  const pessoasAtivas: string[] = [];
  const h2 = grid.findIndex((linha) =>
    (linha ?? []).some((c) => normalizeHeader(String(c ?? "")) === "pessoa")
  );
  if (h2 >= 0) {
    const cabecalhos = (grid[h2] ?? []).map((c) => normalizeHeader(String(c ?? "")));
    const colPessoa = cabecalhos.indexOf("pessoa");
    const colStatus = cabecalhos.indexOf("status");
    if (colPessoa >= 0) {
      for (const linha of grid.slice(h2 + 1)) {
        const pessoa = toText(linha?.[colPessoa]);
        if (!pessoa) break; // fim da lista
        const status = colStatus >= 0 ? normalizeHeader(String(linha?.[colStatus] ?? "")) : "";
        if (status === "ativo") pessoasAtivas.push(pessoa);
      }
    }
  }

  const lideres = porFuncao["lider revops"] ?? [];
  if (!lideres.length && !pessoasAtivas.length) {
    console.warn(
      "[gestao] Aba 'Cadastro e Configuracoes' veio vazia: filtros de pessoas seguem montados a partir do DB."
    );
    return null;
  }
  return { lideres, pessoasAtivas, porFuncao };
};

export type PlanilhaParseada = {
  clientes: GestaoCliente[];
  /** Série oficial da aba `MRR Calculado`, quando publicada/anexada. */
  mrrOficial: SerieMrrOficial | null;
  /** A aba `Upsell Downsell` veio no arquivo? (define se o MRR é exato) */
  temUpsells: boolean;
  /** Cadastro de pessoas/funções (aba `Cadastro e Configuracoes`), se houver. */
  cadastro: CadastroEquipe | null;
};

export function parseGestaoPlanilha(buffer: ArrayBuffer): PlanilhaParseada {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });

  const nomeBruta = acharAba(wb, "db", "base");
  const nomeLista = acharAba(wb, "lista");
  // Sem a aba `Lista` (arquivo completo da planilha), a própria `Base` vira a lista.
  const nomePrincipal = nomeLista ?? nomeBruta ?? wb.SheetNames[0];
  if (!nomePrincipal) return { clientes: [], mrrOficial: null, temUpsells: false, cadastro: null };

  const raw = linhasDa(wb, nomePrincipal);
  // Quando a aba principal já é a bruta (`Base`), os extras vêm da própria linha
  // (evita casar por nome e confundir clientes homônimos).
  const mesmaAba = nomePrincipal === nomeBruta;
  const extras = mesmaAba ? new Map<string, Extras>() : lerExtras(linhasDa(wb, nomeBruta));
  const upsells = lerUpsells(wb);
  const mrrOficial = lerMrrOficial(wb);
  const mrrPorCliente = lerMrrPorCliente(wb);

  const clientes: GestaoCliente[] = [];
  for (const row of raw) {

    const item: Partial<GestaoCliente> = {};
    for (const [header, value] of Object.entries(row)) {
      const key = HEADER_MAP[normalizeHeader(header)];
      if (!key) continue;
      const atual = (item as Record<string, unknown>)[key];
      if (atual !== undefined && atual !== null) continue; // primeira coluna vence (duplicadas)
      if (NUMERIC.includes(key)) (item as Record<string, unknown>)[key] = toNumber(value);
      else if (DATES.includes(key)) (item as Record<string, unknown>)[key] = toDate(value);
      else (item as Record<string, unknown>)[key] = toText(value);
    }
    if (!item.cliente) continue;
    const ex = mesmaAba ? extrasDaLinha(row).extras : extras.get(chaveCliente(item.cliente));
    const idClickup = ex?.id_clickup ?? null;
    /**
     * Problema conhecido da planilha: sem "Fim Planejado" (coluna E do DB) as
     * fórmulas de CLT/LTV previstos usam a data vazia (30/12/1899) e produzem
     * valores absurdos (-1.541 meses, LTV de milhões negativos) — ou zero, quando
     * o nMRR também é zero. Nesses casos o indicador é INEXISTENTE, não zero.
     */
    const semFimPlanejado = ex ? !ex.tem_fim_planejado : false;

    clientes.push({
      cliente: item.cliente,
      data_inicio: item.data_inicio ?? null,
      data_inicio_planejado: item.data_inicio_planejado ?? ex?.data_inicio_planejado ?? null,
      status: item.status ?? null,
      plano: item.plano ?? null,
      nmrr: item.nmrr ?? null,
      lider_revops: item.lider_revops ?? null,
      responsavel_revops: item.responsavel_revops ?? null,
      especialidade: normalizarEspecialidade(item.especialidade),
      fonte_trafego: item.fonte_trafego ?? null,
      crm: item.crm ?? null,
      tipo_crm: item.tipo_crm ?? null,
      an_dados: item.an_dados ?? ex?.an_dados ?? null,
      an_performance: item.an_performance ?? ex?.an_performance ?? null,
      an_design: item.an_design ?? ex?.an_design ?? null,
      an_copy: item.an_copy ?? ex?.an_copy ?? null,
      an_edicao: item.an_edicao ?? ex?.an_edicao ?? null,
      data_inicio_ref: item.data_inicio_ref ?? null,
      data_fim_ref: item.data_fim_ref ?? null,
      data_aviso_previo_ref: item.data_aviso_previo_ref ?? null,
      mrr_atual: item.mrr_atual ?? null,
      clt_previsto: semFimPlanejado ? null : (item.clt_previsto ?? null),
      clt_atual: item.clt_atual ?? null,
      ltv_previsto: semFimPlanejado ? null : (item.ltv_previsto ?? null),
      ltv_real: semFimPlanejado ? null : (item.ltv_real ?? null),

      motivo_cancelamento: ex?.motivo_cancelamento ?? null,
      data_aviso_previo: ex?.data_aviso_previo ?? null,
      primeiro_upsell_ref: ex?.primeiro_upsell_ref ?? null,
      aviso_dias_prop: ex?.aviso_dias_prop ?? null,
      aviso_mes_pgto: ex?.aviso_mes_pgto ?? null,
      fim_planejado: ex?.fim_planejado ?? null,
      inicio_tratada: ex?.inicio_tratada ?? null,
      fim_tratada: ex?.fim_tratada ?? null,
      id_clickup: idClickup,
      upsells: resolverPorIdOuNome(upsells, idClickup, item.cliente) ?? [],
      mrr_mensal: resolverPorIdOuNome(mrrPorCliente, idClickup, item.cliente) ?? null,
    });
  }

  return {
    clientes,
    mrrOficial,
    temUpsells: upsells.porId.size > 0 || upsells.porNome.size > 0,
    cadastro: lerCadastro(wb),
  };
}
