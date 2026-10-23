// scripts/catalogar-familias.js
//
// Cataloga las tarjetas de la tabla `flashcards` asignándoles una o varias
// "familias" temáticas genéricas de nivel A2 mediante OpenAI (gpt-4o-mini).
//
// Uso:
//   node scripts/catalogar-familias.js            -> solo tarjetas sin familias
//   node scripts/catalogar-familias.js --force    -> recataloga TODAS las tarjetas
//   node scripts/catalogar-familias.js --dry-run  -> no escribe en Supabase, solo muestra el plan
//   node scripts/catalogar-familias.js --solo-tipo
//                                                 -> NO toca familias; rellena la
//                                                    columna `tipo` (palabra|frase) por
//                                                    heurística local (sin IA) de las
//                                                    tarjetas que aún no tienen tipo.
//   node scripts/catalogar-familias.js --solo-clase
//                                                 -> NO toca familias; rellena la
//                                                    dimensión `clase_palabra` (y `tipo`
//                                                    si falta) de las tarjetas que aún
//                                                    no tienen clase. Combinable con
//                                                    --force (todas) y --dry-run.
//
// Variables de entorno requeridas (ver .env.example):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   OPENAI_API_KEY

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { ensureFamilias, sanitizeConfianza, buildFamiliasPromptBlock } from '../src/constants/familias.js';
import { buildClasesPromptBlock, sanitizeClase } from '../src/constants/clases.js';
import { buildFewShotBlock } from './_fewshot.js';

// --- Configuración ---------------------------------------------------------

const MODEL = 'gpt-4o-mini';
const BATCH_SIZE = 25; // tarjetas por petición a la IA
const PAGE_SIZE = 1000; // tarjetas por página al leer de Supabase

// --- Flags de línea de comandos --------------------------------------------

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');
const SOLO_CLASE = args.includes('--solo-clase');
const SOLO_TIPO = args.includes('--solo-tipo');

// --- Validación de entorno -------------------------------------------------

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ Falta la variable de entorno "${name}". Añádela a tu archivo .env (ver .env.example).`);
    process.exit(1);
  }
  return value;
}

const SUPABASE_URL = requireEnv('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const OPENAI_API_KEY = requireEnv('OPENAI_API_KEY');

// --- Clientes ---------------------------------------------------------------

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- Utilidades -------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Lee todas las tarjetas candidatas desde Supabase.
 * Sin --force solo devuelve las que no tienen familias asignadas todavía
 * (columna `familias` NULL o array vacío).
 */
async function fetchCards() {
  const all = [];
  for (let page = 0; page < 50; page += 1) {
    let query = supabase
      .from('flashcards')
      .select('id, arabic, spanish, category, familias')
      .order('id', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (!FORCE) {
      // Solo tarjetas sin familias: NULL o array vacío.
      query = query.or('familias.is.null,familias.eq.{}');
    }

    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

const SYSTEM_PROMPT = `Eres un catalogador experto de vocabulario de árabe para estudiantes de nivel A2.
Tu tarea es asignar a cada tarjeta una o más FAMILIAS.

Debes elegir EXCLUSIVAMENTE valores de esta lista cerrada (copia el NOMBRE literal, con las mismas mayúsculas y acentos). Hay dos grupos: VOCABULARIO y GRAMÁTICA:
${buildFamiliasPromptBlock()}

