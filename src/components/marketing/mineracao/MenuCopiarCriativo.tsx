import { Bot, ChevronDown, Copy, FileText, ListOrdered, MessageSquareQuote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SpyCriativo } from "@/lib/adSpyApi";
import {
  criativoParaMarkdown,
  criativoParaTexto,
  estruturaComoTexto,
  fraseAFraseComoTexto,
  recortesDoCriativo,
} from "@/components/marketing/mineracao/criativoExportar";
import { estruturaParaAgentes } from "../../../../shared/dissecacao-agentes";

/**
 * As saídas de uma análise de criativo, num menu só — o mesmo desenho do relatório da Central de
 * Clientes (`MenuExportarRelatorio`): a análise inteira em Markdown (Notion, ClickUp) e em texto
 * (WhatsApp, e-mail), e os recortes que se levam para outro lugar.
 *
 * Os recortes que a análise não tem ficam DESABILITADOS, e não somem: um menu que muda de tamanho
 * conforme a análise faz quem usa procurar o item que viu ontem. Análise de antes da dissecação v2
 * (20/10/2026) não tem frase a frase nem estruturas.
 */
export function MenuCopiarCriativo({ criativo }: { criativo: SpyCriativo }) {
  const recortes = recortesDoCriativo(criativo);
  const d = criativo.dissecacao;

  const copiar = async (texto: string, oQue: string) => {
    try {
      // `navigator.clipboard` não existe fora de contexto seguro, e `writeText` pode ser negado por
      // permissão. Falhar em silêncio seria o pior caso: a pessoa cola e não vem nada.
      if (!navigator.clipboard?.writeText) throw new Error("sem acesso à área de transferência");
      await navigator.clipboard.writeText(texto);
      toast.success(`${oQue} copiado.`);
    } catch {
      toast.error(
        "Não foi possível copiar automaticamente — o navegador bloqueou o acesso à área de " +
          "transferência (acontece fora de HTTPS). Selecione o texto da análise e copie à mão.",
      );
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={criativo.status !== "done"}>
          <Copy className="mr-1.5 h-4 w-4" />
          Copiar
          <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem onSelect={() => copiar(criativoParaMarkdown(criativo), "Análise em markdown")}>
          <FileText className="mr-2 h-3.5 w-3.5" />
          Copiar Markdown
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copiar(criativoParaTexto(criativo), "Análise em texto")}>
          <FileText className="mr-2 h-3.5 w-3.5" />
          Copiar Texto
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={!recortes.estrutura}
          onSelect={() => d && copiar(estruturaComoTexto(d), "Estrutura")}
        >
          <ListOrdered className="mr-2 h-3.5 w-3.5" />
          Copiar estrutura (blocos e movimentos)
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!recortes.fraseAFrase}
          onSelect={() => d && copiar(fraseAFraseComoTexto(d), "Frase a frase")}
        >
          <MessageSquareQuote className="mr-2 h-3.5 w-3.5" />
          Copiar frase a frase
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!recortes.agentes}
          onSelect={() => d && copiar(estruturaParaAgentes(d), "Estrutura para agentes de IA")}
        >
          <Bot className="mr-2 h-3.5 w-3.5" />
          Copiar estrutura para agentes de IA
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
