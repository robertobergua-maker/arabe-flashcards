// scripts/revisar-familias.js
//
// Repaso fino de la clasificación por familias. Una IA (gpt-4o) actúa como
// REVISORA: para cada tarjeta decide si las familias actuales son correctas o
// propone otras, con motivo breve y confianza (alta/media/baja).
//
// Uso:
//   npm run revisar                         -> genera docs/revision-familias.csv (no escribe en BD)
//   npm run revisar -- --familia "Familia"  -> revisa solo esa familia
//   npm run revisar -- --apply              -> aplica SOLO los cambios de confianza alta
//   npm run revisar -- --apply-csv          -> aplica lo que haya en docs/revision-familias.csv
//                                              (editable en Excel) y aprende ejemplos few-shot
//
// Variables de entorno requeridas (ver .env.example):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   OPENAI_API_KEY

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import {
  FAMILIAS_A2,
  sanitizeFamilias,
  buildFamiliasPromptBlock,
} from '../src/constants/familias.js';
import { buildFewShotBlock, addEjemplos } from './_fewshot.js';

// --- Configuración ---------------------------------------------------------

const MODEL = 'gpt-4o';
const BATCH_SIZE = 10; // lotes pequeños: la revisión es más exigente
const PAGE_SIZE = 1000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, '..', 'docs', 'revision-familias.csv');

const CONFIANZAS = new Set(['alta', 'media', 'baja']);

// --- Flags ------------------------------------------------------------------

const args = process.argv.slice(2);
const APPLY_ALTA = args.includes('--apply');
const APPLY_CSV = args.includes('--apply-csv');

function getFlagValue(name) {
  const prefix = `--${name}=`;
  const withEq = args.find((a) => a.startsWith(prefix));
  if (withEq) return withEq.slice(prefix.length);
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return null;
}

const FAMILIA_FILTRO = getFlagValue('familia');

// --- Validación de entorno --------------------------------------------------

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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- Utilidades -------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

function arraysIguales(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

// --- CSV (parseo y escritura con soporte de comillas) -----------------------

const CSV_HEADERS = ['id', 'arabe', 'espanol', 'familias_actuales', 'familias_propuestas', 'confianza', 'motivo'];
// Separador de COLUMNAS. Usamos ';' porque Excel en español lo toma como
// separador de columnas por defecto (la coma la usa como decimal).
const COL_SEP = ';';
// Separador interno de familias dentro de una misma celda.
const FAM_SEP = '|';
// BOM para que Excel detecte UTF-8 y muestre bien el árabe.
const BOM = '\ufeff';

function csvEscape(value) {
  const s = String(value ?? '');
  // Entrecomilla si contiene el separador de columnas, comillas o saltos de línea.
  if (/[";,\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(rows) {
  const lines = [CSV_HEADERS.join(COL_SEP)];
  for (const r of rows) {
    lines.push([
      csvEscape(r.id),
      csvEscape(r.arabe),
      csvEscape(r.espanol),
      csvEscape(r.familiasActuales.join(FAM_SEP)),
      csvEscape(r.familiasPropuestas.join(FAM_SEP)),
      csvEscape(r.confianza),
      csvEscape(r.motivo),
    ].join(COL_SEP));
  }
  fs.mkdirSync(path.dirname(CSV_PATH), { recursive: true });
  // UTF-8 con BOM.
  fs.writeFileSync(CSV_PATH, `${BOM}${lines.join('\n')}\n`, 'utf8');
}

/**
 * Parser CSV minimalista que respeta comillas dobles. Acepta el separador de
 * columnas indicado (';' o ','). Tolera el BOM al inicio.
 */
function parseCsv(text, delimiter) {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Detecta el separador de columnas a partir de la primera línea: si hay más
 * ';' que ',' fuera de comillas, usa ';'; en caso contrario ','.
 */
function detectDelimiter(text) {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = clean.split(/\r?\n/, 1)[0] || '';
  let semis = 0;
  let commas = 0;
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === ';') semis += 1;
    else if (!inQuotes && ch === ',') commas += 1;
  }
  return semis >= commas ? ';' : ',';
}

function splitFamilias(cell) {
  return String(cell || '')
    .split(FAM_SEP)
    .map((f) => f.trim())
    .filter(Boolean);
}

// --- Lectura de tarjetas ----------------------------------------------------

async function fetchCards() {
  const all = [];
  for (let page = 0; page < 50; page += 1) {
    let query = supabase
      .from('flashcards')
      .select('id, arabic, spanish, familias')
      .order('id', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (FAMILIA_FILTRO) query = query.contains('familias', [FAMILIA_FILTRO]);

    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

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

// --- Prompt de revisión -----------------------------------------------------

function buildSystemPrompt() {
  return `Eres una REVISORA experta de clasificación de vocabulario de árabe para nivel A2.
Recibes tarjetas (árabe, español y sus familias ACTUALES) y debes revisar si la clasificación es correcta.

Lista cerrada de familias (usa el NOMBRE literal). Hay dos grupos: VOCABULARIO y GRAMÁTICA:
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
- TODA tarjeta DEBE recibir al menos una familia: NUNCA propongas un array vacío. Si dudas o ninguna encaja del todo, elige la familia MÁS CERCANA y marca "confianza": "baja".
${buildFewShotBlock()}
Para CADA tarjeta decide:
- "ok": true si las familias actuales ya son correctas; false si propondrías otras.
- "familias": el array de familias correcto (las actuales si ok=true, o tu propuesta).
- "confianza": "alta" | "media" | "baja" (qué seguridad tienes en tu propuesta).
- "motivo": explicación BREVE (máx. ~15 palabras).

Responde SOLO con JSON válido.`;
}

async function reviewBatch(batch) {
  const payload = batch.map((c) => ({
    id: c.id,
    arabic: c.arabic || '',
    spanish: c.spanish || '',
    familias_actuales: Array.isArray(c.familias) ? c.familias : [],
  }));

  const userPrompt = `Revisa estas tarjetas. Devuelve un objeto JSON con esta forma exacta:
{
  "resultados": [
    { "id": <id>, "ok": <bool>, "familias": ["..."], "confianza": "alta|media|baja", "motivo": "..." }
  ]
}
Incluye TODAS las tarjetas recibidas.

TARJETAS:
${JSON.stringify(payload, null, 2)}`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: userPrompt },
    ],
  });

  const content = response.choices?.[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`La IA no devolvió JSON válido: ${error.message}`);
  }

  const resultados = Array.isArray(parsed.resultados) ? parsed.resultados : [];
  const byId = new Map();
  for (const item of resultados) {
    const id = item?.id;
    if (id === undefined || id === null) continue;
    const confianza = CONFIANZAS.has(item?.confianza) ? item.confianza : 'baja';
    byId.set(Number(id), {
      familias: sanitizeFamilias(item?.familias),
      confianza,
      motivo: String(item?.motivo || '').trim(),
    });
  }
  return byId;
}

