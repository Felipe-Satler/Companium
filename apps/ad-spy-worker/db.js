/**
 * Supabase access for the ad-spy worker: PostgREST + Storage over plain fetch with the
 * service_role key, exactly like openclaw-bridge does it. No @supabase/supabase-js here — the
 * bridge established that a handful of fetch helpers is enough and keeps the dependency list at
 * express + jose (+ playwright).
 *
 * Everything in this file BYPASSES RLS. Ownership is therefore checked in the route layer, never
 * assumed here.
 */

import { MEDIA_BUCKET, SUPABASE_SERVICE_KEY, SUPABASE_URL } from "./config.js";

export function sbHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    ...extra,
  };
}

export function dbEnabled() {
  return Boolean(SUPABASE_SERVICE_KEY);
}

class DbError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "DbError";
    this.status = 502;
    this.detail = detail;
  }
}

async function sbFetch(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: sbHeaders({ "Content-Type": "application/json", ...(init.headers || {}) }),
  });
  if (!res.ok) {
    throw new DbError(
      `supabase ${init.method || "GET"} ${path.split("?")[0]} -> ${res.status}`,
      (await res.text().catch(() => "")).slice(0, 300)
    );
  }
  return res;
}

async function sbJson(path, init) {
  const res = await sbFetch(path, init);
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

// ---------------------------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------------------------

/** The pipeline, in execution order. Seeded on insert so the UI can draw the full path up front
 *  (a progress view that reveals its own steps one by one tells you nothing about what is left). */
export const STAGE_TEMPLATE = [
  { key: "discover", label: "Busca" },
  { key: "download", label: "Download" },
  { key: "transcribe", label: "Transcrição" },
  { key: "analyze", label: "Análise" },
];

export function seedStages() {
  return STAGE_TEMPLATE.map((s) => ({
    ...s,
    status: "pending",
    done: 0,
    total: null,
    started_at: null,
    ended_at: null,
    note: null,
  }));
}

export async function insertRun({ userId, tema, sources, settings, extraPrompt, metaProvider }) {
  const rows = await sbJson("ad_spy_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: userId,
      tema,
      sources,
      settings,
      extra_prompt: extraPrompt || null,
      meta_provider: metaProvider,
      status: "searching",
      stages: seedStages(),
      search_state: {},
    }),
  });
  if (!Array.isArray(rows) || !rows.length) throw new DbError("run insert returned no row");
  return rows[0];
}

export async function patchRun(runId, patch) {
  await sbFetch(`ad_spy_runs?id=eq.${encodeURIComponent(runId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

const RUN_COLS =
  "id,user_id,tema,sources,settings,extra_prompt,status,stages,cancel_requested," +
  "analysis_md,analysis,meta_provider,error,search_state,question,criado_em,updated_at";

export async function getRun(runId) {
  const rows = await sbJson(
    `ad_spy_runs?id=eq.${encodeURIComponent(runId)}&select=${RUN_COLS}&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/** Only the cancel flag, read as cheaply as possible — the runner polls this between stages. */
export async function isCancelRequested(runId) {
  const rows = await sbJson(
    `ad_spy_runs?id=eq.${encodeURIComponent(runId)}&select=cancel_requested&limit=1`
  );
  return Array.isArray(rows) && rows.length ? Boolean(rows[0].cancel_requested) : false;
}

export async function requestCancel(runId) {
  await patchRun(runId, { cancel_requested: true });
}

// ---------------------------------------------------------------------------------------------
// Ads
// ---------------------------------------------------------------------------------------------

const AD_COLS =
  "id,run_id,source,external_id,page_name,page_id,page_profile_uri,permalink,ad_copy,title,cta_text," +
  "link_url,display_format,publisher_platform,started_running_on,days_running," +
  "media_type,thumb_path,media_path,duration_sec,transcript,transcript_lang," +
  "transcript_model,collation_count,is_active,selected,media_url,thumb_url,avatar_path,found_via,metrics,criado_em";

/**
 * Upsert the mined ads for a run.
 *
 * `resolution=merge-duplicates` against the (run_id, source, external_id) unique constraint: the
 * Ad Library's infinite scroll re-emits the same ad across GraphQL pages, so the provider WILL
 * hand us duplicates. Deduping in the DB is cheaper and more reliable than tracking seen ids
 * across an async generator.
 */
export async function upsertAds(runId, ads) {
  if (!ads.length) return [];
  const rows = ads.map((a) => ({
    run_id: runId,
    source: a.source,
    external_id: a.externalId || null,
    page_name: a.pageName || null,
    page_id: a.pageId || null,
    page_profile_uri: a.pageProfileUri || null,
    permalink: a.permalink || null,
    ad_copy: a.adCopy || null,
    title: a.title || null,
    cta_text: a.ctaText || null,
    link_url: a.linkUrl || null,
    display_format: a.displayFormat || null,
    publisher_platform: a.publisherPlatform?.length ? a.publisherPlatform : null,
    started_running_on: a.startedRunningOn || null,
    days_running: Number.isFinite(a.daysRunning) ? a.daysRunning : null,
    media_type: a.mediaType || null,
    collation_count: Number.isFinite(a.collationCount) ? a.collationCount : null,
    is_active: typeof a.isActive === "boolean" ? a.isActive : null,
    media_url: a.mediaUrl || null,
    thumb_url: a.thumbUrl || null,
    duration_sec: Number.isFinite(a.durationSec) ? a.durationSec : null,
    found_via: a.foundVia || null,
    // Sempre a chave, nunca ausente: o upsert vai em lote, e o PostgREST recusa lote heterogêneo.
    metrics: a.metrics && Object.keys(a.metrics).length ? a.metrics : null,
  }));
  const out = await sbJson(
    "ad_spy_ads?on_conflict=run_id,source,external_id&select=" + AD_COLS,
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(rows),
    }
  );
  return Array.isArray(out) ? out : [];
}

export async function patchAd(adId, patch) {
  await sbFetch(`ad_spy_ads?id=eq.${Number(adId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}

/** Na ordem em que foram achados (id crescente) — é a ordem do grid. */
export async function listAds(runId) {
  const rows = await sbJson(
    `ad_spy_ads?run_id=eq.${encodeURIComponent(runId)}&select=${AD_COLS}&order=id.asc`
  );
  return Array.isArray(rows) ? rows : [];
}

/**
 * Só os marcados, na ordem em que o AGENTE os lê. É por essa ordem que a análise cita #1, #2... —
 * a Biblioteca guarda a mesma ordem, senão as citações apontariam para o anúncio errado.
 */
export async function listSelectedAds(runId) {
  const rows = await sbJson(
    `ad_spy_ads?run_id=eq.${encodeURIComponent(runId)}&selected=is.true&select=${AD_COLS}` +
      `&order=days_running.desc.nullslast,id.asc`
  );
  return Array.isArray(rows) ? rows : [];
}

/** Marca exatamente estes ids como selecionados na run, e desmarca o resto. */
export async function setSelection(runId, adIds) {
  const run = encodeURIComponent(runId);
  await sbFetch(`ad_spy_ads?run_id=eq.${run}&selected=is.true`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ selected: false }),
  });
  const ids = adIds.map(Number).filter(Number.isFinite);
  if (!ids.length) return 0;
  const res = await sbJson(
    `ad_spy_ads?run_id=eq.${run}&id=in.(${ids.join(",")})&select=id`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ selected: true }),
    }
  );
  // Conta o que de fato casou: ids de outra run simplesmente não entram.
  return Array.isArray(res) ? res.length : 0;
}

/** Um anúncio, para a rota de mídia. */
/**
 * Um anúncio, com TODAS as colunas.
 *
 * Já foi uma lista curta, feita para a rota de imagem (`id,thumb_path,avatar_path,media_type`).
 * A rota de baixar vídeo então lia `media_url` como `undefined` e respondia "este anúncio não tem
 * vídeo guardado" para anúncio que tinha — o dado existia, a consulta é que não o pedia. Colunas a
 * mais aqui não custam nada: é uma linha por requisição.
 */
export async function getAd(adId) {
  const rows = await sbJson(`ad_spy_ads?id=eq.${Number(adId)}&select=${AD_COLS}&limit=1`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// ---------------------------------------------------------------------------------------------
// Biblioteca
// ---------------------------------------------------------------------------------------------

const LIB_LIST_COLS = "id,run_id,tema,titulo,especialidades,saved_by,saved_by_name,criado_em,ads";

export async function insertLibraryEntry(entry) {
  const rows = await sbJson("ad_spy_library", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(entry),
  });
  if (!Array.isArray(rows) || !rows.length) throw new DbError("library insert returned no row");
  return rows[0];
}

/** Lista, opcionalmente filtrando por especialidade (sobreposição de arrays). */
export async function listLibrary({ especialidades = [], limit = 100 } = {}) {
  let path = `ad_spy_library?select=${LIB_LIST_COLS}&order=criado_em.desc&limit=${Number(limit) || 100}`;
  const esp = especialidades.filter(Boolean);
  if (esp.length) {
    // PostgREST: `ov` = overlaps (&&). Valores entre aspas duplas por conterem espaço/acento.
    const list = esp.map((e) => `"${String(e).replace(/"/g, "")}"`).join(",");
    path += `&especialidades=ov.{${encodeURIComponent(list)}}`;
  }
  const rows = await sbJson(path);
  return Array.isArray(rows) ? rows : [];
}

