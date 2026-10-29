-- Re-chaveia as correcoes manuais do CRM (crm_metric_overrides) para a ANCORA NO MES.
--
-- Contexto: a chave (filter_sig) inclui o periodo. Antes, "1o dia -> hoje" virava uma chave
-- "mtd:AAAA-MM" separada, e "1o dia -> um dia qualquer < ultimo" caia em range congelado
-- "r:AAAA-MM-01_AAAA-MM-DD". Ambas somem quando a ponta do filtro muda de dia/mes, entao a
-- correcao lancada (ex.: 01->27/09) nao aparecia ao filtrar um periodo que a engloba (01->30/09).
--
-- A partir de agora o codigo normaliza QUALQUER "1o dia -> dia do mesmo mes" para a chave
-- estavel "m:AAAA-MM" (ver periodSignature em src/utils/crmOverrides.ts). Esta migration
-- converte os registros JA gravados para o novo formato, para que nao se percam.
--
-- Conflitos: quando varias correcoes do mesmo cliente/medico/origem/mes/metrica colapsam na
-- mesma chave, mantemos a MAIS RECENTE (updated_at) -- que representa o ultimo valor que o
-- usuario cadastrou para aquele mes -- e removemos as antigas. (275 linhas -> apaga 52
-- duplicatas antigas, re-chaveia 71 sobreviventes; validado em 29/09/2026.)
--
-- Rodar no SQL Editor do projeto companium-db (o PAT e read-only e nao aplica DDL/DML por MCP).

begin;

create temp table _rank_overrides on commit drop as
with computed as (
  select
    id,
    filter_sig,
    metric,
    updated_at,
    case
      when period_from is not null and (
        period_kind = 'mtd'
        or (
          period_kind = 'range'
          and extract(day from period_from) = 1
          and date_trunc('month', period_from) = date_trunc('month', period_to)
        )
      )
      then split_part(filter_sig, '|', 1) || '|'
        || split_part(filter_sig, '|', 2) || '|'
        || split_part(filter_sig, '|', 3) || '|m:'
        || to_char(period_from, 'YYYY-MM')
      else filter_sig
    end as final_sig
  from crm_metric_overrides
)
select
  id,
  filter_sig,
  final_sig,
  metric,
  row_number() over (partition by final_sig, metric order by updated_at desc, id desc) as rn
from computed;

-- 1) apaga as duplicatas mais antigas que colidiriam na mesma chave (final_sig, metric).
delete from crm_metric_overrides c
using _rank_overrides r
where c.id = r.id
  and r.rn > 1;

-- 2) re-chaveia os sobreviventes cujo periodo mudou para a chave estavel do mes.
update crm_metric_overrides c
set filter_sig = r.final_sig,
    period_kind = 'month'
from _rank_overrides r
where c.id = r.id
  and r.rn = 1
  and c.filter_sig <> r.final_sig;

commit;
