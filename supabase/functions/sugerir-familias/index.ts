// supabase/functions/sugerir-familias/index.ts
//
// Edge Function `sugerir-familias`: lee (con service role) las tarjetas con
// familias_confianza='baja', las agrupa por tema con OpenAI y propone familias
// nuevas con al menos `min` tarjetas. SOLO INFORMA: no escribe en la BD.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  verifyAdmin,
  handleOptions,
  jsonResponse,
  errorResponse,
  HttpError,
} from '../_shared/auth.ts';
import { chatJson } from '../_shared/openai.ts';
import { FAMILIAS_A2 } from '../_shared/familias.js';

const DEFAULT_MIN = 10;
const PAGE_SIZE = 1000;

interface Card {
  id: number;
  arabic?: string;
  spanish?: string;
}

interface Grupo {
  nombre_propuesto?: string;
  descripcion?: string;
  ids?: number[];
}

const SYSTEM_PROMPT = `Eres un lexicógrafo que analiza vocabulario de árabe para nivel A2.
Recibes una lista de tarjetas (id + español) que están MAL o DUDOSAMENTE clasificadas
(no encajan bien en las familias actuales). Tu tarea es AGRUPARLAS por tema común y
proponer POSIBLES familias nuevas que las cubrirían.

Familias que YA existen (no las propongas de nuevo):
${FAMILIAS_A2.map((f: string) => `- ${f}`).join('\n')}

Devuelve SOLO JSON con esta forma:
{
  "grupos": [
    { "nombre_propuesto": "Nombre breve", "descripcion": "Una frase.", "ids": [1,2,3] }
  ]
}
Reglas:
- Agrupa por SIGNIFICADO/tema, no por forma.
- Un grupo solo tiene sentido si es temáticamente coherente.
- No inventes familias que se solapen con las existentes.
- Incluye en "ids" solo tarjetas realmente pertenecientes al grupo.`;

// Service role client para leer tarjetas (nunca se expone al cliente).
function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return createClient(url, key, { auth: { persistSession: false } });
}

async function fetchBajas(): Promise<Card[]> {
  const supabase = serviceClient();
  const all: Card[] = [];
  for (let page = 0; page < 50; page += 1) {
    const { data, error } = await supabase
      .from('flashcards')
      .select('id, arabic, spanish')
      .eq('familias_confianza', 'baja')
      .order('id', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw new HttpError(502, `Error leyendo tarjetas: ${error.message}`);
    if (!data?.length) break;
    all.push(...(data as Card[]));
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido.');
  await verifyAdmin(req);

  let payload: { min?: number } = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const min = Number.isInteger(payload.min) && (payload.min as number) > 0 ? payload.min as number : DEFAULT_MIN;

  const cards = await fetchBajas();
  if (cards.length === 0) return jsonResponse(req, { grupos: [] });

  const byId = new Map(cards.map((c) => [Number(c.id), c]));
  const payloadCards = cards.map((c) => ({ id: c.id, espanol: c.spanish || c.arabic || '' }));

  const result = await chatJson<{ grupos?: Grupo[] }>({
    model: 'gpt-4o',
    system: SYSTEM_PROMPT,
    user: `TARJETAS:\n${JSON.stringify(payloadCards, null, 2)}`,
    temperature: 0.2,
  });

  const grupos = (Array.isArray(result.grupos) ? result.grupos : [])
    .map((g) => {
      const ids = Array.isArray(g.ids) ? [...new Set(g.ids.map(Number))].filter((id) => byId.has(id)) : [];
      return {
        nombre: String(g.nombre_propuesto ?? '').trim(),
        descripcion: String(g.descripcion ?? '').trim(),
        ids,
        ejemplos: ids.slice(0, 12).map((id) => byId.get(id)?.spanish || byId.get(id)?.arabic || ''),
      };
    })
    .filter((g) => g.nombre && g.ids.length >= min)
    .sort((a, b) => b.ids.length - a.ids.length);

  // SOLO INFORMA: no se escribe en la BD.
  return jsonResponse(req, { grupos });
}

Deno.serve((req: Request) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  return handle(req).catch((err) => errorResponse(req, err));
});
