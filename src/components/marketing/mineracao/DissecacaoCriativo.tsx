import { Fragment, useEffect, useId, useState } from "react";
import { AlertTriangle, ArrowDown, Bot, Check, ChevronDown, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSanitizedMarkdown } from "@/hooks/useSanitizedMarkdown";
import {
  NIVEL_CONSCIENCIA_LABEL,
  type SpyCriativo,
  type SpyDissecacaoCriativo,
  type SpyFraseDissecada,
  type SpyMovimentoDissecado,
} from "@/lib/adSpyApi";
import { estruturaParaAgentes } from "../../../../shared/dissecacao-agentes";
import { estruturaComoTexto } from "@/components/marketing/mineracao/criativoExportar";

const SEM_EVIDENCIA = "Sem evidência suficiente na peça.";

const SECOES_V1: { chave: keyof SpyDissecacaoCriativo; titulo: string }[] = [
  { chave: "formato", titulo: "Formato" },
  { chave: "estrutura", titulo: "Estrutura" },
  { chave: "anatomia_semantica", titulo: "Anatomia semântica" },
  { chave: "anatomia_psicologica", titulo: "Anatomia psicológica" },
];

const SECOES_TECNICAS = SECOES_V1.filter((s) => s.chave !== "estrutura");

// Uma cor por bloco, para a faixa lateral ligar a frase ao bloco da aba Estrutura. Classes
// literais: o Tailwind só gera as que encontra escritas no código.
const CORES_BLOCO = [
  "border-l-sky-500",
  "border-l-violet-500",
  "border-l-amber-500",
  "border-l-emerald-500",
  "border-l-rose-500",
  "border-l-cyan-500",
  "border-l-orange-500",
  "border-l-lime-500",
  "border-l-fuchsia-500",
  "border-l-teal-500",
  "border-l-indigo-500",
  "border-l-yellow-500",
];

/**
 * A dissecação de um criativo. Mora aqui porque aparece em três lugares — Análises de Criativos e
 * os dois previews do Composer — e todos têm de mostrar a mesma coisa.
 *
 * Três formas, da mais nova para a mais velha:
 * - versão 2 (desde 20/10/2026): abas Estrutura / Frase a frase / Análise técnica, mais a
 *   "Estrutura para agentes de IA", recolhida;
 * - versão 1: as cinco partes do JSON;
 * - sem JSON: o texto que o agente escreveu.
 */
export function DissecacaoCriativo({ criativo }: { criativo: Pick<SpyCriativo, "dissecacao" | "dissecacao_md"> }) {
  const html = useSanitizedMarkdown(criativo.dissecacao ? null : criativo.dissecacao_md);
  const d = criativo.dissecacao;
  if (!d) {
    return html ? (
      <div
        className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-headings:text-foreground prose-p:text-muted-foreground"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    ) : null;
  }
  if (d.versao === 2) return <DissecacaoV2 d={d} />;
  return (
    <div className="space-y-3">
      {SECOES_V1.map(({ chave, titulo }) => (
        <Secao key={chave} titulo={titulo}>
          {(d[chave] as string) || SEM_EVIDENCIA}
        </Secao>
      ))}
      <SecaoNivel d={d} />
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="neu-inset rounded-lg p-4">
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h4>
      <p className="whitespace-pre-line text-sm">{children}</p>
    </section>
  );
}

function SecaoNivel({ d }: { d: SpyDissecacaoCriativo }) {
  return (
    <Secao titulo="Nível de consciência">
      {d.nivel_consciencia ? NIVEL_CONSCIENCIA_LABEL[d.nivel_consciencia] : SEM_EVIDENCIA}
    </Secao>
  );
}

function BotaoCopiar({ texto, rotulo }: { texto: () => string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto());
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      toast.error("O navegador não deixou copiar. Selecione o texto e copie à mão.");
    }
  };
  return (
    <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={copiar}>
      {copiado ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
      {copiado ? "Copiado" : rotulo}
    </Button>
  );
}

