// scripts/deduplicar.js
//
// Limpieza de tarjetas duplicadas en la tabla `flashcards`.
//
// Detección: agrupa por ÁRABE NORMALIZADO (reutiliza normalizarArabe, sin harakat).
//   - Exactos:  mismo árabe normalizado Y mismo español normalizado.
//   - Probables: mismo árabe normalizado, español distinto.
//   - NO son duplicados las tarjetas con mismo español y árabe distinto (sinónimos):
//     al agrupar por árabe, esas simplemente caen en grupos distintos.
//
// En cada grupo se CONSERVA la tarjeta con más campos rellenos (p. ej.
// transliteración/phonetic); si empatan, el id más bajo. Las demás se marcan
// para ELIMINAR. La conservada recibe la UNIÓN de familias de todo el grupo.
//
// Uso:
//   npm run deduplicar                 -> genera docs/duplicados.csv (NO escribe en BD)
//   npm run deduplicar -- --apply-csv  -> backup + aplica el CSV (editable en Excel)
//
// Variables de entorno (ver .env.example): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { sanitizeFamilias } from '../src/constants/familias.js';
import { normalizarArabe } from './_arabe.js';

const PAGE_SIZE = 1000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const CSV_PATH = path.join(DOCS_DIR, 'duplicados.csv');

const args = process.argv.slice(2);
const APPLY_CSV = args.includes('--apply-csv');

// --- Entorno y cliente ------------------------------------------------------

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
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// --- Normalización del español ----------------------------------------------

