// supabase/functions/_shared/auth.ts
//
// Autorización y CORS compartidos por las Edge Functions.
//
// IMPORTANTE (seguridad): la verificación de admin se hace AQUÍ, dentro de cada
// función, resolviendo el email real del JWT del usuario con
// `supabase.auth.getUser(jwt)` y comparándolo con el secreto ADMIN_EMAIL.
// La opción `verify_jwt` de Supabase NO basta: la clave anon del proyecto es
// también un JWT válido y superaría `verify_jwt` sin ser el admin. Por eso la
// autorización real la impone `verifyAdmin`, no `verify_jwt`.

import { createClient } from 'jsr:@supabase/supabase-js@2';

export interface AdminContext {
  email: string;
  userId: string;
}

// Error HTTP con status para propagar hasta el handler.
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Orígenes permitidos para CORS: localhost (dev) + el dominio de producción,
// que se configura con el secreto APP_ORIGIN (p. ej. https://arabe.tudominio.com).
// Se admiten varios separados por comas en APP_ORIGIN.
function allowedOrigins(): string[] {
  const fromEnv = (Deno.env.get('APP_ORIGIN') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const dev = [
    'http://localhost:5173',
    'http://localhost:4173',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:4173',
  ];
  return [...new Set([...fromEnv, ...dev])];
}

// Devuelve las cabeceras CORS para el origin concreto de la petición, solo si
// está permitido. Si no, no incluye Access-Control-Allow-Origin.
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  if (origin && allowedOrigins().includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

// Atiende el preflight OPTIONS con las cabeceras CORS. Devuelve null si no es OPTIONS.
export function handleOptions(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

// Verifica el JWT del usuario y que su email coincide con ADMIN_EMAIL.
// Lanza HttpError(401) sin token/JWT inválido, HttpError(403) si no es el admin.
export async function verifyAdmin(req: Request): Promise<AdminContext> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new HttpError(401, 'Falta la cabecera Authorization Bearer.');
  }
  const jwt = authHeader.slice('Bearer '.length).trim();
  if (!jwt) throw new HttpError(401, 'Token vacío.');

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  // Cliente con el JWT del usuario: getUser resuelve el email real del token.
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data?.user) {
    throw new HttpError(401, 'Token inválido o expirado.');
  }
  const email = (data.user.email ?? '').trim().toLowerCase();
  const admin = (Deno.env.get('ADMIN_EMAIL') ?? '').trim().toLowerCase();
  if (!admin || email !== admin) {
    // La clave anon llega aquí: es un JWT válido pero sin email de admin -> 403.
    throw new HttpError(403, 'No autorizado.');
  }
  return { email, userId: data.user.id };
}

// Construye una respuesta JSON con cabeceras CORS.
export function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

// Convierte un error (HttpError u otro) en respuesta JSON con CORS.
export function errorResponse(req: Request, err: unknown): Response {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : 'Error interno.';
  return jsonResponse(req, { error: message }, status);
}
