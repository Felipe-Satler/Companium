import { useState } from "react";
import { ChevronDown, Copy, FileDown, FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { nomeDoRelatorio, relatorioParaMarkdown } from "@/utils/relatorioMarkdown";
import { relatorioParaTexto } from "@/utils/relatorioTexto";
import { copiarNodeComoPng, imprimirNode } from "@/utils/exportarRelatorio";
import type { Relatorio } from "@/lib/clientReportsApi";

/**
 * As saídas do relatório, num menu só.
 *
 * Eram um botão de "copiar markdown". Markdown serve para colar no Notion ou no ClickUp e é
 * inútil no WhatsApp, onde os asteriscos aparecem; a tabela de criativos é o que de fato se manda
 * para um cliente, e recortar a tela à mão perde as colunas da direita; e o relatório inteiro
 * às vezes precisa virar anexo. Cada destino quer um formato, e o botão único atendia um.
 *
 * ## O que cada item entrega, e por que o rótulo diz o formato
 *
 * O formato vai no rótulo — "(PNG)", "(PDF)" — porque é ele que decide se a coisa serve: quem vai
 * colar num slide precisa de imagem, quem vai anexar num e-mail precisa de PDF, e descobrir isso
 * depois de colar é tarde.
 *
 * Os dois itens de tabela ficam DESABILITADOS quando o relatório não tem aquela tabela, em vez de
 * sumirem. Um menu que muda de tamanho conforme o relatório faz quem usa procurar o item que viu
 * ontem; desabilitado, a pessoa vê que a opção existe e que este relatório não a tem.
 */

/** Um nome de arquivo que sobrevive a qualquer sistema: sem acento, sem barra, sem espaço. */
function nomeArquivo(relatorio: Relatorio, sufixo: string, ext: string) {
  const base = `${relatorio.cliente}-${nomeDoRelatorio(relatorio)}-${sufixo}`
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${base}.${ext}`;
}

export type MenuExportarRelatorioProps = {
  relatorio: Relatorio;
  /** O relatório inteiro, para o PDF. */
  alvoRelatorio: () => HTMLElement | null;
  /**
   * A tabela de criativos. A função ABRE a seção antes de devolver o elemento: a captura de um nó
   * recolhido sai em branco, e `<details>` fechado tem altura zero.
   */
  alvoCriativos: (() => HTMLElement | null) | null;
  /** A tabela de números, idem. */
  alvoNumeros: (() => HTMLElement | null) | null;
};

export function MenuExportarRelatorio({
  relatorio,
  alvoRelatorio,
  alvoCriativos,
  alvoNumeros,
}: MenuExportarRelatorioProps) {
  const [ocupado, setOcupado] = useState<string | null>(null);

  const copiarTexto = async (texto: string, oQue: string) => {
    try {
      // `navigator.clipboard` não existe fora de contexto seguro, e `writeText` pode ser negado por
      // permissão. Falhar em silêncio seria o pior caso: a pessoa cola e não vem nada, sem saber
      // por quê.
      if (!navigator.clipboard?.writeText) throw new Error("sem acesso à área de transferência");
      await navigator.clipboard.writeText(texto);
      toast.success(`${oQue} copiado.`);
    } catch {
      toast.error(
        "Não foi possível copiar automaticamente — o navegador bloqueou o acesso à área de " +
          "transferência (acontece fora de HTTPS). Selecione o texto do relatório e copie à mão.",
      );
    }
  };

  const copiarImagem = async (
    chave: string,
    obterAlvo: () => HTMLElement | null,
    sufixo: string,
    oQue: string,
  ) => {
    const node = obterAlvo();
    if (!node) {
      toast.error(`Este relatório não tem ${oQue}.`);
      return;
    }
    setOcupado(chave);
    try {
      const r = await copiarNodeComoPng(node, nomeArquivo(relatorio, sufixo, "png"));
      // "Copiado" e "baixado" são coisas diferentes para quem vai colar em seguida. Dizer "copiado"
      // quando o arquivo foi para a pasta de downloads manda a pessoa colar o nada.
      if (r === "copiado") toast.success(`${oQue} copiada como imagem.`);
      else {
        toast.success(
          `${oQue} baixada como imagem — a área de transferência de imagem não está disponível ` +
            "neste navegador (ela exige HTTPS).",
        );
      }
    } catch (err) {
      toast.error(
        `Não foi possível gerar a imagem: ${err instanceof Error ? err.message : "falha na captura"}.`,
      );
    } finally {
      setOcupado(null);
    }
  };

  const exportarPdf = () => {
    const node = alvoRelatorio();
    if (!node) return;
    // O nome do arquivo que o navegador sugere no "Salvar como PDF" sai do título do documento.
    imprimirNode(node, `${relatorio.nome_exibicao || relatorio.cliente} — ${nomeDoRelatorio(relatorio)}`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 shrink-0">
          {ocupado ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Copy className="mr-1.5 h-3.5 w-3.5" />
          )}
          Copiar
          <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem
          onSelect={() => copiarTexto(relatorioParaMarkdown(relatorio), "Relatório em markdown")}
        >
          <FileText className="mr-2 h-3.5 w-3.5" />
          Copiar Markdown
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => copiarTexto(relatorioParaTexto(relatorio), "Relatório em texto")}
        >
          <FileText className="mr-2 h-3.5 w-3.5" />
          Copiar Texto
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={!alvoCriativos || ocupado !== null}
          onSelect={() =>
            alvoCriativos &&
            copiarImagem("criativos", alvoCriativos, "criativos", "Tabela de criativos")
          }
        >
          <ImageIcon className="mr-2 h-3.5 w-3.5" />
          Copiar tabela de criativos (PNG)
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!alvoNumeros || ocupado !== null}
          onSelect={() =>
            alvoNumeros && copiarImagem("numeros", alvoNumeros, "numeros", "Tabela de números")
          }
        >
          <ImageIcon className="mr-2 h-3.5 w-3.5" />
          Copiar tabela de números (PNG)
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={exportarPdf}>
          <FileDown className="mr-2 h-3.5 w-3.5" />
          Exportar Relatório (PDF)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
