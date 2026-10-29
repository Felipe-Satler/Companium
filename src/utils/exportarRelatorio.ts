import { toBlob } from "html-to-image";

/**
 * Levar o relatório para fora do dashboard: imagem da tabela e PDF.
 *
 * Markdown e texto resolvem o diagnóstico escrito; estas duas resolvem o resto. A tabela de
 * criativos e a de números são o que alguém cola num grupo de WhatsApp ou numa apresentação, e
 * recortar a tela à mão perde metade das colunas. O PDF é o relatório inteiro, para anexar.
 *
 * ## Três decisões que não são óbvias
 *
 * - **Captura sempre no tema CLARO.** O tema escuro é confortável na tela e péssimo em imagem
 *   colada e em papel: texto claro sobre fundo escuro vira um bloco preto num slide branco, e
 *   gasta tinta. As duas funções trocam o tema, capturam e devolvem.
 * - **Nada de corte horizontal.** A tabela de criativos vive dentro de um `overflow-x-auto`, então
 *   capturar a caixa visível entregaria as três primeiras colunas. A captura mede a largura REAL do
 *   conteúdo e desliga o corte durante o instante da foto.
 * - **Copiar pode falhar, e aí baixa.** A área de transferência de IMAGEM exige contexto seguro e
 *   permissão; fora de HTTPS ela simplesmente não existe. Em vez de falhar, o arquivo é baixado — e
 *   quem chamou recebe qual dos dois aconteceu, para a mensagem na tela dizer a verdade.
 */

/** O que de fato aconteceu com a imagem. A tela avisa coisas diferentes para cada um. */
export type ResultadoImagem = "copiado" | "baixado";

/**
 * Roda `fn` com o tema claro aplicado, e devolve o tema anterior ao fim.
 *
 * O `classList` do `<html>` é onde o ThemeContext escreve `light`/`dark`. Mexer nele é feio, e é
 * menos feio do que entregar um PNG ilegível: a alternativa seria reconstruir a paleta clara dentro
 * da captura, que é manter uma segunda cópia do tema.
 */
async function comTemaClaro<T>(fn: () => Promise<T>): Promise<T> {
  const raiz = document.documentElement;
  const eraEscuro = raiz.classList.contains("dark");
  if (eraEscuro) {
    raiz.classList.remove("dark");
    raiz.classList.add("light");
  }
  try {
    return await fn();
  } finally {
    if (eraEscuro) {
      raiz.classList.remove("light");
      raiz.classList.add("dark");
    }
  }
}

/**
 * Desliga o corte horizontal dentro de `node` enquanto `fn` roda.
 *
 * Devolve a largura real do conteúdo, que é o que a captura precisa saber: o elemento continua
 * tendo a largura da coluna onde mora, e só o conteúdo dele é mais largo.
 */
async function semCorteHorizontal<T>(node: HTMLElement, fn: (largura: number) => Promise<T>): Promise<T> {
  const cortados = [node, ...node.querySelectorAll<HTMLElement>("*")].filter((el) => {
    const o = getComputedStyle(el).overflowX;
    return o === "auto" || o === "scroll" || o === "hidden";
  });
  const antes = cortados.map((el) => el.style.overflowX);
  for (const el of cortados) el.style.overflowX = "visible";

  // A largura é a do conteúdo mais largo — tipicamente a `<table>` dentro do rolador.
  const larguras = [node.scrollWidth, ...[...node.querySelectorAll("table")].map((t) => t.scrollWidth)];
  const largura = Math.max(...larguras, node.offsetWidth);

  try {
    return await fn(largura);
  } finally {
    cortados.forEach((el, i) => {
      el.style.overflowX = antes[i];
    });
  }
}

/** Um respiro em volta: colada sem margem, a borda da tabela encosta no texto vizinho. */
const RESPIRO = 12;

/**
 * 1×1 totalmente transparente (RGBA 0,0,0,0). Entra no lugar de uma imagem que não pôde ser buscada.
 *
 * Gerado e conferido byte a byte, não copiado de memória: o "pixel 1×1" que todo mundo tem na
 * cabeça costuma ser VERMELHO, e esticado na célula de uma tabela ele vira um bloco salmão que
 * parece um erro — ou pior, parece dado. Transparente some sobre o fundo branco da captura, que é o
 * mesmo resultado visual de uma miniatura ausente na tela.
 */
