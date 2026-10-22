-- Migración: añade la columna `familias_confianza` a public.flashcards.
--
-- Guarda el nivel de confianza de la clasificación por familias de cada tarjeta:
--   'alta'  -> clasificación segura (o editada a mano por el admin)
--   'media' -> clasificación razonable pero no segura
--   'baja'  -> la IA dudó / usó la familia más cercana (pendiente de revisar)
--
-- Cómo usar: ejecútalo en Supabase -> SQL Editor. NO se ejecuta automáticamente.
-- Es idempotente: se puede lanzar más de una vez sin error.

alter table public.flashcards
  add column if not exists familias_confianza text;

-- Restringe los valores admitidos a 'alta' | 'media' | 'baja' (permite NULL
-- para tarjetas aún sin clasificar). Se crea solo si no existe ya.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'flashcards_familias_confianza_check'
  ) then
    alter table public.flashcards
      add constraint flashcards_familias_confianza_check
      check (familias_confianza in ('alta', 'media', 'baja'));
  end if;
end $$;

-- Índice para que el filtro "Pendientes de revisar" (confianza = 'baja') sea rápido.
create index if not exists flashcards_familias_confianza_idx
  on public.flashcards (familias_confianza);
