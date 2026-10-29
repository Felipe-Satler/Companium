// Cache em memória + helpers de retry para os hooks de dados grandes.
// Resolve dois problemas observados em produção:
// 1) "canceling statement due to statement timeout" (código 57014) quando muitas
//    requisições concorrentes saturam a view → retry com backoff exponencial.
// 2) Lentidão ao navegar entre páginas (refetch completo) → cache TTL.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 min
const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export function getCached<T>(key: string): T | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return e.value as T;
}

export function setCached<T>(key: string, value: T) {
  store.set(key, { value, expiresAt: Date.now() + TTL_MS });
}

// Um resultado VAZIO nunca deve ser memorizado: quase sempre é uma falha transitória
// (timeout da view, corrida de carregamento) e não "de fato não há dados". Cachear um
// array vazio por 5 min congelava a tela em 0 (ex.: leads tráfego/CPL sumindo no CRM) até
// o usuário recarregar. Se for genuinamente vazio, refetch é barato. Objetos/escalares
// não-nulos seguem cacheáveis normalmente.
function isCacheable(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return v != null;
}

// Coalesce: se já existe um fetch em curso para a mesma chave, reaproveita.
// Evita N requests duplicados quando vários componentes montam ao mesmo tempo.
export async function dedupedFetch<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const cached = getCached<T>(key);
  if (cached !== undefined) return cached;

  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const p = fn()
    .then((v) => {
      if (isCacheable(v)) setCached(key, v);
      return v;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retry específico para erros transitórios do Postgres/PostgREST.
// 57014 = statement timeout (acontece quando a view está sobrecarregada).
// 503/504 também são tratados.
export async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e: unknown) {
      lastErr = e;
      const code = (e as { code?: string; status?: number })?.code;
      const status = (e as { status?: number })?.status;
      const transient =
        code === "57014" || code === "PGRST116" || status === 503 || status === 504;
      if (!transient || attempt === maxAttempts - 1) throw e;
      // Backoff exponencial com jitter: 400ms, 900ms, 1900ms...
      const delay = 400 * Math.pow(2, attempt) + Math.random() * 200;
      await sleep(delay);
    }
  }
  throw lastErr;
}

/** Invalida uma chave do cache (usado após uma edição que muda o resultado do fetch). */
export function clearCached(key: string): void {
  store.delete(key);
  inflight.delete(key);
}