export async function getLibraryEntry(id) {
  const rows = await sbJson(`ad_spy_library?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function deleteLibraryEntry(id) {
  await sbFetch(`ad_spy_library?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

// ---------------------------------------------------------------------------------------------
// Favoritos da Biblioteca (por usuário)
// ---------------------------------------------------------------------------------------------

/** Ids das análises que ESTE usuário favoritou. */
export async function listFavoritos(userId) {
  const rows = await sbJson(
    `ad_spy_library_favoritos?user_id=eq.${encodeURIComponent(userId)}&select=entry_id`
  );
  return new Set(Array.isArray(rows) ? rows.map((r) => r.entry_id) : []);
}

/**
 * Liga/desliga o favorito. Idempotente dos dois lados: favoritar o que já é favorito não duplica
 * (a PK resolve com merge-duplicates) e desfavoritar o que não era não é erro.
 */
export async function setFavorito(entryId, userId, favorito) {
  if (favorito) {
    await sbFetch("ad_spy_library_favoritos?on_conflict=entry_id,user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ entry_id: entryId, user_id: userId }]),
    });
    return;
  }
  await sbFetch(
    `ad_spy_library_favoritos?entry_id=eq.${encodeURIComponent(entryId)}` +
      `&user_id=eq.${encodeURIComponent(userId)}`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } }
  );
}