function DissecacaoV2({ d }: { d: SpyDissecacaoCriativo }) {
  const prefixo = useId();
  const [aba, setAba] = useState("estrutura");
  const [alvo, setAlvo] = useState<number | null>(null);
  const blocos = d.blocos ?? [];
  const movimentos = d.movimentos ?? [];
  const frases = d.frases ?? [];
  const ligado = d.ligacoes !== false && movimentos.length > 0 && movimentos.every((m) => m.bloco != null);
  const corDoBloco = (n: number | null) => {
    const i = blocos.findIndex((b) => b.n === n);
    return i >= 0 ? CORES_BLOCO[i % CORES_BLOCO.length] : "border-l-border";
  };
  const blocoDoMovimento = new Map(movimentos.map((m) => [m.n, m.bloco]));

  // Clicar num movimento troca de aba e leva à primeira frase dele. O scroll espera a aba nova
  // estar no DOM: por isso o efeito, e não a chamada direta no clique.
  useEffect(() => {
    if (aba !== "frases" || alvo == null) return;
    document.getElementById(`${prefixo}-mov-${alvo}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setAlvo(null);
  }, [aba, alvo, prefixo]);
  const irParaMovimento = (n: number) => {
    setAlvo(n);
    setAba("frases");
  };

  return (
    <div className="space-y-3">
      {d.cobertura_baixa && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          O frase a frase cobre pouco do que foi falado no vídeo: a análise pode ter pulado trechos.
        </p>
      )}
      <Tabs value={aba} onValueChange={setAba}>
        <TabsList className="grid h-auto w-full grid-cols-3">
          <TabsTrigger value="estrutura" className="text-xs">Estrutura</TabsTrigger>
          <TabsTrigger value="frases" className="text-xs">Frase a frase</TabsTrigger>
          <TabsTrigger value="analise" className="text-xs">Análise técnica</TabsTrigger>
        </TabsList>

        <TabsContent value="estrutura" className="space-y-3">
          {blocos.length || movimentos.length ? (
            <>
              <div className="flex justify-end">
                <BotaoCopiar texto={() => estruturaComoTexto(d)} rotulo="Copiar estrutura" />
              </div>
              {ligado && blocos.length ? (
                <ol className="space-y-1">
                  {blocos.map((b, i) => (
                    <Fragment key={b.n}>
                      {i > 0 && (
                        <li aria-hidden className="flex justify-center text-muted-foreground">
                          <ArrowDown className="h-4 w-4" />
                        </li>
                      )}
                      <li className={`neu-inset rounded-lg border-l-4 p-3 ${corDoBloco(b.n)}`}>
                        <p className="text-sm font-semibold">
                          <span className="mr-1.5 text-muted-foreground">{i + 1}.</span>
                          {b.nome}
                        </p>
                        <ListaMovimentos movimentos={movimentos.filter((m) => m.bloco === b.n)} onClick={irParaMovimento} />
                      </li>
                    </Fragment>
                  ))}
                </ol>
              ) : (
                <>
                  {blocos.length > 0 && (
                    <section className="neu-inset rounded-lg p-3">
                      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Estrutura simplificada
                      </h4>
                      <ol className="list-decimal space-y-0.5 pl-5 text-sm">
                        {blocos.map((b) => (
                          <li key={b.n}>{b.nome}</li>
                        ))}
                      </ol>
                    </section>
                  )}
                  {movimentos.length > 0 && (
                    <section className="neu-inset rounded-lg p-3">
                      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Estrutura invisível
                      </h4>
                      <ListaMovimentos movimentos={movimentos} />
                    </section>
                  )}
                </>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{SEM_EVIDENCIA}</p>
          )}
        </TabsContent>

        <TabsContent value="frases" className="space-y-4">
          <ListaFrases
            frases={frases.filter((f) => f.origem === "fala")}
            prefixo={prefixo}
            corDaFrase={(f) => (ligado ? corDoBloco(blocoDoMovimento.get(f.movimento ?? -1) ?? null) : "border-l-border")}
            vazio="Nenhuma frase da fala foi analisada."
          />
          {frases.some((f) => f.origem === "texto") && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Texto do anúncio</h4>
              <ListaFrases frases={frases.filter((f) => f.origem === "texto")} prefixo={prefixo} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="analise" className="space-y-3">
          {SECOES_TECNICAS.map(({ chave, titulo }) => (
            <Secao key={chave} titulo={titulo}>
              {(d[chave] as string) || SEM_EVIDENCIA}
            </Secao>
          ))}
          <SecaoNivel d={d} />
        </TabsContent>
      </Tabs>
      <EstruturaParaAgentes d={d} />
    </div>
  );
}

function ListaMovimentos({
  movimentos,
  onClick,
}: {
  movimentos: SpyMovimentoDissecado[];
  onClick?: (n: number) => void;
}) {
  return (
    <ul className="mt-1.5 space-y-0.5">
      {movimentos.map((m) => (
        <li key={m.n} className="text-sm text-muted-foreground">
          {onClick ? (
            <button
              type="button"
              onClick={() => onClick(m.n)}
              className="text-left underline-offset-2 hover:text-foreground hover:underline"
              title="Ver as frases deste movimento"
            >
              ↳ {m.nome}
            </button>
          ) : (
            <>↳ {m.nome}</>
          )}
        </li>
      ))}
    </ul>
  );
}

function ListaFrases({
  frases,
  prefixo,
  corDaFrase = () => "border-l-border",
  vazio,
}: {
  frases: SpyFraseDissecada[];
  prefixo: string;
  corDaFrase?: (f: SpyFraseDissecada) => string;
  vazio?: string;
}) {
  if (!frases.length) return vazio ? <p className="text-sm text-muted-foreground">{vazio}</p> : null;
  return (
    <ol className="space-y-2">
      {frases.map((f, i) => {
        // A âncora fica na PRIMEIRA frase de cada movimento: é para onde o clique na Estrutura leva.
        const abreMovimento = f.movimento != null && frases[i - 1]?.movimento !== f.movimento;
        return (
          <li
            key={i}
            id={abreMovimento ? `${prefixo}-mov-${f.movimento}` : undefined}
            className={`neu-inset scroll-mt-4 rounded-lg border-l-4 p-3 ${corDaFrase(f)}`}
          >
            <p className="text-sm font-medium">“{f.texto}”</p>
            {f.original && <p className="mt-0.5 text-xs italic text-muted-foreground">Original: “{f.original}”</p>}
            {f.funcoes.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {f.funcoes.map((fn, j) => (
                  <span key={`${fn}-${j}`} className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                    {fn}
                  </span>
                ))}
              </div>
            )}
            {f.explicacao && <p className="mt-1.5 text-sm text-muted-foreground">→ {f.explicacao}</p>}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * O texto que o Composer manda ao agente que compõe — o MESMO, pela mesma função
 * (shared/dissecacao-agentes.js). Recolhido por padrão: é para máquina, não para leitura; aberto,
 * o selo diz isso antes de qualquer outra coisa.
 */
function EstruturaParaAgentes({ d }: { d: SpyDissecacaoCriativo }) {
  const texto = estruturaParaAgentes(d);
  if (!texto) return null;
  return (
    <Collapsible className="rounded-lg border border-dashed border-border">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
        <Bot className="h-3.5 w-3.5" />
        Estrutura para agentes de IA
        <ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 px-3 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
              <Bot className="h-3 w-3" />
              Para uso de agentes de IA
            </span>
            <BotaoCopiar texto={() => texto} rotulo="Copiar" />
          </div>
          <p className="text-[11px] text-muted-foreground">
            É o que o Composer entrega ao agente que escreve o anúncio novo: os passos e como cumprir cada um, sem as
            palavras da peça original.
          </p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{texto}</pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
