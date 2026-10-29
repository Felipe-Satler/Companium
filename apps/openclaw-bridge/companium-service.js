// Companium service layer for the chat bridge.
//
// Keeps tenancy rules and intent handling OUT of the HTTP route. Three concerns:
//
//   CompaniumClient            — isolates the data source (Supabase REST) so the
//                                rest of the service never touches transport/infra.
//   CompaniumQueryService      — validates the structured intents the skill emits
//                                and centralizes tenant scoping (a hard scope
//                                directive injected into the agent prompt + read
//                                filters for any direct query).
//   CompaniumPermissionService — decides whether an intent may run under the
//                                current tenantContext. Restricted bots are gated
//                                by capability + tenant/clinic; internal bots are
//                                allowed broad but still audited.
//
// The wire contract with the frontend is UNCHANGED (message | service_request).
// These intents are the internal classification vocabulary; the only side-effects
// the bridge actually executes remain `export` and `plot`.

import { ACCESS_MODE, CAP_WILDCARD, hasCapability, isRestricted } from "./tenancy.js";

// --- Intent vocabulary ------------------------------------------------------

/** Structured intents the skill may classify a turn into. */
export const INTENT = Object.freeze({
  LEADS_LIST: "companium.leads.list",
  LEADS_DETAIL: "companium.leads.detail",
  METRICS_SUMMARY: "companium.metrics.summary",
  PIPELINE_STATUS: "companium.pipeline.status",
  TASKS_PENDING: "companium.tasks.pending",
  EXPORT_REPORT: "companium.export.report",
  PLOT_METRIC: "companium.plot.metric",
});

/** Which capability each intent requires. `*` (wildcard) satisfies all of them. */
export const INTENT_CAPABILITY = Object.freeze({
  [INTENT.LEADS_LIST]: "leads.read",
  [INTENT.LEADS_DETAIL]: "leads.read",
  [INTENT.METRICS_SUMMARY]: "metrics.read",
  [INTENT.PIPELINE_STATUS]: "pipeline.read",
  [INTENT.TASKS_PENDING]: "tasks.read",
  [INTENT.EXPORT_REPORT]: "export",
  [INTENT.PLOT_METRIC]: "plot",
});

const KNOWN_INTENTS = new Set(Object.values(INTENT));
const EXPORT_FORMATS = new Set(["pdf", "png", "md"]);

/**
 * Map an agent side-effect directive (`{ action: 'export' | 'plot', ... }`) onto
 * a structured intent so it flows through the same validation/permission path.
 * @param {{ action?: string }|null|undefined} directive
 * @returns {{ type: string, capability: string, payload: object } | null}
 */
export function directiveToIntent(directive) {
  if (!directive || typeof directive !== "object") return null;
  if (directive.action === "export") {
    return {
      type: INTENT.EXPORT_REPORT,
      capability: INTENT_CAPABILITY[INTENT.EXPORT_REPORT],
      payload: { exportFormat: directive.kind, filters: directive.filters },
    };
  }
  if (directive.action === "plot") {
    return {
      type: INTENT.PLOT_METRIC,
      capability: INTENT_CAPABILITY[INTENT.PLOT_METRIC],
      payload: { plotSpec: directive.spec, filters: directive.filters },
    };
  }
  return null;
}

// --- Errors -----------------------------------------------------------------

/** Intent valid but payload/action invalid -> 422. */
export class IntentValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 422;
    this.code = "intent_invalid";
  }
}

/** Authenticated but not allowed in this tenantContext -> 403. */
export class TenantPermissionError extends Error {
  constructor(message) {
    super(message);
    this.status = 403;
    this.code = "tenant_forbidden";
  }
}

// --- CompaniumClient --------------------------------------------------------

/**
 * Thin wrapper over the Companium data source (Supabase REST via the service
 * key). Isolates infra so services never build URLs or headers themselves.
 */
export class CompaniumClient {
  /** @param {{ baseUrl: string, headers: () => Record<string,string>, fetchImpl?: typeof fetch }} deps */
  constructor({ baseUrl, headers, fetchImpl }) {
    this.baseUrl = baseUrl;
    this.headers = headers;
    this.fetchImpl = fetchImpl || fetch;
  }