Reglas de clasificación (OBLIGATORIAS):
- Clasifica por el SIGNIFICADO de la tarjeta, NO por los nombres propios ni el contexto del diálogo.
- Asigna como máximo 3 familias por tarjeta; normalmente 1 de VOCABULARIO + 1 de GRAMÁTICA si aplica.
- Las familias del grupo GRAMÁTICA SOLO cuando la tarjeta trate de ese punto gramatical; NO las añadas por defecto.
- Las frases de saludo, agradecimiento o despedida SIEMPRE van a "Saludos y cortesía".
- "Descripción física" y "Emociones y estados" son SOLO para personas. Los adjetivos sobre cosas o lugares (grande, bonito, limpio, excelente) NO van ahí: clasifícalos por el TEMA de la frase.
- Lugares relacionados con viajar (aeropuerto, hotel, estación) → "Transporte y viajes".
- Escuela, estudiante, universidad, biblioteca → "Clase y estudios".
- Oficios y personas que trabajan (peluquero, médico, vendedor) → "Trabajo y profesiones", aunque exista un lugar con nombre parecido.
- Colores de pelo y de ojos (moreno, rubio) → "Colores" y "Descripción física".
- Si la frase menciona un miembro de la familia (hijos, hermanos), incluye "Familia".
- Dinero (dólar, cheque, euro) → "Compras y ropa".
- Ocio, música, prensa y fotografía (periódico, piano, cámara) → "Rutina y tiempo libre".
- Gafas y accesorios personales → "Compras y ropa".
- Un color suelto SIEMPRE → "Colores".
- Vehículos (coche, autobús, tren) → "Transporte y viajes", aunque lleven adjetivo.
- Personas genéricas (hombre, mujer, gente, chico) y nombres propios de personas → "Personas y nombres propios", NO "Datos personales".
- Partículas y preposiciones que NO son de lugar ("con, por", "a, para") → "Preguntas y conectores".
- TODA tarjeta DEBE recibir al menos una familia: NUNCA devuelvas un array vacío. Si dudas o ninguna encaja del todo, elige la MÁS CERCANA y marca "confianza": "baja".
- Indica además una "confianza" por tarjeta: "alta" (seguro), "media" (razonable) o "baja" (dudoso / familia más cercana).
- NO inventes familias nuevas ni variantes. NO uses etiquetas como "Pista", "Vocabulario lección X", nombres de lección ni categorías del material original.
- Devuelve el NOMBRE de la familia tal cual aparece en la lista.
${buildFewShotBlock()}
- Responde SOLO con JSON válido.`;

/**
 * Pide a la IA que clasifique un lote de tarjetas.
 * Devuelve un Map<id, string[]> con las familias saneadas.
 */
async function classifyBatch(batch) {
  const payload = batch.map((c) => ({
    id: c.id,
    arabic: c.arabic || '',
    spanish: c.spanish || '',
    category: c.category || '',
  }));

  const userPrompt = `Clasifica estas tarjetas. Devuelve un objeto JSON con esta forma exacta:
{
  "resultados": [
    { "id": <id numérico de la tarjeta>, "familias": ["Familia exacta de la lista", ...], "confianza": "alta|media|baja" }
  ]
}
Incluye TODAS las tarjetas recibidas, cada una con su id original. Nunca dejes "familias" vacío.

TARJETAS:
${JSON.stringify(payload, null, 2)}`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });

  const content = response.choices?.[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`La IA no devolvió JSON válido para el lote: ${error.message}`);
  }

  const resultados = Array.isArray(parsed.resultados) ? parsed.resultados : [];
  const byId = new Map();
  for (const item of resultados) {
    const id = item?.id;
    if (id === undefined || id === null) continue;
    // Garantiza familia (nunca vacío); si hubo que forzar el fallback, baja.
    const { familias, forzada } = ensureFamilias(item.familias);
    const confianza = forzada ? 'baja' : sanitizeConfianza(item.confianza);
    byId.set(Number(id), { familias, confianza });
  }
  return byId;
}

/**
 * Actualiza `familias` (text[]) y `familias_confianza` (text) de una tarjeta.
 * Si la columna familias_confianza no existe aún, reintenta solo con familias.
 */
async function updateCardFamilies(id, familias, confianza) {
  const { error } = await supabase
    .from('flashcards')
    .update({ familias, familias_confianza: confianza })
    .eq('id', id);
  if (error) {
    if (/familias_confianza/.test(error.message)) {
      const retry = await supabase.from('flashcards').update({ familias }).eq('id', id);
      if (retry.error) throw retry.error;
      return;
    }
    throw error;
  }
}

// === Dimensión CLASE DE PALABRA (--solo-clase) =============================
//
// Independiente de las familias. Solo las tarjetas de tipo 'palabra' reciben
// clase; las frases quedan con clase_palabra = null. Una sola clase por tarjeta
// (su uso principal); si hay varias acepciones, la primera.

/**
 * Lee las tarjetas candidatas a recibir clase de palabra.
 * Sin --force solo devuelve las que aún no tienen clase (clase_palabra NULL).
 */
async function fetchCardsClase() {
  const all = [];
  for (let page = 0; page < 50; page += 1) {
    let query = supabase
      .from('flashcards')
      .select('id, arabic, spanish, category, tipo, clase_palabra')
      .order('id', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (!FORCE) {
      query = query.is('clase_palabra', null);
    }

    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

const SYSTEM_PROMPT_CLASE = `Eres un gramático experto de árabe para estudiantes de nivel A2.
Tu tarea es asignar a cada tarjeta su TIPO y, si procede, su CLASE DE PALABRA.

