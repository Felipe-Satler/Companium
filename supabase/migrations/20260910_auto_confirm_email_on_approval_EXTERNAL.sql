-- 20260910 — Auto-confirma o e-mail do usuário assim que ele é aprovado.
--
-- Problema: aprovação do admin (user_approvals.status='approved') é SEPARADA da
-- confirmação de e-mail do Supabase Auth. Ninguém clica no link de confirmação,
-- então auth.users.email_confirmed_at fica null e signInWithPassword recusa com
-- "Email not confirmed" — usuário "aprovado porém não consegue logar".
--
-- Fix definitivo: gatilho em public.user_approvals que, ao virar 'approved',
-- preenche email_confirmed_at do usuário (se ainda null). SECURITY DEFINER para
-- poder escrever em auth.users. Dispara em INSERT (aprovado direto) e UPDATE.
-- (confirmed_at é coluna GERADA — não setar direto.)
--
-- Aplicar MANUALMENTE no SQL Editor do projeto companium-db (DDL via PAT dá 403).

create or replace function public.confirm_email_on_approval()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.status = 'approved' then
    update auth.users
       set email_confirmed_at = coalesce(email_confirmed_at, now())
     where id = new.user_id
       and email_confirmed_at is null
       and deleted_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_confirm_email_on_approval on public.user_approvals;

create trigger trg_confirm_email_on_approval
  after insert or update of status on public.user_approvals
  for each row
  execute function public.confirm_email_on_approval();

-- Backfill de qualquer aprovado ainda não confirmado (defensivo; hoje = 0).
update auth.users u
   set email_confirmed_at = now()
  from public.user_approvals ua
 where ua.user_id = u.id
   and ua.status = 'approved'
   and u.email_confirmed_at is null
   and u.deleted_at is null;
