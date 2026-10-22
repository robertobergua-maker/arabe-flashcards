// supabase/functions/_shared/openai.ts
//
// Helper para llamar a la API de OpenAI desde Deno vía fetch (sin el SDK).
// Usa OPENAI_API_KEY de los secretos de Supabase y response_format json_object.

import { HttpError } from './auth.ts';

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatArgs {
  model: string; // 'gpt-4o' | 'gpt-4o-mini'
  system: string;
  user: string | ChatContentPart[]; // array para visión (texto + image_url)
  temperature?: number;
}

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Llama a chat.completions con salida JSON y devuelve el objeto ya parseado.
 * Lanza HttpError(502) si OpenAI falla o la respuesta no es JSON válido;
 * HttpError(429) si OpenAI responde rate limit.
 */
export async function chatJson<T = unknown>(args: ChatArgs): Promise<T> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new HttpError(500, 'Falta el secreto OPENAI_API_KEY en el servidor.');

  const body = {
    model: args.model,
    temperature: args.temperature ?? 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: args.system },
      { role: 'user', content: args.user },
    ],
  };

  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new HttpError(502, `No se pudo contactar con OpenAI: ${(e as Error).message}`);
  }

  if (res.status === 429) {
    throw new HttpError(429, 'OpenAI está saturado (rate limit). Reintenta en unos segundos.');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new HttpError(502, `OpenAI respondió ${res.status}: ${detail.slice(0, 300)}`);
  }

  let payload: { choices?: Array<{ message?: { content?: string } }> };
  try {
    payload = await res.json();
  } catch {
    throw new HttpError(502, 'Respuesta de OpenAI ilegible.');
  }

  const content = payload.choices?.[0]?.message?.content ?? '';
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new HttpError(502, 'OpenAI no devolvió JSON válido.');
  }
}
