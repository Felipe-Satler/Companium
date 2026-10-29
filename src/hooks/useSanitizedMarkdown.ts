import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

/**
 * Renderiza Markdown vindo de um AGENTE.
 *
 * marked + DOMPurify, o mesmo caminho que `src/chatbot/core/render.ts` usa para as respostas do
 * assistente — isto é saída de modelo, então é sanitizada, nunca confiada. `gfm` ligado para casar
 * com as opções do chat; o hook `afterSanitizeAttributes` que força target/rel nos links é
 * registrado globalmente lá e vale aqui também assim que o módulo do chat carrega, por isso os
 * atributos são liberados explicitamente abaixo em vez de depender da ordem de import.
 *
 * Um único caminho de sanitização para todo texto de agente: a Mineração e os resumos de
 * Marketing › Clientes passam por aqui.
 */
export function useSanitizedMarkdown(md: string | null | undefined) {
  return useMemo(() => {
    if (!md) return "";
    const html = marked.parse(md, { async: false, gfm: true, breaks: true }) as string;
    return DOMPurify.sanitize(html, { ADD_ATTR: ["target", "rel"] });
  }, [md]);
}
