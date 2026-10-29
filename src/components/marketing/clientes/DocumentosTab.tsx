import { Archive, ChevronDown, ChevronRight, ExternalLink, FileText, FolderOpen, Loader2, Lock, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useClientDocs } from "@/hooks/useClientDocs";
import { rotuloSubpaginas, type ClientDoc } from "@/lib/clientDocsApi";
import { tipoDoc } from "../../../../shared/clickup-doc-tipos";

/**
 * A aba Documentos: as páginas de Doc do ClickUp deste cliente, cada uma levando ao documento.
 *
 * A unidade é a PÁGINA, não o Doc, porque é assim que o workspace é organizado: "Mapeamento do
 * Cliente" é um Doc coletivo com uma página por cliente. A lista vem agrupada pelo Doc que contém
 * as páginas — é o nome que a pessoa reconhece do ClickUp, e sem ele "Ativo › Mapeamento - Dra.
 * Amanda Duarte" apareceria solto, sem dizer de que documento saiu.
 *
 * Ela não resume, não interpreta e não chama agente — é uma lista de links. Por isso a honestidade
 * aqui é sobre PROCEDÊNCIA, não sobre número: de onde o documento veio (`local`), como ele foi
 * atribuído a este cliente (`via`) e de quando é a leitura.
 *
 * Desde que os documentos passaram a ser ingeridos, ela responde uma pergunta a mais: **este
 * documento serve de insumo ao Composer?** É `temConteudo`. Sem mostrar isso, alguém abriria a etapa
 * de insumos, não encontraria o documento que acabou de ver aqui, e concluiria que a ferramenta está
 * quebrada — quando a resposta pode ser "o conteúdo dele não é lido, de propósito".
 */

function data(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function hora(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * As páginas agrupadas pelo Doc que as contém, preservando a ordem que o worker já deu.
 *
 * `cabecalho: false` para o Doc de uma página só cujo título é o mesmo — é o Doc de cliente único
 * ("Mapeamento Estratégico - Dr. Lia Garrido"), onde Doc e documento são a mesma coisa.
 */
function agruparPorDoc(docs: ClientDoc[]) {
  const grupos: { docNome: string | null; paginas: ClientDoc[]; cabecalho: boolean }[] = [];
  for (const doc of docs) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.docNome === doc.docNome) ultimo.paginas.push(doc);
    else grupos.push({ docNome: doc.docNome, paginas: [doc], cabecalho: true });
  }
  for (const g of grupos) {
    g.cabecalho = Boolean(g.docNome) && !(g.paginas.length === 1 && g.paginas[0].nome === g.docNome);
  }
  return grupos;
}

/**
 * A lista agrupada por Doc, com TETO DE ALTURA e rolagem própria.
 *
 * Sem o teto, um cliente com dezenas de páginas empurra para fora da tela tudo que vem depois — e o
 * que vem depois é o expansor dos bloqueados e os avisos. O teto é generoso o bastante para a lista
 * curta não ganhar barra de rolagem à toa.
 */
