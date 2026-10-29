import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  Download,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSanitizedMarkdown } from "@/hooks/useSanitizedMarkdown";
import {
  anunciosDe,
  progressoDe,
  type AnuncioComposto,
  type CatalogoCopy,
  type Composicao,
  type ConceitoEstrategico,
} from "@/lib/adComposerApi";
import { NIVEL_CONSCIENCIA_LABEL } from "@/lib/adSpyApi";
import {
  anuncioParaTexto,
  anunciosProntos,
  baixarTexto,
  composicaoParaTexto,
  nomeDoArquivo,
} from "@/lib/exportarComposicao";
import { duracao, useAgora } from "./tempoOrquestracao";
import { getFormato, validarLimites } from "../../../../shared/ad-formats";
import type { AvisoLimite, CampoFormato } from "../../../../shared/ad-formats";
import type { ComposicaoCampos } from "@/lib/adComposerApi";

/**
 * O que a tela pode fazer com uma composição EM REVISÃO. Vem de fora (`RevisaoComposicao`), porque
 * este componente só desenha: ele é usado também onde não há quem execute ação nenhuma.
 */
export type AcoesRevisao = {
  editar: (indice: number, campos: ComposicaoCampos) => Promise<unknown>;
  revisar: (indice: number, pedido: string) => Promise<unknown>;
  desfazer: (indice: number) => Promise<unknown>;
  podeDesfazer: (indice: number) => boolean;
};

/**
 * O resultado de uma composição: de 1 a 8 anúncios, cada um campo a campo.
 *
 * Um anúncio por vez na tela, escolhido pelas abas de cima: cada um tem os campos do SEU formato, e
 * oito peças empilhadas seriam uma página em que não se acha o título que se veio copiar. As abas
 * existem desde que o agente decide o conjunto — antes de qualquer copy ficar pronta —, e é nelas e
 * no marcador que se vê o trabalho andando.
 *
 * Renderiza a partir da SPEC do formato (`shared/ad-formats.js`), não das chaves que vieram na
 * resposta: assim um campo que o agente esqueceu aparece vazio em vez de sumir da tela, e um campo
 * que ele inventou não vira uma caixa que ninguém sabe o que é.
 *
 * Copiar é campo a campo, porque ninguém cola um bloco inteiro no Gerenciador de Anúncios — cola UM
 * título no campo de título. Os botões de copiar o anúncio inteiro e de exportar o conjunto são
 * para o OUTRO uso: levar a peça para alguém ler, num documento ou numa mensagem.
 */

/**
 * Copia um texto longo (o anúncio inteiro, o conjunto) e confirma no próprio botão.
 *
 * `texto` é uma função, e não o texto pronto, para a montagem só acontecer no clique — o conjunto
 * de oito anúncios não precisa ser serializado a cada render.
 */
function BotaoCopiarTexto({ texto, children }: { texto: () => string; children: string }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto());
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      toast.error("O navegador não deixou copiar. Use o botão de baixar.");
    }
  };
  return (
    <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={copiar}>
      {copiado ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
      {copiado ? "Copiado" : children}
    </Button>
  );
}

