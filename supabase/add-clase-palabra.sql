-- Migración: añade la columna `clase_palabra` a public.flashcards.
--
-- Clase de palabra (categoría gramatical), dimensión INDEPENDIENTE de las
-- familias temáticas. Solo las tarjetas de tipo 'palabra' reciben clase;
-- las frases quedan en NULL. Una sola clase por tarjeta (su uso principal).
--
-- Valores admitidos (9): Sustantivo, Adjetivo, Artículo, Pronombre, Verbo,
-- Adverbio, Preposición, Conjunción, Interjección. Permite NULL.
--
-- Cómo usar: ejecútalo en Supabase -> SQL Editor. NO se ejecuta automáticamente.
-- Es idempotente: se puede lanzar más de una vez sin error.

alter table public.flashcards
  add column if not exists clase_palabra text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'flashcards_clase_palabra_check'
  ) then
    alter table public.flashcards
      add constraint flashcards_clase_palabra_check
      check (clase_palabra in (
        'Sustantivo', 'Adjetivo', 'Artículo', 'Pronombre', 'Verbo',
        'Adverbio', 'Preposición', 'Conjunción', 'Interjección'
      ));
  end if;
end $$;

-- Índice para el filtro por clase de palabra en la vista principal.
create index if not exists flashcards_clase_palabra_idx
  on public.flashcards (clase_palabra);
