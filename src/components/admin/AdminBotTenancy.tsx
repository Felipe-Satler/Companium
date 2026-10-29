import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/external-supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { toast } from "sonner";
import { Bot, Search, RefreshCw, Shield, ShieldOff, X, Plus, Pencil, RotateCcw } from "lucide-react";

// Espelha as colunas de tenancy do catálogo `chatbot_bots` (migration
// 20260819_bot_tenancy). O bridge deriva o tenantContext dessas mesmas colunas.
type AccessMode = "internal_unrestricted" | "restricted";

interface BotTenancyRow {
  id: string;
  label: string | null;
  enabled: boolean | null;
  access_mode: AccessMode;
  tenant_id: string | null;
  allowed_clinic_ids: string[];
  allowed_capabilities: string[];
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** tenantId estruturado: não-vazio, sem espaços, curto. */
function validTenantId(v: string): boolean {
  return /^[a-zA-Z0-9._:-]{1,64}$/.test(v.trim());
}

/**
 * Aba de Administração para gerir o vínculo de tenancy dos bots de cliente.
 * Edita `tenant_id` e `allowed_clinic_ids` (e o modo de acesso) por bot, com
 * validação, restaurar/cancelar e persistência em `chatbot_bots` (RLS admin-only;
 * o trigger de auditoria registra valor anterior/novo). Só admin chega aqui.
 */
export function AdminBotTenancy() {
  const [rows, setRows] = useState<BotTenancyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("chatbot_bots")
      .select("id,label,enabled,access_mode,tenant_id,allowed_clinic_ids,allowed_capabilities")
      .order("label", { ascending: true });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows(
      (data ?? []).map((b: any) => ({
        id: b.id,
        label: b.label ?? null,
        enabled: b.enabled ?? null,
        access_mode: (b.access_mode === "restricted" ? "restricted" : "internal_unrestricted") as AccessMode,
        tenant_id: b.tenant_id ?? null,
        allowed_clinic_ids: Array.isArray(b.allowed_clinic_ids) ? b.allowed_clinic_ids : [],
        allowed_capabilities: Array.isArray(b.allowed_capabilities) ? b.allowed_capabilities : ["*"],
      })),
    );
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const q = norm(query.trim());
  const visible = useMemo(
    () =>
      rows.filter(
        (r) => !q || norm(r.label ?? "").includes(q) || norm(r.id).includes(q) || norm(r.tenant_id ?? "").includes(q),
      ),
    [rows, q],
  );

  const modeBadge = (m: AccessMode) =>
    m === "restricted" ? (
      <Badge variant="outline" className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30">
        <Shield className="h-3 w-3 mr-1" /> Restrito (cliente)
      </Badge>
    ) : (
      <Badge variant="outline" className="bg-chart-forecast/15 text-chart-forecast border-chart-forecast/30">
        <ShieldOff className="h-3 w-3 mr-1" /> Interno (irrestrito)
      </Badge>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Escopo de tenancy por bot. Bots internos mantêm visão ampla; bots de cliente ficam presos a um
          <span className="font-medium text-foreground"> tenant</span> e a uma lista de clínicas.
        </p>
        <Button variant="outline" onClick={fetchRows} disabled={loading} className="neu-button shrink-0">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nome do bot, id ou tenant..."
          className="neu-inset border-0 bg-transparent pl-9 pr-9"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Limpar busca"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <Card className="neu-card border-0 bg-transparent shadow-none p-2">
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            {query ? "Nenhum bot para esta busca." : "Nenhum bot cadastrado."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((r) => (
              <li key={r.id} className="flex flex-col gap-3 p-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                      <Bot className="h-4 w-4 shrink-0 text-primary" />
                      {r.label || r.id}
                    </span>
                    {modeBadge(r.access_mode)}
                    {r.enabled === false && (
                      <Badge variant="outline" className="bg-muted text-muted-foreground border-border">
                        Desabilitado
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground break-all">
                    id do bot: <span className="font-mono">{r.id}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    tenantId: <span className="font-mono text-foreground">{r.tenant_id || "—"}</span>
                    {"  ·  "}
                    clínicas: <span className="text-foreground">{r.allowed_clinic_ids.length}</span>
                    {r.allowed_clinic_ids.length > 0 && (
                      <span className="text-muted-foreground"> ({r.allowed_clinic_ids.join(", ")})</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <BotTenancyEditor row={r} onSaved={fetchRows} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Editor (dialog) de um bot: modo de acesso + tenantId + clínicas. */
function BotTenancyEditor({ row, onSaved }: { row: BotTenancyRow; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AccessMode>(row.access_mode);
  const [tenantId, setTenantId] = useState(row.tenant_id ?? "");
  const [clinics, setClinics] = useState<string[]>(row.allowed_clinic_ids);
  const [clinicDraft, setClinicDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // Re-seed quando (re)abre ou a linha muda.
  const reset = useCallback(() => {
    setMode(row.access_mode);
    setTenantId(row.tenant_id ?? "");
    setClinics(row.allowed_clinic_ids);
    setClinicDraft("");
  }, [row]);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const addClinic = () => {
    const v = clinicDraft.trim();
    if (!v) return;
    if (clinics.includes(v)) {
      setClinicDraft("");
      return;
    }
    setClinics((prev) => [...prev, v]);
    setClinicDraft("");
  };
  const removeClinic = (v: string) => setClinics((prev) => prev.filter((c) => c !== v));

  const restrictedInvalidTenant = mode === "restricted" && !validTenantId(tenantId);
  const dirty =
    mode !== row.access_mode ||
    (tenantId.trim() || null) !== (row.tenant_id || null) ||
    JSON.stringify(clinics) !== JSON.stringify(row.allowed_clinic_ids);

  const persist = async () => {
    setSaving(true);
    // Ao virar restrito, capacidades default seguras (leitura + export/plot). Ao virar interno,
    // volta ao wildcard. Interno ignora tenant/clínicas (o bridge também ignora nesse modo).
    const nextCaps =
      mode === "restricted"
        ? ["leads.read", "metrics.read", "pipeline.read", "tasks.read", "export", "plot"]
        : ["*"];
    const patch = {
      access_mode: mode,
      tenant_id: mode === "restricted" ? tenantId.trim() : null,
      allowed_clinic_ids: mode === "restricted" ? clinics : [],
      allowed_capabilities: nextCaps,
    };
    const { error } = await supabase.from("chatbot_bots").update(patch).eq("id", row.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Tenancy do bot "${row.label || row.id}" atualizada.`);
    setOpen(false);
    onSaved();
  };

  // Rebaixar um bot restrito para interno remove as restrições — exige confirmação explícita.
  const isLoosening = row.access_mode === "restricted" && mode === "internal_unrestricted";

  const saveButton = isLoosening ? (
    <ConfirmActionDialog
      title="Remover restrições do bot"
      description={
        <>
          Este bot é <span className="font-semibold text-foreground">restrito</span>. Salvar como{" "}
          <span className="font-semibold text-foreground">interno (irrestrito)</span> remove o tenant e as clínicas,
          liberando visão ampla. Tem certeza?
        </>
      }
      confirmLabel="Remover restrições"
      onConfirm={persist}
      trigger={
        <Button disabled={saving || !dirty} className="neu-button-primary">
          {saving ? "..." : "Salvar"}
        </Button>
      }
    />
  ) : (
    <Button onClick={persist} disabled={saving || !dirty || restrictedInvalidTenant} className="neu-button-primary">
      {saving ? "..." : "Salvar"}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="neu-button">
          <Pencil className="h-4 w-4" /> Editar tenancy
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tenancy de {row.label || row.id}</DialogTitle>
          <DialogDescription>
            Bots internos têm visão ampla. Bots de cliente ficam presos ao tenant e às clínicas abaixo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Modo de acesso</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as AccessMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="internal_unrestricted">Interno (irrestrito)</SelectItem>
                <SelectItem value="restricted">Restrito (bot de cliente)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "restricted" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="tenant-id">tenantId</Label>
                <Input
                  id="tenant-id"
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  placeholder="ex.: clinica-acme"
                  className={restrictedInvalidTenant && tenantId ? "border-destructive" : ""}
                />
                {restrictedInvalidTenant ? (
                  <p className="text-xs text-destructive">
                    Obrigatório. Use letras, números e . _ : - (sem espaços), até 64 caracteres.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Identificador estruturado do tenant do cliente.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>allowedClinicIds</Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={clinicDraft}
                    onChange={(e) => setClinicDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addClinic();
                      }
                    }}
                    placeholder="Adicionar id de clínica e Enter"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addClinic} disabled={!clinicDraft.trim()}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {clinics.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhuma clínica liberada ainda. Sem clínicas, o bot fica sem escopo de clínica.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {clinics.map((c) => (
                      <Badge
                        key={c}
                        variant="outline"
                        className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30 gap-1 pr-1"
                      >
                        <span className="font-mono">{c}</span>
                        <button
                          type="button"
                          onClick={() => removeClinic(c)}
                          className="hover:text-foreground"
                          aria-label={`Remover ${c}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={reset} disabled={saving || !dirty} title="Descartar alterações">
            <RotateCcw className="h-4 w-4" /> Restaurar
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancelar
          </Button>
          {saveButton}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
