// scripts/ingestar-aportes.js
//
// Pipeline de ingestión inteligente para el admin: lee aportes de vocabulario
// (texto, imagen o PDF), extrae y cataloga el vocabulario con IA, y lo inserta
// en la tabla `flashcards` de Supabase con prevención ESTRICTA de duplicados.
//
// Uso:
//   npm run ingestar -- --archivo=aportes/leccion5.txt
//   npm run ingestar -- --imagen=aportes/nota.jpg
//   npm run ingestar -- --archivo=aportes/apuntes.pdf
//   npm run ingestar -- --carpeta=aportes
//   npm run ingestar -- --archivo=aportes/leccion5.txt --dry-run
//
// También acelra una ruta posicional suelta:
//   npm run ingestar -- aportes/leccion5.txt
//
// Variables de entorno requeridas (ver .env.example):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   OPENAI_API_KEY

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { sanitizeFamilias, buildFamiliasPromptBlock } from '../src/constants/familias.js';
import { buildFewShotBlock } from './_fewshot.js';

// --- Configuración ---------------------------------------------------------

const MODEL = 'gpt-4o-mini'; // soporta visión (imágenes) y texto
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const SUPPORTED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...IMAGE_EXTENSIONS, ...PDF_EXTENSIONS]);

const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

// --- Flags / argumentos -----------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

function getFlagValue(...names) {
  for (const name of names) {
    const prefix = `--${name}=`;
    const match = args.find((a) => a.startsWith(prefix));
    if (match) return match.slice(prefix.length);
  }
  return null;
}

// Ruta: admite --archivo=, --imagen=, --pdf=, --carpeta= o un argumento suelto.
const inputPath =
  getFlagValue('archivo', 'imagen', 'pdf', 'carpeta', 'ruta') ||
  args.find((a) => !a.startsWith('--')) ||
  null;

// --- Validación de entorno -------------------------------------------------

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ Falta la variable de entorno "${name}". Añádela a tu archivo .env (ver .env.example).`);
    process.exit(1);
  }
  return value;
}

// --- Normalización lingüística del árabe -----------------------------------

const ARABIC_DIACRITICS_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g; // harakat, tanwin, shadda, sukun, superscript alef, tatweel

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

// --- Clientes ---------------------------------------------------------------

const SUPABASE_URL = requireEnv('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const OPENAI_API_KEY = requireEnv('OPENAI_API_KEY');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- Lectura de entradas ----------------------------------------------------

async function resolveInputFiles(inputPath) {
  const stat = await fs.stat(inputPath);
  if (stat.isDirectory()) {
    const entries = await fs.readdir(inputPath);
    return entries
      .map((name) => path.join(inputPath, name))
      .filter((file) => SUPPORTED_EXTENSIONS.has(path.extname(file).toLowerCase()));
  }
  return [inputPath];
}

function classifyFile(file) {
  const ext = path.extname(file).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (PDF_EXTENSIONS.has(ext)) return 'pdf';
  return 'unknown';
}

// --- Extracción con IA ------------------------------------------------------

const EXTRACTION_SYSTEM_PROMPT = `Eres un lexicógrafo experto de árabe para estudiantes de español de nivel A2.
Extraes vocabulario (palabras y frases cortas) de material de clase y lo catalogas.

Debes asignar a cada entrada una o más FAMILIAS, eligiendo EXCLUSIVAMENTE de esta lista cerrada (copia el NOMBRE literal, con las mismas mayúsculas y acentos). Hay dos grupos: VOCABULARIO y GRAMÁTICA:
${buildFamiliasPromptBlock()}

Reglas de clasificación (OBLIGATORIAS):
- Clasifica por el SIGNIFICADO de la entrada, NO por los nombres propios ni el contexto del diálogo.
- Asigna como máximo 3 familias por entrada; normalmente 1 de VOCABULARIO + 1 de GRAMÁTICA si aplica.
- Las familias del grupo GRAMÁTICA SOLO cuando la entrada trate de ese punto gramatical; NO las añadas por defecto.
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
- NO inventes familias nuevas ni variantes. NO uses etiquetas como "Pista", "Vocabulario lección X", números de lección ni categorías del material.
- Devuelve el NOMBRE de la familia tal cual aparece en la lista.
- Conserva el árabe en escritura árabe (con vocalización/harakat si aparece en el original).
- El significado en español debe ser claro y conciso.
${buildFewShotBlock()}
- Responde SOLO con JSON válido.`;

function buildExtractionUserText(sourceLabel) {
  return `Extrae TODO el vocabulario árabe-español útil del material "${sourceLabel}".
