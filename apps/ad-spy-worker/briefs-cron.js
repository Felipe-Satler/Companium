#!/usr/bin/env node
/**
 * Entrada do job agendado que reescreve o Contexto Operacional de Marketing › Clientes.
 *
 * É um processo próprio, e NÃO uma rota HTTP, de propósito: uma rota chamada pelo timer precisaria
 * ou de credencial no systemd ou de ficar sem autenticação. Aqui o systemd roda com o mesmo
 * EnvironmentFile do worker e chama a mesma função que a rota de "atualizar agora" chama — um
 * caminho de código só.
 *
 * Por padrão PULA quem já foi apurado nesta semana: o ClickUp de um cliente não muda tanto em sete
 * dias que valha uma segunda chamada de agente, e o job é semanal. Isso também dá retomada de graça —
 * um job que morreu no meio pode rodar de novo e só pega quem faltou. Use `--force` depois de mexer
 * no prompt do agente, que é quando TODO texto precisa ser reescrito.
 *
 * Uso:
 *   node briefs-cron.js            # ativos ainda não apurados nesta semana
 *   node briefs-cron.js --force    # todos, mesmo os já em dia
 *   node briefs-cron.js <padrao>   # só um, para teste (ex.: jose_ramos) — sempre roda
 *
 * ⚠️ Os dois exemplos acima precisam do `spy.env`: `SUPABASE_SERVICE_KEY` chega ao serviço pelo
 * `EnvironmentFile=` do systemd, e um `node` direto do shell NÃO o vê — falha com
 * "SUPABASE_SERVICE_KEY ausente". Rode `sudo systemctl start marketing-briefs.service` (mesmo
 * caminho do timer) ou carregue o env antes: `set -a; . ./spy.env; set +a`.
 */

import { refreshAllBriefs, refreshBrief } from "./briefs.js";
import { dbEnabled } from "./db.js";

const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);

async function main() {
  if (!dbEnabled()) {
    log("[briefs] SUPABASE_SERVICE_KEY ausente — nada a fazer.");
    process.exitCode = 1;
    return;
  }

  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const alvo = args.find((a) => !a.startsWith("--"));

  // Um cliente pedido pelo nome sempre roda: quem digitou isso quer o resumo agora.
  if (alvo) {
    await refreshBrief({ cliente: alvo, log });
    return;
  }

  const { ok, falhas } = await refreshAllBriefs({ log, force });
  // Sai diferente de zero quando TUDO que foi tentado falhou: aí é problema de infraestrutura
  // (agente fora, leitura vazia) e o `systemctl status` deve mostrar vermelho. Falha de um cliente
  // ou outro é normal e já fica registrada na linha dele. Nada a fazer (todos em dia) é sucesso.
  if (ok === 0 && falhas.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  log(`[briefs] erro fatal: ${err instanceof Error ? err.stack || err.message : err}`);
  process.exitCode = 1;
});
