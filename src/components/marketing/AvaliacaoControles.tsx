import {
  Archive,
  CheckCircle2,
  Copy,
  PenLine,
  ShieldAlert,
  Star,
  Tag as TagIcon,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AVALIACAO_VAZIA, type AvaliacaoItem } from "@/lib/avaliacoesApi";
import { useDefinirTag, useVotar } from "@/hooks/useAvaliacoes";
import { TAGS_AVALIACAO, getTag } from "../../../shared/avaliacao-tags";
import type { AlvoAvaliacao, Voto } from "../../../shared/avaliacao-tags";

/**
 * Voto (+/−) e tag — o MESMO componente para análise da Mineração e composição do Composer.
 *
 * Um componente para os dois porque é um sistema só: o `alvo` é o parâmetro. Duplicá-lo garantiria
 * que as duas telas divergissem na primeira mudança.
 */

/**
 * `shared/avaliacao-tags.js` guarda o NOME do ícone, não o componente, porque ele é lido também pelo
 * worker, que não tem React. O mapa mora aqui, onde há UI — e o `?? TagIcon` é o que impede uma tag
 * nova de quebrar a tela antes de alguém lembrar de acrescentar o ícone.
 */
const ICONES: Record<string, LucideIcon> = {
  Star,
  CheckCircle2,
  PenLine,
  Copy,
  ShieldAlert,
  Archive,
};

/**
 * As classes precisam ser strings LITERAIS: o Tailwind varre o código e não enxerga
 * `bg-${cor}-500/10`. Então o mapa é explícito, por família de cor do vocabulário.
 */
const CORES: Record<string, string> = {
  amber: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  blue: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
  zinc: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/30",
  red: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
  slate: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30",
};

/**
 * O chip da tag — cor, ícone E rótulo, os três.
 *
 * Cor sozinha não é sinal acessível: falha para cerca de 8% dos homens e some em captura de tela em
 * escala de cinza. O ícone sobrevive aos dois casos, e o rótulo não depende de nenhum deles.
 */
export function TagChip({ tag, className = "" }: { tag: string | null; className?: string }) {
  const def = getTag(tag);
  if (!def) return null;
  const Icon = ICONES[def.icone] ?? TagIcon;
  return (
    <span
      title={def.descricao}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${
        CORES[def.cor] ?? CORES.zinc
      } ${className}`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {def.label}
    </span>
  );
}

/**
 * Os controles: dois botões de voto e o seletor de tag.
 *
 * `compacto` é para o card/linha de lista, onde o espaço é curto e a descrição não cabe. A diferença
 * é só de tamanho — o comportamento é o mesmo nos dois, porque votar é a ação que a pessoa repete
 * varrendo a lista, e mudar o gesto entre as telas a faria errar.
 */
export function AvaliacaoControles({
  alvo,
  id,
  avaliacao,
  compacto = false,
}: {
  alvo: AlvoAvaliacao;
  id: string;
  avaliacao?: AvaliacaoItem;
  compacto?: boolean;
}) {
  const a = avaliacao ?? AVALIACAO_VAZIA;
  const votar = useVotar(alvo);
  const definirTag = useDefinirTag(alvo);
  const def = getTag(a.tag);

  // Clicar no voto que já está marcado TIRA o voto. Sem isso não haveria como desfazer um clique
  // errado, e "votei por engano" é mais comum que "mudei de ideia".
  const clique = (v: Exclude<Voto, null>) =>
    votar.mutate({ id, voto: a.meuVoto === v ? null : v });

  const tamanho = compacto ? "h-3 w-3" : "h-3.5 w-3.5";
  const padding = compacto ? "px-1 py-0.5" : "px-1.5 py-1";

  return (
    <div className="flex flex-wrap items-center gap-1">
      <div className="inline-flex items-center rounded-md border border-border">
        <button
          type="button"
          onClick={() => clique(1)}
          aria-pressed={a.meuVoto === 1}
          aria-label={a.meuVoto === 1 ? "Tirar meu voto positivo" : "Votar positivamente"}
          className={`inline-flex items-center gap-1 rounded-l-md ${padding} text-[11px] font-medium tabular-nums transition-colors ${
            a.meuVoto === 1
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ThumbsUp className={tamanho} />
          {a.positivos > 0 && a.positivos}
        </button>
        <button
          type="button"
          onClick={() => clique(-1)}
          aria-pressed={a.meuVoto === -1}
          aria-label={a.meuVoto === -1 ? "Tirar meu voto negativo" : "Votar negativamente"}
          className={`inline-flex items-center gap-1 rounded-r-md border-l border-border ${padding} text-[11px] font-medium tabular-nums transition-colors ${
            a.meuVoto === -1
              ? "bg-destructive/15 text-destructive"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ThumbsDown className={tamanho} />
          {a.negativos > 0 && a.negativos}
        </button>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={def ? `Tag: ${def.label}. Trocar` : "Definir tag"}
            className="inline-flex items-center"
          >
            {def ? (
              <TagChip tag={a.tag} />
            ) : (
              <span
                className={`inline-flex items-center gap-1 rounded-md border border-dashed border-border ${padding} text-[11px] text-muted-foreground hover:text-foreground`}
              >
                <TagIcon className={tamanho} />
                tag
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {TAGS_AVALIACAO.map((t) => {
            const Icon = ICONES[t.icone] ?? TagIcon;
            return (
              <DropdownMenuItem
                key={t.id}
                onSelect={() => definirTag.mutate({ id, tag: t.id })}
                className="gap-2"
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">
                  <span className="block text-xs font-medium">{t.label}</span>
                  {/* A descrição no menu é o que mantém o vocabulário consistente entre as pessoas:
                      sem ela, "Ajustar" e "Genérico" viram interpretação de cada um. */}
                  <span className="block text-[11px] text-muted-foreground">{t.descricao}</span>
                </span>
                {a.tag === t.id && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </DropdownMenuItem>
            );
          })}
          {a.tag && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => definirTag.mutate({ id, tag: null })}
                className="text-xs text-muted-foreground"
              >
                Tirar a tag
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
