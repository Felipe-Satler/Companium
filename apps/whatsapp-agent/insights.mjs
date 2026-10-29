// whatsapp-agent-insights — ACOMPANHAMENTO dos grupos do agente de WhatsApp.
// Para cada grupo conhecido/liberado da conta, lê as conversas recentes pelo OpenClaw,
// pede ao modelo (pela CONEXÃO DE CONTA OpenClaw, via gateway, SEM API paga) uma análise de:
//   - sentimento da conversa (positivo/neutro/negativo/misto)
//   - andamento do atendimento (sem_atividade/aguardando/em_andamento/resolvido)
//   - resumo curto + pontos de atenção
// e grava um snapshot por grupo em `whatsapp_group_insights` (service_role, bypassa RLS).
//
// DESENHO (espelha whatsapp-agent/sync.mjs e meta-ads-bot/analysis.ts):
//   * DRY-RUN por padrão. Só grava com `--apply`.
//   * Model-invoke idêntico ao job de Análise IA do Meta Ads:
//       openclaw capability model run --gateway --json --prompt "<SYSTEM + conversa>"
//     -> stdout é um envelope { ok, provider, model, outputs:[{text}] }; a resposta do
//        modelo está em outputs[0].text (e dentro dela, um JSON com a análise).
//   * Supabase com SUPABASE_URL + SUPABASE_SERVICE_KEY de /etc/companium-supabase.env.
//
// ⚠️ 1ª ATIVAÇÃO: o comando que LISTA mensagens de um grupo do WhatsApp depende do plugin e
//    ainda não pôde ser validado (canal não conectado). O default abaixo é tolerante: se a
//    listagem falhar/!JSON, o grupo é PULADO (não grava nada — não apaga dado bom). Ajuste
//    WHATSAPP_HISTORY_SUBCMD (ou buildHistoryArgs) conforme `openclaw channels capabilities
//    --channel whatsapp` no 1º uso, e remova este aviso. Ver WHATSAPP_AGENT.md.

import { createClient } from '@supabase/supabase-js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile } from 'node:fs/promises';

const execFileP = promisify(execFile);

const APPLY = process.argv.includes('--apply');
const ACCOUNT_ID = (process.env.WHATSAPP_ACCOUNT_ID || 'whatsapp-groobot').trim();
const AGENT_ID = (process.env.WHATSAPP_AGENT_ID || 'whatsappagent').trim();
const SESSIONS_DIR =
  process.env.WHATSAPP_SESSIONS_DIR || `/home/deploy/.openclaw/agents/${AGENT_ID}/sessions`;
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || 'openclaw';
const MODEL = (process.env.WHATSAPP_ANALYSIS_MODEL || '').trim(); // vazio = conexão padrão do gateway
const MODEL_LABEL = MODEL || 'conta-openclaw';
const HISTORY_LIMIT = Number(process.env.WHATSAPP_HISTORY_LIMIT || 200);
const WINDOW_HOURS = Number(process.env.WHATSAPP_WINDOW_HOURS || 48);
const LLM_TIMEOUT_MS = Number(process.env.WHATSAPP_LLM_TIMEOUT_MS || 150000);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[wa-insights] faltam SUPABASE_URL/SUPABASE_SERVICE_KEY no ambiente.');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const log = (...a) => console.log(`[wa-insights]${APPLY ? '' : ' [dry-run]'}`, ...a);

async function oc(args, { tolerate = false } = {}) {
  try {
    const { stdout } = await execFileP(OPENCLAW_BIN, args, {
      timeout: LLM_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
    });
    return stdout;
  } catch (e) {
    if (tolerate) return null;
    throw e;
  }
}