// --- Modo: revisar (genera CSV) ---------------------------------------------

async function modoRevisar() {
  const cards = await fetchCards();
  console.log(`📥 ${cards.length} tarjeta(s) a revisar${FAMILIA_FILTRO ? ` (familia: "${FAMILIA_FILTRO}")` : ''}.`);
  if (cards.length === 0) { console.log('✅ No hay nada que revisar.'); return; }

  const batches = chunk(cards, BATCH_SIZE);
  const cambios = [];
  const resumen = { ok: 0, alta: 0, media: 0, baja: 0, error: 0 };

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    process.stdout.write(`🔎 Lote ${i + 1}/${batches.length} (${batch.length})... `);
    let review;
    try {
      review = await reviewBatch(batch);
    } catch (error) {
      console.log(`⚠️  ${error.message}`);
      resumen.error += batch.length;
      continue;
    }

    for (const card of batch) {
      const actuales = sanitizeFamilias(card.familias);
      const r = review.get(Number(card.id));
      if (!r) { resumen.error += 1; continue; }

      const propuestas = r.familias;
      const hayCambio = !arraysIguales(actuales, propuestas);
      if (!hayCambio) { resumen.ok += 1; continue; }

      resumen[r.confianza] += 1;
      cambios.push({
        id: card.id,
        arabe: card.arabic || '',
        espanol: card.spanish || '',
        familiasActuales: actuales,
        familiasPropuestas: propuestas,
        confianza: r.confianza,
        motivo: r.motivo,
      });
    }
    console.log('ok');
    if (i < batches.length - 1) await sleep(400);
  }

  writeCsv(cambios);

  console.log('\n📊 Resumen de la revisión:');
  console.log(`   Correctas (sin cambio): ${resumen.ok}`);
  console.log(`   Cambios propuestos:     ${cambios.length}`);
  console.log(`     · confianza alta:  ${resumen.alta}`);
  console.log(`     · confianza media: ${resumen.media}`);
  console.log(`     · confianza baja:  ${resumen.baja}`);
  if (resumen.error > 0) console.log(`   Sin respuesta de la IA: ${resumen.error}`);
  console.log(`\n📝 CSV generado: ${path.relative(path.join(__dirname, '..'), CSV_PATH)}`);
  console.log('   (No se ha escrito nada en Supabase. Usa --apply o --apply-csv para aplicar.)');
}

// --- Modo: --apply (solo confianza alta, recalcula en vivo) -----------------