TIPO: indica si la tarjeta es una sola palabra o una expresión de varias palabras.
- "palabra": una única unidad léxica (aunque lleve artículo o pronombre pegado).
- "frase": expresión, oración o locución de varias palabras.

CLASE DE PALABRA: elige EXCLUSIVAMENTE un valor de esta lista cerrada (copia el NOMBRE literal, con las mismas mayúsculas y acentos):
${buildClasesPromptBlock()}

Reglas de clasificación (OBLIGATORIAS):
- Clasifica por el SIGNIFICADO y la función de la tarjeta.
- Asigna la clase SOLO a las tarjetas de tipo "palabra". En las tarjetas de tipo "frase", devuelve "clase_palabra": null.
- UNA sola clase por tarjeta: la de su USO PRINCIPAL. Si una palabra tiene varias acepciones de distinta clase, elige la PRIMERA/más habitual.
- Los numerales usados como nombre (once, diez) son "Sustantivo".
- Los nombres propios (personas, países, ciudades) son "Sustantivo".
- Los interrogativos de lugar/tiempo/modo (¿dónde?, ¿cuándo?, ¿cómo?) son "Adverbio"; ¿quién?, ¿qué?, ¿cuál? son "Pronombre".
- NO inventes clases nuevas ni variantes. Usa SOLO los nombres de la lista.
- Responde SOLO con JSON válido.`;

/**
 * Pide a la IA el tipo y la clase de palabra de un lote de tarjetas.
 * Devuelve un Map<id, { tipo, clase_palabra }> ya saneado.
 */
async function classifyBatchClase(batch) {
  const payload = batch.map((c) => ({
    id: c.id,
    arabic: c.arabic || '',
    spanish: c.spanish || '',
    category: c.category || '',
  }));

  const userPrompt = `Clasifica estas tarjetas. Devuelve un objeto JSON con esta forma exacta:
{
  "resultados": [
    { "id": <id numérico de la tarjeta>, "tipo": "palabra|frase", "clase_palabra": "Clase exacta de la lista o null" }
  ]
}
Incluye TODAS las tarjetas recibidas, cada una con su id original.
Recuerda: "clase_palabra" debe ser null cuando el "tipo" sea "frase".

