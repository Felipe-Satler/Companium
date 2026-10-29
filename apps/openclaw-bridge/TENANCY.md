# Bridge multi-tenancy — architecture

How the chat bridge separates **client bots** (restricted) from **internal
operation bots** (unrestricted), without changing the frontend wire contract.

## Layers

The `POST /api/openclaw/chat` route runs four responsibilities:

1. **Route** — `index.js` `app.post('/api/openclaw/chat')`: parse/validate body.
2. **Auth + tenant resolution** — `verifyUser()` (JWT → userId), `resolveAgent()`
   (authorizes the requested `botId`, returns the catalog `botRow`), then
   `buildTenantContext({ botRow, userId })` (`tenancy.js`).
3. **Companium service layer** — `companium-service.js`:
   - `CompaniumClient` isolates the data source (Supabase REST).
   - `CompaniumQueryService` validates structured intents and builds the tenant
     **scope directive** injected into the agent prompt.
   - `CompaniumPermissionService` decides whether an intent may run under the
     tenantContext (`assertIntentAllowed`).
4. **Reply / persistence** — existing `performExport` / `performPlot` +
   transcript persistence, unchanged.

## Where the tenancy data lives

Columns on the **`chatbot_bots`** catalog table (Supabase project
`your-project-ref`), added by
`supabase/migrations/20260819_bot_tenancy_EXTERNAL.sql`:

| column | meaning |
|--------|---------|
| `access_mode` | `internal_unrestricted` (default) or `restricted` |
| `tenant_id` | tenant the restricted bot is pinned to (null for internal) |
| `allowed_clinic_ids` | `text[]` of clinic ids the bot may see |
| `allowed_capabilities` | `text[]`; internal is `{*}` |

Edits happen in the **Administração → Tenancy de Bots** tab
(`src/components/admin/AdminBotTenancy.tsx`), written directly to `chatbot_bots`
under an admin-only RLS UPDATE policy. A DB trigger records every change in
`chatbot_bot_tenancy_audit` (old/new value, `changed_by`, `changed_at`).

The bridge reads these columns with the service key in `getBots()` and derives the
`tenantContext` per turn. **Nothing is trusted from the frontend.**

## Restricted vs internal — current bots

- **Default = internal_unrestricted.** Every bot that predates the migration (and
  any new bot) is internal_unrestricted with capability `*` → identical to today's
  behavior. No internal bot regresses.
- **Restricted bots:** none until an admin explicitly switches a bot to
  `restricted` and sets its `tenant_id` / `allowed_clinic_ids` in the new tab.

To list the live modes:

```sql
select id, label, access_mode, tenant_id, allowed_clinic_ids
from public.chatbot_bots
order by access_mode desc, label;
```

## Enforcement boundary (known limitation)

The bridge enforces, server-side: which bot is restricted, capability gating of
`export`/`plot`, and a hard tenant **scope directive** in the agent prompt. Since
the agent performs its own data reads (via PAT-backed tools/skills), full DB-level
isolation for a restricted bot's reads also depends on those tools honoring the
`tenantContext` scope. That downstream tool scoping is the next step for airtight
isolation — see the "riscos pendentes" in the delivery summary.
