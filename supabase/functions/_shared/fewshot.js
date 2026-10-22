// supabase/functions/_shared/fewshot.js
//
// Parte PURA del few-shot, compartida por scripts y Edge Functions. ESM puro,
// sin APIs de Node ni de Deno. El lado Node (leer/escribir el JSON) vive en
// scripts/_fewshot.js, que reexporta buildFewShotBlock desde aquí.

/**
 * Construye el bloque de texto few-shot para el prompt a partir de una lista de
 * ejemplos { espanol, familias }. Si no hay ejemplos, devuelve cadena vacía.
 */
export function buildFewShotBlock(ejemplos = []) {
  if (!Array.isArray(ejemplos) || ejemplos.length === 0) return '';
  const lineas = ejemplos
    .filter((e) => e && e.espanol && Array.isArray(e.familias) && e.familias.length > 0)
    .map((e) => `- "${e.espanol}" -> ${e.familias.join(', ')}`)
    .join('\n');
  if (!lineas) return '';
  return `\nEJEMPLOS DE CLASIFICACIÓN CORRECTA (sigue este criterio):\n${lineas}\n`;
}
