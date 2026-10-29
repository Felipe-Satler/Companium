import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/external-supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Bot } from "lucide-react";

type BotRow = { id: string; label: string};

// Valor sentinela p/ "sem bot" no Select (Radix não aceita value=""). Ao salvar,
// remove a config do usuário → cliente fica sem a página de chat; interno cai no default.
const NONE = "__none__";

/** Admin-only per-user agent config. Writes to user_bot_sttings (RLS enforces admin) */
export function UserBotSettings({ userId, email}: { userId: string; email: string}) {
    const [open, setOpen] = useState(false);
    const [botId, setBotId] = useState("");
    const [canSwitch, setCanSwitch] = useState(false);
    const [allowed, setAllowed] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);

    // load the catalog + this user's current settings when the dialog opens
    const { data } = useQuery({
        queryKey: ['admin-user-bot', userId],
        enabled: open,
        queryFn: async () => {
            const [botsRes, settingRes] = await Promise.all([
                supabase.from("chatbot_bots").select("id,label").eq("enabled", true),
                supabase
                    .from("user_bot_settings")
                    .select("bot_id,can_switch,allowed_bots")
                    .eq("user_id", userId)
                    .maybeSingle(),
            ]);
            return {
                bots: (botsRes.data ?? []) as BotRow[],
                settings: settingRes.data as
                    | { bot_id: string; can_switch: boolean; allowed_bots: string[]}
                    | null,
            };
        },
    });

    // seed the form when data arrives (sem linha ou bot_id vazio → "Nenhum")
    useEffect(() => {
        if (!data) return;
        setBotId(data.settings?.bot_id || NONE);
        setCanSwitch(!!data.settings?.can_switch);
        setAllowed(data.settings?.allowed_bots ?? []);
    }, [data]);

    const bots = data?.bots ?? [];
    const toggleAllowed = (id: string, on: boolean) => 
        setAllowed((prev) => ( on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));

    const save = async () => {
        setSaving(true);
        // "Nenhum": remove a config → sem bot (limpa também bot atribuído e permitidos,
        // senão o cliente pegaria o 1º permitido). Cliente: sem página de chat.
        const { error } = botId === NONE
            ? await supabase.from("user_bot_settings").delete().eq("user_id", userId)
            : await supabase.from("user_bot_settings").upsert({
                user_id: userId,
                bot_id: botId,
                can_switch: canSwitch,
                allowed_bots: canSwitch ? allowed : [],
                updated_at: new Date().toISOString(),
            });
        setSaving(false);
        if (error) return toast.error(error.message);
        toast.success("Configurações salvas");
        setOpen(false);
    };

    return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs font-medium neu-button">
              <Bot className="h-3.5 w-3.5" /> Bot
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-center">
          Definir a qual bot de chat este usuário tem acesso.
        </TooltipContent>
      </Tooltip>
      <DialogContent>
        <DialogHeader><DialogTitle>Agente de {email}</DialogTitle></DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Agente atribuído</Label>
            <Select value={botId} onValueChange={setBotId}>
              <SelectTrigger><SelectValue placeholder="Selecione um agente" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Nenhum (sem chat)</SelectItem>
                {bots.map((b) => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {botId === NONE && (
              <p className="text-xs text-muted-foreground">
                Sem agente: o cliente não vê a página de chat. (Usuário interno cai no agente padrão.)
              </p>
            )}
          </div>

          {botId !== NONE && (
          <div className="flex items-center justify-between">
            <Label htmlFor="can-switch">Permitir trocar de agente no chat</Label>
            <Switch id="can-switch" checked={canSwitch} onCheckedChange={setCanSwitch} />
          </div>
          )}

          {botId !== NONE && canSwitch && (
            <div className="space-y-2">
              <Label>Agentes que pode escolher</Label>
              {bots.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={allowed.includes(b.id)}
                    onCheckedChange={(v) => toggleAllowed(b.id, !!v)}
                  />
                  {b.label}
                </label>
              ))}
              <p className="text-xs text-muted-foreground">
                O agente atribuído é sempre permitido, mesmo fora da lista.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}