// Primeiro objeto {...} balanceado de uma string (igual ao extractJsonObject do analysis.ts).
function extractJsonObject(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Alvos: grupos em que o agente de WhatsApp JÁ conversou, descobertos pelas SESSÕES do
// gateway. O plugin do WhatsApp não expõe listagem de grupos/mensagens (directory só tem
// groups/peers/self, e groups list vem vazio no WhatsApp Web), então a fonte confiável é a
// sessão do agente: a chave traz `...:whatsapp:group:<group_id>:thread:...` e o sessionId
// aponta o arquivo de trajetória com a conversa real (user/assistant). Fallback: known_groups/allowlist.
// ---------------------------------------------------------------------------
function parseGroupIdFromKey(key) {
  const m = /:group:(.+?):thread:/.exec(key) || /:group:(.+)$/.exec(key);
  return m ? m[1] : null;
}

async function listGroupSessions() {
  const out = await oc(['sessions', '--agent', AGENT_ID, '--json', '--limit', 'all'], { tolerate: true });
  if (!out) return [];
  let parsed;
  try { parsed = JSON.parse(out); } catch { return []; }
  const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
  const groups = [];
  for (const s of sessions) {
    if (s.kind !== 'group') continue;
    const gid = parseGroupIdFromKey(String(s.key || ''));
    if (!gid) continue;
    groups.push({ group_id: gid, sessionId: s.sessionId, updatedAt: s.updatedAt || 0 });
  }
  return groups;
}

// Lê o arquivo de eventos da sessão e devolve { messages, groupName }. O arquivo é
// `<sessionId>-topic-*.jsonl` (o `.trajectory.jsonl` é outro formato, ignorado).
async function readSessionTrajectory(sessionId) {
  if (!sessionId) return { messages: [], groupName: null };
  let files = [];
  try { files = await readdir(SESSIONS_DIR); } catch { return { messages: [], groupName: null }; }
  const file = files.find(
    (f) => f.startsWith(sessionId) && f.endsWith('.jsonl') && !f.includes('.trajectory'),
  );
  if (!file) return { messages: [], groupName: null };
  let raw;
  try { raw = await readFile(`${SESSIONS_DIR}/${file}`, 'utf8'); } catch { return { messages: [], groupName: null }; }
  const messages = [];
  let groupName = null;
  let lastSender = null;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let rec;
    try { rec = JSON.parse(t); } catch { continue; }
    // Metadados: nome do grupo (group_subject) + remetente da próxima mensagem do cliente.
    const content = typeof rec.content === 'string' ? rec.content : '';
    if (content.includes('Conversation info')) {
      const meta = extractJsonObject(content);
      if (meta) {
        if (meta.group_subject) groupName = String(meta.group_subject);
        if (meta.sender) lastSender = String(meta.sender);
      }
      continue;
    }
    if (rec.type !== 'message') continue;
    const msg = rec.message || {};
    const role = msg.role;
    if (role !== 'user' && role !== 'assistant') continue;
    let text = msg.content;
    if (Array.isArray(text)) {
      text = text.map((p) => (p && typeof p === 'object' ? p.text || '' : String(p))).join(' ');
    }
    text = String(text || '').trim();
    const ts = Date.parse(rec.timestamp || msg.timestamp || '') || null;
    const fromMe = role === 'assistant';
    messages.push({ from: fromMe ? '[agente]' : lastSender || 'cliente', text, ts, fromMe });
  }
  return { messages, groupName };
}

async function resolveTargets() {
  // 1) Primário: grupos vindos das sessões do agente (trazem a conversa real).
  const fromSessions = await listGroupSessions();
  const byId = new Map();
  for (const g of fromSessions) {
    const prev = byId.get(g.group_id);
    if (!prev || g.updatedAt > prev.updatedAt) byId.set(g.group_id, g);
  }
  if (byId.size) {
    return [...byId.values()].map((g) => ({ id: g.group_id, name: null, sessionId: g.sessionId }));
  }
  // 2) Fallback: grupos conhecidos (descobertos antes) ou allowlist manual — sem sessão
  //    local para ler, então só serão analisados se já tiverem histórico acessível (hoje: pulados).
  const { data: known } = await sb
    .from('whatsapp_known_groups')
    .select('group_id, group_name')
    .eq('account_id', ACCOUNT_ID);
  if (Array.isArray(known) && known.length) {
    return known.map((g) => ({ id: g.group_id, name: g.group_name || g.group_id, sessionId: null }));
  }
  const { data: cfg } = await sb
    .from('whatsapp_group_agents')
    .select('group_allowlist')
    .eq('account_id', ACCOUNT_ID)
    .maybeSingle();
  const allow = Array.isArray(cfg?.group_allowlist) ? cfg.group_allowlist : [];
  return allow.filter((g) => g?.id).map((g) => ({ id: g.id, name: g.name || g.id, sessionId: null }));
}

