// supabase/functions/_shared/familias.js
//
// FUENTE CANÓNICA ÚNICA de las familias temáticas A2 (23 familias).
// ESM puro, sin APIs de Node ni de Deno: portable a Vite (frontend),
// Node (scripts) y Deno (Edge Functions).
//
// La consumen por reexportación: src/constants/familias.js, scripts/_*.js
// y las Edge Functions (import relativo ../_shared/familias.js).
// NO duplicar esta lista en ningún otro sitio.
//
// Hay dos GRUPOS: 'vocabulario' (temas) y 'gramatica' (estructuras). La regla
// "asignar gramática solo cuando la tarjeta trate de ese punto" se aplica POR
// GRUPO (no por número de posición).

export const FAMILIAS_A2_META = [
  // --- Vocabulario por temas ---
  {
    nombre: 'Saludos y cortesía',
    grupo: 'vocabulario',
    descripcion: 'Saludos, despedidas, agradecimientos y fórmulas de cortesía.',
    ejemplos: ['hola', 'gracias', 'de nada', 'un momento por favor'],
  },
  {
    nombre: 'Datos personales',
    grupo: 'vocabulario',
    descripcion: 'Nombre, edad, teléfono, correo, nacionalidad, estado civil.',
    ejemplos: ['tengo 43 años', 'soltero', 'casada', 'mi número de teléfono es…'],
  },
  {
    nombre: 'Familia',
    grupo: 'vocabulario',
    descripcion: 'Miembros de la familia y relaciones de parentesco.',
    ejemplos: ['padre', 'tío materno', 'nieta', 'hermanos'],
  },
  {
    nombre: 'Descripción física',
    grupo: 'vocabulario',
    descripcion: 'Aspecto físico de PERSONAS únicamente. Los adjetivos sobre cosas o lugares NO van aquí.',
    ejemplos: ['alto', 'gordo', 'rubio', 'calvo', 'guapa', 'joven'],
  },
  {
    nombre: 'Emociones y estados',
    grupo: 'vocabulario',
    descripcion: 'Estados de ánimo o físicos de PERSONAS. Los adjetivos sobre cosas o lugares NO van aquí.',
    ejemplos: ['contento', 'triste', 'cansado', 'hambriento', 'enfadado'],
  },
  {
    nombre: 'Cuerpo humano',
    grupo: 'vocabulario',
    descripcion: 'Partes del cuerpo.',
    ejemplos: ['cabeza', 'ojo', 'brazo', 'espalda'],
  },
  {
    nombre: 'Salud',
    grupo: 'vocabulario',
    descripcion: 'Médico, enfermedad y servicios sanitarios.',
    ejemplos: ['hospital', 'farmacia', 'médico', 'enfermo'],
  },
  {
    nombre: 'Casa y habitaciones',
    grupo: 'vocabulario',
    descripcion: 'La vivienda y sus estancias.',
    ejemplos: ['salón', 'dormitorio', 'pasillo', 'balcón', 'alquiler'],
  },
  {
    nombre: 'Muebles y objetos',
    grupo: 'vocabulario',
    descripcion: 'Objetos y mobiliario de la casa.',
    ejemplos: ['cama', 'armario', 'espejo', 'lámpara', 'alfombra'],
  },
  {
    nombre: 'Ciudad y lugares',
    grupo: 'vocabulario',
    descripcion: 'Barrio, edificios y servicios urbanos.',
    ejemplos: ['ayuntamiento', 'banco', 'cine', 'mezquita', 'peluquería'],
  },
  {
    nombre: 'Transporte y viajes',
    grupo: 'vocabulario',
    descripcion: 'Medios de transporte, viajes y alojamiento.',
    ejemplos: ['aeropuerto', 'coche', 'hotel', 'maleta'],
  },
  {
    nombre: 'Comida y bebida',
    grupo: 'vocabulario',
    descripcion: 'Alimentos, bebidas, comercios y locales de comida.',
    ejemplos: ['pan', 'café', 'restaurante', 'carnicería'],
  },
  {
    nombre: 'Compras y ropa',
    grupo: 'vocabulario',
    descripcion: 'Tiendas, comprar, precios y ropa.',
    ejemplos: ['tienda', 'vendedor', 'precio', 'camisa'],
  },
  {
    nombre: 'Trabajo y profesiones',
    grupo: 'vocabulario',
    descripcion: 'Oficios, lugar de trabajo y empleo.',
    ejemplos: ['ingeniero', 'oficina', 'entrevista de trabajo', 'estoy parado'],
  },
  {
    nombre: 'Clase y estudios',
    grupo: 'vocabulario',
    descripcion: 'Aula, estudios e instrucciones de clase.',
    ejemplos: ['ejercicio', 'escribe', 'lee', 'escucha', 'estudiante', 'escuela'],
  },
  {
    nombre: 'Tiempo, fechas y clima',
    grupo: 'vocabulario',
    descripcion: 'Horas, días, meses, momentos del día y tiempo atmosférico.',
    ejemplos: ['esta tarde', 'lunes', 'enero', 'hace calor'],
  },
  {
    nombre: 'Rutina y tiempo libre',
    grupo: 'vocabulario',
    descripcion: 'Rutina diaria, aficiones, deportes y ocio.',
    ejemplos: ['¿qué haces esta tarde?', 'me levanto', 'leer', 'fútbol'],
  },
  {
    nombre: 'Países y nacionalidades',
    grupo: 'vocabulario',
    descripcion: 'Países, gentilicios e idiomas.',
    ejemplos: ['Marruecos', 'España', 'egipcio', 'árabe (idioma)'],
  },
  {
    nombre: 'Personas y nombres propios',
    grupo: 'vocabulario',
    descripcion: 'Palabras genéricas para personas (hombre, mujer, gente, chico) y nombres propios de personas, incluidos los usados para practicar lectura.',
    ejemplos: ['hombre', 'mujer', 'Layla', 'Napoleón', 'Cleopatra'],
  },
  {
    nombre: 'Animales y naturaleza',
    grupo: 'vocabulario',
    descripcion: 'Animales, plantas, paisaje y astros.',
    ejemplos: ['camello', 'pájaro', 'árbol', 'mar', 'sol', 'luna'],
  },

  // --- Gramática y estructuras ---
  // Asignar SOLO cuando la tarjeta trate de ese punto gramatical, no por defecto.
  {
    nombre: 'Números',
    grupo: 'gramatica',
    descripcion: 'Cardinales y ordinales.',
    ejemplos: ['once', 'veinte', 'cuarenta y tres', 'segunda planta'],
  },
  {
    nombre: 'Colores',
    grupo: 'gramatica',
    descripcion: 'Colores y sus formas masculina/femenina.',
    ejemplos: ['rojo', 'roja', 'azul marino', 'gris'],
  },
  {
    nombre: 'Ubicación y preposiciones',
    grupo: 'gramatica',
    descripcion: 'Dónde está algo.',
    ejemplos: ['debajo', 'entre', 'a la derecha de', 'dentro', 'delante'],
  },
  {
    nombre: 'Verbos y conjugación',
    grupo: 'gramatica',
    descripcion: 'Formas verbales y conjugaciones.',
    ejemplos: ['tengo', 'tenéis (vosotras)', 'tienen (ellos dos)', 'escribid'],
  },
  {
    nombre: 'Pronombres, posesivos y demostrativos',
    grupo: 'gramatica',
    descripcion: 'Pronombres personales, posesivos y demostrativos.',
    ejemplos: ['este es mi libro', 'este libro es mío', 'tu', 'su'],
  },
  {
    nombre: 'Preguntas y conectores',
    grupo: 'gramatica',
    descripcion: 'Interrogativos y conectores.',
    ejemplos: ['¿dónde?', '¿cuál?', '¿con quién?', 'pero', 'ni… ni'],
  },
];

