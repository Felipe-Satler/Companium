// Multi-tenant context resolution for the OpenClaw chat bridge.
//
// The bridge spawns one `openclaw agent` turn per request. WHICH data that agent
// is allowed to touch is decided HERE, server-side, from the bot catalog row —
// never from the frontend and never inferred from the user's free text.
//
// Two execution modes exist, and a `tenantContext` ALWAYS exists (never absent):
//
//   restricted            — client bots. Scoped to one tenant + a set of clinics
//                           + an explicit capability allow-list.
//   internal_unrestricted — internal operation bots (how things work today).
//                           Explicit broad context, allowedCapabilities: ['*'].
//
// Keeping internal bots on an EXPLICIT context (instead of "no context") lets the
// rest of the pipeline branch on `tenantContext.mode` uniformly and lets every
// turn be audited as restricted vs unrestricted.

/**
 * @typedef {Object} RestrictedTenantContext
 * @property {'restricted'} mode
 * @property {string} tenantId
 * @property {string[]} allowedClinicIds
 * @property {string[]} allowedCapabilities
 * @property {string} userId
 * @property {string} [role]
 */

/**
 * @typedef {Object} InternalTenantContext
 * @property {'internal_unrestricted'} mode
 * @property {string} userId
 * @property {['*']} allowedCapabilities
 * @property {true} unrestricted
 * @property {string} [role]
 */

/** @typedef {RestrictedTenantContext | InternalTenantContext} TenantContext */

/**
 * @typedef {{ kind: 'restricted_client_bot' } | { kind: 'internal_unrestricted_bot' }} BotAccessPolicy
 */

export const ACCESS_MODE = Object.freeze({
  RESTRICTED: "restricted",
  INTERNAL: "internal_unrestricted",
});

/** Capability granted implicitly to internal bots (matches everything). */
export const CAP_WILDCARD = "*";

/** Coerce an unknown value into a string array of trimmed, non-empty entries. */
function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
}

/**
 * Read the tenancy fields off a raw `chatbot_bots` row with SAFE, backward-
 * compatible defaults. A row that predates the tenancy columns (all null/absent)
 * resolves to internal_unrestricted with capability `*` — i.e. exactly today's
 * behavior. Only a row explicitly marked `restricted` becomes a client bot.
 *
 * @param {Record<string, any> | null | undefined} row
 * @returns {{ accessMode: string, tenantId: string|null, allowedClinicIds: string[], allowedCapabilities: string[] }}
 */
export function normalizeBotRow(row) {
  const raw = (row && typeof row.access_mode === "string" && row.access_mode.trim()) || "";
  const accessMode = raw === ACCESS_MODE.RESTRICTED ? ACCESS_MODE.RESTRICTED : ACCESS_MODE.INTERNAL;

  const tenantId =
    row && typeof row.tenant_id === "string" && row.tenant_id.trim()
      ? row.tenant_id.trim()
      : null;

  const allowedClinicIds = toStringArray(row && row.allowed_clinic_ids);

  let allowedCapabilities = toStringArray(row && row.allowed_capabilities);
  if (accessMode === ACCESS_MODE.INTERNAL || allowedCapabilities.length === 0) {
    // Internal bots always get the wildcard; restricted bots with no explicit
    // list fall back to the wildcard so a mis-seeded row never silently loses
    // access (the permission layer still gates by mode).
    allowedCapabilities = [CAP_WILDCARD];
  }

  return { accessMode, tenantId, allowedClinicIds, allowedCapabilities };
}

/**
 * Decide the server-side access policy for a bot. Never trusts the client.
 * @param {Record<string, any> | null | undefined} botRow
 * @returns {BotAccessPolicy}
 */
export function resolveBotAccessPolicy(botRow) {
  const { accessMode } = normalizeBotRow(botRow);
  return accessMode === ACCESS_MODE.RESTRICTED
    ? { kind: "restricted_client_bot" }
    : { kind: "internal_unrestricted_bot" };
}

/**
 * Build the tenantContext for a turn. ALWAYS returns a context object.
 * @param {{ botRow: Record<string, any>|null|undefined, userId: string, role?: string }} args
 * @returns {TenantContext}
 */
