/**
 * Aliases de cliente — DADO COMPARTILHADO entre o frontend e os workers.
 *
 * Mora fora de `src/` e é JavaScript puro de propósito: o frontend importa isto por
 * `src/data/clienteAliases.ts` (que segue sendo a API tipada e a casa das funções), e o
 * ad-spy-worker importa o MESMO arquivo em Node, sem build.
 *
 * Por que não JSON: os comentários abaixo explicam por que cada alias esquisito existe, e são a
 * única memória de contas de anúncio com nome que não lembra em nada o cliente. JSON os apagaria.
 *
 * Mexer aqui muda o casamento de cliente em TODAS as telas de Clientes e nos resumos de
 * Marketing › Clientes. `src/test/squadsIndex.test.ts` e `src/test/clientesVisiveis.test.ts`
 * cobrem o comportamento.
 */

export const CLIENT_ALIASES = {
  // "Clínica Bellucci" é a marca antiga; o cliente passa a ser exibido pelo nome da médica,
  // "Lia Garrido", tanto no CRM quanto no Meta Ads. Consolidamos todas as variantes do
  // nome da clínica (com/sem acento no "í", com espaço ou underscore) sob o novo canônico.
  "Clínica_Bellucci": "Lia_Garrido",
  "Clínica Bellucci": "Lia Garrido",
  "Clinica_Bellucci": "Lia_Garrido",
  "Clinica Bellucci": "Lia Garrido",
  // Aurelio: o slug do Kommo é "Dr_Aurelio", mas algumas contas de Ads canonicalizam para
  // "Aurelio_Oliveira" (heurística), gerando 2 linhas no CRM. Consolida tudo sob um único
  // canônico "Aurelio_Oliveira" (= nome_identificador "aurelio oliveira" da tabela clientes).
  "Dr_Aurelio": "Aurelio_Oliveira",
  // A planilha de projetos chama o cliente só de "Dr. Aurelio" (sem sobrenome). Sem esta linha a
  // chave dele lá vira "aurelio", que não casa com "aurelio_oliveira" das contas de anúncio e do CRM:
  // a Central de Clientes e o Composer mostravam o cliente sem número nem criativo (17/10/2026).
  // "Aurelio" é a forma que sobra depois de tirar o "Dr." — e só ela, exata, então um outro
  // "Aurelio Fulano" futuro não é capturado.
  "Aurelio": "Aurelio_Oliveira",
  // Clínica Prisma: existe um cliente no Kommo gravado com o nome CRU da conta de Ads
  // ("C.A GROOHUB - Clinica Prisma"); o caminho Kommo (clientMatchKey/normalizeClientName)
  // não tira o prefixo "C.A GROOHUB -", então não fundia com o "Clinica Prisma". Mapeia o
  // nome exato → "Clinica Prisma" pra virar uma linha só (alias exato, não afeta futuros).
  "C.A GROOHUB - Clinica Prisma": "Clinica Prisma",
  // Luciano: o mesmo cliente aparece como "Luciano Carvalhal" e "Luciano Lopes Carvalhal"
  // (matchKeys diferentes). Unifica sob o nome completo.
  "Luciano Carvalhal": "Luciano Lopes Carvalhal",
  "Luciano_Carvalhal": "Luciano_Lopes_Carvalhal",
  // Ronald: aparece como "Dr. Ronald" (vira "Ronald" após tirar título) e
  // "Ronald Valverde". Unifica sob o nome completo. As variantes com "Dr." cobrem o
  // registro do Kommo gravado já com o título (que NÃO passa por canonicalizeAdsClient,
  // só por normalizeClientName) — sem elas, "Dr. Ronald" virava uma 2ª linha no filtro.
  "Ronald": "Ronald Valverde",
  "Dr. Ronald": "Ronald Valverde",
  "Dr Ronald": "Ronald Valverde",
  "Dr_Ronald": "Ronald_Valverde",
  "Dr. Ronald Valverde": "Ronald Valverde",
  "Dr Ronald Valverde": "Ronald Valverde",
  // Typo "Ronard" (com "r" no lugar do "n") — mesma pessoa que "Ronald Valverde".
  // Sem estas entradas, "Ronard Valverde" vira um 2º cliente separado no filtro/relatório.
  "Ronard": "Ronald Valverde",
  "Ronard Valverde": "Ronald Valverde",
  "Ronard_Valverde": "Ronald_Valverde",
  "Dr. Ronard": "Ronald Valverde",
  "Dr Ronard": "Ronald Valverde",
  "Dr_Ronard": "Ronald_Valverde",
  "Dr. Ronard Valverde": "Ronald Valverde",
  "Dr Ronard Valverde": "Ronald Valverde",
  // Variações de caixa/acento dentro do próprio Kommo — apontam para o mesmo client canônico
  "Fabio_Morais": "Fábio_Morais",
  "Teo_De_Oliveira": "Teo_de_Oliveira",
  // Instituto Urológico de Aurora: o Google Ads grava a conta SEM o "de"
  // ("Instituto_Urológico_Aurora"), virando um 2º cliente separado do Kommo
  // ("Instituto_Urológico_de_Aurora") — a entrada do Ads não casava com o
  // nome_identificador "instituto urologico de aurora" da tabela clientes, então
  // ficava sem planejado. Consolida sob o nome do Kommo (funde dropdown + dados + planejado).
  "Instituto_Urológico_Aurora": "Instituto_Urológico_de_Aurora",
  "Instituto Urológico Aurora": "Instituto Urológico de Aurora",
  // Dr. Luís Felipe Pacheco: o exportador do Google grava a conta dele sob o slug CURTO
  // "Luis_Felipe". As views (_v_meta_google_ads_raw/_daily_raw) já dobram Luis_Felipe→Luis_Pacheco,
  // mas a RPC `list_ads_clients` (que alimenta o dropdown do CRM) lê a TABELA base "Meta/Google Ads",
  // onde o "Luis_Felipe" cru ainda existe → aparecia uma opção "Luis Felipe" solta. Funde no
  // canônico do Pacheco p/ unificar opção + dados numa entrada só ("Dr. Luís Felipe Pacheco").
  "Luis_Felipe": "Luis_Pacheco",
  "Luis Felipe": "Luis Pacheco",
  // Dra. Luna Mota: o Kommo grava o slug COM título ("dra_luna_mota"), enquanto a conta de
  // Ads canonicaliza sem título ("Luna_Mota") — geravam DUAS entradas no dropdown p/ a mesma
  // médica (e o CRM dela não fundia com o cadastro/planejado). O strip de título só corta com
  // espaço, não com underscore, então aliasamos explicitamente p/ juntar tudo sob "Luna_Mota".
  "dra_luna_mota": "Luna_Mota",
  "dra luna mota": "Luna Mota",
  "Dra_Luna_Mota": "Luna_Mota",
  "Dra. Luna Mota": "Luna Mota",
  // Dr. Heitor: o CRM/Kommo grava o cliente como "Heitor" (matchKey "heitor"), mas as
  // contas de Ads ("Dr. Heitor Simão - CA 1.2 | Groohub" e "CA2 - Dr. Heitor Simão")
  // canonicalizam para "Heitor_Simão" (matchKey "heitor_simao") → 2 linhas no CRM/filtro
  // (uma só com o CRM, outra só com o Ads) e planejado partido em 2 cadastros. Funde a conta
  // de Ads no slug do Kommo "Heitor" (que tem o nome_exibicao "Dr. Heitor" e os leads do CRM)
  // p/ virar uma entrada só. Cobre as formas com/sem acento em "Simão".
  "Heitor Simão": "Heitor",
  "Heitor_Simão": "Heitor",
  "Heitor Simao": "Heitor",
  "Heitor_Simao": "Heitor",
  // Lumilaser: a conta do Kommo foi renomeada p/ "Sílvio Matos - LumiLaser" (com uma ASPA
  // DUPLA solta no fim, artefato de digitação) a partir de jun/2026. Esse nome cru NÃO casava
  // com o canônico "Lumilaser" (clientMatchKey mantém a aspa/prefixo), então os leads recentes
  // (jun→set/2026) sumiam do CRM da Lumilaser. TEM que ficar aqui (CLIENT_ALIASES), que é o
  // mapa que `normalizeClientName` usa para consolidar os leads do CRM — pôr só em
  // ADS_CLIENT_ALIASES não resolve o CRM. "Lumilaser" já é exibido como "Sílvio Matos -
  // LumiLaser" via CLIENT_DISPLAY_LABELS. Cobre também a forma SEM a aspa (nome da planilha).
  "Sílvio Matos - LumiLaser\"": "Lumilaser",
  "Sílvio Matos - LumiLaser": "Lumilaser",
};