function ListaAgrupada({ docs }: { docs: ClientDoc[] }) {
  return (
    <div className="max-h-[420px] space-y-4 overflow-y-auto pr-1">
      {agruparPorDoc(docs).map(({ docNome, paginas, cabecalho }) => (
        <section key={docNome ?? "(sem doc)"} className="space-y-2">
          {/* Sem cabeçalho quando o Doc tem uma página só com o mesmo nome: repetir o título duas
              vezes não informa nada. */}
          {cabecalho && (
            <h4 className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
              <FolderOpen className="h-3 w-3" />
              {docNome}
              <span className="font-normal">
                ({paginas.length} {paginas.length === 1 ? "página" : "páginas"})
              </span>
            </h4>
          )}
          <div className="space-y-2">
            {paginas.map((doc) => (
              <Linha key={doc.id} doc={doc} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Linha({ doc }: { doc: ClientDoc }) {
  const atualizado = data(doc.atualizadoEm);
  const rotuloTipo = doc.tipo ? (tipoDoc(doc.tipo)?.label ?? null) : null;
  // Sem URL o item continua aparecendo, mas como texto: um link quebrado para o ClickUp é pior do
  // que dizer que não há link.
  const Wrapper = doc.url ? "a" : "div";
  const props = doc.url
    ? { href: doc.url, target: "_blank", rel: "noopener noreferrer" }
    : {};

  return (
    <Wrapper
      {...props}
      className={`flex items-start gap-3 rounded-lg border border-border p-3 transition-colors ${
        doc.url ? "hover:border-primary/40 hover:bg-secondary/40" : ""
      } ${doc.arquivado ? "opacity-60" : ""}`}
    >
      {/* O ÍCONE É O STATUS, e por isso fica à esquerda do nome: é a primeira coisa lida na linha.
          Cadeado em círculo amarelo = o corpo deste documento não alimenta o Composer. Antes isso só
          aparecia como um selo cinza no meio dos outros metadados, e se perdia — com 82 dos 117
          documentos nessa situação, quem varre a lista precisa distinguir de relance o que serve de
          insumo do que é só link. O `title` explica a razão, que é diferente nos dois casos. */}
      {doc.tipo ? (
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <span
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-400/25 text-amber-700 dark:bg-amber-400/20 dark:text-amber-400"
          title="O conteúdo deste documento não é lido: o nome indica credenciais de acesso, ou é um template em branco."
          aria-label="conteúdo não ingerido"
        >
          <Lock className="h-3 w-3" aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{doc.nome}</span>
          {doc.url && <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          {doc.local && <span className="truncate">{doc.local}</span>}
          {/* O rótulo do tipo sai da MESMA definição que o worker usa para decidir a ingestão. */}
          {rotuloTipo && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
              {rotuloTipo}
            </span>
          )}
          {/* Sem conteúdo ingerido: o documento é um link, não insumo. O motivo mais comum é o tipo
              estar fora da allowlist — e aí é decisão, não defeito. */}
          {!doc.tipo && (
            // O cadeado à esquerda já dá o sinal; aqui fica só a palavra, sem repetir o ícone.
            // Só para o caso travado: "ainda não pré-ingerido" não é estado que a pessoa precise
            // ver, porque a leitura sob demanda resolve sozinha quando ela abre ou compõe.
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium">conteúdo não ingerido</span>
          )}
          {/* Casou só pelo título, numa pasta que não é do cliente: é um palpite mais fraco e a
              tela diz isso, para ninguém tratar um documento mal atribuído como fato. */}
          {doc.via === "nome" && (
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-600 dark:text-amber-500">
              casado pelo título
            </span>
          )}
          {rotuloSubpaginas(doc.subpaginas) && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{rotuloSubpaginas(doc.subpaginas)}</span>
          )}
          {doc.arquivado && (
            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-medium">
              <Archive className="h-2.5 w-2.5" />
              arquivado
            </span>
          )}
          {atualizado && <span>atualizado em {atualizado}</span>}
        </p>
      </div>
    </Wrapper>
  );
}

/**
 * Não há guarda de "aba aberta" aqui porque o Radix **desmonta** o `TabsContent` inativo: enquanto a
 * aba não é escolhida, este componente não existe e nada vai ao ClickUp. É o mesmo mecanismo em que
 * a `RelatorioTab` se apoia para não paginar o CRM sem necessidade.
 */
export function DocumentosTab({ cliente }: { cliente: string }) {
  const { documentos, clickupIndisponivel, erro, lidoEm, truncado, isLoading, recarregar, recarregando } =
    useClientDocs(cliente);
  const [verBloqueados, setVerBloqueados] = useState(false);

  /**
   * O que fica escondido é o que NUNCA vai ser lido — `tipo === null`, ou seja documento de
   * credencial ou template em branco. **Não** é `temConteudo`.
   *
   * A primeira versão usou `temConteudo` e isso estava errado: ele diz apenas se o corpo já foi
   * PRÉ-ingerido pelo sync. Página classificada sem corpo em cache é lida na hora, sob demanda —
   * `conteudoDoDocumento` tem leitura preguiçosa, e é por ela que passam o preview e o Composer.
   * Com 2 páginas pré-ingeridas de 6.057, usar `temConteudo` escondia praticamente TODO documento
   * utilizável e fazia a aba parecer vazia para todo cliente.
   */
  const uteis = documentos.filter((d) => d.tipo !== null);
  const bloqueados = documentos.filter((d) => d.tipo === null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          Docs do ClickUp deste cliente
          {lidoEm && (
            <>
              {" "}
              · leitura de {data(lidoEm)} às {hora(lidoEm)}
            </>
          )}
        </p>
        <Button variant="outline" size="sm" onClick={recarregar} disabled={recarregando || isLoading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${recarregando ? "animate-spin" : ""}`} />
          Recarregar
        </Button>
      </div>

      {isLoading && (
        <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> lendo o ClickUp…
        </p>
      )}

      {/* Não conseguimos ler. É um fato diferente de "não há documento", e é por isso que esta
          mensagem não pode ser a mesma do vazio. */}
      {!isLoading && clickupIndisponivel && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-sm font-medium">Não foi possível ler o ClickUp</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {erro ?? "O worker não conseguiu consultar o ClickUp nesta leitura."} Isto não quer dizer
            que o cliente não tenha documentos.
          </p>
        </div>
      )}

      {!isLoading && !clickupIndisponivel && erro && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {erro}
        </p>
      )}

      {!isLoading && !clickupIndisponivel && !erro && documentos.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhum documento deste cliente encontrado no ClickUp. A busca casa o nome do cliente com o
          título da página, com o de uma página acima dela, ou com a tarefa, a pasta ou o Doc onde
          ela está — se ele existir escrito de outra forma, não aparece aqui.
        </p>
      )}

      {uteis.length > 0 && <ListaAgrupada docs={uteis} />}

      {/* Lemos, há documentos, mas nenhum com corpo. Sem esta linha a área ficaria vazia acima do
          expansor e pareceria falha de carregamento. */}
      {!isLoading && !clickupIndisponivel && !erro && uteis.length === 0 && bloqueados.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Todos os documentos deste cliente são de acesso/credencial ou template, então nenhum pode
          ser usado como insumo. Os {bloqueados.length} abaixo continuam acessíveis como link.
        </p>
      )}

      {bloqueados.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setVerBloqueados((v) => !v)}
            aria-expanded={verBloqueados}
            className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary/40"
          >
            {verBloqueados ? (
              <ChevronDown className="h-3 w-3 shrink-0" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0" />
            )}
            <Lock className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />
            {bloqueados.length} documento(s) de acesso/credencial
          </button>

          {verBloqueados && (
            <>
              <p className="text-[11px] text-muted-foreground">
                Eles aparecem aqui como link para o ClickUp, mas o corpo deles nunca é lido e não
                podem ser usados como insumo. É o que impede login e senha de cliente de atravessar
                para o nosso banco e para o prompt de um modelo. Template em branco cai na mesma
                gaveta, por outro motivo: molde sem conteúdo faz o modelo inventar o preenchimento.
              </p>
              <ListaAgrupada docs={bloqueados} />
            </>
          )}
        </div>
      )}

      {truncado && (
        <p className="text-[11px] text-muted-foreground">
          A varredura do workspace bateu no teto de páginas; a lista pode estar incompleta.
        </p>
      )}
    </div>
  );
}
