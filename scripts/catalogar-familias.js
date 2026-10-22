// scripts/catalogar-familias.js
//
// Cataloga las tarjetas de la tabla `flashcards` asignándoles una o varias
// "familias" temáticas genéricas de nivel A2 mediante OpenAI (gpt-4o-mini).
//
// Uso:
//   node scripts/catalogar-familias.js            -> solo tarjetas sin familias
//   node scripts/catalogar-familias.js --force    -> recataloga TODAS las tarjetas
//   node scripts/catalogar-familias.js --dry-run  -> no escribe en Supabase, solo muestra el plan
//
// Variables de entorno requeridas (ver .env.example):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   OPENAI_API_KEY

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { sanitizeFamilias, buildFamiliasPromptBlock } from '../src/constants/familias.js';
import { buildFewShotBlock } from './_fewshot.js';

// --- Configuración ---------------------------------------------------------

const MODEL = 'gpt-4o-mini';
const BATCH_SIZE = 25; // tarjetas por petición a la IA
const PAGE_SIZE = 1000; // tarjetas por página al leer de Supabase

// --- Flags de línea de comandos --------------------------------------------

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');

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
- Si NINGUNA familia de la lista encaja, devuelve un array de familias VACÍO ([]). NO inventes ni fuerces una familia.
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
    { "id": <id numérico de la tarjeta>, "familias": ["Familia exacta de la lista", ...] }
  ]
}
Incluye TODAS las tarjetas recibidas, cada una con su id original.

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
    byId.set(Number(id), sanitizeFamilias(item.familias));
  }
  return byId;
}

/**
 * Actualiza la columna `familias` (text[]) de una tarjeta en Supabase.
 */
async function updateCardFamilies(id, familias) {
  const { error } = await supabase
    .from('flashcards')
    .update({ familias })
    .eq('id', id);
  if (error) throw error;
}

// --- Programa principal -----------------------------------------------------

async function main() {
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
  const unclassified = []; // tarjetas sin ninguna familia válida (no se tocan)

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
      const familias = classification.get(Number(card.id)) || [];

      // Sin familia válida: no se actualiza; se registra como "sin clasificar".
      if (familias.length === 0) {
        unclassified.push(card);
        continue;
      }

      if (DRY_RUN) {
        console.log(`\n   [dry-run] #${card.id} "${card.spanish || card.arabic}" -> ${familias.join(', ')}`);
        updated += 1;
        continue;
      }
      try {
        await updateCardFamilies(card.id, familias);
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

  if (unclassified.length > 0) {
    console.log(`\n⚠️  Sin clasificar (no se ${DRY_RUN ? 'actualizarían' : 'actualizaron'}): ${unclassified.length}`);
    for (const card of unclassified) {
      console.log(`   - #${card.id}: "${card.spanish || ''}" / "${card.arabic || ''}"`);
    }
  }

  if (DRY_RUN) console.log('\n   (DRY-RUN: no se escribió nada en Supabase)');
}

main().catch((error) => {
  console.error('\n💥 Error fatal:', error.message);
  process.exit(1);
});