// minúsculas, sin tildes, sin signos ni paréntesis, espacios colapsados.
function normalizarEspanol(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')          // tildes/diacríticos latinos
    .replace(/\([^)]*\)/g, ' ')               // elimina paréntesis y su contenido
    .replace(/[.,;:!¡?¿"'`«»…/\\|-]/g, ' ')    // signos de puntuación
    .replace(/\s+/g, ' ')
    .trim();
}

// --- Fusión de columnas -----------------------------------------------------

const norm = (v) => (v === null || v === undefined ? '' : String(v).trim());

// Harakat/tashkil para medir vocalización del árabe.
const HARAKAT_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
function contarHarakat(texto) {
  const m = String(texto || '').match(HARAKAT_RE);
  return m ? m.length : 0;
}

// Signos diacríticos típicos de transliteración académica del árabe.
const DIACRITICOS_TRANSLIT_RE = /[āīūēōâîûḏṯḥṣḍṭẓġšʿʾčžñ]/i;
function tieneDiacriticosTranslit(texto) {
  return DIACRITICOS_TRANSLIT_RE.test(String(texto || ''));
}

// category: unión de todos los valores distintos del grupo (sin repetir,
// recortados), separados por "; ".
function fusionarCategory(group) {
  const vistos = new Set();
  const out = [];
  for (const c of group) {
    const v = norm(c.category);
    if (!v) continue;
    if (vistos.has(v)) continue;
    vistos.add(v);
    out.push(v);
  }
  return out.join('; ');
}

// phonetic: preferir con diacríticos; si empatan, la más larga; desempate, minúscula.
function fusionarPhonetic(group) {
  const candidatos = group.map((c) => norm(c.phonetic)).filter(Boolean);
  if (candidatos.length === 0) return '';
  return [...candidatos].sort((a, b) => {
    const da = tieneDiacriticosTranslit(a) ? 1 : 0;
    const db = tieneDiacriticosTranslit(b) ? 1 : 0;
    if (da !== db) return db - da;                 // con diacríticos primero
    if (a.length !== b.length) return b.length - a.length; // más larga primero
    const la = a === a.toLowerCase() ? 1 : 0;
    const lb = b === b.toLowerCase() ? 1 : 0;
    return lb - la;                                // minúscula primero
  })[0];
}

// arabic: preferir la de más harakat; empate -> la más larga; desempate estable.
function fusionarArabic(group) {
  const candidatos = group.map((c) => norm(c.arabic)).filter(Boolean);
  if (candidatos.length === 0) return '';
  return [...candidatos].sort((a, b) => {
    const ha = contarHarakat(a);
    const hb = contarHarakat(b);
    if (ha !== hb) return hb - ha;
    return b.length - a.length;
  })[0];
}

// Calcula los valores fusionados finales para la tarjeta conservada.
// spanish se mantiene SIEMPRE el de la conservada.
function calcularFinales(group, conservar) {
  const final_arabic = fusionarArabic(group) || norm(conservar.arabic);
  return {
    final_arabic,
    final_spanish: norm(conservar.spanish),
    final_phonetic: fusionarPhonetic(group) || norm(conservar.phonetic),
    final_category: fusionarCategory(group),
    final_arabe_normalizado: normalizarArabe(final_arabic),
  };
}

// --- CSV (; + BOM, como revisar) --------------------------------------------

const CSV_HEADERS = [
  'grupo', 'tipo', 'accion', 'id',
  'arabe', 'espanol', 'transliteracion', 'category', 'familias',
  // Solo se rellenan en la fila "conservar": resultado de la fusión que se
  // aplicará. Puedes editarlas en Excel antes de --apply-csv.
  'final_arabic', 'final_spanish', 'final_phonetic', 'final_category',
];
const COL_SEP = ';';
const FAM_SEP = '|';
const BOM = '\ufeff';

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[";,\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(rows) {
  const lines = [CSV_HEADERS.join(COL_SEP)];
  for (const r of rows) {
    lines.push([
      csvEscape(r.grupo),
      csvEscape(r.tipo),
      csvEscape(r.accion),
      csvEscape(r.id),
      csvEscape(r.arabe),
      csvEscape(r.espanol),
      csvEscape(r.transliteracion),
      csvEscape(r.category),
      csvEscape(r.familias.join(FAM_SEP)),
      csvEscape(r.final_arabic ?? ''),
      csvEscape(r.final_spanish ?? ''),
      csvEscape(r.final_phonetic ?? ''),
      csvEscape(r.final_category ?? ''),
    ].join(COL_SEP));
  }
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  fs.writeFileSync(CSV_PATH, `${BOM}${lines.join('\n')}\n`, 'utf8');
}

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

function splitFamilias(cell) {
  return String(cell || '').split(FAM_SEP).map((f) => f.trim()).filter(Boolean);
}

// --- Datos ------------------------------------------------------------------

async function fetchAll() {
  const all = [];
  for (let page = 0; page < 50; page += 1) {
    const { data, error } = await supabase
      .from('flashcards')
      .select('*')
      .order('id', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

// Cuenta campos "con datos" para elegir la tarjeta más completa.
function scoreCompleteness(card) {
  const campos = ['spanish', 'arabic', 'phonetic', 'category', 'familias', 'familias_confianza'];
  let score = 0;
  for (const campo of campos) {
    const v = card[campo];
    if (Array.isArray(v)) { if (v.length > 0) score += 1; }
    else if (v !== null && v !== undefined && String(v).trim() !== '') score += 1;
  }
  return score;
}

// Elige la tarjeta a conservar: más campos rellenos; si empatan, id más bajo.
function elegirConservar(group) {
  return [...group].sort((a, b) => {
    const diff = scoreCompleteness(b) - scoreCompleteness(a);
    if (diff !== 0) return diff;
    return Number(a.id) - Number(b.id);
  })[0];
}

function unionFamilias(group) {
  const todas = [];
  for (const c of group) todas.push(...(Array.isArray(c.familias) ? c.familias : []));
  return sanitizeFamilias(todas);
}

// Agrupa por árabe normalizado y devuelve solo los grupos con duplicados reales.
function detectarGrupos(cards) {
  const porArabe = new Map();
  for (const card of cards) {
    const key = normalizarArabe(card.arabic);
    if (!key) continue; // sin árabe utilizable: no se considera
    if (!porArabe.has(key)) porArabe.set(key, []);
    porArabe.get(key).push(card);
  }

  const grupos = [];
  for (const [, group] of porArabe) {
    if (group.length < 2) continue;
    // ¿Todos comparten el mismo español normalizado? -> exacto; si no, probable.
    const espanoles = new Set(group.map((c) => normalizarEspanol(c.spanish)));
    const tipo = espanoles.size === 1 ? 'exacto' : 'probable';
    grupos.push({ tipo, group });
  }
  return grupos;
}

// --- Modo por defecto: generar CSV ------------------------------------------

async function modoDetectar() {
  const cards = await fetchAll();
  console.log(`📥 ${cards.length} tarjeta(s) en la tabla.`);

  const grupos = detectarGrupos(cards);
  const rows = [];
  let exactos = 0;
  let probables = 0;
  let aEliminar = 0;

  grupos.forEach((g, i) => {
    const grupoId = i + 1;
    const conservar = elegirConservar(g.group);
    const familiasUnion = unionFamilias(g.group);
    const finales = calcularFinales(g.group, conservar);
    if (g.tipo === 'exacto') exactos += 1; else probables += 1;

    for (const card of g.group) {
      const esConservar = card.id === conservar.id;
      if (!esConservar) aEliminar += 1;
      rows.push({
        grupo: grupoId,
        tipo: g.tipo,
        accion: esConservar ? 'conservar' : 'eliminar',
        id: card.id,
        arabe: card.arabic || '',
        espanol: card.spanish || '',
        transliteracion: card.phonetic || '',
        category: card.category || '',
        // En la fila "conservar" mostramos la unión; en las demás, sus familias.
        familias: esConservar ? familiasUnion : (Array.isArray(card.familias) ? card.familias : []),
        // Los final_* (resultado de la fusión) solo en la fila "conservar".
        final_arabic: esConservar ? finales.final_arabic : '',
        final_spanish: esConservar ? finales.final_spanish : '',
        final_phonetic: esConservar ? finales.final_phonetic : '',
        final_category: esConservar ? finales.final_category : '',
      });
    }
  });

  writeCsv(rows);

  console.log('\n📊 Resumen de duplicados:');
  console.log(`   Grupos con duplicados: ${grupos.length}`);
  console.log(`     · exactos:  ${exactos}`);
  console.log(`     · probables: ${probables}`);
  console.log(`   Tarjetas a eliminar (propuesta): ${aEliminar}`);
  console.log(`   Tarjetas a conservar:            ${grupos.length}`);
  console.log(`\n📝 CSV generado: ${path.relative(path.join(__dirname, '..'), CSV_PATH)}`);
  console.log('   (No se ha escrito nada en Supabase. Revisa/edita el CSV y usa --apply-csv.)');
}

// --- Modo --apply-csv: backup + aplicar -------------------------------------

async function backupTabla() {
  const cards = await fetchAll();
  const fecha = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const file = path.join(DOCS_DIR, `backup-flashcards-${fecha}.json`);
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cards, null, 2), 'utf8');
  console.log(`💾 Backup completo guardado: ${path.relative(path.join(__dirname, '..'), file)} (${cards.length} tarjetas).`);
  return file;
}

// Actualiza la conservada; si la columna opcional arabe_normalizado no existe,
// reintenta sin ella para no bloquear la fusión del resto de campos.
async function applyUpdate(id, update) {
  const { error } = await supabase.from('flashcards').update(update).eq('id', id);
  if (error && /arabe_normalizado/.test(error.message) && 'arabe_normalizado' in update) {
    const rest = { ...update };
    delete rest.arabe_normalizado;
    return supabase.from('flashcards').update(rest).eq('id', id);
  }
  return { error };
}

async function modoApplyCsv() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌ No existe el CSV: ${CSV_PATH}. Ejecuta antes "npm run deduplicar".`);
    process.exit(1);
  }

  // 1. Copia de seguridad ANTES de tocar nada.
  await backupTabla();

  // 2. Leer el CSV (editable: el usuario puede cambiar accion o borrar grupos).
  const fileText = fs.readFileSync(CSV_PATH, 'utf8');
  const delimiter = detectDelimiter(fileText);
  const rows = parseCsv(fileText, delimiter);
  if (rows.length <= 1) { console.log('✅ El CSV no tiene filas.'); return; }

  const header = rows[0].map((h) => h.trim().replace(/^\ufeff/, ''));
  const col = Object.fromEntries(CSV_HEADERS.map((h) => [h, header.indexOf(h)]));
  if (col.grupo === -1 || col.accion === -1 || col.id === -1) {
    console.error('❌ El CSV debe tener al menos las columnas "grupo", "accion" e "id".');
    process.exit(1);
  }

  // 3. Reconstruir grupos desde el CSV.
  const grupos = new Map(); // grupo -> { conservarId, familias:Set, eliminar:[], finales }
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const grupo = String(row[col.grupo] || '').trim();
    const accion = String(row[col.accion] || '').trim().toLowerCase();
    const id = Number(String(row[col.id] || '').trim());
    if (!grupo || !Number.isInteger(id)) continue;

    if (!grupos.has(grupo)) grupos.set(grupo, { conservarId: null, familias: new Set(), eliminar: [], finales: null });
    const g = grupos.get(grupo);

    // La unión de familias se arma con TODAS las filas del grupo presentes.
    for (const fam of splitFamilias(col.familias !== -1 ? row[col.familias] : '')) g.familias.add(fam);

    if (accion === 'conservar') {
      g.conservarId = id;
      // Lee los valores finales editables de la fila conservar (si existen).
      const cell = (name) => (col[name] !== -1 ? String(row[col[name]] ?? '').trim() : '');
      g.finales = {
        arabic: cell('final_arabic'),
        spanish: cell('final_spanish'),
        phonetic: cell('final_phonetic'),
        category: cell('final_category'),
      };
    } else if (accion === 'eliminar') {
      g.eliminar.push(id);
    }
  }

  // 4. Aplicar grupo a grupo: fusionar en la conservada y eliminar el resto.
  let eliminadas = 0;
  let fusionadas = 0;
  let saltados = 0;

  for (const [grupoId, g] of grupos) {
    if (g.conservarId === null) {
      console.log(`   ⚠️  Grupo ${grupoId}: sin fila "conservar"; se omite entero (no se elimina nada).`);
      saltados += 1;
      continue;
    }

    const familiasFinal = sanitizeFamilias([...g.familias]);

    // 4a. Construye la actualización de la conservada: familias + columnas
    //     fusionadas (final_*). Solo incluye un campo si viene con valor en el CSV.
    const update = { familias: familiasFinal };
    const f = g.finales || {};
    if (f.arabic) { update.arabic = f.arabic; update.arabe_normalizado = normalizarArabe(f.arabic); }
    if (f.spanish) update.spanish = f.spanish;
    if (f.phonetic) update.phonetic = f.phonetic;
    if (f.category) update.category = f.category;

    const { error: upErr } = await applyUpdate(g.conservarId, update);
    if (upErr) {
      console.error(`   ❌ Grupo ${grupoId}: error actualizando #${g.conservarId}: ${upErr.message}. Se omite el grupo.`);
      saltados += 1;
      continue;
    }
    fusionadas += 1;

    // 4b. Elimina las demás (nunca la conservada, por seguridad).
    const aBorrar = g.eliminar.filter((id) => id !== g.conservarId);
    for (const id of aBorrar) {
      const { error: delErr } = await supabase.from('flashcards').delete().eq('id', id);
      if (delErr) { console.error(`   ❌ Grupo ${grupoId}: error eliminando #${id}: ${delErr.message}`); continue; }
      eliminadas += 1;
      console.log(`   🗑️  #${id} eliminada (grupo ${grupoId}, conservada #${g.conservarId}).`);
    }
  }

  console.log('\n🎉 Deduplicación aplicada.');
  console.log(`   Grupos procesados:  ${grupos.size - saltados}`);
  console.log(`   Conservadas (familias fusionadas): ${fusionadas}`);
  console.log(`   Eliminadas:         ${eliminadas}`);
  if (saltados > 0) console.log(`   Grupos omitidos:    ${saltados}`);
}

// --- Entrada ----------------------------------------------------------------

async function main() {
  if (APPLY_CSV) return modoApplyCsv();
  return modoDetectar();
}

main().catch((error) => {
  console.error('\n💥 Error fatal:', error.message);
  process.exit(1);
});
