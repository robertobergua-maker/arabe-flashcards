// supabase/functions/importar/index.ts
//
// Edge Function `importar`: recibe texto o imagen (visión) del admin, extrae
// vocabulario con OpenAI y devuelve PROPUESTAS de tarjetas. NO escribe en la BD:
// el guardado lo hace la app tras la pantalla de revisión.

import {
  verifyAdmin,
  handleOptions,
  jsonResponse,
  errorResponse,
  HttpError,
} from '../_shared/auth.ts';
import { chatJson, type ChatContentPart } from '../_shared/openai.ts';
import {
  buildFamiliasPromptBlock,
  ensureFamilias,
  sanitizeConfianza,
} from '../_shared/familias.js';
import { buildFewShotBlock } from '../_shared/fewshot.js';
import { normalizarArabe } from '../_shared/arabe.js';
import { buildClasesPromptBlock, sanitizeClase } from '../_shared/clases.js';
import ejemplos from '../_shared/ejemplos-familias.json' with { type: 'json' };

// Límites de tamaño de entrada.
const MAX_TEXTO = 20000; // caracteres
const MAX_IMAGEN_BASE64 = 5 * 1024 * 1024; // ~5 MB de cadena base64

const SYSTEM_PROMPT = `Eres un lexicógrafo experto de árabe para estudiantes de español de nivel A2.
Extraes vocabulario (palabras y frases) de material de clase y lo catalogas.

Separa PALABRAS de FRASES. Por cada elemento devuelve:
- arabe: el término en árabe VOCALIZADO (con harakat).
- espanol: el significado claro y conciso en español.
- transliteracion: transliteración con signos diacríticos (ā, ī, ū, ḏ, ṯ, ḥ, ṣ, ḍ, ṭ, ẓ, ʿ, ʾ…).
- tipo: "palabra" o "frase".
- clase_palabra: la categoría gramatical (ver lista) SOLO si tipo es "palabra"; si tipo es "frase", pon null.
- familias: una o más familias de la lista cerrada (NUNCA vacío; usa la más cercana si dudas).
- confianza: "alta" | "media" | "baja".

Elige las familias EXCLUSIVAMENTE de esta lista cerrada. Hay dos grupos: VOCABULARIO y GRAMÁTICA:
${buildFamiliasPromptBlock()}

Elige la clase_palabra EXCLUSIVAMENTE de esta lista cerrada de 9 clases:
${buildClasesPromptBlock()}

Reglas:
- Clasifica por el SIGNIFICADO, no por nombres propios ni contexto del diálogo.
- Máximo 3 familias por elemento; normalmente 1 de VOCABULARIO + 1 de GRAMÁTICA si aplica.
- Grupo GRAMÁTICA solo si el elemento trata de ese punto gramatical.
- TODO elemento DEBE recibir al menos una familia: nunca vacío; si dudas, la más cercana con confianza "baja".
- Devuelve el NOMBRE de la familia tal cual aparece en la lista.
- clase_palabra: UNA SOLA clase, la del uso principal. Si la entrada tiene varias acepciones de distinta clase, usa la PRIMERA. Si tipo es "frase", clase_palabra DEBE ser null.
${buildFewShotBlock(ejemplos as Array<{ espanol: string; familias: string[] }>)}
Devuelve SOLO un objeto JSON con esta forma EXACTA (la clave de nivel superior debe llamarse "items"):
{
  "items": [
    { "arabe": "...", "espanol": "...", "transliteracion": "...", "tipo": "palabra|frase", "clase_palabra": "Sustantivo|...|null", "familias": ["..."], "confianza": "alta|media|baja" }
  ]
}
No uses ninguna otra clave de nivel superior (ni "vocabulario", ni "palabras", ni "frases"): todo va dentro de "items".`;

function inferirTipo(tipo: unknown, espanol: string): 'palabra' | 'frase' {
  if (tipo === 'frase' || tipo === 'palabra') return tipo;
  const palabras = espanol.trim().split(/\s+/).filter(Boolean);
  return palabras.length > 2 ? 'frase' : 'palabra';
}

// Tolerante a nombres de campo alternativos que a veces usa la IA.
function pickField(raw: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return '';
}

