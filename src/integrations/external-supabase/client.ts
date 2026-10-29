import { createClient } from '@supabase/supabase-js';

// FONTE ÚNICA das credenciais = /etc/companium-supabase.env no servidor.
// O deploy.sh injeta SUPABASE_URL/SUPABASE_ANON_KEY daquele arquivo como VITE_* no build.
// NÃO colocar URL/chave hardcoded aqui (a chave anon/publishable é pública, mas a fonte
// deve ser sempre o arquivo central para evitar divergência após rotação de chaves).
export const EXTERNAL_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const EXTERNAL_SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string);

if (!EXTERNAL_SUPABASE_URL || !EXTERNAL_SUPABASE_ANON_KEY) {
  throw new Error(
    'Supabase não configurado: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no build ' +
      '(vêm de /etc/companium-supabase.env via deploy.sh).',
  );
}

export const externalSupabase = createClient(EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: localStorage,
    storageKey: 'groohub-auth',
  },
});

// Alias para imports padronizados em fluxos de auth.
export const supabase = externalSupabase;
