import * as React from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import logo from "@/assets/logo.png";
import logoLight from "@/assets/logo-light.png";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { chaveMeusPedidos, criarPedido, useMeuOptout, useMeusPedidos } from "@/hooks/usePedidosDados";
import { AVISO_ATUALIZADO_EM, TIPOS_PEDIDO, fraseDesempenho, rotuloTipoPedido, type TipoPedido } from "@/lib/usage/aviso";

/**
 * "Dados de uso do Companium" — o "Saiba mais" do aviso de coleta. Abre também sem login (link
 * na tela de entrada); logado, ganha o formulário de pedidos (cópia, dúvida, oposição).
 */
export default function Privacidade() {
  const { user, isApproved, loading } = useAuth();
  React.useEffect(() => {
    document.title = "Privacidade e dados de uso | Companium";
  }, []);

  if (loading) return null;
  if (user && isApproved) {
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
          <Conteudo />
          <Pedidos uid={user.id} />
        </div>
      </DashboardLayout>
    );
  }
  return <SemLogin />;
}

function SemLogin() {
  const { theme } = useTheme();
  return (
    <main className="min-h-screen bg-ambient bg-noise">
      <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
        <div className="flex items-center justify-between">
          <img src={theme === "dark" ? logo : logoLight} alt="Companium" className="h-9 w-auto" />
          <Button variant="ghost" size="sm" asChild>
            <Link to="/auth">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Entrar
            </Link>
          </Button>
        </div>
        <Conteudo />
        <section className="neu-card p-5 text-sm text-muted-foreground">
          Para fazer um pedido sobre os seus dados (cópia, dúvida ou oposição), entre no Companium e volte a esta página.
        </section>
      </div>
    </main>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function Conteudo() {
  const desempenho = fraseDesempenho();
  return (
    <article className="neu-card space-y-6 p-5 sm:p-7">
      <header className="flex items-center gap-3">
        <div className="neu-inset flex size-11 shrink-0 items-center justify-center rounded-full text-primary">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dados de uso do Companium</h1>
          <p className="text-xs text-muted-foreground">Última atualização: {AVISO_ATUALIZADO_EM}</p>
        </div>
      </header>

      <Secao titulo="O que registramos">
        <ul className="list-disc space-y-1 pl-5">
          <li>As telas que você abre e por quanto tempo cada uma fica em uso.</li>
          <li>Os botões que você clica, e em que ordem.</li>
          <li>Nos assistentes de IA: o tempo de uso e quantas perguntas e respostas houve.</li>
          <li>A data, a hora e o usuário de cada registro.</li>
        </ul>
      </Secao>

      <Secao titulo="Como medimos o tempo">
        <p>
          Só contamos o tempo enquanto a aba do Companium está visível e você interagiu com ela no último minuto. Uma
          aba esquecida aberta não conta.
        </p>
      </Secao>

      <Secao titulo="O que não registramos">
        <ul className="list-disc space-y-1 pl-5">
          <li>O que você digita nos campos.</li>
          <li>
            O conteúdo de tabelas e listas, como nomes de leads ou de pacientes. Nesses casos, registramos só "item de
            tabela".
          </li>
          <li>Sua tela, câmera, microfone ou teclas.</li>
          <li>Nada que você faz fora do Companium.</li>
        </ul>
        <p>
          As conversas com os assistentes de IA já ficam salvas para o histórico do chat funcionar. As métricas de uso só
          contam quantas perguntas e respostas houve. Elas não leem o conteúdo.
        </p>
      </Secao>

      <Secao titulo="Para que usamos">
        <p>Para entender quais recursos são úteis, corrigir problemas e decidir o que melhorar.</p>
        {desempenho && <p>{desempenho}</p>}
      </Secao>

      <Secao titulo="Quem vê">
        <p>
          Os administradores do Companium e as pessoas que eles autorizarem. Nenhum cliente vê dados de outros usuários.
          Não vendemos nem compartilhamos esses dados com terceiros. Eles ficam guardados no provedor de infraestrutura
          que hospeda o Companium.
        </p>
      </Secao>

      <Secao titulo="Por quanto tempo">
        <p>
          Os registros detalhados (cada tela e cada clique) são apagados após 90 dias. Depois disso, guardamos só os totais
          por dia, como o tempo por tela e o número de perguntas por assistente.
        </p>
      </Secao>

      <Secao titulo="Base legal">
        <p>Legítimo interesse em melhorar o serviço (LGPD, art. 7º, IX).</p>
      </Secao>

      <Secao titulo="Seus direitos">
        <p>
          Você pode pedir uma cópia dos seus dados de uso, tirar dúvidas ou se opor a esta coleta. Se você se opuser,
          deixamos de medir o seu uso. Use o formulário abaixo (é preciso estar logado).
        </p>
      </Secao>
    </article>
  );
}

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Pedidos({ uid }: { uid: string }) {
  const qc = useQueryClient();
  const { data: pedidos = [] } = useMeusPedidos(uid);
  const { data: optout } = useMeuOptout(uid);
  const [tipo, setTipo] = React.useState<TipoPedido>("copia");
  const [mensagem, setMensagem] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const texto = mensagem.trim() || rotuloTipoPedido(tipo);
    setEnviando(true);
    try {
      await criarPedido(uid, tipo, texto);
      setMensagem("");
      toast.success("Pedido enviado. Um administrador vai responder por aqui.");
      void qc.invalidateQueries({ queryKey: chaveMeusPedidos(uid) });
    } catch (err) {
      toast.error(`Não foi possível enviar: ${(err as Error).message}`);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <section className="neu-card space-y-5 p-5 sm:p-7">
      <div>
        <h2 className="text-base font-semibold text-foreground">Falar sobre meus dados</h2>
        <p className="text-sm text-muted-foreground">Os administradores do Companium recebem o pedido e respondem nesta página.</p>
      </div>

      {optout && (
        <p className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
          <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
          A medição do seu uso está desligada.
        </p>
      )}

      <form onSubmit={enviar} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="pedido-tipo">Assunto</Label>
          <Select value={tipo} onValueChange={(v) => setTipo(v as TipoPedido)}>
            <SelectTrigger id="pedido-tipo" className="w-full sm:w-96">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_PEDIDO.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pedido-mensagem">Mensagem (opcional)</Label>
          <Textarea
            id="pedido-mensagem"
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="Conte o que você precisa."
          />
        </div>
        <Button type="submit" disabled={enviando}>
          {enviando ? "Enviando…" : "Enviar pedido"}
        </Button>
      </form>

      {pedidos.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Seus pedidos</h3>
          <ul className="space-y-2">
            {pedidos.map((p) => (
              <li key={p.id} className="rounded-md border border-border/60 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{rotuloTipoPedido(p.tipo)}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {p.status === "resolvido" ? (
                      <CheckCircle2 className="size-3.5 text-primary" aria-hidden="true" />
                    ) : (
                      <Clock className="size-3.5" aria-hidden="true" />
                    )}
                    {p.status === "resolvido" ? "Respondido" : "Aguardando"} · {dataHora(p.created_at)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{p.mensagem}</p>
                {p.resposta && (
                  <p className="mt-2 whitespace-pre-wrap rounded bg-muted/40 px-2 py-1.5 text-foreground">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">Resposta: </span>
                    {p.resposta}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