export function buildTenantContext({ botRow, userId, role }) {
  const norm = normalizeBotRow(botRow);
  if (norm.accessMode === ACCESS_MODE.RESTRICTED) {
    return {
      mode: ACCESS_MODE.RESTRICTED,
      tenantId: norm.tenantId || "",
      allowedClinicIds: norm.allowedClinicIds,
      allowedCapabilities: norm.allowedCapabilities,
      userId,
      ...(role ? { role } : {}),
    };
  }
  return {
    mode: ACCESS_MODE.INTERNAL,
    userId,
    allowedCapabilities: [CAP_WILDCARD],
    unrestricted: true,
    ...(role ? { role } : {}),
  };
}

/**
 * Resolve the tenant from the AUTHENTICATED USER, not from the bot.
 *
 * This is the model for a SINGLE shared client bot: the scope rides on the
 * verified identity (JWT sub -> user_client_scope row), per request — never on
 * the bot row, the frontend, or the model's text.
 *
 *   - a row in user_client_scope  -> restricted, pinned to that ONE client.
 *   - no row (staff / unmapped)   -> internal_unrestricted (sees all = today).
 *
 * The returned `clientId`/`adsNames`/`cmpKeys` are carried for the bridge's own
 * awareness (audit, snapshot fetch). They are NOT what enforces the read — the
 * caller's JWT + the already-deployed RLS on the scoped views does that. Keeping
 * enforcement in the DB (not re-derived here) is what makes it airtight.
 *
 * @param {{
 *   userId: string,
 *   fetchScope: (userId: string) => Promise<null | {
 *     client_id: string, client_slug?: string, ads_names?: string[], cmpkeys?: string[]
 *   }>,
 *   role?: string,
 * }} args
 * `fetchScope` MUST resolve to the row, or `null` for a confirmed no-row (staff),
 * and MUST THROW if it cannot determine the scope (network/query error). This
 * function does NOT swallow that error — it propagates so the caller can fail
 * CLOSED (a client must never be downgraded to staff on a lookup blip).
 *
 * @returns {Promise<TenantContext & { isClient: boolean, clientId?: string, clientSlug?: string, adsNames?: string[], cmpKeys?: string[] }>}
 */
export async function resolveTenantForUser({ userId, fetchScope, role }) {
  const scope = await fetchScope(userId); // may throw -> caller fails closed

  if (!scope || typeof scope.client_id !== "string" || !scope.client_id) {
    return {
      mode: ACCESS_MODE.INTERNAL,
      userId,
      isClient: false,
      allowedCapabilities: [CAP_WILDCARD],
      unrestricted: true,
      ...(role ? { role } : {}),
    };
  }

  return {
    mode: ACCESS_MODE.RESTRICTED,
    userId,
    isClient: true,
    tenantId: scope.client_id, // = clientes.id; also the scope key for clientes/clientes_meta
    clientId: scope.client_id,
    clientSlug: typeof scope.client_slug === "string" ? scope.client_slug : "",
    adsNames: toStringArray(scope.ads_names), // exact-match scope for Ads ("Client")
    cmpKeys: toStringArray(scope.cmpkeys), // matchkey scope for Kommo (client)
    allowedClinicIds: [], // Companium has no clinic axis; scope is name-based
    allowedCapabilities: [CAP_WILDCARD], // export/plot still gated by assertIntentAllowed
    ...(role ? { role } : {}),
  };
}

/** Short label for audit logs. @param {TenantContext} ctx */
export function contextLabel(ctx) {
  return ctx && ctx.mode === ACCESS_MODE.RESTRICTED ? "restricted" : "internal_unrestricted";
}

/** @param {TenantContext} ctx */
export function isRestricted(ctx) {
  return !!ctx && ctx.mode === ACCESS_MODE.RESTRICTED;
}

/**
 * Does the context grant a capability? Wildcard matches everything.
 * @param {TenantContext} ctx
 * @param {string} capability
 */
export function hasCapability(ctx, capability) {
  const caps = (ctx && ctx.allowedCapabilities) || [];
  return caps.includes(CAP_WILDCARD) || caps.includes(capability);
}
