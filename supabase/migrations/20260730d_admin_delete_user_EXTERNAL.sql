-- ⚠️ PROJETO-ALVO: your-project-ref. Rode no SQL Editor. Aplicar ANTES de subir o front.
--
-- EXCLUIR USUÁRIO (só admin): remove o usuário do sistema de vez — apaga aprovação, papéis,
-- vínculo de usuário-cliente e config de bot, e deleta a conta de auth. Depois disso a pessoa
-- some da lista e perde todo acesso; se ela se cadastrar de novo, o trigger on_auth_user_created
-- recria como 'pending' para poder ser ACEITA novamente. Diferente de "Rejeitar" (que mantém
-- na aba Rejeitados). SECURITY DEFINER para poder deletar de auth.users.

create or replace function public.admin_delete_user(_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Só admin. E ninguém exclui a si mesmo (evita se trancar pra fora).
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Apenas administradores podem excluir usuários.';
  end if;
  if _uid = auth.uid() then
    raise exception 'Você não pode excluir a si mesmo.';
  end if;

  -- Limpa dados de app (user_roles/user_approvals cairiam por CASCADE, mas explícito é
  -- idempotente e cobre tabelas SEM cascade — user_client_scope e user_bot_settings).
  delete from public.user_client_scope where user_id = _uid;
  delete from public.user_bot_settings  where user_id = _uid;
  delete from public.user_roles         where user_id = _uid;
  delete from public.user_approvals     where user_id = _uid;

  -- Remove a conta de auth (dispara os cascades restantes: user_roles/user_approvals via FK,
  -- decided_by vira NULL). Some da lista da Administração (que é montada por user_approvals).
  delete from auth.users where id = _uid;
end;
$$;

revoke execute on function public.admin_delete_user(uuid) from public, anon;
grant  execute on function public.admin_delete_user(uuid) to authenticated;

notify pgrst, 'reload schema';
