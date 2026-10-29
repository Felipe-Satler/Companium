#!/usr/bin/env node
/**
 * Sincroniza os documentos do ClickUp. Rodado pelo `marketing-docs.timer` (diário) e à mão.
 *
 * Diário, e não semanal como os resumos, porque a economia está no lugar certo: listar o workspace
 * é uma busca paginada, e enumerar páginas e baixar conteúdo só acontecem para quem mudou. Documento
 * editado hoje à tarde está disponível como insumo do Composer amanhã de manhã — e quem precisa de
 * agora usa o botão da aba.
 *
 *   node docs-cron.js                 # a carteira inteira
 *   node docs-cron.js jose_ramos       # só o conteúdo de um cliente (a listagem é sempre do todo)
 *
 * Sai com código 1 em falha, para o systemd marcar a unidade como `failed` em vez de "success" com
 * um erro escondido no journal.
 *
 * ⚠️ Os dois exemplos acima precisam do `spy.env`: `SUPABASE_SERVICE_KEY` chega ao serviço pelo
 * `EnvironmentFile=` do systemd, e um `node` direto do shell NÃO o vê — falha com
 * "SUPABASE_SERVICE_KEY ausente". Rode `sudo systemctl start marketing-docs.service` (mesmo
 * caminho do timer) ou carregue o env antes: `set -a; . ./spy.env; set +a`.
 */

import { sincronizarDocs } from "./docs-sync.js";
import { clickupHabilitado } from "./clickup.js";
import { dbEnabled } from "./db.js";

const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);

async function main() {
  const cliente = process.argv[2] ? String(process.argv[2]).trim() : null;

  if (!dbEnabled()) {
    throw new Error("SUPABASE_SERVICE_KEY ausente: sem ela não há onde gravar os documentos.");
  }
  if (!clickupHabilitado()) {
    throw new Error(
      "Credencial do ClickUp ausente. O token já existe no servidor para o `briefagent`; " +
        "copie as duas linhas para o spy.env — ver spy.env.example."
    );
  }

  const r = await sincronizarDocs({ cliente, log });
  log(
    `[docs-cron] ok: ${r.total} Doc(s) e ${r.paginas} página(s), ` +
      `${r.estruturasLidas} estrutura(s) enumerada(s), ${r.conteudosLidos} conteúdo(s) lido(s), ` +
      `${r.removidas} Doc(s) e ${r.removidasPaginas} página(s) removida(s), ` +
      `${r.semCliente} página(s) sem cliente, ${r.semTipo} Doc(s) sem tipo, ` +
      `${r.coletivos} coletivo(s), ${r.semPaginas} sem páginas enumeradas, ` +
      `${r.semAcesso} sem acesso (401/403)`
  );
  if (r.truncado) {
    log("[docs-cron] ATENÇÃO: a listagem foi truncada (CLICKUP_MAX_DOC_PAGES) — lista incompleta.");
  }
}

main().catch((err) => {
  // `detail` é o corpo da resposta do Supabase, que o `DbError` carrega. Sem imprimi-lo, um
  // "supabase POST marketing_client_docs -> 400" não diz NADA sobre o que estava errado no payload —
  // foi o que aconteceu na primeira execução real e custou um probe para descobrir.
  const detalhe = err?.detail ? `\n  detalhe: ${err.detail}` : "";
  console.error(`${new Date().toISOString()} [docs-cron] FALHOU: ${err?.message || err}${detalhe}`);
  process.exit(1);
});
