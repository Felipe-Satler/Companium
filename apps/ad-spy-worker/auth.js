/**
 * Auth for the ad-spy worker.
 *
 * Two gates, and the second one is the point of this file:
 *   1. verifyUser()    — the Supabase JWT is real (JWKS, ES256), giving us a trustworthy user id.
 *   2. assertInternal() — that user is INTERNAL, i.e. has NO row in user_client_scope.
 *
 * Gate 2 exists because the frontend guard (ProtectedRoute bouncing /marketing for client users)
 * is a convenience, not a security boundary — anyone can curl this port's nginx route with a
 * valid client-user token. Ad spy is competitor research for the team; a client must never reach
 * it. So the server re-derives "internal" from the same signal AuthContext uses: the presence of
 * a row. Lifted from openclaw-bridge/index.js (verifyUser + fetchUserClientScope).
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import { JWKS_URL, JWT_AUDIENCE, JWT_ISSUER, SUPABASE_URL } from "./config.js";
import { sbHeaders } from "./db.js";

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
    this.status = 401;
  }
}

export class ForbiddenError extends Error {
  constructor(message) {
    super(message);
    this.name = "ForbiddenError";
    this.status = 403;
  }
}

const jwks = createRemoteJWKSet(new URL(JWKS_URL));

/**
 * Verify the bearer token and return the user id (`sub`).
 * @param {string|undefined} authHeader raw Authorization header value
 * @returns {Promise<{ userId: string, jwt: string }>}
 */
export async function verifyUser(authHeader) {
  if (!authHeader || typeof authHeader !== "string") {
    throw new AuthError("Missing Authorization header");
  }
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new AuthError("Malformed Authorization header");
  const token = m[1].trim();
  if (!token) throw new AuthError("Empty bearer token");

  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }));
  } catch {
    // Covers expiry, bad signature, wrong iss/aud.
    throw new AuthError("Invalid or expired token");
  }
  if (!payload.sub || typeof payload.sub !== "string") {
    throw new AuthError("Token missing subject");
  }
  // Nome para exibir ("salvo por …" na Biblioteca). Mesma regra do rodapé da sidebar: nome do
  // cadastro, senão a parte local do e-mail.
  const meta = payload.user_metadata || {};
  const email = typeof payload.email === "string" ? payload.email : "";
  const name = meta.name || meta.full_name || (email ? email.split("@")[0] : null);
  return { userId: payload.sub, jwt: token, email, name };
}

/**
 * Read this user's client-scope row with the service key.
 *
 * Three outcomes, and the third is why this is not just `=== null`:
 *   row   -> restricted client user
 *   null  -> CONFIRMED no row (internal / team)
 *   throw -> could not determine; the caller must fail CLOSED. Never downgrade a possible
 *            client to internal just because a lookup flaked.
 */
async function fetchUserClientScope(userId) {
  const url =
    `${SUPABASE_URL}/rest/v1/user_client_scope` +
    `?user_id=eq.${encodeURIComponent(userId)}` +
    `&select=client_id&limit=1`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`user_client_scope lookup ${res.status}`);
  const rows = await res.json(); // a parse failure throws too -> fail closed
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * Throw unless the user is internal (no user_client_scope row).
 * Fails closed: if the lookup cannot be completed, access is denied.
 */
export async function assertInternal(userId) {
  let scope;
  try {
    scope = await fetchUserClientScope(userId);
  } catch (err) {
    const e = new ForbiddenError("Não foi possível verificar o escopo do usuário.");
    e.cause = err;
    throw e;
  }
  if (scope) {
    throw new ForbiddenError("A Mineração é restrita à equipe interna.");
  }
}

/**
 * Express helper: verify + internal check in one call.
 * Returns `{ userId, jwt }` or throws AuthError / ForbiddenError.
 */
export async function requireInternalUser(req) {
  const user = await verifyUser(req.headers.authorization);
  await assertInternal(user.userId);
  return user;
}
