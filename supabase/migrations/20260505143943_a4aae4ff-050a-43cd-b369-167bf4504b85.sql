CREATE OR REPLACE FUNCTION public.get_users_with_emails()
RETURNS TABLE (id uuid, email text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT u.id, u.email::text, u.created_at
  FROM auth.users u;
END;
$$;

REVOKE ALL ON FUNCTION public.get_users_with_emails() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_users_with_emails() TO authenticated;