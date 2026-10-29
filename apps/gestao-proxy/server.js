import http from 'node:http';

// ============================================================================
// gestao-proxy — download read-only da planilha de Gestão pelo backend.
//
// Motivo: o CSP do companium.example.com mantém `connect-src 'self'` (o browser só
// fala com a própria origem + Supabase). Um fetch direto do frontend para o
// docs.google.com é bloqueado ("Failed to fetch"). Este serviço baixa a planilha
// no servidor (sem CORS/CSP) e a devolve na MESMA origem, via nginx
// (/api/gestao/planilha), exatamente como o reach-service (/api/meta-reach).
//
// GARANTIAS:
//  - O endereço da planilha vem SÓ do ambiente (GESTAO_SHEET_URL). O frontend
//    nunca conhece a URL do Google — só chama /api/gestao/planilha.
//  - Sem SSRF: o serviço ignora qualquer URL do cliente; baixa apenas a URL fixa.
//  - Cache em memória com TTL (default 10 min): páginas recarregando não
//    re-baixam o arquivo. Em caso de falha upstream, serve o último cache válido.
//  - READ-ONLY: só faz GET da planilha. Não escreve nada, não toca banco.
//
// Rotas (nginx repassa o path completo):
//   GET /api/gestao/planilha[?force=1]  -> bytes .xlsx (Content-Type xlsx)
//   GET /api/gestao/health              -> { ok, cached, ageMs, bytes }
// ============================================================================

const PORT = Number(process.env.GESTAO_PROXY_PORT || 18911);
const HOST = '127.0.0.1'; // só localhost — exposto ao mundo via nginx
const SHEET_URL = process.env.GESTAO_SHEET_URL || '';
const TTL_MS = Number(process.env.GESTAO_CACHE_TTL_MS || 10 * 60_000);
const TZ = process.env.TZ || 'America/Sao_Paulo';
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function log(...a) {
  console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: TZ })}]`, ...a);
}

if (!SHEET_URL) {
  console.error('Env faltando: GESTAO_SHEET_URL');
  process.exit(1);
}

/** @type {{ buf: Buffer, ts: number } | null} */
let cache = null;
/** @type {Promise<{buf: Buffer, cached: boolean, stale?: boolean}> | null} */
let inflight = null;

async function download() {
  const res = await fetch(SHEET_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error('upstream devolveu arquivo vazio');
  // HTML = página de login/permissão (planilha não publicada), não o arquivo.
  const head = buf.subarray(0, 200).toString('utf8').trim().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
    throw new Error('upstream devolveu HTML (planilha não publicada?)');
  }
  // .xlsx é um zip: começa com a assinatura "PK".
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) {
    throw new Error('upstream não devolveu um .xlsx válido');
  }
  return buf;
}

async function getBuffer(force) {
  const fresh = cache && Date.now() - cache.ts < TTL_MS;
  if (!force && fresh) return { buf: cache.buf, cached: true };
  if (inflight) return inflight; // deduplica downloads concorrentes
  inflight = (async () => {
    try {
      const buf = await download();
      cache = { buf, ts: Date.now() };
      log(`planilha baixada e cacheada (${buf.length} bytes)`);
      return { buf, cached: false };
    } catch (e) {
      if (cache) {
        log('download falhou, servindo cache anterior:', String(e && e.message || e).slice(0, 140));
        return { buf: cache.buf, cached: true, stale: true };
      }
      throw e;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    const path = u.pathname;

    if (path === '/api/gestao/health' || path === '/health') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(
        JSON.stringify({
          ok: true,
          cached: !!cache,
          ageMs: cache ? Date.now() - cache.ts : null,
          bytes: cache ? cache.buf.length : 0,
          ttlMs: TTL_MS,
        })
      );
      return;
    }

    if (path === '/api/gestao/planilha' || path === '/planilha') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'method not allowed' }));
        return;
      }
      const force = u.searchParams.get('force') === '1';
      const { buf } = await getBuffer(force);
      res.statusCode = 200;
      res.setHeader('Content-Type', XLSX_MIME);
      res.setHeader('Content-Length', String(buf.length));
      res.setHeader('Content-Disposition', 'inline; filename="gestao.xlsx"');
      // Sempre revalida no servidor (o cache de servidor é quem evita o re-download).
      res.setHeader('Cache-Control', 'no-store');
      res.end(req.method === 'HEAD' ? undefined : buf);
      return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: String(e && e.message || e).slice(0, 200) }));
  }
});

server.listen(PORT, HOST, () =>
  log(`gestao-proxy ouvindo em http://${HOST}:${PORT} (GET /api/gestao/planilha) · TTL ${Math.round(TTL_MS / 1000)}s`)
);
// Aquece o cache no boot (não derruba o serviço se falhar).
getBuffer(true).catch((e) => log('falha ao aquecer cache:', String(e && e.message || e).slice(0, 140)));
