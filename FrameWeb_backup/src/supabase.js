import { createClient } from '@supabase/supabase-js';

/**
 * Mesmo projeto Supabase do app: conta, perfis, pastas e progresso sao os
 * mesmos nos dois lados. A chave anon e publica por design (o que protege os
 * dados e o RLS, definido em db/schema.sql no repo do app).
 */
const supabaseUrl = 'https://viigaxgbimmjudbuhoqh.supabase.co';
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpaWdheGdiaW1tanVkYnVob3FoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4NjM4MDgsImV4cCI6MjEwMzQzOTgwOH0.MkeCooysWNoi5w9R70RRpTphIjYsa3kW4iHw_25XMfo';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    // no navegador o link de confirmacao volta com o token na URL
    detectSessionInUrl: true,
  },
});
