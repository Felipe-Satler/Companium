import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  QrCode,
  RefreshCw,
  RotateCw,
  Plug,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Power,
} from "lucide-react";
import { useWhatsappConnection } from "@/hooks/useWhatsappConnection";

function StatusBadge({ ok, okText, badText, warn }: { ok: boolean; okText: string; badText: string; warn?: boolean }) {
  return (
    <Badge
      variant="outline"
      className={
        ok
          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : warn
            ? "border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-400"
            : "border-rose-500/40 bg-rose-500/15 text-rose-600 dark:text-rose-400"
      }
    >
      {ok ? <CheckCircle2 className="mr-1 h-3 w-3" /> : warn ? <AlertTriangle className="mr-1 h-3 w-3" /> : <XCircle className="mr-1 h-3 w-3" />}
      {ok ? okText : badText}
    </Badge>
  );
}

const fmt = (ms: number | null) => (ms ? new Date(ms).toLocaleString("pt-BR") : "—");

export function WhatsappConnectionPanel() {
  const { status, loading, reachable, refresh, connect, cancelConnect, reconnect, disconnect, restart } =
    useWhatsappConnection();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  const startConnect = async () => {
    setLines([]);
    setConnecting(true);
    setOpen(true);
    try {
      await connect((event, data) => {
        if (event === "log") setLines((p) => [...p, String(data?.line ?? "")]);
        else if (event === "done") {
          setLines((p) => [...p, `— processo encerrado (código ${data?.code ?? "?"}) —`]);
          setConnecting(false);
          if (data?.status?.connected) toast.success("WhatsApp conectado!");
        }
      });
    } catch (e) {
      setLines((p) => [...p, `erro: ${e instanceof Error ? e.message : String(e)}`]);
      toast.error("Falha ao iniciar a conexão. O backend está instalado? (ver runbook)");
    } finally {
      setConnecting(false);
    }
  };

  const doAction = async (fn: () => Promise<unknown>, okMsg: string, afterConnect = false) => {
    setBusy(true);
    try {
      await fn();
      toast.success(okMsg);
      if (afterConnect) await startConnect();
    } catch {
      toast.error("Ação falhou. Verifique se o backend/plugin estão instalados (runbook).");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Plug className="h-4 w-4 text-sky-600 dark:text-sky-400" /> Conexão do WhatsApp
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <Button variant="ghost" size="icon" className="ml-auto h-7 w-7" onClick={() => void refresh()} title="Atualizar status">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {!reachable ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            O serviço de conexão ainda não está disponível. É preciso instalar uma vez (no servidor, com
            sudo): o plugin <code className="rounded bg-muted px-1">@openclaw/whatsapp</code> e o serviço{" "}
            <code className="rounded bg-muted px-1">whatsapp-admin</code> + rota nginx — passos no runbook
            <code className="rounded bg-muted px-1">WHATSAPP_AGENT.md</code>. Depois disso, tudo aqui funciona.
          </span>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge ok={!!status?.pluginInstalled} okText="Plugin OK" badText="Plugin ausente" warn />
            <StatusBadge ok={!!status?.connected} okText="Conectado" badText="Desconectado" />
            <StatusBadge ok={!!status?.active} okText="Ativo (respondendo)" badText="Inativo" warn={!!status?.connected && !status?.active} />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
            <span>Conta: <span className="text-foreground">{status?.account ?? "—"}</span></span>
            <span>Última conexão: <span className="text-foreground">{fmt(status?.lastStartAt ?? null)}</span></span>
            <span>Última queda: <span className="text-foreground">{fmt(status?.lastStopAt ?? null)}</span></span>
          </div>
          {status?.lastError && (
            <div className="flex items-start gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-600 dark:text-rose-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Último erro do canal: {String(status.lastError)}</span>
            </div>
          )}
          {status?.connected === false && status?.enabledInConfig && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
              O agente está <strong>ligado</strong> na config, mas o WhatsApp está <strong>desconectado</strong> — ele não
              vai responder até reconectar. Clique em <strong>Reconectar</strong>.
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={startConnect} disabled={busy || connecting}>
              <QrCode className="mr-1 h-4 w-4" /> {status?.connected ? "Reemitir QR" : "Conectar (QR)"}
            </Button>
            <Button variant="outline" onClick={() => doAction(reconnect, "Sessão derrubada — gerando novo QR…", true)} disabled={busy || connecting}>
              <RotateCw className="mr-1 h-4 w-4" /> Reconectar
            </Button>
            <Button variant="outline" onClick={() => doAction(restart, "Gateway reiniciando…")} disabled={busy || connecting}>
              <Power className="mr-1 h-4 w-4" /> Reiniciar gateway
            </Button>
            {status?.connected && (
              <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => doAction(disconnect, "WhatsApp desconectado.")} disabled={busy || connecting}>
                Desconectar
              </Button>
            )}
          </div>
        </>
      )}

      {/* Modal do QR / logs de conexão */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) cancelConnect(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-4 w-4" /> Conectar WhatsApp
              {connecting && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </DialogTitle>
            <DialogDescription>
              Escaneie o QR Code abaixo no WhatsApp do número (Aparelhos conectados › Conectar aparelho).
              O QR expira em ~1 min; se sumir, clique em Conectar de novo.
            </DialogDescription>
          </DialogHeader>
          <pre
            ref={logRef}
            className="max-h-[52vh] overflow-auto whitespace-pre rounded-md bg-black p-3 text-[10px] leading-[1.1] text-green-400"
          >
            {lines.length ? lines.join("\n") : "Aguardando o QR Code…"}
          </pre>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