Devuelve un objeto JSON con esta forma exacta:
{
  "entradas": [
    { "arabe": "término en árabe", "espanol": "significado en español", "familias": ["Familia exacta de la lista", ...] }
  ]
}
No incluyas entradas sin árabe o sin español.`;
}

async function extractFromText(textContent, sourceLabel) {
  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      { role: 'user', content: `${buildExtractionUserText(sourceLabel)}\n\nMATERIAL:\n${textContent}` },
    ],
  });
  return parseEntries(response.choices?.[0]?.message?.content);
}

async function extractFromImage(file, sourceLabel) {
  const ext = path.extname(file).toLowerCase();
  const mime = IMAGE_MIME[ext] || 'image/png';
  const base64 = (await fs.readFile(file)).toString('base64');
  const dataUrl = `data:${mime};base64,${base64}`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildExtractionUserText(sourceLabel) },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  return parseEntries(response.choices?.[0]?.message?.content);
}

async function extractFromPdf(file, sourceLabel) {
  // pdfjs-dist es pesado: se carga solo si realmente hay un PDF que procesar.
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await fs.readFile(file));
  const pdf = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

  let fullText = '';
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    fullText += content.items.map((item) => item.str || '').join(' ') + '\n';
  }

  const clean = fullText.trim();
  if (!clean) {
    console.warn(`   ⚠️  El PDF "${sourceLabel}" no tiene texto extraíble (¿escaneado?). Conviértelo a imagen y usa --imagen.`);
    return [];
  }
  return extractFromText(clean, sourceLabel);
}

function parseEntries(rawContent) {
  const raw = (rawContent || '').trim();
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`La IA no devolvió JSON válido: ${error.message}`);
  }
  const list = Array.isArray(parsed.entradas)
    ? parsed.entradas
    : Array.isArray(parsed.resultados)
      ? parsed.resultados
      : Array.isArray(parsed)
        ? parsed
        : [];

  return list
    .map((item) => ({
      arabe: String(item?.arabe || item?.arabic || '').trim(),
      espanol: String(item?.espanol || item?.spanish || '').trim(),
      familias: sanitizeFamilias(item?.familias),
    }))
    .filter((entry) => entry.arabe && entry.espanol);
}

// --- Índice de duplicados ---------------------------------------------------

/**
 * Carga todas las tarjetas existentes y construye un índice por árabe
 * normalizado para detectar duplicados en O(1).
 */
async function buildExistingIndex() {
  const index = new Map(); // arabeNormalizado -> { id, familias }
  const pageSize = 1000;
  for (let page = 0; page < 50; page += 1) {
    const { data, error } = await supabase
      .from('flashcards')
      .select('id, arabic, familias')
      .order('id', { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      const key = normalizarArabe(row.arabic);
      if (key && !index.has(key)) {
        index.set(key, { id: row.id, familias: Array.isArray(row.familias) ? row.familias : [] });
      }
    }
    if (data.length < pageSize) break;
  }
  return index;
}

function mergeFamilias(existing, incoming) {
  return sanitizeFamilias([...(existing || []), ...(incoming || [])]);
}

// --- Procesamiento de una entrada ------------------------------------------

async function processEntry(entry, index, stats) {
  const normalized = normalizarArabe(entry.arabe);
  if (!normalized) return;

  const existing = index.get(normalized);

  if (existing) {
    // Ya existe: no duplicar. Fusionar familias si faltan.
    const merged = mergeFamilias(existing.familias, entry.familias);
    const hasNewFamilias = merged.length !== existing.familias.length;

    if (hasNewFamilias && !DRY_RUN) {
      const { error } = await supabase
        .from('flashcards')
        .update({ familias: merged })
        .eq('id', existing.id);
      if (error) {
        console.error(`   ❌ Error actualizando #${existing.id}: ${error.message}`);
        return;
      }
      index.set(normalized, { id: existing.id, familias: merged });
    }

    stats.actualizados += hasNewFamilias ? 1 : 0;
    stats.omitidos += hasNewFamilias ? 0 : 1;
    const detalle = hasNewFamilias ? ` (familias -> ${merged.join(', ')})` : '';
    console.log(`[OMITIDO/ACTUALIZADO] "${entry.espanol}" ya existía.${detalle}`);
    return;
  }

  // Nueva tarjeta. Si no tiene ninguna familia válida, NO se inserta:
  // se registra como "sin clasificar" para revisión manual.
  if (!entry.familias || entry.familias.length === 0) {
    stats.sinClasificar.push(entry);
    console.log(`[SIN CLASIFICAR] "${entry.espanol}" (${entry.arabe}) — no se inserta.`);
    return;
  }

  const record = {
    arabic: entry.arabe,
    spanish: entry.espanol,
    familias: entry.familias,
    arabe_normalizado: normalized,
  };

  if (!DRY_RUN) {
    const { data, error } = await supabase
      .from('flashcards')
      .insert([record])
      .select('id')
      .single();
    if (error) {
      // Si la columna opcional arabe_normalizado no existe, reintenta sin ella.
      if (/arabe_normalizado/.test(error.message)) {
        const { arabe_normalizado, ...fallback } = record;
        const retry = await supabase.from('flashcards').insert([fallback]).select('id').single();
        if (retry.error) { console.error(`   ❌ Error insertando "${entry.espanol}": ${retry.error.message}`); return; }
      } else {
        console.error(`   ❌ Error insertando "${entry.espanol}": ${error.message}`);
        return;
      }
    }
  }

  // Registrar en el índice para evitar duplicados dentro del mismo lote.
  index.set(normalized, { id: null, familias: entry.familias });
  stats.nuevos += 1;
  console.log(`[NUEVO] Insertada: "${entry.espanol}" -> ${entry.familias.join(', ')}`);
}

