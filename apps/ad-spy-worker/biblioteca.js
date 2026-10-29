/**
 * Salvar uma análise concluída na Biblioteca.
 *
 * Mora sozinho porque tem dois chamadores que precisam gravar a MESMA coisa: a rota
 * `POST /runs/:id/save`, quando a pessoa clica em salvar, e o orquestrador, que salva sozinho a
 * análise que acabou de mandar fazer. Duas cópias divergiriam na primeira coluna nova — e o sintoma
 * seria a análise do orquestrador abrindo diferente da salva à mão.
 */

import { insertLibraryEntry, listSelectedAds } from "./db.js";
import { perguntasDaPeca } from "./pergunta.js";

/**
 * @param {{ run: object, especialidade: string, titulo: string|null, userId: string, name: string|null }} p
 *   `run` precisa estar `done`, com `analysis_md` — quem chama confere.
 */
export async function salvarRunNaBiblioteca({ run, especialidade, titulo, userId, name }) {
  // Snapshot na ORDEM em que o agente leu: é por ela que a análise cita #1, #2...
  const ads = await listSelectedAds(run.id);
  return insertLibraryEntry({
    run_id: run.id,
    tema: run.tema,
    titulo,
    // UM segmento, o principal: a análise é classificada e encontrada por ele. A coluna segue
    // `text[]` porque análises antigas têm mais de um.
    especialidades: [especialidade],
    settings: run.settings || {},
    extra_prompt: run.extra_prompt,
    analysis_md: run.analysis_md,
    analysis: run.analysis,
    // As perguntas feitas ao grid vão DENTRO de cada anúncio salvo: a Biblioteca guarda só os
    // selecionados, e é entre eles que a ordenação por pergunta passa a valer lá.
    ads: ads.map(({ media_url: _m, thumb_url: _t, ...ad }) => {
      const perguntas = perguntasDaPeca(run.question, ad.id);
      return perguntas.length ? { ...ad, perguntas } : ad;
    }),
    saved_by: userId,
    saved_by_name: name,
  });
}
