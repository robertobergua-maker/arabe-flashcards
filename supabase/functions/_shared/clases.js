// supabase/functions/_shared/clases.js
//
// FUENTE CANÓNICA ÚNICA de las CLASES DE PALABRA (categoría gramatical).
// Es una dimensión INDEPENDIENTE de las familias temáticas.
// ESM puro, sin APIs de Node ni de Deno: portable a Vite, Node y Deno.
//
// Reglas de uso (las aplican el importador y catalogar):
// - Solo las tarjetas de tipo 'palabra' reciben clase; las 'frase' quedan null.
// - Una sola clase por tarjeta, la de su USO PRINCIPAL.
// - Si una entrada tiene varias acepciones de distinta clase, se toma la PRIMERA.

export const CLASES_PALABRA_META = [
  {
    nombre: 'Sustantivo',
    descripcion: 'Nombra personas, cosas, lugares o conceptos (incluye nombres propios y numerales usados como nombre).',
    ejemplos: ['casa', 'padre', 'Marruecos', 'once'],
  },
  {
    nombre: 'Adjetivo',
    descripcion: 'Describe una cualidad o estado de un sustantivo.',
    ejemplos: ['alto', 'rojo', 'contento'],
  },
  {
    nombre: 'Artículo',
    descripcion: 'Determinante del nombre.',
    ejemplos: ['ال'],
  },
  {
    nombre: 'Pronombre',
    descripcion: 'Sustituye o señala al nombre: personales, demostrativos, posesivos, interrogativos.',
    ejemplos: ['él', 'este', 'mi', 'ـكَ (tu)', '¿quién?'],
  },
  {
    nombre: 'Verbo',
    descripcion: 'Expresa acción o estado; formas conjugadas.',
    ejemplos: ['tengo', 'escribe', 'estudia'],
  },
  {
    nombre: 'Adverbio',
    descripcion: 'Modifica a verbo, adjetivo u oración: lugar, tiempo, modo…',
    ejemplos: ['aquí', 'ahora', '¿dónde?', 'debajo', 'delante'],
  },
  {
    nombre: 'Preposición',
    descripcion: 'Relaciona palabras introduciendo un complemento.',
    ejemplos: ['en', 'sobre', 'con', 'de'],
  },
  {
    nombre: 'Conjunción',
    descripcion: 'Une palabras u oraciones.',
    ejemplos: ['y', 'pero', 'ni… ni'],
  },
  {
    nombre: 'Interjección',
    descripcion: 'Expresa emoción o fórmula exclamativa.',
    ejemplos: ['¡hola!', '¡ah!'],
  },
];

// Lista ordenada de nombres (fuente de verdad para UI y validación).
export const CLASES_PALABRA = CLASES_PALABRA_META.map((c) => c.nombre);

// Conjunto para validaciones rápidas (O(1)).
export const CLASES_PALABRA_SET = new Set(CLASES_PALABRA);

/**
 * Normaliza un valor de clase de palabra: devuelve el nombre canónico si es
 * válido, o null si no lo es (null = sin clase, válido para frases o descartes).
 */
export function sanitizeClase(value) {
  const v = String(value ?? '').trim();
  return CLASES_PALABRA_SET.has(v) ? v : null;
}

/**
 * Construye el bloque de texto con las 9 clases (nombre · descripción · ejemplos)
 * para inyectar en el prompt de la IA.
 */
export function buildClasesPromptBlock() {
  return CLASES_PALABRA_META
    .map((c) => `- ${c.nombre}: ${c.descripcion} Ej.: ${c.ejemplos.join(', ')}.`)
    .join('\n');
}