  /** GET `${baseUrl}/rest/v1/${pathAndQuery}` and parse JSON. Returns [] on error. */
  async restGet(pathAndQuery) {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/rest/v1/${pathAndQuery}`, {
        headers: this.headers(),
      });
      if (!res.ok) return [];
      return await res.json().catch(() => []);
    } catch {
      return [];
    }
  }
}

// --- CompaniumQueryService --------------------------------------------------

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Validates structured intents and centralizes tenant scoping. Always receives a
 * tenantContext; never infers tenancy from user text.
 */
export class CompaniumQueryService {
  /** @param {{ client?: CompaniumClient }} [deps] */
  constructor(deps = {}) {
    this.client = deps.client || null;
  }

  /**
   * Validate a classified intent's shape/payload. Throws IntentValidationError.
   * @param {{ type: string, payload?: object }} intent
   */
  validateStructuredIntent(intent) {
    if (!intent || typeof intent.type !== "string" || !KNOWN_INTENTS.has(intent.type)) {
      throw new IntentValidationError("Unknown Companium intent.");
    }
    const p = isPlainObject(intent.payload) ? intent.payload : {};

    if (p.dateRange !== undefined) {
      if (!isPlainObject(p.dateRange) || typeof p.dateRange.from !== "string" || typeof p.dateRange.to !== "string") {
        throw new IntentValidationError("Invalid dateRange.");
      }
    }
    for (const key of ["clinicId", "leadId", "metric", "groupBy"]) {
      if (p[key] !== undefined && typeof p[key] !== "string") {
        throw new IntentValidationError(`Invalid ${key}.`);
      }
    }
    if (p.filters !== undefined && !isPlainObject(p.filters)) {
      throw new IntentValidationError("Invalid filters.");
    }
    if (p.exportFormat !== undefined && !EXPORT_FORMATS.has(String(p.exportFormat))) {
      throw new IntentValidationError("Invalid exportFormat.");
    }
    if (p.plotSpec !== undefined && !isPlainObject(p.plotSpec)) {
      throw new IntentValidationError("Invalid plotSpec.");
    }
    return true;
  }

  /**
   * PostgREST-style scope filters for any DIRECT query. Restricted contexts pin
   * the tenant and (when present) the clinic set; internal contexts add nothing.
   * @param {import('./tenancy.js').TenantContext} tenantContext
   * @returns {Record<string,string>}
   */
  scopeReadFilters(tenantContext) {
    if (!isRestricted(tenantContext)) return {};
    const filters = {};
    if (tenantContext.tenantId) filters.tenant_id = `eq.${tenantContext.tenantId}`;
    if (Array.isArray(tenantContext.allowedClinicIds) && tenantContext.allowedClinicIds.length) {
      filters.clinic_id = `in.(${tenantContext.allowedClinicIds.join(",")})`;
    }
    return filters;
  }

  /**
   * The hard scope block injected into the agent prompt. This is the boundary the
   * agent must respect for its own tool-driven reads.
   * @param {import('./tenancy.js').TenantContext} tenantContext
   * @returns {string}
   */
  buildScopeDirective(tenantContext) {
    if (isRestricted(tenantContext)) {
      const cliente = tenantContext.clientSlug || tenantContext.tenantId || "(não configurado)";
      return [
        "[TENANT_SCOPE mode=restricted]",
        "Este é um acesso de CLIENTE, RESTRITO a um único cliente. Regras invioláveis:",
        `- cliente autorizado: ${cliente}`,
        "- Os dados deste cliente JÁ FORAM carregados pelo servidor no bloco [DADOS_DO_CLIENTE] desta mensagem, e já vêm filtrados no banco para este cliente.",
        "- Responda SOMENTE com base no bloco [DADOS_DO_CLIENTE]. NÃO consulte o banco, NÃO chame ferramentas de dados, NÃO use skills de consulta.",
        "- NUNCA acesse, cite ou agregue dados de outro cliente; NUNCA deduza o cliente a partir do texto do usuário.",
        "- Se o pedido sair do escopo (outro cliente, dados não presentes no bloco), recuse com uma mensagem curta e segura.",
        "- Se o bloco [DADOS_DO_CLIENTE] estiver ausente ou vazio, diga que não há dados disponíveis; NÃO tente buscar por conta própria.",
        "[/TENANT_SCOPE]",
      ].join("\n");
    }
    return [
      "[TENANT_SCOPE mode=internal_unrestricted]",
      "Bot interno de operação: visão ampla autorizada (comportamento padrão da operação).",
      "Ainda assim, mantenha o escopo do dashboard (CRM, métricas, mídia paga, relatórios).",
      "[/TENANT_SCOPE]",
    ].join("\n");
  }
}

// --- CompaniumPermissionService ---------------------------------------------

/**
 * Decides whether an intent may run under the current tenantContext.
 * The single choke point for "pode fazer?" — the route only asks it.
 */
export class CompaniumPermissionService {
  /**
   * Throws TenantPermissionError (403) or IntentValidationError (422) when the
   * intent must not run. Returns a decision object otherwise.
   * @param {{ intent: { type: string, capability?: string, payload?: object }, tenantContext: import('./tenancy.js').TenantContext }} args
   * @returns {{ allowed: true, mode: string, capability: string }}
   */
  assertIntentAllowed({ intent, tenantContext }) {
    const capability = intent.capability || INTENT_CAPABILITY[intent.type];
    if (!capability) {
      throw new IntentValidationError("Intent has no capability mapping.");
    }

    // Internal bots: broad access by design. Still returns a decision so the
    // caller can audit it — this is an explicit allow, not an absence of checks.
    if (!isRestricted(tenantContext)) {
      return { allowed: true, mode: ACCESS_MODE.INTERNAL, capability };
    }

    // Restricted bots: capability must be granted.
    if (!hasCapability(tenantContext, capability)) {
      throw new TenantPermissionError(`Capability '${capability}' not allowed for this bot.`);
    }
    // A restricted bot without a tenant is a mis-config: fail closed.
    if (!tenantContext.tenantId) {
      throw new TenantPermissionError("Restricted bot has no tenant configured.");
    }
    // If the payload names a clinic, it must be inside the allow-list.
    const clinicId = intent.payload && intent.payload.clinicId;
    if (typeof clinicId === "string" && clinicId) {
      const allowed = Array.isArray(tenantContext.allowedClinicIds) && tenantContext.allowedClinicIds.includes(clinicId);
      if (!allowed) {
        throw new TenantPermissionError("Clinic outside the allowed scope.");
      }
    }
    return { allowed: true, mode: ACCESS_MODE.RESTRICTED, capability };
  }
}