const PIXEL_VAZIO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

/**
 * O que a `html-to-image` rejeitou, em português e com causa.
 *
 * Ela rejeita com o **Event de erro de uma `<img>`**, não com um `Error` — então um
 * `err.message` sai vazio e a mensagem na tela virava "falha na captura", que não ajuda ninguém a
 * consertar nada. Aqui o Event é traduzido para o que de fato aconteceu.
 */
function descreverFalha(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  if (err && typeof err === "object" && "target" in err) {
    const alvo = (err as { target?: { src?: string } }).target;
    const src = alvo?.src ? ` (${alvo.src.slice(0, 120)})` : "";
    return `uma imagem da tabela não pôde ser carregada${src}`;
  }
  return "falha desconhecida ao desenhar a imagem";
}

/** O PNG de um pedaço da tela, já no tema claro e sem corte. */
export async function nodeParaPng(node: HTMLElement): Promise<Blob> {
  return comTemaClaro(() =>
    semCorteHorizontal(node, async (largura) => {
      // A ALTURA tem de ser declarada junto com a largura. O padding do `style` entra no clone e
      // empurra o conteúdo para baixo; sem somar o respiro aqui, a tela do PNG continua com a
      // altura do original e a ÚLTIMA LINHA sai cortada — um erro que passa despercebido, porque a
      // imagem parece inteira até alguém procurar a linha que faltou.
      //
      // Sobra de altura é inofensiva (espaço branco embaixo), falta não é. Quando o clone fica mais
      // largo que o original, as linhas podem desembrulhar e ocupar menos altura — então este valor
      // é um teto, e é de propósito.
      let blob: Blob | null;
      try {
        blob = await toBlob(node, {
          // 2× para a imagem não ficar borrada ao ser ampliada num slide ou num Zoom.
          pixelRatio: 2,
          // Fundo opaco: PNG transparente colado sobre um slide escuro fica ilegível, e quem cola
          // não tem como adivinhar que o problema é o alfa.
          backgroundColor: "#ffffff",
          width: largura + RESPIRO * 2,
          height: node.scrollHeight + RESPIRO * 2,
          style: { width: `${largura}px`, padding: `${RESPIRO}px`, boxSizing: "content-box" },
          // As miniaturas vêm de um CDN de imagem; sem isto o cache do navegador pode devolver uma
          // resposta sem CORS e a célula sai vazia.
          cacheBust: true,
          // ⚠️ OBRIGATÓRIO aqui, e a falta disto NÃO dá erro — dá a imagem errada.
          //
          // O cache de recursos da biblioteca indexa pela URL **sem a query string**
          // (`getCacheKey`, em dataurl.js). Toda miniatura deste app passa pelo proxy de imagem, e
          // nela tudo que distingue um criativo do outro mora na query: as URLs são idênticas antes
          // do `?`. Sem este parâmetro, a primeira captura popula o cache e a SEGUNDA desenha a
          // mesma miniatura em todas as linhas — o criativo V009 sai com a foto do V011, numa
          // tabela que vai para o cliente. Medido em 06/10/2026.
          includeQueryParams: true,
          // Imagem que não pôde ser buscada vira um pixel transparente em vez de derrubar a captura
          // inteira. Sem isto, a biblioteca tenta carregar uma data URL VAZIA e rejeita — uma
          // miniatura de CDN expirada fazia a pessoa não conseguir copiar tabela nenhuma.
          imagePlaceholder: PIXEL_VAZIO,
        });
      } catch (err) {
        // Normaliza para um `Error` de verdade: quem chamou mostra a mensagem, e um Event cru
        // chegava lá como texto vazio.
        throw new Error(descreverFalha(err));
      }
      if (!blob) throw new Error("a captura devolveu uma imagem vazia");
      return blob;
    }),
  );
}

