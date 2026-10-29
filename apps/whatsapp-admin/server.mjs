// whatsapp-admin — API autenticada para gerenciar o canal WhatsApp do OpenClaw PELA TELA
// (Administração › Agente WhatsApp). Espelha a auth do openclaw-bridge: verifica o JWT do
// Supabase (JWKS/ES256) e só libera ADMIN ou papel `whatsapp_editor` (has_whatsapp_access).
//
// Endpoints (todos atrás de nginx /api/whatsapp/ + Authorization: Bearer <jwt do usuário>):
//   GET  /api/whatsapp/status        -> status do canal (plugin? conectado? ativo? erros?)
//   POST /api/whatsapp/connect       -> inicia login (stream SSE do QR/logs do `channels login`)
//   POST /api/whatsapp/reconnect     -> logout + login (recupera sessão caída)
//   POST /api/whatsapp/disconnect    -> logout
//   POST /api/whatsapp/restart       -> `openclaw gateway restart --safe` (recupera o gateway)
//
// NADA roda comando sem auth+papel. Bind só em 127.0.0.1 (nginx expõe com TLS).

import express from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const PORT = Number(process.env.PORT || 18920);
const HOST = process.env.HOST || '127.0.0.1';
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || 'openclaw';
const CHANNEL = 'whatsapp';
const ACCOUNT_ID = (process.env.WHATSAPP_ACCOUNT_ID || 'whatsapp-groobot').trim();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://your-project-ref.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const JWT_ISSUER = `${SUPABASE_URL}/auth/v1`;
const JWKS_URL = `${JWT_ISSUER}/.well-known/jwks.json`;
const jwks = createRemoteJWKSet(new URL(JWKS_URL));

// --- Auth: JWT válido + papel (admin OU whatsapp_editor) -------------------
class AuthError extends Error {}

async function requireWhatsappAdmin(req) {
  const h = req.headers['authorization'];
  const m = typeof h === 'string' && h.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new AuthError('Missing/!bearer');
  let payload;
  try {
    ({ payload } = await jwtVerify(m[1], jwks, { issuer: JWT_ISSUER, audience: 'authenticated' }));
  } catch {
    throw new AuthError('Invalid token');
  }
  const uid = payload.sub;
  if (!uid) throw new AuthError('No sub');
  if (!SUPABASE_SERVICE_KEY) throw new AuthError('Server missing service key');
  // Papel via PostgREST (service role): admin OU whatsapp_editor.
  const url = `${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${uid}&select=role`;
  const r = await fetch(url, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  if (!r.ok) throw new AuthError('role lookup failed');
  const roles = (await r.json()).map((x) => x.role);
  if (!roles.includes('admin') && !roles.includes('whatsapp_editor')) {
    throw new AuthError('forbidden');
  }
  return uid;
}

function guard(handler) {
  return async (req, res) => {
    try {
      req.uid = await requireWhatsappAdmin(req);
    } catch (e) {
      const forbidden = e instanceof AuthError && e.message === 'forbidden';
      return res.status(forbidden ? 403 : 401).json({ error: e.message || 'unauthorized' });
    }
    try {
      await handler(req, res);
    } catch (e) {
      if (!res.headersSent) res.status(500).json({ error: e?.message || 'internal' });
    }
  };
}

async function oc(args, { tolerate = false } = {}) {
  try {
    const { stdout } = await execFileP(OPENCLAW_BIN, args, { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    if (tolerate) return null;
    throw e;
  }
}

// --- Status ----------------------------------------------------------------
async function buildStatus() {
  const out = await oc(['channels', 'status', '--json'], { tolerate: true });
  let parsed = null;
  if (out) { try { parsed = JSON.parse(out); } catch { /* ignore */ } }
  const wa = parsed?.channels?.whatsapp || null;
  const pluginInstalled = !!wa || (Array.isArray(parsed?.channelOrder) && parsed.channelOrder.includes('whatsapp'));

  // Config (enabled) vem do Supabase (service role), fonte de verdade da tela.
  let enabled = false;
  let displayName = null;
  if (SUPABASE_SERVICE_KEY) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_group_agents?account_id=eq.${encodeURIComponent(ACCOUNT_ID)}&select=enabled,display_name`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    ).catch(() => null);
    if (r && r.ok) {
      const rows = await r.json();
      if (rows[0]) { enabled = !!rows[0].enabled; displayName = rows[0].display_name; }
    }
  }

  const running = !!wa?.running;
  const configured = !!wa?.configured;
  return {
    pluginInstalled,
    configured,
    connected: running,              // canal ativo/rodando = sessão WhatsApp de pé
    running,
    enabledInConfig: enabled,        // mestre liga/desliga definido na tela
    active: enabled && running,      // de fato respondendo
    displayName,
    account: ACCOUNT_ID,
    lastStartAt: wa?.lastStartAt ?? null,
    lastStopAt: wa?.lastStopAt ?? null,
    lastError: wa?.lastError ?? wa?.error ?? null,
    raw: wa,                         // detalhe cru p/ debug na tela
    ts: parsed?.ts ?? null,
  };
}

// --- App -------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/api/whatsapp/health', (_req, res) => res.json({ ok: true }));

app.get('/api/whatsapp/status', guard(async (_req, res) => {
  res.json(await buildStatus());
}));

// Stream (SSE) do login: inicia `openclaw channels login` e manda a saída (incl. QR em ASCII)
// linha a linha pro navegador. O usuário escaneia o QR direto da tela. Encerra no fim/timeout.
app.post('/api/whatsapp/connect', guard(async (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('log', { line: `Iniciando login do WhatsApp (conta ${ACCOUNT_ID})…` });

  const child = spawn(OPENCLAW_BIN, ['channels', 'login', '--channel', CHANNEL, '--account', ACCOUNT_ID, '--verbose'], {
    env: process.env,
  });
  const onData = (buf) => {
    for (const line of buf.toString().split('\n')) {
      if (line.length) send('log', { line });
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  // Timeout de segurança (QR expira; não deixar o processo pendurado pra sempre).
  const killAt = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, 180000);

  const finish = async (code) => {
    clearTimeout(killAt);
    const status = await buildStatus().catch(() => null);
    send('done', { code, status });
    res.end();
  };
  child.on('close', finish);
  child.on('error', (e) => { send('log', { line: `erro: ${e.message}` }); finish(-1); });

  // Se o cliente desistir, mata o processo.
  res.on('close', () => { try { child.kill('SIGTERM'); } catch {} });
}));

app.post('/api/whatsapp/disconnect', guard(async (_req, res) => {
  await oc(['channels', 'logout', '--channel', CHANNEL, '--account', ACCOUNT_ID], { tolerate: true });
  res.json({ ok: true, status: await buildStatus().catch(() => null) });
}));

app.post('/api/whatsapp/reconnect', guard(async (_req, res) => {
  // logout + o connect (stream) é chamado em seguida pela tela; aqui só derrubamos a sessão velha.
  await oc(['channels', 'logout', '--channel', CHANNEL, '--account', ACCOUNT_ID], { tolerate: true });
  res.json({ ok: true, status: await buildStatus().catch(() => null) });
}));

app.post('/api/whatsapp/restart', guard(async (_req, res) => {
  await oc(['gateway', 'restart', '--safe', '--wait', '2m'], { tolerate: true });
  res.json({ ok: true });
}));

app.listen(PORT, HOST, () => {
  console.log(`[whatsapp-admin] ouvindo em http://${HOST}:${PORT} (conta ${ACCOUNT_ID})`);
});