/** Runs cuja mídia está referenciada por alguma entrada da Biblioteca — não podem perder os arquivos. */
export async function isRunInLibrary(runId) {
  const rows = await sbJson(
    `ad_spy_library?run_id=eq.${encodeURIComponent(runId)}&select=id&limit=1`
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function isAdmin(userId) {
  const rows = await sbJson(
    `user_roles?user_id=eq.${encodeURIComponent(userId)}&role=eq.admin&select=role&limit=1`
  );
  return Array.isArray(rows) && rows.length > 0;
}

// ---------------------------------------------------------------------------------------------
// Marketing › Clientes — resumos e as métricas que os embasam
// ---------------------------------------------------------------------------------------------

/** Chave de matching tolerante a caixa/acento/underscore. Porte fiel de `clientMatchKey`
 *  (src/data/clienteAliases.ts) — os dois têm de casar, senão o resumo cai no cliente errado. */
export function clientMatchKey(s) {
  if (!s) return "";
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "_")
    .trim();
}

/**
 * Lê uma tabela/view inteira em páginas.
 *
 * O PostgREST devolve no máximo `limit` linhas por requisição; sem paginar, um período grande
 * volta truncado EM SILÊNCIO e as métricas saem menores do que a realidade — o tipo de erro que
 * ninguém percebe porque o número continua plausível.
 */
async function sbPaged(path, { pageSize = 1000, max = 200000 } = {}) {
  const out = [];
  for (let offset = 0; offset < max; offset += pageSize) {
    const sep = path.includes("?") ? "&" : "?";
    const rows = await sbJson(`${path}${sep}limit=${pageSize}&offset=${offset}`);
    if (!Array.isArray(rows) || !rows.length) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

/**
 * Eventos do CRM agregados, do período.
 *
 * Lê a MATERIALIZED VIEW, não a view `v_kommo_crm_agg`: aquela embute o predicado de tenancy
 * (`client_matchkey(client) = any(caller_kommo_cmpkeys())`), e com service_role não há
 * `auth.uid()` — a chamada voltaria ZERO linhas sem erro nenhum. Quem chama confere o total e
 * grita se vier vazio (ver `assertMetricasVivas` em briefs.js).
 */
export async function readCrmAgg({ de, ate }) {
  return sbPaged(
    `mv_kommo_crm_agg?select=client,event_type,qtd,valor` +
      `&event_date=gte.${de}&event_date=lte.${ate}`
  );
}

/**
 * Investimento e leads de tráfego do período, por conta de anúncio.
 *
 * Lê a view CRUA (`_v_meta_google_ads_raw`), não `v_meta_google_ads`: aquela filtra por
 * `is_approved(auth.uid())`, e com service_role não há `auth.uid()` — a chamada volta ZERO linhas
 * sem erro nenhum. É a mesma armadilha de `readCrmAgg`, e ficou escondida porque
 * `assertMetricasVivas` só gritava quando CRM e anúncios vinham vazios JUNTOS: com o CRM vivo, todo
 * cliente saía com investimento R$ 0,00 (visto no orquestrador em 12/10/2026).
 *
 * A crua não tem escopo por cliente, e não precisa: quem chama é o worker, que já exige usuário
 * interno em toda rota (auth.js).
 */
export async function readAdsRows({ de, ate }) {
  return sbPaged(
    `_v_meta_google_ads_raw?select=Client,Lead,Mensagens_iniciadas,Valor_usado_BRL,Fonte_Ads` +
      `&Dia=gte.${de}&Dia=lte.${ate}`
  );
}

/** Base do Faturamento Bruto por cliente. Sem linha salva, vale realizadas + realizados. */
export async function readFaturamentoConfig() {
  const rows = await sbJson(
    "crm_faturamento_config?select=client_key,consulta_basis,procedimento_basis"
  ).catch(() => []);
  const map = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    map.set(r.client_key, { consulta: r.consulta_basis, procedimento: r.procedimento_basis });
  }
  return map;
}

/**
 * A planilha de projetos — a autoridade sobre quem está ATIVO.
 *
 * Tabela comum (RLS `using (true)` para authenticated), então service_role lê normalmente. Não
 * confundir com `clientes`, que é o cadastro e só sai por views.
 */
export async function readProjetosLista() {
  const rows = await sbJson(
    "projetos_lista?select=cliente,data_inicio,status,plano,lider_revops,crm&order=id"
  );
  return Array.isArray(rows) ? rows : [];
}

/** A função SECURITY DEFINER que espelha `v_cliente_especialidades` sem o portão de `auth.uid()`. */
export const ESPECIALIDADES_RPC = "especialidades_clientes_worker";

/**
 * Especialidades por cliente ativo.
 *
 * Passa pela RPC `especialidades_clientes_worker` porque a VIEW `v_cliente_especialidades` termina em
 * `is_approved(auth.uid())` — e predicado de view não é RLS, então nem `service_role` passa: a view
 * devolve ZERO linhas sem erro nenhum, e todo resumo nasce sem especialidade.
 *
 * O fallback para a view existe para o worker novo rodar antes da migração, mas ele **avisa**. Cair
 * em silêncio devolveria exatamente o bug que a função conserta, e com a mesma cara de "ninguém
 * cadastrou especialidade".
 */
export async function readEspecialidades() {
  try {
    const rows = await sbJson(`rpc/${ESPECIALIDADES_RPC}`, { method: "POST", body: "{}" });
    if (Array.isArray(rows)) return rows;
    console.warn(`[db] rpc/${ESPECIALIDADES_RPC} respondeu algo que não é lista; usando a view.`);
  } catch (err) {
    console.warn(
      `[db] rpc/${ESPECIALIDADES_RPC} indisponível (${err?.message || err}). ` +
        "Caindo para `v_cliente_especialidades`, que volta VAZIA para service_role — os resumos vão " +
        "sair sem especialidade. Rode a migração " +
        "20260928_especialidades_worker_EXTERNAL.sql."
    );
  }
  const rows = await sbJson(
    "v_cliente_especialidades?select=nome_identificador,especialidades"
  ).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

export async function listBriefs() {
  const rows = await sbJson("marketing_client_briefs?select=*&order=atualizado_em.desc");
  return Array.isArray(rows) ? rows : [];
}

export async function getBrief(cliente) {
  const rows = await sbJson(
    `marketing_client_briefs?cliente=eq.${encodeURIComponent(cliente)}&select=*&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/** Upsert por `cliente` (a PK). Idempotente: reatualizar o mesmo cliente sobrescreve a linha. */
export async function upsertBrief(row) {
  await sbFetch("marketing_client_briefs?on_conflict=cliente", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ ...row, atualizado_em: new Date().toISOString() }]),
  });
}

// ---------------------------------------------------------------------------------------------
// Marketing › Ad Composer — ideias de anúncio
// ---------------------------------------------------------------------------------------------

// A lista é histórico: não carrega a composição inteira, só o que o card mostra. A tela pede o
// resto em `getComposition` quando alguém abre uma. `plano` entra (formato, ângulo e estado de cada
// anúncio); `anuncios`, que é a copy inteira de até oito peças, não.
const COMPOSITION_LIST_COLS =
  "id,cliente,nome_exibicao,library_entry_id,analise_titulo,formato,formato_justificativa," +
  "plano,entradas,extra_prompt,avisos,fontes,status,error,criado_por,criado_em,atualizado_em";

/** Insere já com o status que a rota quiser (`running`, na prática) e devolve a linha. */
export async function insertComposition(row) {
  const rows = await sbJson("marketing_compositions", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!Array.isArray(rows) || !rows.length) throw new DbError("composition insert returned no row");
  return rows[0];
}

export async function patchComposition(id, patch) {
  await sbFetch(`marketing_compositions?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...patch, atualizado_em: new Date().toISOString() }),
  });
}

export async function listCompositions({ cliente, limit = 50 } = {}) {
  let path = `marketing_compositions?select=${COMPOSITION_LIST_COLS}&order=criado_em.desc&limit=${
    Number(limit) || 50
  }`;
  if (cliente) path += `&cliente=eq.${encodeURIComponent(cliente)}`;
  const rows = await sbJson(path);
  return Array.isArray(rows) ? rows : [];
}

/**
 * O que a faxina do boot precisa fechar (ver orfas.js): as composições `running` e as EM REVISÃO
 * com algum anúncio sendo revisado (`plano` contém um item `running`).
 */
