import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  MessageCircle,
  AtSign,
  Users,
  Plus,
  Trash2,
  Save,
  AlertTriangle,
  Power,
  Globe,
  Wrench,
} from "lucide-react";
import { useWhatsappAgent, type WhatsappGroup, type GroupScope } from "@/hooks/useWhatsappAgent";
import { WhatsappConnectionPanel } from "@/components/whatsapp/WhatsappConnectionPanel";
import { WhatsappGroupsMonitor } from "@/components/whatsapp/WhatsappGroupsMonitor";

// Tela admin: configura o agente de IA conectado ao WhatsApp que responde em grupos.
// A config é gravada em `whatsapp_group_agents` (RLS admin-only). Um serviço no servidor
// (whatsapp-agent-sync) lê essa config e aplica no gateway OpenClaw. Esta tela NÃO fala com o
// gateway direto — por segurança, tudo passa pelo banco.

export default function WhatsappAgent() {
  const { user, canManageWhatsapp, loading: authLoading } = useAuth();
  const { config, knownGroups, loading, saving, error, save } = useWhatsappAgent();

  // Estado local do formulário (espelha a config; só persiste ao salvar).
  const [displayName, setDisplayName] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [requireMention, setRequireMention] = useState(true);
  const [triggerPrefix, setTriggerPrefix] = useState("");
  const [groupScope, setGroupScope] = useState<GroupScope>("allowlist");
  const [allowlist, setAllowlist] = useState<WhatsappGroup[]>([]);
  const [toolsEnabled, setToolsEnabled] = useState(false);
  const [newGroupId, setNewGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");

  useEffect(() => {
    setDisplayName(config.display_name);
    setEnabled(config.enabled);
    setSystemPrompt(config.system_prompt);
    setRequireMention(config.require_mention);
    setTriggerPrefix(config.trigger_prefix);
    setGroupScope(config.group_scope);
    setAllowlist(config.group_allowlist);
    setToolsEnabled(config.tools_enabled);
  }, [config]);

  if (authLoading || loading) return null;
  if (!user) return <Navigate to="/auth" replace />;
  if (!canManageWhatsapp) return <Navigate to="/" replace />;

  const inAllowlist = (id: string) => allowlist.some((g) => g.id === id);
  const toggleGroup = (g: WhatsappGroup) =>
    setAllowlist((prev) =>
      prev.some((x) => x.id === g.id) ? prev.filter((x) => x.id !== g.id) : [...prev, g],
    );
  const addManualGroup = () => {
    const id = newGroupId.trim();
    if (!id) return;
    if (inAllowlist(id)) {
      toast.error("Esse grupo já está na lista.");
      return;
    }
    setAllowlist((prev) => [...prev, { id, name: newGroupName.trim() || id }]);
    setNewGroupId("");
    setNewGroupName("");
  };

  const onSave = async () => {
    try {
      await save({
        display_name: displayName.trim() || "Agente WhatsApp (Grupos)",
        enabled,
        system_prompt: systemPrompt,
        require_mention: requireMention,
        trigger_prefix: triggerPrefix.trim(),
        group_scope: groupScope,
        group_allowlist: allowlist,
        tools_enabled: toolsEnabled,
      });
      toast.success("Configuração salva. O servidor aplica no WhatsApp no próximo ciclo de sync.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    }
  };

  const canEnable = groupScope === "all" || allowlist.length > 0;

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-6">
        {/* Cabeçalho */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Agente de WhatsApp (Grupos)</h1>
            <p className="text-sm text-muted-foreground">
              Configure como o agente de IA responde nos grupos de WhatsApp conectados.
            </p>
          </div>
          <div className="ml-auto">
            <Badge
              variant="outline"
              className={
                enabled
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "border-border bg-muted text-muted-foreground"
              }
            >
              <Power className="mr-1 h-3 w-3" />
              {enabled ? "Ativo" : "Desligado"}
            </Badge>
          </div>
        </div>

        {error && (
          <Card className="border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            Não foi possível carregar a configuração do banco ({error}). Verifique se a migration foi
            aplicada e se você tem papel de admin.
          </Card>
        )}

        {/* Conexão ao vivo: status + QR + reconectar, tudo pela tela */}
        <WhatsappConnectionPanel />

        {/* Acompanhamento: andamento dos grupos, sentimento da conversa e do atendimento */}
        <WhatsappGroupsMonitor />

        {/* Identidade + liga/desliga */}
        <Card className="space-y-4 p-4">
          <div className="grid gap-2">
            <Label htmlFor="displayName">Nome do agente</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Agente WhatsApp (Grupos)"
            />
          </div>

          <Separator />

          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Power className="h-4 w-4" /> Agente ligado
              </div>
              <p className="text-sm text-muted-foreground">
                Mestre liga/desliga. Só responde quando ligado, o WhatsApp estiver conectado e houver
                pelo menos um grupo liberado.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={(v) => {
                if (v && !canEnable) {
                  toast.error("Libere pelo menos um grupo antes de ligar o agente.");
                  return;
                }
                setEnabled(v);
              }}
            />
          </div>
        </Card>

        {/* Comportamento / segurança */}
        <Card className="space-y-4 p-4">
          <div className="text-sm font-medium text-foreground">Comportamento nos grupos</div>

          {/* Escopo de grupos: allowlist x todos */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Globe className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Responder em todos os grupos
              </div>
              <p className="text-sm text-muted-foreground">
                Ligado: responde em <strong>qualquer grupo onde o número estiver</strong>. Desligado:
                responde só nos grupos da allowlist (abaixo). Em todos os grupos, cuide do gatilho e das
                funções — pode alcançar grupos de clientes.
              </p>
            </div>
            <Switch
              checked={groupScope === "all"}
              onCheckedChange={(v) => setGroupScope(v ? "all" : "allowlist")}
            />
          </div>

          <Separator />

          {/* Gatilho: as 2 opções (mencionado x qualquer mensagem) */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <AtSign className="h-4 w-4 text-sky-600 dark:text-sky-400" /> Só responder quando mencionado
              </div>
              <p className="text-sm text-muted-foreground">
                <strong>Ligado:</strong> só responde quando marcarem o número (@) ou responderem a uma
                mensagem dele. <strong>Desligado:</strong> responde a <strong>qualquer mensagem</strong> do
                grupo (mais ruído e custo).
              </p>
            </div>
            <Switch checked={requireMention} onCheckedChange={setRequireMention} />
          </div>

          <Separator />

          <div className="grid gap-2">
            <Label htmlFor="prefix">Prefixo de gatilho (opcional)</Label>
            <Input
              id="prefix"
              value={triggerPrefix}
              onChange={(e) => setTriggerPrefix(e.target.value)}
              placeholder="ex.: /groo"
            />
            <p className="text-xs text-muted-foreground">
              Se preenchido, o agente só responde mensagens que começam com este prefixo. Deixe vazio para
              não exigir prefixo.
            </p>
          </div>
        </Card>

        {/* Prompt */}
        <Card className="space-y-2 p-4">
          <Label htmlFor="prompt">Instruções do agente (prompt)</Label>
          <Textarea
            id="prompt"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={10}
            placeholder="Descreva a persona, o tom e o que o agente pode/não pode responder."
          />
          <p className="text-xs text-muted-foreground">
            Este texto vira o comportamento do agente. Seja específico sobre escopo e limites (ex.: “não
            fale de preços”, “não prometa prazos”).
          </p>
        </Card>

        {/* Funções (dados CRM/Meta/ClickUp) */}
        <Card className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Wrench className="h-4 w-4 text-green-600 dark:text-green-400" /> Habilitar funções (dados do Companium)
              </div>
              <p className="text-sm text-muted-foreground">
                Ligado: o agente pode consultar <strong>CRM, Meta Ads e ClickUp</strong> (tudo que os
                chatbots da Groohub já fazem no Companium) para responder com dados reais. Desligado:
                responde só com o conhecimento do prompt (texto).
              </p>
            </div>
            <Switch checked={toolsEnabled} onCheckedChange={setToolsEnabled} />
          </div>
          {toolsEnabled && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                Com funções de dados, o agente acessa informações de <strong>todos os clientes</strong>.
                Em grupos de clientes isso pode <strong>vazar dados de um cliente para outro</strong>. Use
                em grupos internos/da equipe. O acesso é read-only e passa pelo mesmo mecanismo seguro dos
                bots da equipe (ver runbook).
              </span>
            </div>
          )}
        </Card>

        {/* Grupos (allowlist) */}
        <Card className={cn("space-y-4 p-4", groupScope === "all" && "opacity-60")}>
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Grupos liberados (allowlist)
            {groupScope === "all" && (
              <Badge variant="outline" className="ml-2 border-border text-muted-foreground">
                ignorada (modo “todos os grupos”)
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            O agente só responde nos grupos marcados abaixo. Em qualquer outro grupo ele fica calado,
            mesmo que o número esteja lá.
          </p>

          {knownGroups.length > 0 ? (
            <div className="space-y-1">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Grupos detectados
              </div>
              {knownGroups.map((g) => (
                <label
                  key={g.group_id}
                  className="flex cursor-pointer items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/50"
                >
                  <span className="truncate text-foreground">
                    {g.group_name || g.group_id}
                    <span className="ml-2 text-xs text-muted-foreground">{g.group_id}</span>
                  </span>
                  <Switch
                    checked={inAllowlist(g.group_id)}
                    onCheckedChange={() =>
                      toggleGroup({ id: g.group_id, name: g.group_name || g.group_id })
                    }
                  />
                </label>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
              Nenhum grupo detectado ainda. Eles aparecem aqui depois que o WhatsApp é conectado e o
              serviço de sync roda. Enquanto isso, você pode adicionar manualmente pelo ID abaixo.
            </div>
          )}

          {/* Adição manual */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="grid flex-1 gap-1">
              <Label htmlFor="gid" className="text-xs">ID do grupo</Label>
              <Input
                id="gid"
                value={newGroupId}
                onChange={(e) => setNewGroupId(e.target.value)}
                placeholder="ex.: 120363...@g.us"
              />
            </div>
            <div className="grid flex-1 gap-1">
              <Label htmlFor="gname" className="text-xs">Nome (opcional)</Label>
              <Input
                id="gname"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Nome do grupo"
              />
            </div>
            <Button type="button" variant="outline" onClick={addManualGroup}>
              <Plus className="mr-1 h-4 w-4" /> Adicionar
            </Button>
          </div>

          {/* Lista selecionada */}
          {allowlist.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Liberados ({allowlist.length})
              </div>
              {allowlist.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center justify-between rounded-md bg-emerald-500/10 px-3 py-2 text-sm"
                >
                  <span className="truncate text-foreground">
                    {g.name}
                    <span className="ml-2 text-xs text-muted-foreground">{g.id}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => setAllowlist((prev) => prev.filter((x) => x.id !== g.id))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Aviso de segurança */}
        <Card className="flex items-start gap-3 border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="text-muted-foreground">
            O agente envia mensagens reais em grupos de WhatsApp. Teste primeiro em um grupo interno,
            mantenha “só responder quando mencionado” ligado e libere grupos um a um. Para parar tudo na
            hora, desligue o agente aqui em cima.
          </div>
        </Card>

        {/* Salvar */}
        <div className="flex items-center justify-end gap-3">
          {config.updated_at && (
            <span className="text-xs text-muted-foreground">
              Última alteração: {new Date(config.updated_at).toLocaleString("pt-BR")}
            </span>
          )}
          <Button onClick={onSave} disabled={saving}>
            <Save className="mr-1 h-4 w-4" />
            {saving ? "Salvando…" : "Salvar configuração"}
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
