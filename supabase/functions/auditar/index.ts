// supabase/functions/auditar/index.ts
//
// Edge Function `auditar`: revisa un lote de tarjetas con OpenAI y devuelve
// incidencias (issues) con sugerencias de corrección. NO escribe en la BD:
// la corrección (applyFix) la aplica la app con el JWT de admin bajo RLS.

import {
  verifyAdmin,
  handleOptions,
  jsonResponse,
  errorResponse,
  HttpError,
} from '../_shared/auth.ts';
import { chatJson } from '../_shared/openai.ts';

const BATCH_SIZE = 15;

interface Card {
  id: number | string;
  arabic?: string;
  spanish?: string;
  phonetic?: string;
}

interface Issue {
  id: number | string;
  problem?: string;
  suggestion?: string;
  field?: 'arabic' | 'spanish';
}

function buildPrompt(batch: Card[]): string {
  const mini = batch.map((c) => ({ id: c.id, arabic: c.arabic, spanish: c.spanish }));
  return `Audita este lote de tarjetas árabe-español de nivel A2.
REGLAS:
1. Elimina tanwin/nunación innecesaria en el árabe.
2. Mantén solo excepciones fijas que siempre la usan, como شكرًا، عفوًا، أيضًا، جدًا، طبعًا، دائمًا، أحيانًا، مرحبًا، أهلًا، صباحًا، مساءً.
3. Corrige mala traducción al español.
IGNORA las tarjetas que ya estén bien.
Responde SOLO con JSON de esta forma:
{ "issues": [ { "id": 123, "problem": "motivo breve", "suggestion": "texto corregido", "field": "arabic" | "spanish" } ] }

DATOS: ${JSON.stringify(mini)}`;
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido.');
  await verifyAdmin(req);

  let payload: { cards?: Card[] };
  try {
    payload = await req.json();
  } catch {
    throw new HttpError(400, 'Cuerpo JSON inválido.');
  }
  const cards = Array.isArray(payload.cards) ? payload.cards : [];
  if (cards.length === 0) return jsonResponse(req, { issues: [] });

  const issues: Issue[] = [];
  for (let i = 0; i < cards.length; i += BATCH_SIZE) {
    const batch = cards.slice(i, i + BATCH_SIZE);
    const result = await chatJson<{ issues?: Issue[] }>({
      model: 'gpt-4o-mini',
      system: 'Eres un corrector experto de diccionarios árabe-español. Devuelves solo JSON.',
      user: buildPrompt(batch),
      temperature: 0.1,
    });
    const batchIssues = Array.isArray(result.issues) ? result.issues : [];
    for (const issue of batchIssues) {
      const card = batch.find((c) => c.id === issue.id);
      if (!card) continue;
      const field = issue.field || (/[\u0600-\u06FF]/.test(issue.suggestion ?? '') ? 'arabic' : 'spanish');
      // Solo incluir si realmente cambia el valor actual.
      if ((card as Record<string, unknown>)[field] !== issue.suggestion) {
        issues.push({ ...issue, field });
      }
    }
  }

  // NO se escribe en la BD: solo se devuelven incidencias.
  return jsonResponse(req, { issues });
}

Deno.serve((req: Request) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  return handle(req).catch((err) => errorResponse(req, err));
});
