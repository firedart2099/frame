-- =====================================================================
-- Frame — lista de convidados
--
-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Por que no banco e não no site: a chave anon é pública (vai no bundle do
-- navegador, como em qualquer app Supabase). Uma checagem só no JavaScript
-- seria contornada por qualquer um chamando o /auth/v1/signup direto. O
-- gatilho abaixo roda dentro do banco, na hora de criar o usuário — não tem
-- como passar por fora.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A lista
-- ---------------------------------------------------------------------
create table if not exists public.allowed_emails (
  email      text primary key,
  note       text,                       -- "namorada", "irmão", pra você lembrar
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.allowed_emails enable row level security;

-- Ninguém lê a lista pelo site. Quem administra é você, pelo painel do
-- Supabase (que usa a service key e ignora RLS).
drop policy if exists allowlist_no_access on public.allowed_emails;
create policy allowlist_no_access on public.allowed_emails
  for all to authenticated using (false) with check (false);

-- ---------------------------------------------------------------------
-- 2. Consulta pública (só responde sim ou não)
--    O site chama isso antes do cadastro pra dar uma mensagem decente em
--    vez de um erro genérico. Devolve boolean e nada mais: não dá pra
--    listar quem está convidado a partir daqui.
-- ---------------------------------------------------------------------
create or replace function public.email_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.allowed_emails a
    where lower(a.email) = lower(trim(p_email))
  );
$fn$;

grant execute on function public.email_allowed(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. A tranca de verdade: gatilho em auth.users
-- ---------------------------------------------------------------------
create or replace function public.enforce_email_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not exists (
    select 1 from public.allowed_emails a
    where lower(a.email) = lower(new.email)
  ) then
    raise exception 'FRAME_NAO_CONVIDADO: % nao esta na lista', new.email
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists frame_allowlist on auth.users;
create trigger frame_allowlist
  before insert on auth.users
  for each row execute function public.enforce_email_allowlist();

-- ---------------------------------------------------------------------
-- 4. Convida quem pode entrar
--    Troque pelos e-mails de verdade e rode. Pra tirar alguém:
--      delete from public.allowed_emails where email = 'fulano@email.com';
--    (Tirar da lista NÃO apaga a conta de quem já entrou — pra isso, remova
--     o usuário em Authentication > Users.)
-- ---------------------------------------------------------------------
insert into public.allowed_emails (email, note) values
  ('luizfetterviana@gmail.com', 'eu'),
  ('abex12321@gmail.com',       'amigo')
on conflict (email) do nothing;

-- Modelo pra ir adicionando:
-- insert into public.allowed_emails (email, note) values
--   ('namorada@email.com',  'namorada'),
--   ('amigo1@email.com',    'amigo do trampo'),
--   ('amigo2@email.com',    'primo')
-- on conflict (email) do nothing;

-- ---------------------------------------------------------------------
-- 5. Quem já tem conta continua entrando
--    O gatilho só vale pra INSERT: contas criadas antes disso seguem
--    funcionando. Se quiser que a lista reflita quem já entrou, roda uma vez:
-- ---------------------------------------------------------------------
insert into public.allowed_emails (email, note)
select u.email, 'conta anterior a lista'
from auth.users u
where u.email is not null
on conflict (email) do nothing;

-- Conferir como ficou:
--   select email, note, created_at from public.allowed_emails order by created_at;