/** Copia e confirma. O `useState` local é o que faz o ✓ aparecer só no botão que foi clicado. */
function BotaoCopiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // Sem permissão de área de transferência (http sem TLS, por exemplo): dizer é melhor do que
      // um botão que pisca e não copiou nada.
      toast.error("O navegador não deixou copiar. Selecione o texto e copie à mão.");
    }
  };
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 shrink-0 px-2 text-[11px]"
      onClick={copiar}
      disabled={!texto}
      aria-label={`Copiar ${rotulo}`}
    >
      {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

/**
 * O contador, e o aviso quando estourou.
 *
 * "34/30" é a informação inteira: o número sozinho não diz se cabe, e "estourou" sozinho não diz
 * por quanto. A cor separa o que a plataforma RECUSA (destrutivo) do que ela só corta na exibição
 * (âmbar) — achatar os dois faria o caso grave parecer um detalhe.
 */
function Contador({ texto, campo, aviso }: { texto: string; campo: CampoFormato; aviso?: AvisoLimite }) {
  if (!campo.limite) return null;
  const rigido = aviso?.tipo === "excede_limite_rigido";
  return (
    <span
      className={`shrink-0 text-[11px] tabular-nums ${
        rigido
          ? "font-semibold text-destructive"
          : aviso
            ? "font-semibold text-amber-600 dark:text-amber-400"
            : "text-muted-foreground"
      }`}
      title={
        rigido
          ? "A plataforma recusa acima deste limite"
          : campo.limiteRigido
            ? "Limite rígido: a plataforma recusa acima disso"
            : "Recomendado: acima disso o texto corta na exibição"
      }
    >
      {texto.length}/{campo.limite}
    </span>
  );
}

function avisoDe(avisos: AvisoLimite[], campo: string, indice: number | null) {
  return avisos.find((a) => a.campo === campo && a.indice === indice);
}

function CampoTexto({
  campo,
  valor,
  avisos,
}: {
  campo: CampoFormato;
  valor: string;
  avisos: AvisoLimite[];
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-xs font-semibold">{campo.label}</h4>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{campo.ajuda}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Contador texto={valor} campo={campo} aviso={avisoDe(avisos, campo.id, null)} />
          <BotaoCopiar texto={valor} rotulo={campo.label} />
        </div>
      </div>
      {valor ? (
        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed">{valor}</p>
      ) : (
        <p className="mt-2 text-[13px] italic text-muted-foreground">
          o agente não devolveu este campo
        </p>
      )}
    </div>
  );
}

function CampoLista({
  campo,
  itens,
  avisos,
}: {
  campo: CampoFormato;
  itens: string[];
  avisos: AvisoLimite[];
}) {
  const contagem = avisos.find(
    (a) => a.campo === campo.id && (a.tipo === "itens_de_menos" || a.tipo === "itens_demais"),
  );
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-xs font-semibold">
            {campo.label}
            <span className="ml-1.5 font-normal text-muted-foreground">
              {itens.length}
              {campo.itens ? ` de ${campo.itens.min}–${campo.itens.max}` : ""}
            </span>
          </h4>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{campo.ajuda}</p>
        </div>
      </div>

      {contagem && (
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3" />
          {contagem.detalhe}
        </p>
      )}

      {itens.length === 0 ? (
        <p className="mt-2 text-[13px] italic text-muted-foreground">
          o agente não devolveu este campo
        </p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {itens.map((item, i) => (
            <li
              key={`${campo.id}-${i}`}
              className="flex items-start gap-2 rounded-md bg-muted/40 px-2 py-1.5"
            >
              <span className="mt-0.5 shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">
                {i + 1}.
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap text-[13px] leading-relaxed">
                {item}
              </span>
              <Contador texto={item} campo={campo} aviso={avisoDe(avisos, campo.id, i)} />
              <BotaoCopiar texto={item} rotulo={`${campo.label} ${i + 1}`} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** O marcador de cada aba: pronto, escrevendo, falhou ou na fila. */
function IconeStatus({ anuncio }: { anuncio: AnuncioComposto }) {
  if (anuncio.status === "running") return <Loader2 className="h-3 w-3 animate-spin" />;
  if (anuncio.status === "pendente") return <Clock className="h-3 w-3 opacity-60" />;
  if (anuncio.status === "error") return <AlertTriangle className="h-3 w-3 text-destructive" />;
  return <Check className="h-3 w-3" />;
}

const ROTULO_STATUS: Record<AnuncioComposto["status"], string> = {
  pendente: "na fila",
  running: "escrevendo",
  ok: "pronto",
  error: "falhou",
};

/**
 * O painel de "está compondo", do clique até o último anúncio.
 *
 * Aparece desde o PRIMEIRO instante, e não só quando o primeiro anúncio chega: a primeira chamada
 * do agente lê os insumos, decide o conjunto e escreve o anúncio 1, e leva minutos. Uma linha cinza
 * de texto nesse tempo era lida como "não está acontecendo nada".
 *
 * Antes de o conjunto estar decidido a barra é indeterminada — não há total, e uma porcentagem
 * inventada seria mentira. Depois, ela conta "3 de 5". O relógio diz há quanto tempo, que é o que
 * separa "está demorando" de "travou".
 */
function PainelAndamento({
  composicao,
  anuncios,
}: {
  composicao: Composicao;
  anuncios: AnuncioComposto[];
}) {
  const agora = useAgora(true);
  const { terminados, total } = progressoDe(anuncios);
  const decidido = total > 0;
  const atual = anuncios.findIndex((a) => a.status === "running");
  const tempo = duracao(agora - Date.parse(composicao.criado_em));

  const passos: { rotulo: string; estado: "feito" | "agora" | "depois" }[] = [
    {
      rotulo: "Lendo os insumos e decidindo o conjunto",
      estado: decidido ? "feito" : "agora",
    },
    {
      rotulo: decidido
        ? `Escrevendo ${total === 1 ? "o anúncio" : `os ${total} anúncios, um a um`}`
        : "Escrevendo os anúncios",
      estado: decidido ? "agora" : "depois",
    },
  ];

  return (
    <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-sm font-semibold">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          {decidido ? (
            <span>
              <span className="tabular-nums">
                {terminados} de {total}
              </span>{" "}
              anúncio{total === 1 ? "" : "s"} pronto{terminados === 1 ? "" : "s"}
            </span>
          ) : (
            "Compondo — escrevendo a ideia"
          )}
        </p>
        {tempo && (
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">há {tempo}</span>
        )}
      </div>

      {decidido ? (
        <div
          role="progressbar"
          aria-label="Anúncios prontos"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={terminados}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${(terminados / total) * 100}%` }}
          />
        </div>
      ) : (
        <div
          role="progressbar"
          aria-label="Compondo"
          aria-valuetext="decidindo o conjunto"
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full w-1/3 animate-indeterminado rounded-full bg-primary" />
        </div>
      )}

      <ol className="space-y-1">
        {passos.map((p) => (
          <li key={p.rotulo} className="flex items-center gap-2 text-xs">
            {p.estado === "feito" ? (
              <Check className="h-3.5 w-3.5 text-primary" />
            ) : p.estado === "agora" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            ) : (
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className={p.estado === "depois" ? "text-muted-foreground" : ""}>{p.rotulo}</span>
          </li>
        ))}
      </ol>

      <p className="text-[11px] text-muted-foreground">
        {decidido
          ? atual >= 0
            ? `Agora: anúncio ${atual + 1}. Os prontos já dá para ler e copiar abaixo.`
            : "Os prontos já dá para ler e copiar abaixo."
          : "A primeira etapa é a mais longa: leva alguns minutos. Pode sair desta tela — você é avisado quando terminar."}
      </p>
    </div>
  );
}

/**
 * A edição à mão de um anúncio, campo a campo, na ordem da spec.
 *
 * O contador e o aviso de limite são recalculados a cada tecla, com a MESMA função que o worker usa
 * (`validarLimites`): é aqui que alguém encurta um título de 34 para 30 caracteres, e precisa ver o
 * número mudar enquanto escreve. Lista é um campo por item, com acrescentar e tirar — juntar os
 * títulos do Google numa caixa só, um por linha, faria uma quebra de linha a mais virar um título.
 */
function EditorAnuncio({
  formatoId,
  inicial,
  salvando,
  onSalvar,
  onCancelar,
}: {
  formatoId: string;
  inicial: ComposicaoCampos;
  salvando: boolean;
  onSalvar: (campos: ComposicaoCampos) => void;
  onCancelar: () => void;
}) {
  const formato = getFormato(formatoId);
  const [campos, setCampos] = useState<ComposicaoCampos>(() => ({ ...inicial }));
  if (!formato) return null;
  const avisos = validarLimites(formato.id, campos);
  const rigidos = avisos.filter((a) => a.tipo === "excede_limite_rigido").length;
  const trocar = (id: string, valor: string | string[]) => setCampos((c) => ({ ...c, [id]: valor }));

  return (
    <div className="space-y-3 rounded-lg border border-primary/40 p-3">
      <p className="text-xs font-semibold">Editando à mão</p>
      {formato.campos.map((campo) => {
        const valor = campos[campo.id];
        if (campo.tipo === "lista") {
          const itens = Array.isArray(valor) ? valor : [];
          return (
            <div key={campo.id} className="space-y-1.5">
              <p className="text-xs font-medium">
                {campo.label}
                {campo.itens && (
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    {itens.length} de {campo.itens.min}–{campo.itens.max}
                  </span>
                )}
              </p>
              {itens.map((item, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="mt-2 w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                    {i + 1}.
                  </span>
                  <Textarea
                    value={item}
                    rows={1}
                    aria-label={`${campo.label} ${i + 1}`}
                    onChange={(e) => trocar(campo.id, itens.map((x, k) => (k === i ? e.target.value : x)))}
                    className="min-h-9 flex-1 text-[13px]"
                  />
                  <span className="mt-2">
                    <Contador texto={item} campo={campo} aviso={avisoDe(avisos, campo.id, i)} />
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 shrink-0 p-0"
                    aria-label={`Tirar ${campo.label} ${i + 1}`}
                    onClick={() => trocar(campo.id, itens.filter((_, k) => k !== i))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {(!campo.itens || itens.length < campo.itens.max) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  aria-label={`Acrescentar em ${campo.label}`}
                  onClick={() => trocar(campo.id, [...itens, ""])}
                >
                  <Plus className="mr-1 h-3 w-3" /> Acrescentar
                </Button>
              )}
            </div>
          );
        }
        const texto = typeof valor === "string" ? valor : "";
        return (
          <div key={campo.id} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">{campo.label}</p>
              <Contador texto={texto} campo={campo} aviso={avisoDe(avisos, campo.id, null)} />
            </div>
            <Textarea
              value={texto}
              aria-label={campo.label}
              rows={campo.limite && campo.limite <= 140 ? 2 : 5}
              onChange={(e) => trocar(campo.id, e.target.value)}
              className="text-[13px]"
            />
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
        <span className="text-[11px] text-muted-foreground">
          {rigidos > 0
            ? `${rigidos} campo(s) acima do que a plataforma aceita — dá para salvar assim, mas não para colar.`
            : "A versão anterior fica guardada: dá para desfazer."}
        </span>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={onCancelar} disabled={salvando}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => onSalvar(campos)} disabled={salvando}>
            {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Salvar edição
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Os três botões da revisão de um anúncio, e o pedido de revisão quando aberto. */
function BarraRevisao({
  indice,
  acoes,
  onEditar,
}: {
  indice: number;
  acoes: AcoesRevisao;
  onEditar: () => void;
}) {
  const [pedindo, setPedindo] = useState(false);
  const [pedido, setPedido] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const executar = async (acao: () => Promise<unknown>, sucesso: string) => {
    setOcupado(true);
    try {
      await acao();
      toast.success(sucesso);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível concluir.");
      return false;
    } finally {
      setOcupado(false);
    }
  };

  const enviar = async () => {
    if (!pedido.trim()) return;
    const ok = await executar(
      () => acoes.revisar(indice, pedido.trim()),
      "Pedido enviado — o agente está revisando este anúncio.",
    );
    if (ok) {
      setPedido("");
      setPedindo(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={onEditar} disabled={ocupado}>
          <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[11px]"
          aria-expanded={pedindo}
          onClick={() => setPedindo((v) => !v)}
          disabled={ocupado}
        >
          <Sparkles className="mr-1 h-3.5 w-3.5" /> Pedir revisão ao agente
        </Button>
        {acoes.podeDesfazer(indice) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={ocupado}
            title="Volta este anúncio à versão anterior à última edição ou revisão"
            onClick={() => executar(() => acoes.desfazer(indice), "Voltou à versão anterior.")}
          >
            <Undo2 className="mr-1 h-3.5 w-3.5" /> Desfazer
          </Button>
        )}
      </div>
      {pedindo && (
        <div className="space-y-1.5 rounded-lg border border-border p-2.5">
          <Textarea
            value={pedido}
            onChange={(e) => setPedido(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void enviar();
            }}
            placeholder="O que mudar neste anúncio? Ex.: gancho mais direto, sem termo técnico; troca o CTA por agendamento"
            aria-label="Pedido de revisão"
            rows={3}
            maxLength={4000}
            autoFocus
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              Ele muda o que você pedir e preserva o resto. A versão atual fica guardada.
            </span>
            <Button size="sm" onClick={() => void enviar()} disabled={ocupado || !pedido.trim()}>
              {ocupado ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              )}
              Enviar ao agente
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Os avisos que o Conceito Estratégico acrescenta (worker, `avisosDoConceito`): não são de limite de
 * caractere, então não têm contador onde aparecer — vão numa lista própria, para conferir antes de
 * publicar.
 */
const AVISOS_DO_CONCEITO: Record<string, string> = {
  duracao_acima_do_funil: "Duração",
  cita_preco: "Preço",
  especialista_sem_rqe: "RQE",
  sem_assinatura: "Assinatura",
  assinatura_incompleta: "Assinatura",
};

function AvisosDoConceito({ avisos }: { avisos: AvisoLimite[] }) {
  const lista = avisos.filter((a) => AVISOS_DO_CONCEITO[a.tipo]);
  if (!lista.length) return null;
  return (
    <ul className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs" aria-label="Conferir antes de publicar">
      {lista.map((a, i) => (
        <li key={`${a.tipo}-${i}`}>
          <span className="font-semibold text-amber-800 dark:text-amber-300">{AVISOS_DO_CONCEITO[a.tipo]}:</span> {a.detalhe}
        </li>
      ))}
    </ul>
  );
}

/**
 * O Conceito Estratégico que o anúncio executa, em uma linha: avatar · nível · ângulo · formato.
 * Só em composição desde 20/10/2026 — as anteriores não têm conceito.
 */
function LinhaDoConceito({ conceito, catalogo }: { conceito: ConceitoEstrategico; catalogo: CatalogoCopy }) {
  const avatar = catalogo.avatares.find((a) => a.id === conceito.avatar_id)?.nome ?? conceito.avatar_id;
  const angulo = catalogo.angulos.find((a) => a.id === conceito.angulo_id)?.nome ?? conceito.angulo_id;
  const formato = catalogo.criativos.find((x) => x.id === conceito.criativo_ref)?.nome ?? conceito.criativo_ref;
  return (
    <p className="mt-1 text-[11px] text-muted-foreground">
      <span className="font-semibold uppercase tracking-wide">Conceito</span> · {avatar} ·{" "}
      {NIVEL_CONSCIENCIA_LABEL[conceito.nivel]?.toLowerCase() ?? conceito.nivel} · {angulo} · {formato}
    </p>
  );
}

/** Um anúncio do conjunto: para que uso é, por quê, e a copy nos campos do formato dele. */
function AnuncioPainel({
  anuncio,
  indice,
  emRevisao = false,
  acoes,
  catalogo = null,
  estatico = null,
}: {
  anuncio: AnuncioComposto;
  indice: number;
  /** Para onde vai o "Abrir na Oficina" — só em anúncio de imagem de composição SALVA. */
  estatico?: string | null;
  /** O catálogo dos Conceitos Estratégicos, para dar nome aos ids do conceito do anúncio. */
  catalogo?: CatalogoCopy | null;
  /** A composição está em revisão (pronta, não salva). */
  emRevisao?: boolean;
  /** Quem pode revisar recebe as ações; quem só olha, não. */
  acoes?: AcoesRevisao;
}) {
  // `formato` pode ser null: em composição antiga o agente podia não declarar um válido.
  const formato = anuncio.formato ? getFormato(anuncio.formato) : null;
  const [editando, setEditando] = useState(false);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  // Em revisão, `running` é o agente REVISANDO: o conteúdo continua lá e continua à vista.
  const revisando = emRevisao && anuncio.status === "running";
  const mostraConteudo = anuncio.status === "ok" || (revisando && Boolean(anuncio.composicao));
  const html = useSanitizedMarkdown(anuncio.composicao_md);
  const avisos = anuncio.avisos ?? [];
  const campos = anuncio.composicao ?? {};
  const rigidos = avisos.filter((a) => a.tipo === "excede_limite_rigido").length;

  return (
    <div className="space-y-4">
      {/* O uso que o AGENTE escolheu para este anúncio, e por quê. Sem a justificativa a escolha é
          caixa preta: dá para aceitar, não dá para discutir. */}
      {formato && (
        <div className="flex items-start justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-primary">{formato.label}</p>
            {anuncio.angulo && <p className="mt-0.5 text-[13px] leading-snug">{anuncio.angulo}</p>}
            {anuncio.conceito && catalogo && <LinhaDoConceito conceito={anuncio.conceito} catalogo={catalogo} />}
            {anuncio.formato_justificativa && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {anuncio.formato_justificativa}
              </p>
            )}
          </div>
          {anuncio.status === "ok" && anuncio.composicao && (
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <BotaoCopiarTexto texto={() => anuncioParaTexto(anuncio)}>Copiar anúncio</BotaoCopiarTexto>
              {estatico && (
                <Button asChild variant="outline" size="sm" className="h-7 px-2 text-[11px]">
                  <Link to={estatico}>
                    <ImageIcon className="mr-1 h-3 w-3" />
                    Abrir na Oficina
                  </Link>
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {mostraConteudo && <AvisosDoConceito avisos={avisos} />}

      {anuncio.status === "pendente" && (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          na fila — este anúncio ainda não começou a ser escrito
        </p>
      )}

      {anuncio.status === "running" && !revisando && (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          escrevendo este anúncio…
        </p>
      )}

      {revisando && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
          <p className="inline-flex items-center gap-2 text-sm font-medium">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            O agente está revisando este anúncio
          </p>
          {anuncio.ultima_revisao && (
            <p className="mt-1 text-xs text-muted-foreground">Pedido: “{anuncio.ultima_revisao}”</p>
          )}
        </div>
      )}

      {/* Em revisão, `error` num anúncio pronto é aviso ("a revisão falhou — ficou como estava"). */}
      {emRevisao && anuncio.status === "ok" && anuncio.error && (
        <p className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-[12px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          {anuncio.error}
        </p>
      )}

      {emRevisao && anuncio.status === "ok" && acoes && formato && !editando && (
        <BarraRevisao indice={indice} acoes={acoes} onEditar={() => setEditando(true)} />
      )}

      {editando && acoes && formato && (
        <EditorAnuncio
          formatoId={formato.id}
          inicial={anuncio.composicao ?? {}}
          salvando={salvandoEdicao}
          onCancelar={() => setEditando(false)}
          onSalvar={async (novos) => {
            setSalvandoEdicao(true);
            try {
              await acoes.editar(indice, novos);
              toast.success("Edição salva.");
              setEditando(false);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Não foi possível salvar a edição.");
            } finally {
              setSalvandoEdicao(false);
            }
          }}
        />
      )}

      {anuncio.status === "error" && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm text-destructive">
            {anuncio.error || "Este anúncio falhou."} Os outros do conjunto não dependem dele.
          </p>
        </div>
      )}

      {mostraConteudo && !editando && (
        <>
          {rigidos > 0 && (
            <p className="inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-[12px] font-medium text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              {rigidos} campo{rigidos === 1 ? "" : "s"} acima do limite que a plataforma aceita —
              ajuste antes de colar
            </p>
          )}

          {html && (
            <div
              className="prose prose-sm max-w-none dark:prose-invert [&_p]:text-[13px] [&_p]:leading-relaxed"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}

          {!formato ? (
            // Duas situações, ditas de formas diferentes porque a causa é diferente: ou o agente não
            // declarou formato nenhum, ou declarou um que este app não conhece. Inventar campos em
            // qualquer dos casos seria pior do que dizer o que aconteceu.
            <p className="text-xs text-muted-foreground">
              {anuncio.formato ? (
                <>
                  O formato <code>{anuncio.formato}</code> não existe nesta versão do app — só a prosa
                  acima pôde ser renderizada.
                </>
              ) : (
                "O agente não declarou um formato desta vez, então não há campos separados para copiar — a ideia acima continua valendo."
              )}
            </p>
          ) : !anuncio.composicao ? (
            <p className="text-xs text-muted-foreground">
              O agente não devolveu o bloco estruturado desta vez, então não há campos separados
              para copiar — a ideia acima continua valendo.
            </p>
          ) : (
            <div className="space-y-2">
              {formato.campos.map((campo) => {
                const valor = campos[campo.id];
                return campo.tipo === "lista" ? (
                  <CampoLista
                    key={campo.id}
                    campo={campo}
                    itens={Array.isArray(valor) ? valor : []}
                    avisos={avisos}
                  />
                ) : (
                  <CampoTexto
                    key={campo.id}
                    campo={campo}
                    valor={typeof valor === "string" ? valor : ""}
                    avisos={avisos}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const ROTULO_FONTE: Record<string, string> = {
  analise: "análise da Biblioteca",
  brief: "resumo do cliente",
  metricas: "métricas da semana",
};

export function ComposicaoResultado({
  composicao,
  acoes,
}: {
  composicao: Composicao;
  /** As ações da revisão, para quem pode revisar. Sem elas a composição só é mostrada. */
  acoes?: AcoesRevisao;
}) {
  const html = useSanitizedMarkdown(composicao.composicao_md);
  const anuncios = anunciosDe(composicao);
  const [escolhido, setEscolhido] = useState(0);
  // O conjunto só cresce de zero para N uma vez, mas a composição exibida pode trocar por outra
  // menor: o índice guardado não pode apontar para fora dela.
  const aberto = Math.min(escolhido, Math.max(0, anuncios.length - 1));

  const cancelada = (composicao.error ?? "").startsWith("Cancelada");

  if (composicao.status === "error") {
    // Cancelar foi decisão de quem pediu, não falha: sem vermelho.
    return cancelada ? (
      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <p className="text-sm text-muted-foreground">
          Composição cancelada antes de o primeiro anúncio ficar pronto.
        </p>
      </div>
    ) : (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
        <p className="text-sm text-destructive">{composicao.error || "A composição falhou."}</p>
      </div>
    );
  }

  const rodando = composicao.status === "running";

  // Rodando e ainda sem conjunto: a primeira chamada é a que decide quantos anúncios serão.
  if (!anuncios.length) {
    return rodando ? <PainelAndamento composicao={composicao} anuncios={anuncios} /> : null;
  }

  return (
    <div className="space-y-4">
      {rodando && <PainelAndamento composicao={composicao} anuncios={anuncios} />}

      {/* Terminou pela metade — cancelada, ou interrompida por um reinício do servidor. O que ficou
          pronto está abaixo; esta linha é o que diz que o conjunto não está completo. */}
      {!rodando && composicao.error && (
        <p className="rounded-md bg-muted px-2.5 py-1.5 text-[12px] text-muted-foreground">
          {cancelada ? "Cancelada" : composicao.error.replace(/\.$/, "")} —{" "}
          {anunciosProntos(composicao).length} de {anuncios.length} anúncio
          {anuncios.length === 1 ? "" : "s"} ficaram prontos.
        </p>
      )}

      {/* Com o que o conjunto foi feito. Uma composição sem o resumo do cliente é uma composição
          diferente, e quem lê precisa saber disso antes de confiar nela. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* `metricas` só entra na lista quando a linha a TEM: o insumo saiu em 02/10/2026, e
            mostrar "métricas da semana" riscada em toda composição nova diria que faltou algo —
            quando na verdade aquele insumo deixou de existir. Em composição ANTIGA ela continua
            aparecendo, porque ali é informação verdadeira sobre como aquela ideia foi feita. */}
        {(["analise", "brief", ...(composicao.fontes?.metricas === undefined ? [] : ["metricas"])] as const).map((f) => {
          const tem = composicao.fontes?.[f] === true;
          return (
            <span
              key={f}
              className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                tem ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground line-through"
              }`}
              title={tem ? `Usou a ${ROTULO_FONTE[f]}` : `Sem a ${ROTULO_FONTE[f]}`}
            >
              {ROTULO_FONTE[f]}
            </span>
          );
        })}
        {Boolean(composicao.fontes?.relatorios) && (
          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
            {composicao.fontes?.relatorios} relatório(s)
          </span>
        )}
        {Boolean(composicao.fontes?.documentos) && (
          <span
            className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
            title={
              composicao.fontes?.documentos_sem_corpo
                ? `${composicao.fontes.documentos_sem_corpo} entraram só com título e pasta`
                : undefined
            }
          >
            {composicao.fontes?.documentos} documento(s)
            {composicao.fontes?.documentos_sem_corpo
              ? ` (${composicao.fontes.documentos_sem_corpo} sem corpo)`
              : ""}
          </span>
        )}
        {Boolean(composicao.fontes?.criativos) && (
          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
            {composicao.fontes?.criativos} análise(s) de criativo
          </span>
        )}
        {composicao.semana_de && (
          <span className="text-[11px] text-muted-foreground">
            semana de {composicao.semana_de} a {composicao.semana_ate}
          </span>
        )}
      </div>

      {/* Levar o conjunto para fora. Só com a composição parada: exportar pela metade daria um
          documento que parece completo e não é. Com um anúncio só, "copiar anúncio" já resolve o
          copiar; o baixar continua valendo. */}
      {!rodando && anunciosProntos(composicao).length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {anuncios.length > 1 && (
            <BotaoCopiarTexto texto={() => composicaoParaTexto(composicao)}>
              Copiar conjunto
            </BotaoCopiarTexto>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => baixarTexto(nomeDoArquivo(composicao), composicaoParaTexto(composicao))}
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            Baixar .md
          </Button>
        </div>
      )}

      {/* A prosa do CONJUNTO: por que estes anúncios, para este cliente. */}
      {html && (
        <div
          className="prose prose-sm max-w-none dark:prose-invert [&_p]:text-[13px] [&_p]:leading-relaxed"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}

      {/* Com um anúncio só não há o que escolher, e uma aba sozinha seria só ruído. */}
      {anuncios.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Anúncios da composição">
          {anuncios.map((a, i) => {
            const rigidos = (a.avisos ?? []).some((x) => x.tipo === "excede_limite_rigido");
            return (
              <button
                key={i}
                type="button"
                aria-pressed={i === aberto}
                onClick={() => setEscolhido(i)}
                title={`${ROTULO_STATUS[a.status]}${a.angulo ? ` — ${a.angulo}` : ""}`}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  i === aberto
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <IconeStatus anuncio={a} />
                <span className="tabular-nums">{i + 1}</span>
                {getFormato(a.formato ?? "")?.label ?? a.formato ?? "sem formato"}
                {rigidos && <AlertTriangle className="h-3 w-3" aria-label="acima do limite" />}
              </button>
            );
          })}
        </div>
      )}

      <AnuncioPainel
        // A chave troca o painel inteiro ao mudar de aba: o estado de "copiado ✓" de um anúncio não
        // pode aparecer no botão do outro.
        key={aberto}
        anuncio={anuncios[aberto]}
        indice={aberto}
        emRevisao={composicao.status === "revisao"}
        acoes={acoes}
        catalogo={composicao.catalogo_copy ?? null}
        // A arte estática só sai de composição SALVA e de anúncio de imagem (Feed, Meta Ads).
        estatico={
          composicao.status === "ok" && getFormato(anuncios[aberto]?.formato ?? "")?.midia === "imagem"
            ? `/marketing/oficina?cliente=${encodeURIComponent(composicao.cliente)}&composicao=${encodeURIComponent(composicao.id)}&anuncio=${aberto}`
            : null
        }
      />
    </div>
  );
}