export async function listComposicoesRodando() {
  const [rodando, revisando, conceitos] = await Promise.all([
    sbJson("marketing_compositions?status=eq.running&select=id,status,anuncios"),
    sbJson(
      "marketing_compositions?status=eq.revisao&select=id,status,anuncios" +
        `&plano=cs.${encodeURIComponent('[{"status":"running"}]')}`
    ),
    // Na etapa de conceitos, só quem tinha chamada de agente em curso fica órfã — `orfas.js` decide
    // olhando os conceitos. As que esperam quem compõe decidir continuam esperando.
    sbJson("marketing_compositions?status=eq.conceitos&select=id,status,anuncios,conceitos,insumos_insuficientes"),
  ]);
  return [rodando, revisando, conceitos].flatMap((l) => (Array.isArray(l) ? l : []));
}

/** A orquestração que gerou esta composição, se houver. É ela que o "salvar" fecha junto. */
export async function getOrquestracaoDaComposicao(compositionId) {
  const rows = await sbJson(
    `marketing_orquestracoes?composition_id=eq.${encodeURIComponent(compositionId)}` +
      "&select=id,status,etapas&limit=1"
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function getComposition(id) {
  const rows = await sbJson(
    `marketing_compositions?id=eq.${encodeURIComponent(id)}&select=*&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function deleteComposition(id) {
  await sbFetch(`marketing_compositions?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

// ---------------------------------------------------------------------------------------------
// Marketing › Composer — Orquestrador (uma composição conduzida do começo ao fim)
// ---------------------------------------------------------------------------------------------

// A lista não carrega o diagnóstico nem o registro das perguntas: são os campos longos, e quem abre
// uma orquestração pede o resto em `getOrquestracao`.
const ORQUESTRACAO_LIST_COLS =
  "id,cliente,nome_exibicao,pedido,status,error,etapas,run_id,library_entry_id,composition_id," +
  "criado_por,criado_em,atualizado_em";

export async function insertOrquestracao(row) {
  const rows = await sbJson("marketing_orquestracoes", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!Array.isArray(rows) || !rows.length) throw new DbError("orquestracao insert returned no row");
  return rows[0];
}

export async function patchOrquestracao(id, patch) {
  await sbFetch(`marketing_orquestracoes?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...patch, atualizado_em: new Date().toISOString() }),
  });
}

export async function listOrquestracoes({ cliente, limit = 50 } = {}) {
  let path = `marketing_orquestracoes?select=${ORQUESTRACAO_LIST_COLS}&order=criado_em.desc&limit=${
    Number(limit) || 50
  }`;
  if (cliente) path += `&cliente=eq.${encodeURIComponent(cliente)}`;
  const rows = await sbJson(path);
  return Array.isArray(rows) ? rows : [];
}

/** As que estão `running`, só com o que a faxina do boot precisa (ver orfas.js). */
export async function listOrquestracoesRodando() {
  const rows = await sbJson("marketing_orquestracoes?status=eq.running&select=id,etapas");
  return Array.isArray(rows) ? rows : [];
}

export async function getOrquestracao(id) {
  const rows = await sbJson(
    `marketing_orquestracoes?id=eq.${encodeURIComponent(id)}&select=*&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function deleteOrquestracao(id) {
  await sbFetch(`marketing_orquestracoes?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

// ---------------------------------------------------------------------------------------------
// Marketing › Clientes — Relatório (diagnóstico de um período)
// ---------------------------------------------------------------------------------------------

// A lista é histórico: não carrega `snapshot` nem `relatorio_md`, que são os campos grandes. Quem
// abre um relatório pede o resto em `getReport`.
const REPORT_LIST_COLS =
  "id,cliente,nome_exibicao,titulo,periodo_de,periodo_ate,periodo_kind,periodo_label," +
  "comparacao_de,comparacao_ate,comparacao_regra,prioridade,avisos,fontes,status,error," +
  "criado_por,criado_em,atualizado_em";

export async function insertReport(row) {
  const rows = await sbJson("marketing_client_reports", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!Array.isArray(rows) || !rows.length) throw new DbError("report insert returned no row");
  return rows[0];
}

export async function patchReport(id, patch) {
  await sbFetch(`marketing_client_reports?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...patch, atualizado_em: new Date().toISOString() }),
  });
}

export async function listReports({ cliente, limit = 50 } = {}) {
  let path = `marketing_client_reports?select=${REPORT_LIST_COLS}&order=criado_em.desc&limit=${
    Number(limit) || 50
  }`;
  if (cliente) path += `&cliente=eq.${encodeURIComponent(cliente)}`;
  const rows = await sbJson(path);
  return Array.isArray(rows) ? rows : [];
}

export async function getReport(id) {
  const rows = await sbJson(
    `marketing_client_reports?id=eq.${encodeURIComponent(id)}&select=*&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function deleteReport(id) {
  await sbFetch(`marketing_client_reports?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------

export async function storageUpload(objectPath, bytes, mimeType, bucket = MEDIA_BUCKET) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`, {
    method: "POST",
    // x-upsert so a re-run over the same (run, ad) overwrites instead of 409-ing.
    headers: sbHeaders({ "Content-Type": mimeType, "x-upsert": "true" }),
    body: bytes,
  });
  if (!res.ok) {
    throw new DbError(
      `storage upload ${res.status}`,
      (await res.text().catch(() => "")).slice(0, 300)
    );
  }
  return objectPath;
}

export async function storageRemove(objectPath, bucket = MEDIA_BUCKET) {
  try {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`, {
      method: "DELETE",
      headers: sbHeaders(),
    });
  } catch {
    /* best effort — an orphaned object is not worth failing a run over */
  }
}

/**
 * Remove vários objetos numa chamada: `DELETE /storage/v1/object/{bucket}` com `{ prefixes }` —
 * exatamente o que o `.remove(paths)` do supabase-js faz (conferido no código instalado).
 *
 * Uma versão anterior usava `POST …/{bucket}/remove`, rota que não existe, e engolia o erro sem
 * olhar o status: apagar uma run removia as linhas e deixava TODAS as thumbnails órfãs no bucket,
 * em silêncio. Agora devolve se deu certo, para quem chama poder dizer a verdade.
 *
 * @returns {Promise<{ ok: boolean, removed: number, error?: string }>}
 */
export async function storageRemoveMany(paths, bucket = MEDIA_BUCKET) {
  const list = paths.filter(Boolean);
  if (!list.length) return { ok: true, removed: 0 };
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
      method: "DELETE",
      headers: sbHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: list }),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 200);
      return { ok: false, removed: 0, error: `storage ${res.status}: ${body}` };
    }
    const removed = await res.json().catch(() => []);
    return { ok: true, removed: Array.isArray(removed) ? removed.length : list.length };
  } catch (err) {
    // Continua best-effort para o deleteRun: arquivo órfão é melhor que run que não some.
    return { ok: false, removed: 0, error: String(err?.message || err) };
  }
}