/**
 * Overrides explícitos: nome da conta no Meta/Google Ads → slug canônico do Kommo.
 * Usado para os casos em que a heurística `canonicalizeAdsClient` não consegue derivar
 * o slug correto sozinha (ex.: campanha cujo nome de conta não é o nome do médico).
 *
 * Quando adicionar conta nova no Meta cujo Client não case com nenhum slug do Kommo
 * após a heurística, adicione aqui.
 */
export const ADS_CLIENT_ALIASES = {
  "CA 1.1.1 - Dr. Fábio Vascular": "Fábio_Morais",
  "Centro Oftalmológico Vista Nova": "Vista_Nova",
  "DRA CINTIA - INSTAGRAM": "Cintia_Castro",
  "Dr. Diego Candido - Ginecologista": "Diego_Cândido",
  "Dr. Fábio Morais Filho - CA 1.1.1 | Groohub": "Fábio_Morais",
  "Dr. Gustavo Coelho - Cirurgião Plastico": "Gustavo_Coelho",
  // "Dr. Henrique Couto CA 1.1.1 | Groohub": o "CA 1.1.1" vem SEM hífen antes ("Couto CA"),
  // então o strip de sufixo " - CA x.y.z" da heurística não corta e o slug vira
  // "Henrique_Couto_CA_1.1.1" — separado do cliente do Kommo "Henrique_Couto" (2 linhas no
  // dropdown, e o planejado não fundia). Mapeia direto pro slug do Kommo p/ unificar Ads + CRM.
  "Dr. Henrique Couto CA 1.1.1 | Groohub": "Henrique_Couto",
  // Conta de Ads do Jerônimo vem como "Dr. Jerônimo de Souza", mas o CRM/Healo grava o cliente
  // como "Jeronimo_Henrique" (nome real do médico). Sem alias, o canonicalizeAdsClient derivaria
  // "Jerônimo de Souza" → card separado do CRM (Meta num card, leads do Healo em outro). Mapeia
  // a conta de Ads direto pro slug do Healo p/ unificar Ads + CRM + planejado e exibir
  // "Dr. Jerônimo Henrique" (CLIENT_DISPLAY_LABELS[jeronimo_henrique]).
  "Dr. Jerônimo de Souza - C.A 1.1.1 | Groohub": "Jeronimo_Henrique",
  // Casa com o slug do Kommo ("Aurelio_Oliveira") p/ NÃO duplicar a conta no CRM/Relatório
  // (antes apontava p/ "Dr_Aurelio", cujo matchKey "dr_aurelio" não fundia com "aurelio_oliveira",
  // gerando 2 linhas — uma só com leads tráfego do Ads, outra só com o CRM).
  "Dr. Aurelio Oliveira - CA 1.1.1": "Aurelio_Oliveira",
  "Dr. Aurelio Oliveira - CA 1.1.1 | Groohub": "Aurelio_Oliveira",
  "Dr. Luis Felipe Pacheco - CA 1.1.1 | Groohub": "Luis_Pacheco",
  "Dr. Luis Fernando Barreto": "Luis_Fernando",
  "Dr. Luis Fernando Barreto - CA 1.1.1 | Groohub": "Luis_Fernando",
  "Dr. Luis Fernando Barreto - CA 1.2.1 | Groohub": "Luis_Fernando",
  "Dr. Luiz Ricardo Cardoso - CA 1.1.1 | Groohub": "Luiz_Cardoso",
  "LUMIlaser Serra Azul - CA 1.1.2": "Lumilaser",
  "LUMIlaser Serra Azul - CA 1.1.2 | Groohub": "Lumilaser",
  "Fisiora - CA 1.1.1 | Groohub": "Instituto_FISIORA",
  "Fisiora - Reabilitação e Saúde": "Instituto_FISIORA",
  // Conta "Instituto Medicina I - CA 1.1.1| Groohub" (act_100000000000004) tem o nome
  // truncado no Meta ("Instituto Medicina I"), então o canonicalizeAdsClient derivaria
  // o slug "Instituto Medicina I" e o cliente apareceria com esse nome cortado, sem casar
  // o rótulo oficial. Mapeia direto pro canônico p/ exibir "Instituto de Medicina Integrada
  // de Atibaia" (CLIENT_DISPLAY_LABELS) e fundir Ads + CRM/planejado.
  "Instituto Medicina I - CA 1.1.1| Groohub": "Instituto_de_Medicina_Integrada_de_Atibaia",
  // "Dra. Patricia Pavan CA 1.1.1 | Groohub": o "CA 1.1.1" vem SEM hífen antes ("Pavan CA"),
  // então o strip de sufixo " - CA x.y.z" da heurística não corta e o slug vira
  // "Patricia_Pavan_CA_1.1.1" — separado da conta com hífen ("... - CA 1.1.1"), gerando uma 2ª
  // opção "Patricia Pavan CA 1.1.1" no filtro. Mapeia direto pro slug canônico p/ remover o
  // "CA 1.1.1", fundir as duas contas numa opção só e exibir "Dra. Patricia Pavan".
  "Dra. Patricia Pavan CA 1.1.1 | Groohub": "Patricia_Pavan",
  // Conta "CA 2.4.01" (act_100000000000002) é do Dr. Ronald, mas o nome cru NÃO tem
  // o nome do médico nem sufixo " | Groohub" — só o número do slot. Sem hífen/nome, o
  // canonicalizeAdsClient não consegue derivar "Ronald" e os dados caíam num balde
  // fantasma "CA 2.4.01". Mapeia direto pro slug canônico do Kommo p/ atribuir o Meta
  // Ads ao Dr. Ronald e fundir com o CRM. (Ideal: renomear no Meta p/ o padrão.)
  "CA 2.4.01": "Ronald_Valverde",
  // Instituto Aurum (projetos_lista, ATIVO desde 30/09, crm="Não") reúne DUAS contas de Ads
  // separadas, uma por médico: Dr. Davi Colares (act_100000000000001) e Dr. Filipe Kato
  // (act_100000000000003). Ambas apontam pro MESMO slug canônico "Instituto_Aurum" p/ aparecerem
  // como UM cliente só ("Instituto Aurum") em todas as telas. Na tela Meta Ads o split por médico
  // é feito por CONTA (ADS_ACCOUNT_MEDICO_SPLIT), já que as campanhas do Kato não carregam o
  // nome do médico ("Post do Instagram ..."). Não há pipeline no Kommo (crm="Não"). Add 20/10/2026.
  "Dr. Davi Colares - CA 1.1.1 | Groohub": "Instituto_Aurum",
  "Dr. Filipe Kato - CA 1.1.1 | Groohub": "Instituto_Aurum",
};

/**
 * Fusão de conta de Ads em outro cliente do CRM. A semântica (em que canais vale, e por quê)
 * está documentada em `src/data/clienteAliases.ts`, junto do tipo `AdsClientMerge`.
 */
export const ADS_CLIENT_MERGES = {
  // Dr. Moacir Vitório (conta de Ads própria "Dr. Moacir Vitório - CA 1.1.x | Groohub")
  // → cliente CRM "Lia Garrido" (Clínica Bellucci), médico "Dr. Moacir". No Kommo os dois
  // já são o mesmo cliente (Clinica_Bellucci), separados só pelo campo Médico. Continua
  // aparecendo separado APENAS na tela Meta Ads.
  moacir_vitorio: { crmCanonical: "Lia_Garrido", medico: "Dr. Moacir" },
};
