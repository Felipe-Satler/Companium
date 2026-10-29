import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Loader2,
  Recycle,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConceitosComposicao } from "@/hooks/useAdComposer";
import { acompanhar } from "@/lib/acompanhamento";
import { NIVEL_CONSCIENCIA_LABEL } from "@/lib/adSpyApi";
import {
  progressoDosConceitos,
  type CatalogoCopy,
  type Composicao,
  type SlotConceito,
} from "@/lib/adComposerApi";
import { getFormato } from "../../../../shared/ad-formats";

const erroDe = (err: unknown, padrao: string) => (err instanceof Error ? err.message : padrao);

/**
 * A etapa de Conceitos Estratégicos de uma composição (20/10/2026): um card por anúncio, com o
 * conceito que o agente sugeriu — Avatar + Nível de consciência + Ângulo + Formato — para quem pediu
 * aprovar ou rejeitar. Só com todos aprovados a composição é escrita.
 *
 * Quando o material não dá conceitos diferentes para todos os anúncios, abre o diálogo de insumos
 * insuficientes: escolher mais insumos (volta, descartando esta composição) ou seguir assim mesmo,
 * reciclando conceitos em formatos de saída diferentes.
 *
 * Só quem pediu (ou admin) decide — o `canDelete` de sempre; o worker confere de novo. Os outros
 * veem os conceitos, sem os botões.
 */