// Lê e normaliza as mensagens recentes de um grupo a partir da trajetória da sessão.
// Também preenche target.name com o nome do grupo (group_subject) quando disponível.
// Tolerante: null se não há sessão local (pular); [] se não houve mensagem na janela.
async function fetchMessages(target) {
  if (!target.sessionId) return null;
  const { messages, groupName } = await readSessionTrajectory(target.sessionId);
  if (groupName && !target.name) target.name = groupName;
  const cutoff = Date.now() - WINDOW_HOURS * 3600 * 1000;
  return messages
    .filter((m) => m.text || m.fromMe)
    .filter((m) => m.ts == null || m.ts >= cutoff)
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

const SYSTEM = `Você é um analista de atendimento da agência Groohub. Recebe o histórico recente de
um GRUPO de WhatsApp e avalia, de forma objetiva, o andamento do atendimento, o clima da conversa,
a TEMPERATURA do lead (quão quente/promissor está) e o POTENCIAL DE RESULTADO.
Responda SOMENTE com um objeto JSON (sem texto fora dele), no formato:
{
  "sentimento": "positivo" | "neutro" | "negativo" | "misto",
  "indice_sentimento": number,            // -1.0 (muito negativo) a 1.0 (muito positivo)
  "andamento_atendimento": "aguardando" | "em_andamento" | "resolvido",
  "temperatura": "quente" | "morno" | "frio",   // engajamento/intenção do cliente
  "resultado_score": number,              // 0 a 100: potencial de gerar resultado (venda/avanço)
  "aguardando_resposta": boolean,         // true se o cliente está esperando um retorno nosso
  "intro_resumo": string,                 // 1 frase: como a conversa começou / o que o cliente pediu
  "resumo": string,                        // 1 a 3 frases, português do Brasil
  "pontos_atencao": [ { "tipo": string, "texto": string } ]  // 0 a 4 itens; vazio se não houver
}
Regras: baseie-se só no que está no histórico; não invente. "aguardando" = cliente esperando
resposta; "em_andamento" = conversa ativa sem conclusão; "resolvido" = demanda atendida/encerrada.
"quente" = cliente engajado, respondendo rápido, com intenção clara; "morno" = interesse parcial/lento;
"frio" = pouco/sem engajamento ou conversa parada. resultado_score alto = perto de fechar/avançar.`;

function buildUserPrompt(group, messages) {
  const linhas = messages
    .map((m) => `${m.fromMe ? '[agente]' : `[${m.from}]`} ${m.text}`)
    .join('\n')
    .slice(0, 12000); // teto de contexto
  return `Grupo: ${group.name}\nMensagens (${messages.length}, últimas ${WINDOW_HOURS}h):\n${linhas}`;
}

async function analyze(group, messages) {
  const prompt = `${SYSTEM}\n\n====================\n${buildUserPrompt(group, messages)}`;
  const args = ['capability', 'model', 'run', '--gateway', '--json', '--prompt', prompt];
  if (MODEL) args.push('--model', MODEL);
  const stdout = await oc(args, { tolerate: true });
  if (!stdout) return null;
  const env = extractJsonObject(stdout);
  if (!env || env.ok === false) return null;
  const text = env?.outputs?.[0]?.text ?? '';
  const ans = extractJsonObject(text);
  if (!ans) return null;
  const label = [env.provider, env.model].filter(Boolean).join('/') || MODEL_LABEL;
  return { ans, label };
}

const SENTIMENTS = new Set(['positivo', 'neutro', 'negativo', 'misto']);
const STATUSES = new Set(['aguardando', 'em_andamento', 'resolvido']);
const TEMPERATURES = new Set(['quente', 'morno', 'frio']);

// Colunas de engajamento (migration 20261026c). Se ainda não aplicada, o upsert cai no
// subconjunto base — o job nunca quebra por causa da expansão.
const ENGAGEMENT_COLS = [
  'lead_temperature',
  'result_score',
  'awaiting_reply',
  'agent_reply_count',
  'client_message_count',
  'first_contact_at',
  'intro_summary',
];

async function upsertInsight(row) {
  let { error } = await sb
    .from('whatsapp_group_insights')
    .upsert(row, { onConflict: 'account_id,group_id' });
  if (error && /column|schema cache|does not exist/i.test(error.message || '')) {
    // Migration de engajamento ainda não rodou: grava só as colunas base.
    const base = { ...row };
    for (const c of ENGAGEMENT_COLS) delete base[c];
    ({ error } = await sb
      .from('whatsapp_group_insights')
      .upsert(base, { onConflict: 'account_id,group_id' }));
    if (!error) log('aviso: colunas de engajamento ausentes (rode a migration 20261026c); gravei só o básico.');
  }
  return error;
}

async function run() {
  log(`conta=${ACCOUNT_ID} modelo=${MODEL || '(conexão padrão)'} janela=${WINDOW_HOURS}h`);
  const targets = await resolveTargets();
  log(`grupos-alvo: ${targets.length}`);
  if (!targets.length) {
    log('nenhum grupo conhecido/liberado ainda; nada a analisar.');
    return;
  }

  let written = 0;
  let skipped = 0;
  for (const g of targets) {
    const messages = await fetchMessages(g);
    const label = g.name || g.id;
    if (messages == null) {
      log(`grupo ${label}: sem sessão local p/ ler histórico — pulado.`);
      skipped++;
      continue;
    }
    if (!messages.length) {
      log(`grupo ${label}: sem mensagens na janela — pulado.`);
      skipped++;
      continue;
    }
    // Semeia/atualiza o grupo conhecido (alimenta o seletor da tela) já com o nome resolvido.
    if (APPLY) {
      await sb.from('whatsapp_known_groups').upsert(
        {
          account_id: ACCOUNT_ID,
          group_id: g.id,
          group_name: g.name || g.id,
          last_seen: new Date().toISOString(),
        },
        { onConflict: 'account_id,group_id' },
      );
    }
    const participants = new Set(messages.filter((m) => !m.fromMe).map((m) => m.from)).size;
    const lastTs = messages.reduce((acc, m) => (m.ts && m.ts > acc ? m.ts : acc), 0);
    const firstTs = messages.reduce((acc, m) => (m.ts && (acc === 0 || m.ts < acc) ? m.ts : acc), 0);
    const agentReplies = messages.filter((m) => m.fromMe).length;
    const clientMessages = messages.filter((m) => !m.fromMe).length;
    const lastIsClient = messages.length ? !messages[messages.length - 1].fromMe : false;

    const result = await analyze(g, messages);
    if (!result) {
      log(`grupo ${label}: modelo não retornou análise válida — pulado.`);
      skipped++;
      continue;
    }
    const a = result.ans;
    const sentiment = SENTIMENTS.has(a.sentimento) ? a.sentimento : 'neutro';
    const status = STATUSES.has(a.andamento_atendimento) ? a.andamento_atendimento : 'em_andamento';
    const score =
      typeof a.indice_sentimento === 'number'
        ? Math.max(-1, Math.min(1, a.indice_sentimento))
        : null;
    const highlights = Array.isArray(a.pontos_atencao)
      ? a.pontos_atencao
          .filter((h) => h && (h.texto || h.text))
          .map((h) => ({ tipo: h.tipo || h.type || null, texto: String(h.texto || h.text) }))
      : [];

    const temperature = TEMPERATURES.has(a.temperatura) ? a.temperatura : 'morno';
    const resultScore =
      typeof a.resultado_score === 'number'
        ? Math.max(0, Math.min(100, Math.round(a.resultado_score)))
        : null;
    // Prefere o julgamento do modelo; se ausente, infere pela última mensagem ser do cliente.
    const awaitingReply =
      typeof a.aguardando_resposta === 'boolean' ? a.aguardando_resposta : lastIsClient;
    const introSummary = a.intro_resumo ? String(a.intro_resumo).slice(0, 500) : null;

    const row = {
      account_id: ACCOUNT_ID,
      group_id: g.id,
      group_name: g.name || g.id,
      window_start: new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString(),
      window_end: new Date().toISOString(),
      message_count: messages.length,
      participant_count: participants,
      last_message_at: lastTs ? new Date(lastTs).toISOString() : null,
      sentiment,
      sentiment_score: score,
      attendance_status: status,
      summary: a.resumo ? String(a.resumo) : null,
      highlights,
      analyzed_by: result.label,
      updated_at: new Date().toISOString(),
      // --- engajamento (migration 20261026c) ---
      lead_temperature: temperature,
      result_score: resultScore,
      awaiting_reply: awaitingReply,
      agent_reply_count: agentReplies,
      client_message_count: clientMessages,
      first_contact_at: firstTs ? new Date(firstTs).toISOString() : null,
      intro_summary: introSummary,
    };

    if (APPLY) {
      const error = await upsertInsight(row);
      if (error) {
        log(`grupo ${label}: falha ao gravar insight:`, error.message);
        skipped++;
        continue;
      }
    } else {
      log(
        `grupo ${label}: ${sentiment}/${status} temp=${temperature} resultado=${resultScore ?? '—'} ` +
          `aguardando=${awaitingReply} (${messages.length} msgs) — gravaria insight.`,
      );
    }
    written++;
  }

  log(`concluído: ${written} grupo(s) ${APPLY ? 'gravado(s)' : 'analisado(s) (dry-run)'}, ${skipped} pulado(s).`);
}

run().catch((e) => {
  console.error('[wa-insights] falha:', e?.message || e);
  process.exit(1);
});
