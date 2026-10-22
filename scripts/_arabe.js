// scripts/_arabe.js
//
// Normalización del árabe compartida por los scripts (ingestar, deduplicar…).
// Sin efectos de carga: solo exporta funciones puras.

// harakat, tanwin, shadda, sukun, superscript alef, tatweel
const ARABIC_DIACRITICS_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

/**
 * normalizarArabe: deja el término en una forma canónica comparable.
 * - Elimina diacríticos/harakat (fatha, damma, kasra, sukun, shadda, tanwin).
 * - Unifica las variantes de Alif (أ, إ, آ -> ا).
 * - Unifica Alif Maqsura (ى -> ي) y Taa Marbuta (ة -> ه).
 * - Limpia puntuación y espacios redundantes.
 */
export function normalizarArabe(texto) {
  if (!texto) return '';
  return String(texto)
    .normalize('NFC')
    .replace(ARABIC_DIACRITICS_RE, '')       // quita harakat, tanwin, shadda, sukun, tatweel
    .replace(/[أإآٱ]/g, 'ا')                  // variantes de Alif -> Alif simple
    .replace(/ى/g, 'ي')                       // Alif Maqsura -> Yaa
    .replace(/ة/g, 'ه')                       // Taa Marbuta -> Haa
    .replace(/ؤ/g, 'و')                       // Waw con hamza -> Waw
    .replace(/ئ/g, 'ي')                       // Yaa con hamza -> Yaa
    .replace(/[.,;:!¡?¿"'`«»…ـ]/g, ' ')        // puntuación -> espacio
    .replace(/[\u200f\u200e\u202a-\u202e]/g, '') // marcas de dirección invisibles
    .replace(/\s+/g, ' ')                      // colapsa espacios
    .trim();
}