// --- Programa principal -----------------------------------------------------

async function main() {
  if (!inputPath) {
    console.error('❌ Debes indicar una entrada. Ejemplos:');
    console.error('   npm run ingestar -- --archivo=aportes/leccion5.txt');
    console.error('   npm run ingestar -- --imagen=aportes/nota.jpg');
    console.error('   npm run ingestar -- --carpeta=aportes');
    process.exit(1);
  }

  try {
    await fs.access(inputPath);
  } catch {
    console.error(`❌ No se encontró la ruta: ${inputPath}`);
    process.exit(1);
  }

  console.log(`🔌 Ingestión iniciada${DRY_RUN ? ' (DRY-RUN: no se escribe en Supabase)' : ''}`);

  const files = await resolveInputFiles(inputPath);
  if (files.length === 0) {
    console.error('❌ No hay archivos soportados (.txt, .md, .csv, .png, .jpg, .jpeg, .webp, .pdf).');
    process.exit(1);
  }
  console.log(`📂 ${files.length} archivo(s) a procesar.`);

  console.log('📇 Cargando tarjetas existentes para detección de duplicados...');
  const index = await buildExistingIndex();
  console.log(`   ${index.size} término(s) únicos ya en la base de datos.`);

  const stats = { nuevos: 0, actualizados: 0, omitidos: 0, archivos: 0, sinClasificar: [] };

  for (const file of files) {
    const kind = classifyFile(file);
    const label = path.basename(file);
    if (kind === 'unknown') {
      console.warn(`   ⚠️  Formato no soportado, se omite: ${label}`);
      continue;
    }

    console.log(`\n📄 Procesando ${label} (${kind})...`);
    let entries = [];
    try {
      if (kind === 'text') {
        const content = await fs.readFile(file, 'utf8');
        entries = await extractFromText(content, label);
      } else if (kind === 'image') {
        entries = await extractFromImage(file, label);
      } else if (kind === 'pdf') {
        entries = await extractFromPdf(file, label);
      }
    } catch (error) {
      console.error(`   ❌ Error extrayendo de ${label}: ${error.message}`);
      continue;
    }

    console.log(`   🧠 ${entries.length} entrada(s) detectada(s).`);
    for (const entry of entries) {
      await processEntry(entry, index, stats);
    }
    stats.archivos += 1;
  }

  console.log('\n🎉 Ingestión terminada.');
  console.log(`   Archivos procesados: ${stats.archivos}`);
  console.log(`   Nuevas insertadas:   ${stats.nuevos}`);
  console.log(`   Actualizadas:        ${stats.actualizados}`);
  console.log(`   Omitidas (ya estaban): ${stats.omitidos}`);

  if (stats.sinClasificar.length > 0) {
    console.log(`\n⚠️  Sin clasificar (no se insertaron): ${stats.sinClasificar.length}`);
    for (const entry of stats.sinClasificar) {
      console.log(`   - "${entry.espanol}" / "${entry.arabe}"`);
    }
  }

  if (DRY_RUN) console.log('\n   (DRY-RUN: no se escribió nada en Supabase)');
}

main().catch((error) => {
  console.error('\n💥 Error fatal:', error.message);
  process.exit(1);
});
