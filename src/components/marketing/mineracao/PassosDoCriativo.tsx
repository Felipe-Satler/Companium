import { Check, Loader2 } from "lucide-react";
import { duracao, useAgora } from "@/components/marketing/composer/tempoOrquestracao";

/**
 * As etapas de uma análise de criativo enquanto ela roda, com a atual girando, o que acontece nela
 * e há quanto tempo — na página de Análises de Criativos e no preparo do Composer.
 *
 * Buscar o vídeo, transcrever e dissecar levam minutos cada. Uma linha só ("Analisando…") era
 * indistinguível de uma tela travada: aqui se vê em que etapa está, quantas faltam e se o relógio
 * anda.
 *
 * As chaves são as que o worker grava em `etapa` (criativo.js), na ordem em que grava. A primeira
 * muda conforme a origem: "buscando o anúncio na fonte" (Mineração) ou "buscando o vídeo no
 * Facebook" (criativo do próprio cliente). Etapa que o worker pula — a transcrição, quando o vídeo
 * já tinha transcrição — aparece feita.
 */
const PASSOS = [
  {
    chaves: ["buscando o anúncio na fonte", "buscando o vídeo no Facebook"],
    rotulo: (interno: boolean) => (interno ? "Buscando o vídeo no Facebook" : "Buscando o anúncio na fonte"),
    detalhe: "o texto do anúncio e o arquivo do vídeo",
  },
  {
    chaves: ["transcrevendo o vídeo"],
    rotulo: () => "Transcrevendo a fala",
    detalhe: "o vídeo é baixado e a fala vira texto — vídeo longo leva mais",
  },
  {
    chaves: ["analisando o criativo"],
    rotulo: () => "Dissecando com o agente de análises",
    detalhe: "frase a frase, estrutura de persuasão e análise técnica",
  },
];

export function PassosDoCriativo({
  etapa,
  desde = null,
  interno = false,
}: {
  /** A etapa que o worker gravou por último. */
  etapa: string | null;
  /** Quando a etapa atual começou (o `atualizado_em` da análise: o worker grava a cada etapa). */
  desde?: string | null;
  /** Criativo do próprio cliente: a primeira etapa é buscar o vídeo no Facebook. */
  interno?: boolean;
}) {
  const agora = useAgora(true);
  const encontrado = PASSOS.findIndex((p) => p.chaves.includes(etapa ?? ""));
  // Sem etapa gravada ainda (a análise acabou de nascer), a primeira é a atual.
  const atual = encontrado === -1 ? 0 : encontrado;
  const tempo = desde ? duracao(agora - Date.parse(desde)) : null;

  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <p className="text-xs text-muted-foreground">
        Etapa {atual + 1} de {PASSOS.length}
        {tempo && <span className="tabular-nums"> · nesta etapa há {tempo}</span>}
      </p>
      <ol className="space-y-1.5">
        {PASSOS.map((p, i) => {
          const feito = i < atual;
          const agoraAqui = i === atual;
          return (
            <li key={p.chaves[0]} className="flex items-start gap-2 text-xs">
              {feito ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              ) : agoraAqui ? (
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
              ) : (
                <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border border-border" />
              )}
              <span>
                <span className={agoraAqui ? "font-medium text-foreground" : feito ? "text-muted-foreground line-through" : "text-muted-foreground"}>
                  {p.rotulo(interno)}
                </span>
                {agoraAqui && <span className="block text-[11px] text-muted-foreground">{p.detalhe}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] text-muted-foreground">Pode sair desta tela: a análise continua no servidor.</p>
    </div>
  );
}