TARJETAS:
${JSON.stringify(payload, null, 2)}`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_CLASE },
      { role: 'user', content: userPrompt },
    ],
  });

  const content = response.choices?.[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`La IA no devolvió JSON válido para el lote: ${error.message}`);
  }

  const resultados = Array.isArray(parsed.resultados) ? parsed.resultados : [];
  const byId = new Map();
  for (const item of resultados) {
    const id = item?.id;
    if (id === undefined || id === null) continue;
    const tipo = item?.tipo === 'frase' ? 'frase' : 'palabra';
    // Solo las palabras reciben clase; las frases, null.
    const clase_palabra = tipo === 'palabra' ? sanitizeClase(item.clase_palabra) : null;
    byId.set(Number(id), { tipo, clase_palabra });
  }
  return byId;
}

/**
 * Actualiza `clase_palabra` de una tarjeta (y `tipo` si aún no lo tenía).
 * Nunca toca las familias.
 */
async function updateCardClase(card, tipo, clase_palabra) {
  const patch = { clase_palabra };
  // Rellena tipo solo si la tarjeta todavía no lo tiene.
  if (!card.tipo) patch.tipo = tipo;

  const { error } = await supabase.from('flashcards').update(patch).eq('id', card.id);
  if (error) {
    // Si la columna tipo no existe aún, reintenta solo con clase_palabra.
    if (/tipo/.test(error.message) && patch.tipo !== undefined) {
      const retry = await supabase.from('flashcards').update({ clase_palabra }).eq('id', card.id);
      if (retry.error) throw retry.error;
      return;
    }
    throw error;
  }
}

async function mainClase() {
  console.log('🔌 Conectando a Supabase y OpenAI...');
  console.log(`   Modo: CLASE DE PALABRA · ${FORCE ? 'FORCE (todas las tarjetas)' : 'solo tarjetas sin clase'}${DRY_RUN ? ' · DRY-RUN (sin escribir)' : ''}`);

  const cards = await fetchCardsClase();
  console.log(`📥 ${cards.length} tarjeta(s) a clasificar por clase.`);
  if (cards.length === 0) {
    console.log('✅ No hay nada que hacer.');
    return;
  }

  const batches = chunk(cards, BATCH_SIZE);
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    process.stdout.write(`🧠 Lote ${i + 1}/${batches.length} (${batch.length} tarjetas)... `);

    let classification;
    try {
      classification = await classifyBatchClase(batch);
    } catch (error) {
      console.log(`⚠️  error de IA: ${error.message}`);
      failed += batch.length;
      continue;
    }

    for (const card of batch) {
      const result = classification.get(Number(card.id)) || { tipo: 'palabra', clase_palabra: null };
      const { tipo, clase_palabra } = result;

      if (DRY_RUN) {
        console.log(`\n   [dry-run] #${card.id} "${card.spanish || card.arabic}" -> tipo=${tipo}, clase=${clase_palabra ?? 'null'}`);
        updated += 1;
        continue;
      }
      try {
        await updateCardClase(card, tipo, clase_palabra);
        updated += 1;
      } catch (error) {
        console.log(`\n   ❌ No se pudo actualizar #${card.id}: ${error.message}`);
        failed += 1;
      }
    }

    if (!DRY_RUN) process.stdout.write('ok\n');
    if (i < batches.length - 1) await sleep(400);
  }

  console.log('\n🎉 Clasificación por clase terminada.');
  console.log(`   ${DRY_RUN ? 'A actualizar' : 'Actualizadas'}: ${updated}`);
  if (failed > 0) console.log(`   Con errores:  ${failed}`);
  if (DRY_RUN) console.log('\n   (DRY-RUN: no se escribió nada en Supabase)');
}

// --- Programa principal -----------------------------------------------------

// === Dimensión TIPO (--solo-tipo) =========================================
//
// Rellena `tipo` ('palabra' | 'frase') sin tocar familias ni clase. Heurística
// local barata (sin OpenAI): frase si la categoría incluye 'frases' o el español
// tiene más de 2 palabras; en caso contrario, palabra.

function inferirTipoLocal(card) {
  if (card.category && card.category.toLowerCase().includes('frases')) return 'frase';
  return (card.spanish || '').trim().split(/\s+/).filter(Boolean).length > 2 ? 'frase' : 'palabra';
}

