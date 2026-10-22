// scripts/sugerir-familias.js
//
// Analiza las tarjetas con familias_confianza = 'baja' (pendientes de revisar),
// las agrupa por tema con IA y PROPONE familias nuevas cuando un grupo reúne al
// menos 10 tarjetas. Es SOLO INFORMATIVO: no modifica familias.js ni la base de
// datos. La decisión de crear o no una familia la toma una persona.
//
// Uso:
//   npm run sugerir-familias
//   npm run sugerir-familias -- --min=15   (umbral mínimo de tarjetas por grupo)
//
// Variables de entorno requeridas (ver .env.example):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   OPENAI_API_KEY

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { FAMILIAS_A2 } from '../src/constants/familias.js';

// --- Configuración ---------------------------------------------------------

const MODEL = 'gpt-4o';
const PAGE_SIZE = 1000;
const DEFAULT_MIN = 10; // mínimo de tarjetas para proponer una familia nueva

// --- Flags ------------------------------------------------------------------

const args = process.argv.slice(2);
function getFlagValue(name) {
  const prefix = `--${name}=`;
  const m = args.find((a) => a.startsWith(prefix));
  return m ? m.slice(prefix.length) : null;
}
const MIN_GRUPO = Math.max(1, Number(getFlagValue('min')) || DEFAULT_MIN);

// --- Entorno y clientes -----------------------------------------------------

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

// --- Lectura de tarjetas con confianza baja ---------------------------------

async function fetchBajas() {
  const all = [];
  for (let page = 0; page < 50; page += 1) {
    const { data, error } = await supabase
      .from('flashcards')
      .select('id, arabic, spanish, familias, familias_confianza')
      .eq('familias_confianza', 'baja')
      .order('id', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

// --- Agrupación con IA ------------------------------------------------------

const SYSTEM_PROMPT = `Eres un lexicógrafo que analiza vocabulario de árabe para nivel A2.
Recibes una lista de tarjetas (id + español) que están MAL o DUDOSAMENTE clasificadas
(no encajan bien en las familias actuales). Tu tarea es AGRUPARLAS por tema común y
proponer POSIBLES familias nuevas que las cubrirían.

Familias que YA existen (no las propongas de nuevo):
${FAMILIAS_A2.map((f) => `- ${f}`).join('\n')}

Devuelve SOLO JSON con esta forma:
{
  "grupos": [
    {
      "nombre_propuesto": "Nombre breve de la posible familia nueva",
      "descripcion": "Una frase describiendo qué agrupa.",
      "ids": [<ids de las tarjetas que cubriría>]
    }
  ]
}
Reglas:
- Agrupa por SIGNIFICADO/tema, no por forma.
- Un grupo solo tiene sentido si es temáticamente coherente.
- No inventes familias que se solapen con las existentes.
- Incluye en "ids" solo tarjetas realmente pertenecientes al grupo.`;

async function agrupar(cards) {
  const payload = cards.map((c) => ({ id: c.id, espanol: c.spanish || c.arabic || '' }));
  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `TARJETAS:\n${JSON.stringify(payload, null, 2)}` },
    ],
  });
  const content = response.choices?.[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`La IA no devolvió JSON válido: ${error.message}`);
  }
  return Array.isArray(parsed.grupos) ? parsed.grupos : [];
}

// --- Programa principal -----------------------------------------------------

async function main() {
  console.log('🔌 Buscando tarjetas con confianza baja (pendientes de revisar)...');
  const cards = await fetchBajas();
  console.log(`📥 ${cards.length} tarjeta(s) con confianza baja.`);
  if (cards.length === 0) {
    console.log('✅ No hay tarjetas pendientes. Nada que sugerir.');
    return;
  }

  const byId = new Map(cards.map((c) => [Number(c.id), c]));

  console.log('🧠 Agrupando por tema con IA...');
  let grupos;
  try {
    grupos = await agrupar(cards);
  } catch (error) {
    console.error(`💥 ${error.message}`);
    process.exit(1);
  }

  // Normaliza y filtra: solo grupos con >= MIN_GRUPO tarjetas existentes.
  const propuestas = grupos
    .map((g) => {
      const ids = Array.isArray(g.ids) ? [...new Set(g.ids.map(Number))].filter((id) => byId.has(id)) : [];
      return {
        nombre: String(g.nombre_propuesto || '').trim(),
        descripcion: String(g.descripcion || '').trim(),
        ids,
      };
    })
    .filter((g) => g.nombre && g.ids.length >= MIN_GRUPO)
    .sort((a, b) => b.ids.length - a.ids.length);

  console.log(`\n📊 Sugerencias (umbral: ${MIN_GRUPO} tarjetas por grupo)\n`);

  if (propuestas.length === 0) {
    console.log(`No hay ningún grupo temático con al menos ${MIN_GRUPO} tarjetas.`);
    console.log('Las tarjetas pendientes son demasiado dispersas para proponer una familia nueva.');
    return;
  }

  for (const [i, g] of propuestas.entries()) {
    console.log(`${i + 1}. «${g.nombre}» — ${g.ids.length} tarjetas`);
    console.log(`   ${g.descripcion}`);
    const ejemplos = g.ids.slice(0, 12).map((id) => `"${byId.get(id).spanish || byId.get(id).arabic}"`);
    console.log(`   Cubriría: ${ejemplos.join(', ')}${g.ids.length > ejemplos.length ? ', …' : ''}`);
    console.log('');
  }

  console.log('ℹ️  Solo es una sugerencia. No se ha modificado familias.js ni la base de datos.');
  console.log('   Si decides crear alguna familia, hazlo a mano en src/constants/familias.js.');
}

main().catch((error) => {
  console.error('\n💥 Error fatal:', error.message);
  process.exit(1);
});
