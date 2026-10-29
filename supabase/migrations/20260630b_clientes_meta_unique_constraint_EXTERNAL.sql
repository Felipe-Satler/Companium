-- Fix: o upsert do frontend (supabase-js .upsert(..., {onConflict: "client_id,mes"}))
-- não persistia. O PostgREST resolve o ON CONFLICT de forma mais confiável contra uma
-- CONSTRAINT nomeada do que contra um índice único "solto". Promovemos o índice único
-- existente (clientes_meta_client_mes_uidx) a constraint e recarregamos o schema cache.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.clientes_meta'::regclass
      and conname = 'clientes_meta_client_mes_key'
  ) then
    alter table public.clientes_meta
      add constraint clientes_meta_client_mes_key unique using index clientes_meta_client_mes_uidx;
  end if;
end $$;

notify pgrst, 'reload schema';
