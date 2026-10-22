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
- familias: una o más familias de la lista cerrada (NUNCA vacío; usa la más cercana si dudas).
- confianza: "alta" | "media" | "baja".

Elige las familias EXCLUSIVAMENTE de esta lista cerrada. Hay dos grupos: VOCABULARIO y GRAMÁTICA:
${buildFamiliasPromptBlock()}

Reglas:
- Clasifica por el SIGNIFICADO, no por nombres propios ni contexto del diálogo.
- Máximo 3 familias por elemento; normalmente 1 de VOCABULARIO + 1 de GRAMÁTICA si aplica.
- Grupo GRAMÁTICA solo si el elemento trata de ese punto gramatical.
- TODO elemento DEBE recibir al menos una familia: nunca vacío; si dudas, la más cercana con confianza "baja".
- Devuelve el NOMBRE de la familia tal cual aparece en la lista.
${buildFewShotBlock(ejemplos as Array<{ espanol: string; familias: string[] }>)}
Responde SOLO con JSON válido.`;

interface RawItem {
  arabe?: string;
  espanol?: string;
  transliteracion?: string;
  tipo?: string;
  familias?: string[];
  confianza?: string;
}

function inferirTipo(raw: RawItem): 'palabra' | 'frase' {
  if (raw.tipo === 'frase' || raw.tipo === 'palabra') return raw.tipo;
  const palabras = String(raw.espanol ?? '').trim().split(/\s+/).filter(Boolean);
  return palabras.length > 2 ? 'frase' : 'palabra';
}

function normalizeItem(raw: RawItem) {
  const { familias, forzada } = ensureFamilias(raw.familias);
  const confianza = forzada ? 'baja' : sanitizeConfianza(raw.confianza);
  const arabe = String(raw.arabe ?? '').trim();
  return {
    arabe,
    espanol: String(raw.espanol ?? '').trim(),
    transliteracion: String(raw.transliteracion ?? '').trim(),
    tipo: inferirTipo(raw),
    familias,
    confianza,
    arabe_normalizado: normalizarArabe(arabe),
  };
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

  const result = await chatJson<{ items?: RawItem[]; entradas?: RawItem[] }>({
    model: 'gpt-4o', // gpt-4o soporta texto y visión
    system: SYSTEM_PROMPT,
    user: userContent,
    temperature: 0.1,
  });

  const rawItems = Array.isArray(result.items)
    ? result.items
    : Array.isArray(result.entradas)
      ? result.entradas
      : [];

  const items = rawItems
    .map(normalizeItem)
    .filter((it) => it.arabe && it.espanol);

  // NO se escribe en la base de datos: solo se devuelven propuestas.
  return jsonResponse(req, { items });
}

Deno.serve((req: Request) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  return handle(req).catch((err) => errorResponse(req, err));
});