/** Baixa um blob com o nome dado. Último recurso quando a área de transferência não existe. */
function baixar(blob: Blob, nomeArquivo: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revogar na hora corta o download em alguns navegadores; o atraso é o custo de não cortar.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Copia um pedaço da tela como PNG. Se a área de transferência não aceitar imagem, baixa o arquivo.
 *
 * O retorno diz qual dos dois aconteceu — quem chama precisa disso para não dizer "copiado" quando
 * o que houve foi um download na pasta de downloads.
 */
export async function copiarNodeComoPng(
  node: HTMLElement,
  nomeArquivo: string,
): Promise<ResultadoImagem> {
  // A PROMESSA vai para o `ClipboardItem`, não o blob já resolvido, e isso é a diferença entre
  // funcionar e não funcionar. A escrita de imagem na área de transferência exige o gesto do
  // usuário, e esperar a captura terminar antes de chamar `write` gasta esse gesto — o Safari
  // recusa, e o Chrome recusa quando a captura demora. `ClipboardItem` aceita uma promessa
  // justamente para o trabalho acontecer dentro da chamada.
  const captura = nodeParaPng(node);

  // `ClipboardItem` não existe em todo navegador, e `clipboard.write` exige contexto seguro.
  const temClipboardDeImagem =
    typeof ClipboardItem !== "undefined" && typeof navigator.clipboard?.write === "function";

  if (temClipboardDeImagem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": captura })]);
      return "copiado";
    } catch {
      // Permissão negada ou contexto inseguro: cai para o download em vez de não entregar nada.
      // Se o que falhou foi a CAPTURA, o `await` abaixo lança e quem chamou mostra o erro.
    }
  }

  baixar(await captura, nomeArquivo);
  return "baixado";
}

/** Onde o conteúdo a imprimir é montado. Fica fora do `#root` para o CSS poder esconder o app. */
const PRINT_ROOT = "print-root";
const CLASSE_IMPRIMINDO = "imprimindo";

/**
 * Manda o relatório para a impressão do navegador — é o "Exportar PDF".
 *
 * **Impressão nativa, e não um PDF montado por biblioteca.** Rasterizar a tela num PDF produziria
 * um documento de imagem: texto não selecionável, não pesquisável, pesado, e borrado ao ampliar. A
 * impressão do navegador gera texto de verdade e já oferece "Salvar como PDF" em todos eles. O
 * preço é um diálogo a mais para quem exporta; o ganho é um anexo que o cliente consegue usar.
 *
 * O conteúdo é CLONADO para fora do app, e o CSS de impressão esconde o resto. A alternativa —
 * esconder tudo menos um ramo da árvore com seletores — depende da posição do relatório no DOM, e
 * ele aparece em dois lugares (a aba da Central de Clientes e o diálogo do Composer).
 */
export function imprimirNode(node: HTMLElement, titulo: string): void {
  if (typeof window.print !== "function") return;

  const anterior = document.title;
  const raiz = document.documentElement;
  const eraEscuro = raiz.classList.contains("dark");

  const alvo = document.createElement("div");
  alvo.id = PRINT_ROOT;
  const copia = node.cloneNode(true) as HTMLElement;
  // Seção recolhida continua recolhida na cópia, e um PDF sem a tabela de números seria um PDF que
  // perdeu a prova do que afirma.
  copia.querySelectorAll("details").forEach((d) => d.setAttribute("open", ""));
  alvo.appendChild(copia);
  document.body.appendChild(alvo);

  if (eraEscuro) {
    raiz.classList.remove("dark");
    raiz.classList.add("light");
  }
  // O nome do arquivo que o navegador sugere sai do título do documento.
  document.title = titulo;
  document.body.classList.add(CLASSE_IMPRIMINDO);

  const limpar = () => {
    document.body.classList.remove(CLASSE_IMPRIMINDO);
    alvo.remove();
    document.title = anterior;
    if (eraEscuro) {
      raiz.classList.remove("light");
      raiz.classList.add("dark");
    }
    window.removeEventListener("afterprint", limpar);
  };

  window.addEventListener("afterprint", limpar);
  try {
    window.print();
  } finally {
    // `afterprint` não dispara em todo navegador (e não dispara se o diálogo for cancelado em
    // alguns). O atraso cobre o caso em que ele vem; sem isto a tela poderia ficar presa no estado
    // de impressão.
    setTimeout(limpar, 1000);
  }
}
