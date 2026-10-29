import { useState, type ReactNode } from "react";
import { CheckCheck, ChevronsUpDown, Loader2, MessageCircleQuestion, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  contarRespostas,
  grupoDe,
  pendentes,
  perguntasGuardadas,
  PERGUNTAS_PRONTAS,
  rotuloDaPergunta,
  temRespostas,
} from "@/components/marketing/mineracao/perguntaGrid";
import { MAX_PERGUNTA_CHARS, type SpyAd, type SpyQuestion, type SpyResposta } from "@/lib/adSpyApi";

type Props = {
  ads: SpyAd[];
  question: SpyQuestion | null | undefined;
  onAsk: (pergunta: string) => void;
  isAsking: boolean;
  onClear: () => void;
  /** Marca para a análise as peças que atendem, na ordem do grid. */
  onSelectMatching: (ids: number[]) => void;
  /** Busca ou análise em andamento: o grid está mudando, ou o agente está ocupado. */
  disabled?: boolean;
};

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * "Perguntar ao grid": a pessoa escreve o que procura e o agente lê todas as peças por ela.
 *
 * Fica acima do grid porque muda a ORDEM dele. A pergunta é texto livre de propósito — as prontas
 * são atalho, não cardápio: o que vale a pena perguntar depende do que a pessoa está montando.
 */
export function PerguntaGrid({ ads, question, onAsk, isAsking, onClear, onSelectMatching, disabled }: Props) {
  const [texto, setTexto] = useState(question?.texto ?? "");
  const rodando = question?.status === "running" || isAsking;
  const pergunta = texto.replace(/\s+/g, " ").trim();
  const podePerguntar = pergunta.length >= 5 && !rodando && !disabled;

  const comRespostas = temRespostas(question);
  const n = contarRespostas(ads, question);
  // Só faz sentido oferecer "ler as que faltam" para a pergunta que está na tela.
  const faltam = question?.status === "done" && question.texto === pergunta ? pendentes(ads, question) : 0;
  const atendem = ads.filter((ad) => grupoDe(question, ad) === "atende").map((ad) => ad.id);
  const guardadas = perguntasGuardadas(question);

  return (
    <section aria-label="Perguntar ao grid" className="space-y-2.5 rounded-xl border border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <h3 className="text-sm font-semibold">Perguntar ao grid</h3>
          <p className="text-xs text-muted-foreground">
            O agente lê {plural(ads.length, "peça", "peças")} e põe na frente as que atendem, com o trecho
            que mostra por quê. Não gasta crédito de busca.
          </p>
        </div>
      </div>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (podePerguntar) onAsk(pergunta);
        }}
      >
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={MAX_PERGUNTA_CHARS}
          aria-label="Pergunta sobre as peças"
          placeholder="Ex.: o anúncio fala de preço ou parcelamento?"
          className="h-9 min-w-[16rem] flex-1 text-sm"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-9 text-xs" aria-label="Perguntas prontas">
              Perguntas prontas
              <ChevronsUpDown className="ml-1 h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {PERGUNTAS_PRONTAS.map((p) => (
              // Preenche o campo, não pergunta: a leitura leva tempo, e quem começa é quem clica.
              <DropdownMenuItem key={p.rotulo} onSelect={() => setTexto(p.pergunta)}>
                {p.rotulo}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="submit" size="sm" className="h-9" disabled={!podePerguntar}>
          {rodando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          {faltam > 0 ? `Ler ${plural(faltam, "peça que falta", "peças que faltam")}` : "Perguntar"}
        </Button>
      </form>

      {guardadas.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Perguntas já feitas nesta busca">
          <span className="text-[11px] text-muted-foreground">Já respondidas:</span>
          {guardadas.map((g) => (
            // Voltar a uma pergunta guardada não relê o grid: só o que tiver chegado depois dela.
            <button
              key={g.texto}
              type="button"
              title={g.texto}
              disabled={rodando || disabled}
              onClick={() => onAsk(g.texto)}
              className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {rotuloDaPergunta(g.texto)}
            </button>
          ))}
        </div>
      )}

      {question?.status === "running" && (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Lendo as peças… {question.feito} de {question.total}
        </p>
      )}

      {question?.status === "error" && (
        <p className="text-xs text-destructive" role="alert">
          {question.error || "Não foi possível responder à pergunta."}
        </p>
      )}

      {comRespostas && question.status !== "running" && (
        <div className="space-y-2 border-t border-border pt-2.5">
          <p className="text-xs text-muted-foreground">
            Ordenado por: <span className="font-medium text-foreground">“{question.texto}”</span>
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Contagem tom="atende">{plural(n.atende, "atende", "atendem")}</Contagem>
            <Contagem tom="parcial">{n.parcial} em parte</Contagem>
            <Contagem tom="nao">{plural(n.nao, "não atende", "não atendem")}</Contagem>
            {n.sem > 0 && <Contagem tom="sem">{n.sem} sem resposta</Contagem>}
            <span className="flex-1" />
            {atendem.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={disabled}
                onClick={() => onSelectMatching(atendem)}
              >
                <CheckCheck className="mr-1 h-3.5 w-3.5" />
                Selecionar as que atendem
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={onClear}>
              <X className="mr-1 h-3.5 w-3.5" />
              Limpar pergunta
            </Button>
          </div>
          {question.error && (
            <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <RotateCw className="h-3.5 w-3.5" />
              {question.error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

const TOM: Record<string, string> = {
  atende: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  parcial: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  nao: "bg-muted text-muted-foreground",
  sem: "border border-dashed border-border text-muted-foreground",
};

function Contagem({ tom, children }: { tom: keyof typeof TOM; children: ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${TOM[tom]}`}>{children}</span>;
}

const ROTULO: Record<string, string> = { atende: "Atende", parcial: "Atende em parte", nao: "Não atende" };

/**
 * A resposta da pergunta, no card.
 *
 * Diz também o que NÃO foi lido. Antes da análise só há título e texto; num vídeo, a fala — onde
 * costuma estar o conteúdo — ainda não existe, e um "não atende" ali vale só para a legenda.
 */
export function RespostaNoCard({ resposta, ad }: { resposta: SpyResposta | null; ad: SpyAd }) {
  if (!resposta) {
    return (
      <div className={`rounded-lg px-2 py-1.5 text-[11px] font-medium ${TOM.sem}`}>
        Ainda não lida para esta pergunta
      </div>
    );
  }
  if (!resposta.veredito) {
    return (
      <div className={`rounded-lg px-2 py-1.5 text-[11px] font-medium ${TOM.sem}`}>
        Sem texto para ler{ad.media_type === "video" ? " — o vídeo ainda não foi transcrito" : ""}
      </div>
    );
  }
  const soTexto = resposta.base === "copy" && ad.media_type === "video";
  return (
    <div className="space-y-1 rounded-lg border border-border px-2 py-1.5">
      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${TOM[resposta.veredito]}`}>
        {ROTULO[resposta.veredito]}
      </span>
      {resposta.trecho ? (
        <p className="line-clamp-4 text-xs italic text-foreground/90" title={resposta.trecho}>
          “{resposta.trecho}”
        </p>
      ) : (
        resposta.veredito !== "nao" && (
          <p className="text-[11px] text-muted-foreground">O agente não citou um trecho literal — confira no anúncio.</p>
        )
      )}
      {soTexto && (
        <p className="text-[11px] text-muted-foreground">
          Só o texto foi lido; a fala do vídeo entra depois da análise.
        </p>
      )}
    </div>
  );
}