export function ConceitosComposicao({
  composicao,
  onEscolherMaisInsumos,
  nome,
}: {
  composicao: Composicao;
  /** Descarta esta composição e volta à etapa de insumos, com a seleção guardada. */
  onEscolherMaisInsumos: () => void;
  /** O nome do cliente, para o aviso de "anúncios prontos" dizer de quem é. */
  nome?: string;
}) {
  const { aprovar, rejeitar, seguir, confirmar } = useConceitosComposicao(composicao.id);
  const slots = composicao.conceitos ?? [];
  const catalogo = composicao.catalogo_copy ?? null;
  const insuficiente = composicao.insumos_insuficientes ?? null;
  const pode = composicao.canDelete;
  const { aprovados, total, gerando } = progressoDosConceitos(composicao);
  const decidirInsumos = Boolean(insuficiente && !insuficiente.seguir);

  // O diálogo abre sozinho quando a decisão aparece; fechado, a faixa no topo continua oferecendo
  // as duas saídas — fechar não é decidir.
  const [dialogo, setDialogo] = useState(decidirInsumos);
  useEffect(() => {
    if (decidirInsumos) setDialogo(true);
  }, [decidirInsumos]);

  const seguirAssim = () =>
    seguir.mutate(undefined, {
      onSuccess: () => {
        setDialogo(false);
        toast.success("Seguindo — o agente completa os anúncios que faltam, reciclando conceitos.");
      },
      onError: (err) => toast.error(erroDe(err, "Não foi possível seguir")),
    });

  const comecar = () =>
    confirmar.mutate(undefined, {
      onSuccess: () => {
        // O aviso de "conceitos prontos" soltou o acompanhamento; a escrita leva minutos, então
        // ele volta, para avisar quando os anúncios ficarem prontos.
        acompanhar({ tipo: "composicao", id: composicao.id, nome: nome || composicao.nome_exibicao || composicao.cliente });
        toast.success("Conceitos aprovados — escrevendo os anúncios.");
      },
      onError: (err) => toast.error(erroDe(err, "Não foi possível começar a composição")),
    });

  if (!slots.length && !insuficiente) {
    return (
      <p className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-4 text-xs" role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        Lendo o Estudo de Copy e sugerindo um conceito estratégico por anúncio…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Cada anúncio nasce de um conceito: <span className="font-medium text-foreground">avatar</span>,{" "}
        <span className="font-medium text-foreground">nível de consciência</span>,{" "}
        <span className="font-medium text-foreground">ângulo</span> e{" "}
        <span className="font-medium text-foreground">formato</span>. Conceitos iguais a Meta trata como o mesmo
        anúncio, então nenhum se repete.
      </p>

      {insuficiente && (
        <FaixaInsumos
          insuficiente={insuficiente}
          pode={pode}
          seguindo={seguir.isPending}
          onSeguir={seguirAssim}
          onEscolherMaisInsumos={onEscolherMaisInsumos}
        />
      )}

      {catalogo?.avatares_origem === "agente" && (
        // O código só lê o modelo padrão do Estudo; fora dele, quem achou os avatares foi o agente
        // (com trechos conferidos no texto). Vale um olho antes de aprovar.
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          Este Estudo de Copy não segue o modelo padrão: os{" "}
          <span className="font-medium text-foreground">{catalogo.avatares.length} avatares</span> foram identificados
          pelo agente nas personas do Estudo. Confira se estão certos antes de aprovar.
        </p>
      )}

      {catalogo && (
        <ol className="grid gap-3 lg:grid-cols-2">
          {slots.map((slot) => (
            <CardConceito
              key={slot.n}
              slot={slot}
              slots={slots}
              catalogo={catalogo}
              pode={pode}
              aguardandoDecisao={decidirInsumos}
              onAprovar={() =>
                aprovar.mutate(slot.n, { onError: (err) => toast.error(erroDe(err, "Não foi possível aprovar")) })
              }
              onRejeitar={(motivo) =>
                rejeitar.mutateAsync({ n: slot.n, motivo }).catch((err) => {
                  toast.error(erroDe(err, "Não foi possível pedir outro conceito"));
                  throw err;
                })
              }
            />
          ))}
        </ol>
      )}

      {slots.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {aprovados} de {total} conceito{total === 1 ? "" : "s"} aprovado{aprovados === 1 ? "" : "s"}
            {gerando && " · o agente está sugerindo"}
          </span>
          {pode && (
            <Button size="sm" onClick={comecar} disabled={aprovados < total || gerando || confirmar.isPending}>
              {confirmar.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              )}
              Começar composição
            </Button>
          )}
        </div>
      )}

      {insuficiente && pode && (
        <Dialog open={dialogo && decidirInsumos} onOpenChange={setDialogo}>
          <DialogContent className="neu-dialog">
            <DialogHeader>
              <DialogTitle>
                {insuficiente.bloqueante ? "Não dá para sugerir conceitos" : "Os insumos não bastam para todos os anúncios"}
              </DialogTitle>
              <DialogDescription>{insuficiente.motivo}</DialogDescription>
            </DialogHeader>
            {insuficiente.sugestao && <p className="text-sm">{insuficiente.sugestao}</p>}
            {!insuficiente.bloqueante && (
              <p className="text-xs text-muted-foreground">
                Seguindo assim mesmo, o agente completa os anúncios que faltam repetindo conceitos — sempre em outro formato
                de saída, para a Meta não tratar dois anúncios como o mesmo.
              </p>
            )}
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={onEscolherMaisInsumos}>
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Escolher mais insumos
              </Button>
              {!insuficiente.bloqueante && (
                <Button onClick={seguirAssim} disabled={seguir.isPending}>
                  {seguir.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Recycle className="mr-1.5 h-3.5 w-3.5" />}
                  Seguir assim mesmo
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function FaixaInsumos({
  insuficiente,
  pode,
  seguindo,
  onSeguir,
  onEscolherMaisInsumos,
}: {
  insuficiente: NonNullable<Composicao["insumos_insuficientes"]>;
  pode: boolean;
  seguindo: boolean;
  onSeguir: () => void;
  onEscolherMaisInsumos: () => void;
}) {
  if (insuficiente.seguir) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <Recycle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Seguindo com os insumos que há: onde faltou conceito novo, o agente recicla um conceito em outro formato de saída.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <div className="min-w-0 flex-1 text-xs">
        <p className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          {insuficiente.bloqueante ? "Não dá para sugerir conceitos" : "Os insumos não bastam para todos os anúncios"}
        </p>
        <p className="mt-0.5">{insuficiente.motivo}</p>
        {insuficiente.sugestao && <p className="mt-0.5 text-muted-foreground">{insuficiente.sugestao}</p>}
      </div>
      {pode && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onEscolherMaisInsumos}>
            Escolher mais insumos
          </Button>
          {!insuficiente.bloqueante && (
            <Button size="sm" onClick={onSeguir} disabled={seguindo}>
              Seguir assim mesmo
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

const ROTULO_ESTADO: Record<SlotConceito["status"], string> = {
  pendente: "Aguardando sua decisão",
  gerando: "Sugerindo…",
  sugerido: "Sugerido",
  aprovado: "Aprovado",
  erro: "Sem conceito",
};

function CardConceito({
  slot,
  slots,
  catalogo,
  pode,
  aguardandoDecisao,
  onAprovar,
  onRejeitar,
}: {
  slot: SlotConceito;
  slots: SlotConceito[];
  catalogo: CatalogoCopy;
  pode: boolean;
  aguardandoDecisao: boolean;
  onAprovar: () => void;
  onRejeitar: (motivo: string) => Promise<unknown>;
}) {
  const [rejeitando, setRejeitando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const saida = getFormato(slot.formato_saida);
  const c = slot.conceito;
  const avatar = c ? catalogo.avatares.find((a) => a.id === c.avatar_id) : null;
  const angulo = c ? catalogo.angulos.find((a) => a.id === c.angulo_id) : null;
  const formato = c ? catalogo.criativos.find((x) => x.id === c.criativo_ref) : null;
  const irmaos =
    c && slot.reciclado
      ? slots
          .filter(
            (s) =>
              s.n !== slot.n &&
              s.conceito &&
              [s.conceito.avatar_id, s.conceito.nivel, s.conceito.angulo_id, s.conceito.criativo_ref].join("|") ===
                [c.avatar_id, c.nivel, c.angulo_id, c.criativo_ref].join("|"),
          )
          .map((s) => s.n + 1)
      : [];

  const enviarRejeicao = async () => {
    setEnviando(true);
    try {
      await onRejeitar(motivo.trim());
      setRejeitando(false);
      setMotivo("");
    } catch {
      /* o toast já disse */
    } finally {
      setEnviando(false);
    }
  };

  const aprovado = slot.status === "aprovado";
  return (
    <li
      aria-label={`Conceito do anúncio ${slot.n + 1}`}
      className={`flex flex-col gap-3 rounded-xl border-2 p-4 ${aprovado ? "border-primary/60 bg-primary/5" : "border-border bg-card"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Anúncio {slot.n + 1} · {saida?.label ?? slot.formato_saida}
        </h3>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            aprovado
              ? "bg-primary/15 text-primary"
              : slot.status === "erro"
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {slot.status === "gerando" && <Loader2 className="h-3 w-3 animate-spin" />}
          {aprovado && <Check className="h-3 w-3" />}
          {ROTULO_ESTADO[slot.status]}
        </span>
      </div>

      {c && (
        <dl className="grid gap-2 text-sm">
          <Parte rotulo="Avatar">{avatar?.nome ?? c.avatar_id}</Parte>
          <Parte rotulo="Nível de consciência">
            {NIVEL_CONSCIENCIA_LABEL[c.nivel] ?? c.nivel}
            {avatar && avatar.nivel && avatar.nivel !== c.nivel && (
              <Selo>diferente do Estudo ({NIVEL_CONSCIENCIA_LABEL[avatar.nivel]})</Selo>
            )}
            {avatar?.nivel_inferido && avatar.nivel === c.nivel && <Selo>o Estudo não diz o nível: inferido pelo agente</Selo>}
            {/* "Consciente do Mecanismo" não existe no sistema e é lido como consciente da
                solução: a tela mostra o que o Estudo diz, para ninguém achar que foi trocado. */}
            {avatar && avatar.nivel === c.nivel && /mecanismo/i.test(avatar.nivel_original) && (
              <span className="ml-1 text-[11px] text-muted-foreground">(o Estudo diz “{avatar.nivel_original}”)</span>
            )}
          </Parte>
          <Parte rotulo="Ângulo">
            <span className="font-medium">{angulo?.nome ?? c.angulo_id}</span>
            {angulo?.descricao && <span className="block text-xs text-muted-foreground">{angulo.descricao}</span>}
            {angulo && angulo.trechos.length > 0 && (
              <Collapsible>
                <CollapsibleTrigger className="group mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                  <ChevronDown className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180" />
                  De onde veio no Estudo
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="mt-1 space-y-1">
                    {angulo.trechos.map((t, i) => (
                      <li key={i} className="border-l-2 border-border pl-2 text-xs italic text-muted-foreground">
                        “{t}”
                      </li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            )}
          </Parte>
          <Parte rotulo="Formato">
            {formato?.nome ?? c.criativo_ref}
            {formato?.nivel && formato.nivel !== c.nivel && (
              <Selo>estrutura feita para {NIVEL_CONSCIENCIA_LABEL[formato.nivel]?.toLowerCase()}</Selo>
            )}
          </Parte>
          {slot.reciclado && (
            <p className="inline-flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-300">
              <Recycle className="h-3.5 w-3.5" />
              Reciclado: mesmo conceito do anúncio {irmaos.join(", ")}, em outro formato de saída.
            </p>
          )}
          {c.justificativa && <p className="text-xs text-muted-foreground">{c.justificativa}</p>}
        </dl>
      )}

      {slot.status === "gerando" && !c && (
        <p className="text-xs text-muted-foreground">O agente está sugerindo um conceito diferente dos outros…</p>
      )}
      {slot.status === "pendente" && (
        <p className="text-xs text-muted-foreground">
          {aguardandoDecisao
            ? "Sem conceito diferente com os insumos escolhidos. Decida entre escolher mais insumos e seguir assim mesmo."
            : "Na fila para receber um conceito."}
        </p>
      )}
      {slot.error && slot.status !== "sugerido" && slot.status !== "aprovado" && (
        <p className="text-xs text-destructive">{slot.error}</p>
      )}
      {slot.rejeitados.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {slot.rejeitados.length} conceito{slot.rejeitados.length === 1 ? "" : "s"} rejeitado
          {slot.rejeitados.length === 1 ? "" : "s"} neste anúncio
        </p>
      )}

      {pode && rejeitando && (
        <div className="space-y-2">
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Por que não? (opcional — ajuda o agente a acertar o próximo)"
            aria-label={`Motivo da rejeição do anúncio ${slot.n + 1}`}
            rows={2}
            maxLength={500}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setRejeitando(false)} disabled={enviando}>
              Voltar
            </Button>
            <Button size="sm" variant="destructive" onClick={() => void enviarRejeicao()} disabled={enviando}>
              {enviando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Rejeitar e pedir outro
            </Button>
          </div>
        </div>
      )}

      {pode && !rejeitando && (
        <div className="mt-auto flex flex-wrap justify-end gap-2">
          {slot.status === "sugerido" && (
            <>
              <Button size="sm" variant="outline" onClick={() => setRejeitando(true)}>
                <ThumbsDown className="mr-1.5 h-3.5 w-3.5" />
                Rejeitar
              </Button>
              <Button size="sm" onClick={onAprovar}>
                <ThumbsUp className="mr-1.5 h-3.5 w-3.5" />
                Aprovar
              </Button>
            </>
          )}
          {aprovado && (
            <Button size="sm" variant="ghost" onClick={() => setRejeitando(true)}>
              Trocar este conceito
            </Button>
          )}
          {slot.status === "erro" && !aguardandoDecisao && (
            <Button size="sm" variant="outline" onClick={() => void onRejeitar("")}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Tentar de novo
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function Parte({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Selo({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1.5 inline-flex rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
      {children}
    </span>
  );
}