function normalizeItem(raw: Record<string, unknown>) {
  const arabe = pickField(raw, 'arabe', 'arabic', 'ar');
  const espanol = pickField(raw, 'espanol', 'español', 'spanish', 'es');
  const transliteracion = pickField(raw, 'transliteracion', 'transliteración', 'translit', 'fonetica', 'phonetic');
  const familiasInput = Array.isArray(raw.familias)
    ? raw.familias
    : typeof raw.familias === 'string'
      ? [raw.familias]
      : [];
  const { familias, forzada } = ensureFamilias(familiasInput);
  const confianza = forzada ? 'baja' : sanitizeConfianza(raw.confianza as string);
  const tipo = inferirTipo(raw.tipo, espanol);
  // Solo las palabras reciben clase; las frases quedan en null.
  const clase_palabra = tipo === 'palabra' ? sanitizeClase(raw.clase_palabra) : null;
  return {
    arabe,
    espanol,
    transliteracion,
    tipo,
    clase_palabra,
    familias,
    confianza,
    arabe_normalizado: normalizarArabe(arabe),
  };
}

// Busca recursivamente el primer array de objetos "item-like" en la respuesta,
// sea cual sea la clave que use la IA (items, entradas, vocabulario, palabras+frases…).
function extractItemArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((v) => v && typeof v === 'object') as Record<string, unknown>[];
  }
  if (!value || typeof value !== 'object') return [];
  const obj = value as Record<string, unknown>;
  // Preferir claves conocidas primero.
  for (const key of ['items', 'entradas', 'vocabulario', 'resultados', 'tarjetas']) {
    if (Array.isArray(obj[key])) return extractItemArray(obj[key]);
  }
  // Si separó palabras y frases en claves distintas, combinarlas.
  const combinado: Record<string, unknown>[] = [];
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) combinado.push(...extractItemArray(v));
  }
  return combinado;
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido.');
  await verifyAdmin(req);

  let payload: { modo?: string; contenido?: string; leccion?: string };
  try {
    payload = await req.json();
  } catch {
    throw new HttpError(400, 'Cuerpo JSON inválido.');
  }

  const modo = payload.modo;
  const contenido = payload.contenido;
  if (modo !== 'texto' && modo !== 'imagen') {
    throw new HttpError(400, 'El campo "modo" debe ser "texto" o "imagen".');
  }
  if (typeof contenido !== 'string' || contenido.trim() === '') {
    throw new HttpError(400, 'El campo "contenido" es obligatorio.');
  }

  // Límites de tamaño: no llamar a OpenAI si se superan.
  if (modo === 'texto' && contenido.length > MAX_TEXTO) {
    throw new HttpError(413, `Texto demasiado largo (máximo ${MAX_TEXTO} caracteres).`);
  }
  if (modo === 'imagen' && contenido.length > MAX_IMAGEN_BASE64) {
    throw new HttpError(413, 'Imagen demasiado grande (máximo ~5 MB).');
  }

  const userContent: string | ChatContentPart[] = modo === 'imagen'
    ? [
        { type: 'text', text: 'Extrae el vocabulario árabe-español de esta imagen de material de clase.' },
        { type: 'image_url', image_url: { url: contenido } },
      ]
    : `Extrae el vocabulario árabe-español del siguiente material.\n\nMATERIAL:\n${contenido}`;

  console.log(`[importar] modo=${modo} longitud=${contenido.length}`);

  console.log('[importar] llamando a OpenAI…');
  const result = await chatJson<Record<string, unknown>>({
    model: 'gpt-4o', // gpt-4o soporta texto y visión
    system: SYSTEM_PROMPT,
    user: userContent,
    temperature: 0.1,
  });
  console.log('[importar] OpenAI respondió. claves de nivel superior:', Object.keys(result ?? {}).join(', ') || '(ninguna)');

  const rawItems = extractItemArray(result);
  console.log(`[importar] elementos crudos de la IA: ${rawItems.length}`);

  // La IA respondió JSON legible pero sin ningún array de elementos: es una
  // respuesta inesperada, no una lista vacía legítima -> 502 (nunca [] silencioso).
  if (rawItems.length === 0) {
    throw new HttpError(
      502,
      `OpenAI no devolvió ningún elemento utilizable. Claves recibidas: ${Object.keys(result ?? {}).join(', ') || '(ninguna)'}`,
    );
  }

  let descartados = 0;
  const items = rawItems
    .map(normalizeItem)
    .filter((it) => {
      if (it.arabe && it.espanol) return true;
      descartados += 1;
      console.log(`[importar] descartado (sin arabe o sin espanol): ${JSON.stringify(it)}`);
      return false;
    });

  console.log(`[importar] tras normalizar: ${items.length} válidos, ${descartados} descartados`);

  // NO se escribe en la base de datos: solo se devuelven propuestas.
  return jsonResponse(req, { items });
}

Deno.serve((req: Request) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  return handle(req).catch((err) => errorResponse(req, err));
});