async function fetchCardsTipo() {
  const all = [];
  for (let page = 0; page < 50; page += 1) {
    let query = supabase
      .from('flashcards')
      .select('id, spanish, category, tipo')
      .order('id', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (!FORCE) query = query.is('tipo', null);
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

async function mainTipo() {
  console.log('🔌 Conectando a Supabase...');
  console.log(`   Modo: TIPO (heurística local) · ${FORCE ? 'FORCE (todas)' : 'solo tarjetas sin tipo'}${DRY_RUN ? ' · DRY-RUN' : ''}`);
  const cards = await fetchCardsTipo();
  console.log(`📥 ${cards.length} tarjeta(s) a clasificar por tipo.`);
  if (cards.length === 0) { console.log('✅ No hay nada que hacer.'); return; }

  let updated = 0;
  let failed = 0;
  for (const card of cards) {
    const tipo = inferirTipoLocal(card);
    if (DRY_RUN) {
      console.log(`   [dry-run] #${card.id} "${card.spanish || ''}" -> tipo=${tipo}`);
      updated += 1;
      continue;
    }
    const { error } = await supabase.from('flashcards').update({ tipo }).eq('id', card.id);
    if (error) { console.log(`   ❌ #${card.id}: ${error.message}`); failed += 1; } else { updated += 1; }
  }

  console.log('\n🎉 Clasificación por tipo terminada.');
  console.log(`   ${DRY_RUN ? 'A actualizar' : 'Actualizadas'}: ${updated}`);
  if (failed > 0) console.log(`   Con errores:  ${failed}`);
  if (DRY_RUN) console.log('\n   (DRY-RUN: no se escribió nada en Supabase)');
}

async function main() {
  if (SOLO_TIPO) {
    await mainTipo();
    return;
  }
  if (SOLO_CLASE) {
    await mainClase();
    return;
  }
  console.log('🔌 Conectando a Supabase y OpenAI...');
  console.log(`   Modo: ${FORCE ? 'FORCE (todas las tarjetas)' : 'solo tarjetas sin familias'}${DRY_RUN ? ' · DRY-RUN (sin escribir)' : ''}`);

  const cards = await fetchCards();
  console.log(`📥 ${cards.length} tarjeta(s) a catalogar.`);
  if (cards.length === 0) {
    console.log('✅ No hay nada que hacer.');
    return;
  }

  const batches = chunk(cards, BATCH_SIZE);
  let updated = 0;
  let failed = 0;
  const bajas = []; // tarjetas asignadas con confianza baja (pendientes de revisar)

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    process.stdout.write(`🧠 Lote ${i + 1}/${batches.length} (${batch.length} tarjetas)... `);

    let classification;
    try {
      classification = await classifyBatch(batch);
    } catch (error) {
      console.log(`⚠️  error de IA: ${error.message}`);
      failed += batch.length;
      continue;
    }

    for (const card of batch) {
      // Nunca sin familia: si la IA no devolvió nada para esta tarjeta,
      // recurrimos al fallback con confianza baja.
      const result = classification.get(Number(card.id)) || ensureFamiliasFallback();
      const { familias, confianza } = result;
      if (confianza === 'baja') bajas.push(card);

      if (DRY_RUN) {
        console.log(`\n   [dry-run] #${card.id} "${card.spanish || card.arabic}" -> ${familias.join(', ')} (${confianza})`);
        updated += 1;
        continue;
      }
      try {
        await updateCardFamilies(card.id, familias, confianza);
        updated += 1;
      } catch (error) {
        console.log(`\n   ❌ No se pudo actualizar #${card.id}: ${error.message}`);
        failed += 1;
      }
    }

    if (!DRY_RUN) process.stdout.write('ok\n');

    // Pequeña pausa para no saturar la API entre lotes.
    if (i < batches.length - 1) await sleep(400);
  }

  console.log('\n🎉 Catalogación terminada.');
  console.log(`   ${DRY_RUN ? 'A actualizar' : 'Actualizadas'}: ${updated}`);
  if (failed > 0) console.log(`   Con errores:  ${failed}`);

  if (bajas.length > 0) {
    console.log(`\n⚠️  Confianza baja (pendientes de revisar): ${bajas.length}`);
    for (const card of bajas) {
      console.log(`   - #${card.id}: "${card.spanish || ''}" / "${card.arabic || ''}"`);
    }
  }

  if (DRY_RUN) console.log('\n   (DRY-RUN: no se escribió nada en Supabase)');
}

// Fallback local por si la IA ni siquiera devuelve la tarjeta en su respuesta.
function ensureFamiliasFallback() {
  const { familias } = ensureFamilias([]);
  return { familias, confianza: 'baja' };
}

main().catch((error) => {
  console.error('\n💥 Error fatal:', error.message);
  process.exit(1);
});
