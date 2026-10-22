-- Migración: añade la columna `tipo` a public.flashcards.
--   'palabra' -> término léxico (una o pocas palabras)
--   'frase'   -> expresión u oración
-- Permite NULL para tarjetas aún sin clasificar (las rellena
-- `npm run catalogar -- --solo-tipo`).
--
-- Cómo usar: ejecútalo en Supabase -> SQL Editor. NO se ejecuta automáticamente.
-- Es idempotente: se puede lanzar más de una vez sin error.

alter table public.flashcards
  add column if not exists tipo text;

-- Restringe los valores admitidos a 'palabra' | 'frase' (permite NULL).
-- Se crea solo si no existe ya.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'flashcards_tipo_check'
  ) then
    alter table public.flashcards
      add constraint flashcards_tipo_check
      check (tipo in ('palabra', 'frase'));
  end if;
end $$;

-- Índice para que el filtro por tipo en la vista principal sea rápido.
create index if not exists flashcards_tipo_idx
  on public.flashcards (tipo);
