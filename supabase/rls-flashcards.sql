-- Políticas Row Level Security (RLS) para la tabla public.flashcards.
--
-- Cómo usar: ejecuta este script en Supabase -> SQL Editor.
-- ⚠️ IMPORTANTE: antes de ejecutarlo, reemplaza el marcador '<EMAIL_DEL_ADMIN>'
--    en TODAS las políticas de escritura por el email real del usuario admin.
--    Debe ser EXACTAMENTE el mismo valor que la variable VITE_ADMIN_EMAIL del cliente.
--
-- Nota: el rol service_role (usado por los scripts `catalogar` e `ingestar`)
--       SE SALTA RLS siempre, por lo que esos scripts seguirán funcionando igual.

-- 1. Activar RLS en la tabla.
alter table public.flashcards enable row level security;

-- 2. Lectura pública: cualquiera (anónimo o autenticado) puede leer.
create policy "flashcards_select_public"
  on public.flashcards
  for select
  to anon, authenticated
  using (true);

-- 3. Escritura SOLO para el usuario admin, identificado por su email en el JWT.
--    No basta con estar autenticado: el email del token debe coincidir con el admin.

create policy "flashcards_insert_admin"
  on public.flashcards
  for insert
  to authenticated
  with check (auth.jwt() ->> 'email' = '<EMAIL_DEL_ADMIN>');

create policy "flashcards_update_admin"
  on public.flashcards
  for update
  to authenticated
  using (auth.jwt() ->> 'email' = '<EMAIL_DEL_ADMIN>')
  with check (auth.jwt() ->> 'email' = '<EMAIL_DEL_ADMIN>');

create policy "flashcards_delete_admin"
  on public.flashcards
  for delete
  to authenticated
  using (auth.jwt() ->> 'email' = '<EMAIL_DEL_ADMIN>');
