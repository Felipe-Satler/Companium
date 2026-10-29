-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto. Aplicar ANTES (ou junto) de subir o frontend novo. É ADITIVO: só amplia o
-- CHECK do `metric` — não toca dado nem policy. Sem ela, salvar correção de VALOR falha
-- (violação do check); o frontend cai no valor calculado (fallback, não quebra a tela).
--
-- NOVO: além das CONTAGENS (leads / consultas & procedimentos agendados/realizados), agora
-- também é possível corrigir manualmente os VALORES EM DINHEIRO (R$) de consultas e
-- procedimentos (agendadas/realizadas × agendados/realizados). Mesma regra "sempre fixo":
-- o valor gravado SUBSTITUI o calculado e cola no recorte (filter_sig) até ser removido.
-- Ao corrigir um valor, o Faturamento Bruto (e o ROAS) recomputam no frontend pela base
-- escolhida do cliente.

alter table public.crm_metric_overrides
  drop constraint if exists crm_metric_overrides_metric_check;

alter table public.crm_metric_overrides
  add constraint crm_metric_overrides_metric_check check (metric in (
    -- contagens (inteiros)
    'leads',
    'consultas_agendadas', 'consultas_realizadas',
    'procedimentos_agendados', 'procedimentos_realizados',
    -- valores em dinheiro (R$)
    'valor_consultas_agendadas', 'valor_consultas_realizadas',
    'valor_procedimentos_agendados', 'valor_procedimentos_realizados'
  ));

notify pgrst, 'reload schema';