/** Storage paths held by a run's ads, for cleanup before deleting the rows. */
export async function listRunMediaPaths(runId) {
  const rows = await sbJson(
    `ad_spy_ads?run_id=eq.${encodeURIComponent(runId)}&select=thumb_path,media_path,avatar_path`
  );
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r) => [r.thumb_path, r.media_path, r.avatar_path]).filter(Boolean);
}

/**
 * Delete a run and everything under it.
 *
 * `ad_spy_ads` goes with it through `on delete cascade`, but Storage does NOT — objects there have
 * no foreign key, so they must be removed explicitly or the bucket accumulates thumbnails nobody
 * can reach. Storage cleanup is best-effort on purpose: an orphaned file is a much smaller problem
 * than a run the user cannot delete.
 */
export async function deleteRun(runId) {
  // A Biblioteca guarda snapshot dos anúncios, mas as thumbnails continuam no bucket sob o
  // caminho da run. Apagar a mídia aqui deixaria a Biblioteca com cards sem imagem.
  const keepMedia = await isRunInLibrary(runId).catch(() => true);
  const paths = keepMedia ? [] : await listRunMediaPaths(runId).catch(() => []);
  const storage = await storageRemoveMany(paths);
  await sbFetch(`ad_spy_runs?id=eq.${encodeURIComponent(runId)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  return { files: paths.length, keptForLibrary: keepMedia, storage };
}

export async function storageDownload(objectPath, bucket = MEDIA_BUCKET) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`, {
    headers: sbHeaders(),
  });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------------------------
// Documentos do ClickUp (Marketing › Central de Clientes + insumo do Composer)
//
// Apêndado no FIM do arquivo de propósito: havia outra frente editando este `db.js` ao mesmo tempo,
// e apêndice em EOF é a edição que menos conflita. A alternativa — duplicar a camada HTTP do
// Supabase num arquivo meu — seria pior: dois lugares com header de auth e tratamento de erro.
// ---------------------------------------------------------------------------------------------

// A leitura por Doc saiu daqui em 02/10/2026. `listClientDocs` e `getClientDoc` serviam a aba e o
// preview quando a unidade era o Doc, e `getClientDoc` era o único leitor de
// `marketing_client_docs.conteudo_md` — a coluna que guardava as páginas CONCATENADAS e que num
// Doc coletivo é o texto de dezenas de clientes num campo só. Apagar as duas é o que torna
// verdadeira a afirmação de que aquela coluna está morta: `listClientDocPages` e `getDocPage`
// (no fim deste arquivo) são as substitutas, por página.

/**
 * O estado atual da tabela, só o necessário para decidir o que rebaixar.
 *
 * Não traz `conteudo_md`: o sync precisa comparar DATAS, e carregar o markdown de centenas de
 * documentos para depois descartá-lo seria o jeito mais caro possível de não fazer nada.
 */
export async function readDocsSyncState() {
  const rows = await sbJson(
    "marketing_client_docs?select=doc_id,atualizado_em_clickup,conteudo_lido_em,estrutura_lida_em,tipo"
  );
  return Array.isArray(rows) ? rows : [];
}

/**
 * Upsert em lote por `doc_id`. `merge-duplicates` = só as chaves presentes no payload mudam.
 *
 * **Agrupa por conjunto de chaves antes de enviar, e isso não é otimização.** O PostgREST recusa com
 * 400 um insert em lote cujos objetos não tenham TODAS as mesmas chaves. O sync depende de mandar
 * chaves diferentes por linha — quem foi rebaixado leva `conteudo_md`/`conteudo_chars`/
 * `conteudo_lido_em`, quem não foi OMITE essas chaves, porque em `merge-duplicates` chave ausente
 * preserva o valor e chave com `null` o apaga. Num POST único os dois formatos convivem no mesmo
 * array e o PostgREST rejeita o lote inteiro: foi o `supabase POST marketing_client_docs -> 400` da
 * primeira execução real, que não gravou NENHUMA das 117 linhas.
 *
 * `?columns=` resolveria a heterogeneidade, mas pelo caminho errado: ele trata chave ausente como
 * `null`, que é exatamente o apagamento que o desenho existe para evitar.
 */
export async function upsertClientDocs(rows) {
  if (!rows.length) return 0;

  const grupos = new Map();
  for (const row of rows) {
    const assinatura = Object.keys(row).sort().join("|");
    if (!grupos.has(assinatura)) grupos.set(assinatura, []);
    grupos.get(assinatura).push(row);
  }

  for (const lote of grupos.values()) {
    await sbJson("marketing_client_docs?on_conflict=doc_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(lote),
    });
  }
  return rows.length;
}

/**
 * Apaga as linhas que esta execução do sync não tocou — marca-e-varre.
 *
 * Sem isso, documento apagado no ClickUp continuaria na aba para sempre e, pior, continuaria
 * disponível como insumo do Composer. O sync escreve `sincronizado_em = now()` em tudo que viu;
 * o que ficou com data anterior ao início da execução é o que desapareceu do ClickUp.
 *
 * Marca-e-varre em vez de `doc_id=not.in.(...)` com a lista do que existe: aquela URL cresce com a
 * quantidade de documentos (centenas de ids estouram o limite do servidor) e as vírgulas
 * separadoras não sobrevivem ao escape do valor. Aqui a URL tem tamanho fixo.
 *
 * Quem chama é responsável por NÃO varrer depois de uma varredura suspeita (ver `docs-sync.js`):
 * um sync que falhou no meio não pode apagar a tabela.
 */
export async function deleteDocsNaoVistos(desdeIso) {
  const res = await sbFetch(
    `marketing_client_docs?sincronizado_em=lt.${encodeURIComponent(desdeIso)}`,
    { method: "DELETE", headers: { Prefer: "count=exact,return=minimal" } }
  );
  const faixa = res.headers.get("content-range") || "";
  const n = Number(faixa.split("/")[1]);
  return Number.isFinite(n) ? n : 0;
}

/** A resolução de pai já conhecida, indexada por id. Cache permanente: resolver custa requisição. */
export async function readClickupParents() {
  const rows = await sbJson("marketing_clickup_parents?select=parent_id,kind,nome,cadeia");
  return new Map((Array.isArray(rows) ? rows : []).map((r) => [String(r.parent_id), r]));
}