// Lista ordenada de nombres (fuente de verdad para UI y validación).
export const FAMILIAS_A2 = FAMILIAS_A2_META.map((f) => f.nombre);

// Conjunto para validaciones rápidas (O(1)).
export const FAMILIAS_A2_SET = new Set(FAMILIAS_A2);

// Niveles de confianza válidos para la columna `familias_confianza`.
export const CONFIANZAS = ['alta', 'media', 'baja'];
export const CONFIANZAS_SET = new Set(CONFIANZAS);

// Familia de reserva: garantiza que ninguna tarjeta se guarde sin familia
// cuando, pese al prompt, la IA no devuelve ninguna válida. Estas tarjetas se
// marcan confianza 'baja' para que salgan en "Pendientes de revisar".
export const FAMILIA_FALLBACK = 'Personas y nombres propios';

/**
 * Garantiza al menos una familia válida ("nunca sin familia").
 * Devuelve { familias, forzada }: si hubo que recurrir al fallback, forzada=true.
 */
export function ensureFamilias(input) {
  const limpias = sanitizeFamilias(input);
  if (limpias.length > 0) return { familias: limpias, forzada: false };
  return { familias: [FAMILIA_FALLBACK], forzada: true };
}

/** Normaliza un valor de confianza a 'alta'|'media'|'baja' (por defecto 'baja'). */
export function sanitizeConfianza(value) {
  const v = String(value || '').trim().toLowerCase();
  return CONFIANZAS_SET.has(v) ? v : 'baja';
}

/**
 * Normaliza un array arbitrario de familias dejando solo las válidas, sin
 * duplicados y preservando el orden oficial. Descarta cualquier nombre que no
 * esté en la lista vigente. Si no queda ninguna válida, devuelve [].
 */
export function sanitizeFamilias(input) {
  const list = Array.isArray(input) ? input : [];
  const found = new Set(list.map((f) => String(f).trim()).filter((f) => FAMILIAS_A2_SET.has(f)));
  return FAMILIAS_A2.filter((f) => found.has(f));
}

/**
 * Lee el array de familias de una tarjeta de forma tolerante:
 * soporta `familias` como array (text[]) o como string separado por ';'.
 * No inventa ninguna familia: si no hay, devuelve [].
 */
export function getCardFamilias(card) {
  if (!card) return [];
  const raw = card.familias;
  if (Array.isArray(raw)) return raw.map((f) => String(f).trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split(';').map((f) => f.trim()).filter(Boolean);
  return [];
}

/**
 * Construye el bloque de texto con las familias para el prompt de la IA,
 * separadas por grupo (VOCABULARIO y GRAMÁTICA).
 */
export function buildFamiliasPromptBlock() {
  const porGrupo = (grupo) =>
    FAMILIAS_A2_META
      .filter((f) => f.grupo === grupo)
      .map((f) => `- ${f.nombre}: ${f.descripcion} Ej.: ${f.ejemplos.join(', ')}.`)
      .join('\n');

  return (
    `VOCABULARIO (temas):\n${porGrupo('vocabulario')}\n\n` +
    `GRAMÁTICA (estructuras — asignar SOLO si la tarjeta trata de ese punto):\n${porGrupo('gramatica')}`
  );
}
