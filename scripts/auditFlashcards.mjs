import { supabase } from '../src/supabaseClient.js';

const ARABIC_RE = /[\u0600-\u06FF]/;
const LABEL_RE = /(^|\s)(Ejemplo|Example|Fon[eé]tica|Fonetica|Transcripci[oó]n|Transcripcion|Category)\s*:/i;
const LATIN_PARENS_RE = /\([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\s.,;:'"¿?¡!_-]{2,}\)/;

const CATEGORY_MAP = new Map([
  ['# Pista X: Category', 'Pista X: Categoría'],
  ['Common Phrases', 'Frases comunes'],
  ['Concepts', 'Conceptos'],
  ['Country', 'Países'],
  ['Exercise', 'Ejercicios'],
  ['Expression', 'Expresiones'],
  ['Greeting', 'Saludos'],
  ['Greetings', 'Saludos'],
  ['Home', 'Casa'],
  ['House Structure', 'Estructura de la casa'],
  ['Introduction', 'Presentaciones'],
  ['Location', 'Ubicación'],
  ['Numbers', 'Números'],
  ['Objects', 'Objetos'],
  ['Occupation', 'Profesiones'],
  ['People', 'Personas'],
  ['Places', 'Lugares'],
  ['Question', 'Preguntas'],
  ['Technology', 'Tecnología'],
  ['appliances', 'Electrodomésticos'],
  ['building', 'Edificios'],
  ['furniture', 'Muebles'],
  ['nationality', 'Nacionalidades'],
  ['person', 'Personas'],
  ['place', 'Lugares'],
  ['room', 'Habitaciones'],
  ['vehicle', 'Vehículos'],
  ['المضامين المعجمية - الموضوعية', 'Contenidos léxicos y temáticos'],
  ['وظائف', 'Funciones'],
]);

function cleanArabicText(text) {
  return String(text || '')
    .replace(LATIN_PARENS_RE, '')
    .replace(/(?:^|[\s:;.,])(?:Ejemplo|Example|Fon[eé]tica|Fonetica|Transcripci[oó]n|Transcripcion)\s*:\s*/gi, ' ')
    .replace(/^\s*[:;.,-]+\s*/, '')
    .replace(/\s*[:;.,-]+\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanSpanishText(text) {
  return String(text || '')
    .replace(/(?:^|[\s:;.,])(?:Ejemplo|Example|Fon[eé]tica|Fonetica|Transcripci[oó]n|Transcripcion)\s*:\s*/gi, ' ')
    .replace(/^\s*[:;.,-]+\s*/, '')
    .replace(/\s*[:;.,-]+\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function fetchAllCards() {
  const all = [];
  const pageSize = 1000;
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await supabase
      .from('flashcards')
      .select('*')
      .range(page * pageSize, (page + 1) * pageSize - 1)
      .order('id', { ascending: true });
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}

function auditCard(card) {
  const problems = [];
  const fixes = {};
  const category = String(card.category || '').trim();
  const spanish = String(card.spanish || '').trim();
  const arabic = String(card.arabic || '').trim();
  const phonetic = String(card.phonetic || '').trim();

  if (!category) {
    problems.push('sin categoría');
    fixes.category = 'Sin categoría';
  } else if (CATEGORY_MAP.has(category)) {
    problems.push(`categoría no española: ${category}`);
    fixes.category = CATEGORY_MAP.get(category);
  }

  const cleanSpanish = cleanSpanishText(spanish);
  const cleanArabic = cleanArabicText(arabic);
  if (cleanSpanish && cleanSpanish !== spanish) {
    problems.push('etiquetas/metadatos en español');
    fixes.spanish = cleanSpanish;
  }
  if (cleanArabic && cleanArabic !== arabic) {
    problems.push('etiquetas/metadatos en árabe');
    fixes.arabic = cleanArabic;
  }

  if (ARABIC_RE.test(spanish) && !ARABIC_RE.test(arabic)) {
    problems.push('posible español/árabe intercambiados');
  } else {
    if (ARABIC_RE.test(spanish)) problems.push('campo español contiene árabe');
    if (arabic && !ARABIC_RE.test(arabic)) problems.push('campo árabe sin escritura árabe');
  }

  if (LABEL_RE.test(spanish) || LATIN_PARENS_RE.test(spanish)) problems.push('marcas visibles en español');
  if (LABEL_RE.test(arabic) || LATIN_PARENS_RE.test(arabic)) problems.push('marcas visibles en árabe');

  return { card, problems: [...new Set(problems)], fixes };
}

const cards = await fetchAllCards();
const categoryCounts = new Map();
for (const card of cards) {
  const category = String(card.category || '').trim() || '(vacía)';
  categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
}

const audited = cards.map(auditCard);
const withFixes = audited.filter(item => Object.keys(item.fixes).length > 0);
const suspicious = audited.filter(item => item.problems.length > 0);

if (process.argv.includes('--apply-categories')) {
  const categoryFixes = withFixes.filter(item => item.fixes.category);
  let updated = 0;
  for (const item of categoryFixes) {
    const { error } = await supabase
      .from('flashcards')
      .update({ category: item.fixes.category })
      .eq('id', item.card.id);
    if (error) throw error;
    updated += 1;
  }
  console.log(JSON.stringify({ applied: 'categories', updated }, null, 2));
  process.exit(0);
}

console.log(JSON.stringify({
  total: cards.length,
  categoryCounts: [...categoryCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])),
  categoryFixCount: withFixes.filter(item => item.fixes.category).length,
  suggestedFixCount: withFixes.length,
  suggestedFixes: withFixes.slice(0, 200),
  suspiciousCount: suspicious.length,
  suspicious: suspicious.slice(0, 200),
}, null, 2));