export async function upsertClickupParents(rows) {
  if (!rows.length) return 0;
  await sbJson("marketing_clickup_parents?on_conflict=parent_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  return rows.length;
}

// ---------------------------------------------------------------------------------------------
// PÁGINAS de Doc do ClickUp — a unidade de atribuição desde 02/10/2026.
//
// O documento de um cliente neste workspace é uma PÁGINA dentro de um Doc coletivo, então é a
// página que a aba lista, que o preview abre e que o Composer recebe como insumo. Ver o cabeçalho
// da migração 20261002 para o porquê, inclusive o vazamento que o conteúdo concatenado abria.
// ---------------------------------------------------------------------------------------------

/**
 * Colunas da aba: tudo menos o conteúdo, que é grande e só o preview e o Composer pedem.
 *
 * O Doc vem embutido (`doc:...`) porque a tela precisa do nome dele para agrupar — "Mapeamento do
 * Cliente › Ativo › Mapeamento - Dra. Amanda Duarte" só faz sentido inteiro. O embed depende da FK
 * `doc_id -> marketing_client_docs`, criada na mesma migração.
 */
export const DOC_PAGE_LIST_COLS =
  "page_id,doc_id,pagina_pai_id,nome,caminho,ordem,cliente,atribuido_via,tipo," +
  "conteudo_chars,conteudo_lido_em,atualizado_em_clickup," +
  "doc:marketing_client_docs(nome,url,local,arquivado,publico,criado_em_clickup)";

/** As páginas de um cliente: editadas mais recentemente primeiro, e na ordem do Doc dentro dele. */
export async function listClientDocPages(cliente) {
  const rows = await sbJson(
    `marketing_client_doc_pages?select=${DOC_PAGE_LIST_COLS}` +
      `&cliente=eq.${encodeURIComponent(cliente)}` +
      "&order=atualizado_em_clickup.desc,doc_id.asc,ordem.asc"
  );
  return Array.isArray(rows) ? rows : [];
}

/**
 * As páginas de UM Doc, com o conteúdo: é de onde saem as subpáginas de uma página escolhida (uma
 * página com subpáginas é um documento só — ver `conteudoDoDocumento`).
 */
export async function listPaginasDoDoc(docId) {
  const rows = await sbJson(
    "marketing_client_doc_pages?select=page_id,doc_id,pagina_pai_id,nome,ordem,cliente,tipo," +
      `conteudo_md,conteudo_lido_em&doc_id=eq.${encodeURIComponent(docId)}&order=ordem.asc`
  );
  return Array.isArray(rows) ? rows : [];
}

/** Uma página COM o conteúdo. É o que serve o preview e o prompt do Composer. */
export async function getDocPage(pageId) {
  const rows = await sbJson(
    `marketing_client_doc_pages?select=*&page_id=eq.${encodeURIComponent(pageId)}&limit=1`
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/**
 * A estrutura de páginas já conhecida, sem conteúdo.
 *
 * É o que permite o sync **reatribuir** todas as páginas a cada execução sem reenumerar o
 * workspace: a atribuição é pura e depende de título, caminho e da carteira de clientes — e a
 * carteira muda (cliente novo entra, cliente sai). Reenumerar é uma chamada por Doc; reler esta
 * tabela é uma consulta. Sem isso, um cliente novo só ganharia seus documentos quando o ClickUp
 * por coincidência marcasse os Docs como editados.
 */
export async function readDocPagesState() {
  const rows = await sbJson(
    "marketing_client_doc_pages?select=page_id,doc_id,pagina_pai_id,nome,caminho,ordem,cliente,tipo,conteudo_lido_em"
  );
  return Array.isArray(rows) ? rows : [];
}

/**
 * Upsert em lote por `page_id`, agrupando por conjunto de chaves antes de enviar.
 *
 * O agrupamento não é otimização: o PostgREST recusa com 400 um insert em lote cujos objetos não
 * tenham TODAS as mesmas chaves, e o sync depende de mandar chaves diferentes por linha — página
 * cujo corpo foi rebaixado leva `conteudo_md`, página que não foi OMITE a chave, porque em
 * `merge-duplicates` chave ausente preserva o valor e chave com `null` o apaga. É a mesma armadilha
 * que já derrubou o POST de `marketing_client_docs` na primeira execução real, e aqui ela é pior:
 * apagar `conteudo_md` de todas as páginas inutilizaria o insumo do Composer em silêncio.
 */
export async function upsertDocPages(rows) {
  if (!rows.length) return 0;

  const grupos = new Map();
  for (const row of rows) {
    const assinatura = Object.keys(row).sort().join("|");
    if (!grupos.has(assinatura)) grupos.set(assinatura, []);
    grupos.get(assinatura).push(row);
  }

  for (const lote of grupos.values()) {
    await sbJson("marketing_client_doc_pages?on_conflict=page_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(lote),
    });
  }
  return rows.length;
}

/**
 * Apaga as páginas que esta execução não tocou — marca-e-varre, igual aos Docs.
 *
 * Pega dois casos: página apagada dentro de um Doc que continua existindo, e a linha sintética
 * `doc:<doc_id>` que o sync grava quando a enumeração falha (ela deixa de ser vista no sync em que
 * a enumeração volta a funcionar). Doc apagado inteiro não precisa daqui: a FK cascateia.
 *
 * Quem chama é responsável por NÃO varrer depois de uma leitura duvidosa — mesma guarda de
 * `deleteDocsNaoVistos`.
 */
export async function deleteDocPagesNaoVistas(desdeIso) {
  const res = await sbFetch(
    `marketing_client_doc_pages?sincronizado_em=lt.${encodeURIComponent(desdeIso)}`,
    { method: "DELETE", headers: { Prefer: "count=exact,return=minimal" } }
  );
  const faixa = res.headers.get("content-range") || "";
  const n = Number(faixa.split("/")[1]);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------------------------
// Controle de qualidade — voto (por pessoa) e tag (do item) de análises e composições
// ---------------------------------------------------------------------------------------------

/**
 * Votos e tags de TODOS os itens de um tipo, agregados por id.
 *
 * Lê tudo do tipo em vez de filtrar por uma lista de ids, e isso é escolha: `alvo_id=in.(...)` com
 * uma página de composições põe dezenas de uuids na URL (que tem limite) e o filtro precisaria ser
 * refeito a cada paginação. As duas tabelas têm uma linha por voto e uma por item — centenas, não
 * milhões —, então trazer tudo e cruzar em memória é mais barato e muito mais simples. Se um dia
 * passar de alguns milhares, vira uma view agregada.
 */
export async function readAvaliacoes(alvoTipo, userId) {
  const tipo = encodeURIComponent(alvoTipo);
  const [votos, tags] = await Promise.all([
    sbJson(`marketing_votos?select=alvo_id,user_id,voto&alvo_tipo=eq.${tipo}`).catch(() => []),
    sbJson(`marketing_tags?select=alvo_id,tag,definida_por,definida_em&alvo_tipo=eq.${tipo}`).catch(
      () => []
    ),
  ]);

  const itens = {};
  const de = (id) =>
    (itens[id] ??= { positivos: 0, negativos: 0, saldo: 0, meuVoto: null, tag: null });

  for (const v of Array.isArray(votos) ? votos : []) {
    const alvo = de(String(v.alvo_id));
    if (Number(v.voto) === 1) alvo.positivos += 1;
    else alvo.negativos += 1;
    alvo.saldo = alvo.positivos - alvo.negativos;
    // `meuVoto` é o que faz o botão aparecer marcado: sem ele a pessoa não sabe se já votou e vota
    // de novo achando que não contou.
    if (userId && String(v.user_id) === String(userId)) alvo.meuVoto = Number(v.voto) === 1 ? 1 : -1;
  }
  for (const t of Array.isArray(tags) ? tags : []) {
    de(String(t.alvo_id)).tag = t.tag ?? null;
  }
  return itens;
}

/** `voto` 1 ou -1 grava; `null` apaga a linha (é o toggle de clicar no mesmo botão de novo). */
export async function setVoto(alvoTipo, alvoId, userId, voto) {
  if (voto === null) {
    await sbFetch(
      `marketing_votos?alvo_tipo=eq.${encodeURIComponent(alvoTipo)}` +
        `&alvo_id=eq.${encodeURIComponent(alvoId)}&user_id=eq.${encodeURIComponent(userId)}`,
      { method: "DELETE", headers: { Prefer: "return=minimal" } }
    );
    return;
  }
  await sbFetch("marketing_votos?on_conflict=alvo_tipo,alvo_id,user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([
      { alvo_tipo: alvoTipo, alvo_id: String(alvoId), user_id: userId, voto },
    ]),
  });
}

