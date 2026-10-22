// scripts/_fewshot.js
//
// Helper COMPARTIDO por revisar / catalogar / ingestar para los ejemplos
// few-shot de clasificación de familias. Los ejemplos viven en
// scripts/ejemplos-familias.json como una lista de { espanol, familias }.
//
// - loadEjemplos(): lee el archivo (tolerante a inexistente/corrupto).
// - buildFewShotBlock(): construye el bloque de texto para inyectar en el prompt.
// - addEjemplos(): añade correcciones nuevas sin duplicar y con variedad por
//   familia, respetando un máximo total. Devuelve cuántas añadió.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeFamilias } from '../src/constants/familias.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EJEMPLOS_PATH = path.join(__dirname, 'ejemplos-familias.json');

// Máximo de ejemplos que se añaden en una sola pasada de --apply-csv.
export const MAX_EJEMPLOS_POR_PASADA = 30;

/**
 * Lee la lista de ejemplos del JSON. Devuelve [] si no existe o no es válido.
 * Cada ejemplo se sanea: { espanol: string, familias: string[] válidas }.
 */
export function loadEjemplos() {
  let raw;
  try {
    raw = fs.readFileSync(EJEMPLOS_PATH, 'utf8');
  } catch {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn('[_fewshot] ejemplos-familias.json no es JSON válido; se ignora.');
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((e) => ({
      espanol: String(e?.espanol || '').trim(),
      familias: sanitizeFamilias(e?.familias),
    }))
    .filter((e) => e.espanol && e.familias.length > 0);
}

/**
 * Construye el bloque de texto few-shot para el prompt. Si no hay ejemplos,
 * devuelve cadena vacía (el prompt funciona igual sin ellos).
 */
export function buildFewShotBlock(ejemplos = loadEjemplos()) {
  if (!ejemplos.length) return '';
  const lineas = ejemplos
    .map((e) => `- "${e.espanol}" -> ${e.familias.join(', ')}`)
    .join('\n');
  return `\nEJEMPLOS DE CLASIFICACIÓN CORRECTA (sigue este criterio):\n${lineas}\n`;
}

/**
 * Escribe la lista completa de ejemplos en el JSON (formateado).
 */
export function saveEjemplos(ejemplos) {
  fs.writeFileSync(EJEMPLOS_PATH, `${JSON.stringify(ejemplos, null, 2)}\n`, 'utf8');
}

/**
 * Añade nuevas correcciones a los ejemplos existentes:
 * - descarta las que ya existen (dedup por español normalizado);
 * - prioriza VARIEDAD: reparte por familia principal para no saturar de una sola;
 * - respeta el máximo `limit` de añadidos en esta pasada.
 * Devuelve { added, total }.
 *
 * `candidatos`: lista de { espanol, familias }.
 */
export function addEjemplos(candidatos, limit = MAX_EJEMPLOS_POR_PASADA) {
  const actuales = loadEjemplos();
  const vistos = new Set(actuales.map((e) => normalizeKey(e.espanol)));

  // Candidatos válidos, saneados y no duplicados (ni entre sí ni con los actuales).
  const limpios = [];
  for (const c of candidatos) {
    const espanol = String(c?.espanol || '').trim();
    const familias = sanitizeFamilias(c?.familias);
    if (!espanol || familias.length === 0) continue;
    const key = normalizeKey(espanol);
    if (vistos.has(key)) continue;
    vistos.add(key);
    limpios.push({ espanol, familias });
  }

  // Selección con variedad: recorre por rondas tomando 1 ejemplo de cada
  // familia principal (la primera del array) hasta llegar al límite.
  const porFamilia = new Map();
  for (const ej of limpios) {
    const principal = ej.familias[0];
    if (!porFamilia.has(principal)) porFamilia.set(principal, []);
    porFamilia.get(principal).push(ej);
  }

  const seleccionados = [];
  const grupos = [...porFamilia.values()];
  let quedan = true;
  while (seleccionados.length < limit && quedan) {
    quedan = false;
    for (const grupo of grupos) {
      if (grupo.length === 0) continue;
      seleccionados.push(grupo.shift());
      quedan = true;
      if (seleccionados.length >= limit) break;
    }
  }

  if (seleccionados.length > 0) {
    saveEjemplos([...actuales, ...seleccionados]);
  }
  return { added: seleccionados.length, total: actuales.length + seleccionados.length };
}

function normalizeKey(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
