// src/constants/familias.js
//
// Lista OFICIAL y CERRADA de familias temáticas de vocabulario para nivel A2.
// Es la única fuente de verdad: la usan la UI (filtros, formularios, badges)
// y los scripts de ingestión/catalogación. No añadir variantes fuera de aquí.

export const FAMILIAS_A2 = [
  'Familia y Relaciones',
  'Casa y Vivienda',
  'Comida y Bebida',
  'Rutina y Tiempo Libre',
  'Ciudad, Transporte y Direcciones',
  'Comercio y Compras',
  'Salud y Cuerpo Humano',
  'Trabajo y Educación',
  'Viajes y Clima',
  'Gramática, Conectores y Partículas',
];

// Familia neutra por defecto cuando no se puede clasificar una tarjeta.
export const FAMILIA_POR_DEFECTO = 'Gramática, Conectores y Partículas';

// Conjunto para validaciones rápidas (O(1)).
export const FAMILIAS_A2_SET = new Set(FAMILIAS_A2);

/**
 * Normaliza un array arbitrario de familias dejando solo las válidas, sin
 * duplicados y preservando el orden oficial. Si no queda ninguna válida,
 * devuelve la familia por defecto.
 */
export function sanitizeFamilias(input) {
  const list = Array.isArray(input) ? input : [];
  const found = new Set(list.map((f) => String(f).trim()).filter((f) => FAMILIAS_A2_SET.has(f)));
  const ordered = FAMILIAS_A2.filter((f) => found.has(f));
  return ordered.length > 0 ? ordered : [FAMILIA_POR_DEFECTO];
}

/**
 * Lee el array de familias de una tarjeta de forma tolerante:
 * soporta `familias` como array (text[]) o como string separado por ';'.
 */
export function getCardFamilias(card) {
  if (!card) return [];
  const raw = card.familias;
  if (Array.isArray(raw)) return raw.map((f) => String(f).trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split(';').map((f) => f.trim()).filter(Boolean);
  return [];
}