/** `tag` null LIMPA. Trocar é sobrescrever: a PK é (alvo_tipo, alvo_id), uma tag por item. */
export async function setTag(alvoTipo, alvoId, tag, userId) {
  if (tag === null) {
    await sbFetch(
      `marketing_tags?alvo_tipo=eq.${encodeURIComponent(alvoTipo)}` +
        `&alvo_id=eq.${encodeURIComponent(alvoId)}`,
      { method: "DELETE", headers: { Prefer: "return=minimal" } }
    );
    return;
  }
  await sbFetch("marketing_tags?on_conflict=alvo_tipo,alvo_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([
      {
        alvo_tipo: alvoTipo,
        alvo_id: String(alvoId),
        tag,
        definida_por: userId,
        definida_em: new Date().toISOString(),
      },
    ]),
  });
}

/**
 * Apaga voto e tag de um item. Chamado junto da exclusão do artefato.
 *
 * É o que compensa a falta de FK no desenho polimórfico (ver a migração): sem isto, apagar uma
 * análise deixaria votos órfãos, e um id reaproveitado herdaria a avaliação de outro item.
 * Best-effort de propósito — falhar aqui não pode impedir a exclusão do artefato em si.
 */
export async function deleteAvaliacoes(alvoTipo, alvoId) {
  const filtro =
    `alvo_tipo=eq.${encodeURIComponent(alvoTipo)}&alvo_id=eq.${encodeURIComponent(alvoId)}`;
  await Promise.all([
    sbFetch(`marketing_votos?${filtro}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    }).catch(() => {}),
    sbFetch(`marketing_tags?${filtro}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    }).catch(() => {}),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Análises de Criativos (Mineração) — a dissecação de UM anúncio, salva por especialidade.
// Mesmo desenho da Biblioteca: lista da equipe, estrela de cada um. Ver criativo.js.
// ---------------------------------------------------------------------------------------------

const CRIATIVO_LIST_COLS =
  "id,run_id,library_entry_id,ad_id,titulo,especialidades,status,etapa,error,dissecacao,saved_by," +
  "saved_by_name,criado_em,atualizado_em,ad,origem,cliente,meta_ad_id";

export async function insertCriativo(row) {
  const rows = await sbJson("ad_spy_criativos", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!Array.isArray(rows) || !rows.length) throw new DbError("criativo insert returned no row");
  return rows[0];
}

export async function patchCriativo(id, patch) {
  await sbFetch(`ad_spy_criativos?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...patch, atualizado_em: new Date().toISOString() }),
  });
}

export async function getCriativo(id) {
  const rows = await sbJson(`ad_spy_criativos?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/** Lista, opcionalmente filtrando por especialidade (sobreposição de arrays), como `listLibrary`. */
export async function listCriativos({ especialidades = [], origem = null, cliente = null, limit = 200 } = {}) {
  let p = `ad_spy_criativos?select=${CRIATIVO_LIST_COLS}&order=criado_em.desc&limit=${Number(limit) || 200}`;
  if (origem) p += `&origem=eq.${encodeURIComponent(origem)}`;
  if (cliente) p += `&cliente=eq.${encodeURIComponent(cliente)}`;
  const esp = especialidades.filter(Boolean);
  if (esp.length) {
    const list = esp.map((e) => `"${String(e).replace(/"/g, "")}"`).join(",");
    p += `&especialidades=ov.{${encodeURIComponent(list)}}`;
  }
  const rows = await sbJson(p);
  return Array.isArray(rows) ? rows : [];
}

/** Análises de criativo que ficaram "rodando" — sobras de um reinício, para fechar no boot. */
export async function listCriativosRodando() {
  const rows = await sbJson("ad_spy_criativos?status=eq.running&select=id");
  return Array.isArray(rows) ? rows : [];
}

export async function deleteCriativo(id) {
  await sbFetch(`ad_spy_criativos?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

export async function listFavoritosCriativos(userId) {
  const rows = await sbJson(
    `ad_spy_criativos_favoritos?user_id=eq.${encodeURIComponent(userId)}&select=criativo_id`
  );
  return new Set(Array.isArray(rows) ? rows.map((r) => r.criativo_id) : []);
}

export async function setFavoritoCriativo(criativoId, userId, favorito) {
  if (favorito) {
    await sbFetch("ad_spy_criativos_favoritos?on_conflict=criativo_id,user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ criativo_id: criativoId, user_id: userId }]),
    });
    return;
  }
  await sbFetch(
    `ad_spy_criativos_favoritos?criativo_id=eq.${encodeURIComponent(criativoId)}` +
      `&user_id=eq.${encodeURIComponent(userId)}`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } }
  );
}

/** A análise de um criativo INTERNO já pedida (rodando ou pronta) — uma por anúncio. */
export async function getCriativoInterno(metaAdId) {
  const rows = await sbJson(
    `ad_spy_criativos?origem=eq.cliente&meta_ad_id=eq.${encodeURIComponent(metaAdId)}` +
      "&status=in.(running,done)&select=id,status&order=criado_em.desc&limit=1"
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * O criativo do cliente, da conta de anúncios ("Criativos Meta Ads", uma linha por anúncio por
 * dia): a linha mais recente que tenha VÍDEO — o arquivo guardado (`Video_URL`) ou o link do post
 * (`Video_Permalink`) —; sem nenhuma, a mais recente.
 *
 * O filtro de vídeo vai na consulta, e não depois dela: antes eram as 60 linhas mais recentes e a
 * procura acontecia nelas, e um anúncio no ar há mais tempo, cujo vídeo só aparecia em linhas mais
 * antigas, saía como "sem vídeo" — enquanto a tela, que olha o período todo, tocava o vídeo
 * (VID 005 do Dr. Aurelio, 19/10/2026).
 */
export async function readCriativoMetaAd(metaAdId) {
  const base =
    `${encodeURIComponent("Criativos Meta Ads")}?Ad_ID=eq.${encodeURIComponent(metaAdId)}` +
    "&select=Ad_ID,Client,Nome_Anuncio,Headline,Thumbnail_URL,Media_URL,Video_URL,Video_Permalink," +
    "Ad_Criado_Em,Dia&order=Dia.desc&limit=1";
  const comVideo = await sbJson(`${base}&or=(Video_URL.not.is.null,Video_Permalink.not.is.null)`);
  if (Array.isArray(comVideo) && comVideo.length) return comVideo[0];
  const qualquer = await sbJson(base);
  return Array.isArray(qualquer) && qualquer.length ? qualquer[0] : null;
}

// ---------------------------------------------------------------------------------------------
// Marketing › Central de Clientes › Brand kit (27/10/2026)
// ---------------------------------------------------------------------------------------------

const BRAND_KIT_COLS =
  "cliente,nome_clinica,paleta,fontes,contatos,enderecos,identificacao,bio_conferida,imagens," +
  "atualizado_em,atualizado_por";

export async function getBrandKit(cliente) {
  const rows = await sbJson(
    `marketing_brand_kits?cliente=eq.${encodeURIComponent(cliente)}&select=${BRAND_KIT_COLS}&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * Grava o kit inteiro, MENOS as imagens: elas só mudam pelo upload (`patchBrandKitImagens`). Um
 * salvar da tela que levasse `imagens` desfaria um upload feito noutra aba no meio-tempo.
 */
export async function upsertBrandKit(kit, userId) {
  const { imagens: _imagens, ...resto } = kit;
  await sbFetch("marketing_brand_kits?on_conflict=cliente", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ ...resto, atualizado_em: new Date().toISOString(), atualizado_por: userId }]),
  });
}

/** Troca UM caminho de imagem (ou o apaga, com null), criando a linha do kit se ainda não houver. */
export async function patchBrandKitImagens(cliente, tipo, caminho, userId) {
  const atual = await getBrandKit(cliente);
  const imagens = { ...(atual?.imagens || {}), [tipo]: caminho };
  await sbFetch("marketing_brand_kits?on_conflict=cliente", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([
      { cliente, imagens, atualizado_em: new Date().toISOString(), atualizado_por: userId },
    ]),
  });
  return imagens;
}

/**
 * A identificação que o Estudo de Copy deu na composição mais recente deste cliente
 * (`catalogo_copy.identificacao`). É a sugestão do "preencher a partir do Estudo" do Brand kit —
 * sem reler o ClickUp, que pode levar um minuto num Estudo dividido em subpáginas.
 */
export async function getIdentificacaoDoEstudo(cliente) {
  const rows = await sbJson(
    `marketing_compositions?cliente=eq.${encodeURIComponent(cliente)}&catalogo_copy=not.is.null` +
      "&select=catalogo_copy,criado_em&order=criado_em.desc&limit=1"
  );
  const linha = Array.isArray(rows) && rows.length ? rows[0] : null;
  const id = linha?.catalogo_copy?.identificacao;
  return id ? { ...id, de: linha.criado_em } : null;
}

// ---------------------------------------------------------------------------------------------
// Marketing › Composer › Estático — artes (27/10/2026)
// ---------------------------------------------------------------------------------------------

export async function insertArte(row) {
  const rows = await sbJson("marketing_artes", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!Array.isArray(rows) || !rows.length) throw new DbError("arte insert returned no row");
  return rows[0];
}

export async function patchArte(id, patch) {
  await sbFetch(`marketing_artes?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...patch, atualizado_em: new Date().toISOString() }),
  });
}

export async function getArte(id) {
  const rows = await sbJson(`marketing_artes?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/** As artes de um anúncio (ou de uma composição inteira, sem `indice`), mais recentes primeiro. */
export async function listArtes({ compositionId = null, indice = null, cliente = null, limit = 50 } = {}) {
  let path = `marketing_artes?select=*&order=criado_em.desc&limit=${Number(limit) || 50}`;
  if (compositionId) path += `&composition_id=eq.${encodeURIComponent(compositionId)}`;
  if (Number.isInteger(indice)) path += `&anuncio_indice=eq.${indice}`;
  if (cliente) path += `&cliente=eq.${encodeURIComponent(cliente)}`;
  const rows = await sbJson(path);
  return Array.isArray(rows) ? rows : [];
}

export async function deleteArte(id) {
  await sbFetch(`marketing_artes?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

/** As que ficaram `running` de uma vida anterior do worker: ninguém mais vai fechá-las. */
export async function fecharArtesOrfas(motivo) {
  await sbFetch("marketing_artes?status=eq.running", {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "error", error: motivo, atualizado_em: new Date().toISOString() }),
  });
}