async function modoApplyAlta() {
  const cards = await fetchCards();
  console.log(`📥 ${cards.length} tarjeta(s) a revisar y aplicar (solo confianza ALTA)${FAMILIA_FILTRO ? ` (familia: "${FAMILIA_FILTRO}")` : ''}.`);
  if (cards.length === 0) { console.log('✅ No hay nada que hacer.'); return; }

  const batches = chunk(cards, BATCH_SIZE);
  let aplicados = 0;
  let fallidos = 0;
  let ignorados = 0;

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    process.stdout.write(`🔎 Lote ${i + 1}/${batches.length} (${batch.length})... `);
    let review;
    try {
      review = await reviewBatch(batch);
    } catch (error) {
      console.log(`⚠️  ${error.message}`);
      fallidos += batch.length;
      continue;
    }

    for (const card of batch) {
      const actuales = sanitizeFamilias(card.familias);
      const r = review.get(Number(card.id));
      if (!r) continue;
      const propuestas = r.familias;
      if (arraysIguales(actuales, propuestas)) continue;
      if (r.confianza !== 'alta') { ignorados += 1; continue; }
      if (propuestas.length === 0) { ignorados += 1; continue; } // no dejamos sin familia por "alta"

      try {
        await updateCardFamilies(card.id, propuestas, r.confianza);
        aplicados += 1;
        console.log(`\n   ✅ #${card.id} "${card.spanish}" -> ${propuestas.join(', ')}`);
      } catch (error) {
        console.log(`\n   ❌ #${card.id}: ${error.message}`);
        fallidos += 1;
      }
    }
    process.stdout.write('ok\n');
    if (i < batches.length - 1) await sleep(400);
  }

  console.log('\n🎉 Aplicación (confianza alta) terminada.');
  console.log(`   Aplicados: ${aplicados}`);
  console.log(`   Ignorados (media/baja o vacío): ${ignorados}`);
  if (fallidos > 0) console.log(`   Fallidos: ${fallidos}`);
}

// --- Modo: --apply-csv (aplica el CSV editado + aprende ejemplos) -----------

async function modoApplyCsv() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌ No existe el CSV: ${CSV_PATH}. Ejecuta antes "npm run revisar".`);
    process.exit(1);
  }
  const fileText = fs.readFileSync(CSV_PATH, 'utf8');
  const delimiter = detectDelimiter(fileText); // acepta ';' (Excel ES) o ','
  const rows = parseCsv(fileText, delimiter);
  if (rows.length <= 1) { console.log('✅ El CSV no tiene filas de cambios.'); return; }

  // Solo nos interesan las columnas `id` y `familias_propuestas`: así, aunque
  // Excel estropee el árabe al guardar, la aplicación sigue siendo fiable.
  // `espanol` se lee solo de forma oportunista para el few-shot (es español,
  // no se corrompe), pero su ausencia nunca impide aplicar.
  const header = rows[0].map((h) => h.trim().replace(/^\ufeff/, ''));
  const idxId = header.indexOf('id');
  const idxProp = header.indexOf('familias_propuestas');
  const idxEsp = header.indexOf('espanol');
  if (idxId === -1 || idxProp === -1) {
    console.error('❌ El CSV debe tener al menos las columnas "id" y "familias_propuestas" en la cabecera.');
    process.exit(1);
  }

  console.log(`📄 CSV leído (separador "${delimiter}"). Usando solo columnas id y familias_propuestas.`);

  let aplicados = 0;
  let fallidos = 0;
  let saltados = 0;
  const aprendidos = []; // para few-shot

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const id = Number(String(row[idxId] || '').trim());
    if (!Number.isInteger(id)) { saltados += 1; continue; }

    const propuestas = sanitizeFamilias(splitFamilias(row[idxProp]));
    const espanol = idxEsp !== -1 ? String(row[idxEsp] ?? '').trim() : '';

    if (propuestas.length === 0) {
      // Fila sin propuesta válida (p. ej. el usuario la vació): se salta.
      saltados += 1;
      continue;
    }

    try {
      // Edición revisada a mano: confianza 'alta'.
      await updateCardFamilies(id, propuestas, 'alta');
      aplicados += 1;
      if (espanol) aprendidos.push({ espanol, familias: propuestas });
      console.log(`   ✅ #${id} -> ${propuestas.join(', ')} (alta)`);
    } catch (error) {
      console.log(`   ❌ #${id}: ${error.message}`);
      fallidos += 1;
    }
  }

  // Aprender ejemplos few-shot (hasta 30, variados, sin duplicar).
  const { added, total } = addEjemplos(aprendidos);

  console.log('\n🎉 Aplicación desde CSV terminada.');
  console.log(`   Aplicados: ${aplicados}`);
  if (saltados > 0) console.log(`   Saltados (sin id o sin propuesta): ${saltados}`);
  if (fallidos > 0) console.log(`   Fallidos: ${fallidos}`);
  console.log(`   Ejemplos few-shot añadidos: ${added} (total en el archivo: ${total}).`);
}

// --- Entrada ----------------------------------------------------------------

async function main() {
  if (APPLY_CSV && APPLY_ALTA) {
    console.error('❌ Usa --apply O --apply-csv, no ambos a la vez.');
    process.exit(1);
  }
  if (FAMILIA_FILTRO && !FAMILIAS_A2.includes(FAMILIA_FILTRO)) {
    console.error(`❌ Familia desconocida: "${FAMILIA_FILTRO}". Debe ser una de la lista oficial.`);
    process.exit(1);
  }

  if (APPLY_CSV) return modoApplyCsv();
  if (APPLY_ALTA) return modoApplyAlta();
  return modoRevisar();
}

main().catch((error) => {
  console.error('\n💥 Error fatal:', error.message);
  process.exit(1);
});
