import { useState } from "react";
import { supabase } from "@/integrations/external-supabase/client";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Check, UserRound, UserRoundX } from "lucide-react";
import {
  canonicalizeAdsClient,
  clientCmpKey,
  clientMatchKey,
  adsClientSearchCore,
  getRawClientNames,
  normalizeClientName,
} from "@/data/clienteAliases";
import type { AdminClientOption } from "@/hooks/useAdminClientOptions";

/**
 * Controle de "usuário-cliente" (acesso restrito a UM cliente) na tela de Administração.
 * Ao vincular, PRECOMPUTA os identificadores do cliente (cmpkeys do CRM + nomes crus de conta
 * Ads) usando os helpers canônicos do frontend e grava em user_client_scope. O isolamento
 * real dos dados é imposto no banco (RLS/views) a partir desses identificadores.
 */
export function AdminClientUserControl({
  userId,
  currentSlug,
  clients,
  disabled,
  onChanged,
}: {
  userId: string;
  currentSlug: string | null;
  clients: AdminClientOption[];
  disabled?: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);

  const computeScope = async (slug: string): Promise<{ cmpkeys: string[]; ads_names: string[] }> => {
    const target = clientCmpKey(slug);

    // cmpkeys do CRM/Kommo: chave canônica do slug + variantes conhecidas (aliases).
    const cmpSet = new Set<string>();
    for (const v of [slug, canonicalizeAdsClient(slug), ...getRawClientNames(canonicalizeAdsClient(slug))]) {
      const k = clientMatchKey(v);
      if (k) cmpSet.add(k);
    }

    // ads_names: nomes CRUS de conta Ads cujo cmpKey bate com o cliente. Enumera os clientes
    // DISTINTOS de Ads (mesma fonte do dropdown) e casa por chave CANÔNICA — assim pega contas
    // sob nome com typo ("Ronard" por "Ronald") ou estrutura atípica ("CA 2.4.01") que um
    // ilike por núcleo do slug perderia. Fallback: ilike por núcleo se a RPC falhar.
    const adsSet = new Set<string>();
    const { data: adsList, error: adsErr } = await supabase.rpc("list_ads_clients");
    if (!adsErr && Array.isArray(adsList)) {
      for (const r of (adsList as { client: string | null }[])) {
        const c = r.client;
        if (c && clientCmpKey(c) === target) adsSet.add(c);
      }
    } else {
      const core = adsClientSearchCore(slug);
      if (core && core.length >= 3) {
        const { data } = await supabase
          .from("v_meta_google_ads")
          .select("Client")
          .ilike("Client", `%${core}%`)
          .limit(5000);
        for (const r of ((data as any[]) || [])) {
          const c = r.Client as string;
          if (c && clientCmpKey(c) === target) adsSet.add(c);
        }
      }
    }
    // matchkey das contas de Ads casadas também entra nos cmpkeys (defensivo).
    for (const c of adsSet) {
      const k = clientMatchKey(c);
      if (k) cmpSet.add(k);
    }

    // Variantes CRUS do Kommo que pertencem ao cliente → matchkey do nome CRU. A RLS do Kommo
    // casa via client_matchkey(client) sobre o nome BRUTO (sem normalizar/alias), então um
    // cliente com 2+ grafias no Kommo (ex.: "Ronald" + "Dr._Ronald") só é totalmente visível
    // se AMBAS as matchkeys cruas estiverem no escopo.
    const { data: kommoList, error: kommoErr } = await supabase.rpc("list_kommo_clients");
    if (!kommoErr && Array.isArray(kommoList)) {
      for (const r of (kommoList as { client: string | null }[])) {
        const c = r.client;
        if (c && clientCmpKey(normalizeClientName(c)) === target) {
          const k = clientMatchKey(c);
          if (k) cmpSet.add(k);
        }
      }
    }

    return { cmpkeys: [...cmpSet], ads_names: [...adsSet] };
  };

  const save = async () => {
    const opt = clients.find((c) => c.slug === picked);
    if (!opt) {
      toast.error("Selecione um cliente.");
      return;
    }
    if (!opt.id) {
      toast.error("Esse cliente ainda não está cadastrado na base de clientes — cadastre-o em Clientes para poder vincular.");
      return;
    }
    setBusy(true);
    try {
      const { cmpkeys, ads_names } = await computeScope(opt.slug);
      const { error } = await supabase.from("user_client_scope").upsert(
        {
          user_id: userId,
          client_id: opt.id,
          client_slug: opt.slug,
          cmpkeys,
          ads_names,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
      toast.success(`Usuário vinculado a ${opt.label} (acesso restrito).`);
      setOpen(false);
      setPicked("");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || "Falha ao vincular o cliente.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    const { error } = await supabase.from("user_client_scope").delete().eq("user_id", userId);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Acesso de usuário-cliente removido.");
    onChanged();
  };

  if (currentSlug) {
    // Vinculado (ON): azul sólido, igual ao badge "Usuário-cliente".
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            onClick={remove}
            disabled={busy || disabled}
            className="h-7 gap-1 px-2 text-xs font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/40 hover:bg-blue-500/25 hover:text-blue-400"
          >
            <UserRoundX className="h-3.5 w-3.5" />
            Remover cliente
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-center">
          Remover o vínculo de usuário-cliente e o acesso restrito a um único cliente.
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            {/* Não vinculado (OFF): neutro apagado, borda tracejada. */}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || disabled}
              className="h-7 gap-1 px-2 text-xs font-medium neu-button text-muted-foreground border-dashed hover:text-foreground"
            >
              <UserRound className="h-3.5 w-3.5" />
              Usuário-cliente
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-center">
          Vincular o usuário a um único cliente, com acesso restrito e somente leitura.
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72 p-3 space-y-2">
        <p className="text-xs font-medium text-foreground">Vincular a um cliente (acesso restrito)</p>
        <p className="text-[10px] text-muted-foreground">
          O usuário verá SÓ este cliente (CRM/Meta/Google), somente leitura.
        </p>
        {/* Lista inline (cmdk) — NÃO usar SearchableSelect aqui: ele abre um Popover
            próprio e, aninhado dentro deste PopoverContent, a lista de clientes não
            renderiza (Popover-dentro-de-Popover). Command direto resolve. */}
        <Command className="rounded-md border border-border">
          <CommandInput placeholder="Buscar cliente..." className="text-xs" />
          <CommandList className="max-h-52">
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
              {clients.length === 0 ? "Carregando clientes..." : "Nenhum cliente encontrado."}
            </CommandEmpty>
            <CommandGroup>
              {clients.map((c) => (
                <CommandItem key={c.slug} value={c.label} onSelect={() => setPicked(c.slug)} className="text-xs">
                  <Check className={cn("mr-2 h-3.5 w-3.5", picked === c.slug ? "opacity-100" : "opacity-0")} />
                  {c.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={busy} className="text-xs">
            Cancelar
          </Button>
          <Button size="sm" onClick={save} disabled={busy || !picked} className="neu-button-primary text-xs">
            {busy ? "..." : "Vincular"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
