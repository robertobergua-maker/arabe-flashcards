import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from './supabaseClient';
import OpenAI from 'openai';
import * as pdfjsLib from 'pdfjs-dist'; 
import { 
  Search, Volume2, BookOpen, X, Check, ArrowLeft, ArrowRight,
  PlayCircle, Settings, Filter, Plus, Trash2, Edit2, Lock, Unlock, 
  Image as ImageIcon, Wand2, Loader, Trophy, Frown, CheckCircle, 
  HelpCircle, Grid, Activity, Mic, Camera, Upload, Gamepad2, Baseline, 
  AlertTriangle, ChevronLeft, ChevronRight, Sparkles, Database, Copy, PartyPopper
} from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.mjs`;

// --- UTILIDADES ---
const removeArabicDiacritics = (text) => text ? text.replace(/[\u064B-\u065F\u0670]/g, '') : "";
const normalizeForSearch = (text) => text ? text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u064B-\u065F\u0670]/g, "") : ""; 
const shuffleArray = (array) => { const newArray = [...array]; for (let i = newArray.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [newArray[i], newArray[j]] = [newArray[j], newArray[i]]; } return newArray; };
const safeGetStorage = (key, fallback) => { try { const saved = localStorage.getItem(key); return saved ? JSON.parse(saved) : fallback; } catch (e) { return fallback; } };
const setSafeStorage = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn("No se pudo guardar localmente:", e); } };
const getCardType = (card) => { if (!card) return 'word'; if (card.category && card.category.toLowerCase().includes('frases')) return 'phrase'; return (card.spanish || "").trim().split(/\s+/).length > 2 ? 'phrase' : 'word'; };
const playSmartAudio = (text) => { if (!text) return; try { window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'ar-SA'; utterance.rate = 0.7; const voices = window.speechSynthesis.getVoices(); const preferredVoice = voices.find(v => v.lang.includes('ar')); if (preferredVoice) utterance.voice = preferredVoice; window.speechSynthesis.speak(utterance); } catch (e) { console.error("Audio error", e); } };
const APP_VIEWS = new Set(['welcome', 'flashcards', 'exam']);
const getViewFromHash = () => {
  const hashView = window.location.hash.replace(/^#\/?/, '');
  return APP_VIEWS.has(hashView) ? hashView : '';
};

function ArabicTextWithAudio({ text, className = "", buttonClassName = "" }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} dir="rtl">
      <span>{text}</span>
      <span
        role="button"
        tabIndex={0}
        onClick={(event) => { event.stopPropagation(); playSmartAudio(text); }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); playSmartAudio(text); } }}
        className={`shrink-0 p-1.5 rounded-full bg-orange-100 text-orange-700 hover:bg-orange-200 ${buttonClassName}`}
        title="Escuchar"
        aria-label="Escuchar frase en árabe"
      >
        <Volume2 className="w-3.5 h-3.5" />
      </span>
    </span>
  );
}

const PDF_TEXT_MIN_CHARS = 40;
const PDF_RENDER_TARGET_SCALE = 2.4;
const PDF_MAX_CANVAS_SIDE = 2200;

const cleanExtractedText = (text) => (text || "")
  .replace(/\s+\n/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .replace(/[ \t]{2,}/g, " ")
  .replace(/Página \d+/gi, "")  // Eliminar números de página
  .replace(/\b\d{1,3}\b/g, "")  // Eliminar números sueltos (1-3 dígitos)
  .replace(/\.\w{2,4}(\s|$)/g, "")  // Eliminar extensiones de archivo
  .replace(/\b\w{1,2}\b/g, "")  // Eliminar palabras muy cortas (1-2 letras, posibles fragmentos)
  .trim();

async function extractTextFromPdfPage(page) {
  try {
    const textContent = await page.getTextContent();
    const rawText = textContent.items
      .map(item => item.str || "")
      .join(" ");
    return cleanExtractedText(rawText);
  } catch (error) {
    console.warn("No se pudo extraer texto nativo del PDF:", error);
    return "";
  }
}

async function renderPdfPageToDataUrl(page) {
  const baseViewport = page.getViewport({ scale: 1 });
  const largestSide = Math.max(baseViewport.width, baseViewport.height);
  const safeScale = Math.min(PDF_RENDER_TARGET_SCALE, PDF_MAX_CANVAS_SIDE / largestSide);
  const viewport = page.getViewport({ scale: Math.max(1.4, safeScale) });

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: false });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  context.save();
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();

  const renderTask = page.render({ canvasContext: context, viewport });
  await renderTask.promise;
  const image = canvas.toDataURL('image/jpeg', 0.92);
  canvas.width = 0;
  canvas.height = 0;
  return image;
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

function parseVisionJsonResponse(rawContent) {
  const raw = (rawContent || "").trim();
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    return {
      hasText: Boolean(parsed.hasText),
      content: cleanExtractedText(parsed.content || ""),
      notes: parsed.notes || ""
    };
  } catch (error) {
    const content = cleanExtractedText(raw.replace(/^```json|```$/g, ""));
    return {
      hasText: content.length > 0 && !/LIENZO_EN_BLANCO|NO_TEXT|SIN_TEXTO/i.test(content),
      content,
      notes: "Respuesta no JSON; se guardó el texto recuperado."
    };
  }
}

async function transcribeImageWithOpenAI(openai, imageDataUrl, label = "imagen") {
  const prompt = `Lee esta ${label} como material de clase de Árabe A2.
Devuelve SOLO JSON válido con esta forma:
{
  "hasText": true,
  "content": "transcripción completa y ordenada del texto visible",
  "notes": "observaciones breves si algo está borroso o cortado"
}
Reglas:
- Transcribe todo el texto visible en árabe, español o fonética.
- Conserva el árabe en escritura árabe y respeta el orden lógico de lectura.
- Si hay tablas o listas de vocabulario, mantenlas como listas claras.
- Si no hay ningún texto legible, usa {"hasText": false, "content": "", "notes": "sin texto legible"}.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageDataUrl } }
      ]
    }]
  });

  return parseVisionJsonResponse(response.choices?.[0]?.message?.content || "");
}

async function summarizeMaterialWithOpenAI(openai, sourceText, label, priorityNotes = "") {
  const priorityBlock = priorityNotes.trim()
    ? `
NOTAS DE PRIORIDAD DEL ADMINISTRADOR:
${priorityNotes.trim()}
`
    : "";
  const prompt = `Actúa como profesor de Árabe nivel A2 de EOI.
Analiza el siguiente material y devuelve una ficha útil para preparar examen.
Incluye SOLO información que aparezca en el material: vocabulario, frases bilingües, verbos en presente, estructuras, gramática, errores habituales y ejemplos.
Conserva literalmente todas las frases árabe-español / español-árabe que detectes.
Incluye una sección llamada "FRASES BASE PARA EXAMEN" con pares de traducción cuando existan.
Si hay NOTAS DE PRIORIDAD DEL ADMINISTRADOR, incorpóralas literalmente en una sección "PRIORIDAD PARA EXAMEN" y marca ese material como preferente para futuros simulacros.
No inventes contenido que no esté en el material.

FUENTE: ${label}${priorityBlock}
MATERIAL:
${sourceText}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1
  });

  return cleanExtractedText(response.choices?.[0]?.message?.content || sourceText);
}

function extractJsonArray(rawContent) {
  const raw = (rawContent || "").trim();
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : raw;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('La IA no devolvió una lista JSON válida.');
  }
  return JSON.parse(candidate.substring(start, end + 1));
}

function normalizeGeneratedGrammarQuestion(question, index) {
  const safeQuestion = question && typeof question === 'object' ? question : {};
  const rawOpciones = Array.isArray(safeQuestion.opciones)
    ? safeQuestion.opciones
    : Array.isArray(safeQuestion.options)
      ? safeQuestion.options
      : [];
  const opciones = [...new Set(rawOpciones.map(opt => cleanExamPhrase(opt)).filter(Boolean))];
  let correcta = Number.isInteger(safeQuestion.correcta) ? safeQuestion.correcta : Number(safeQuestion.correcta);
  if (!Number.isInteger(correcta) || correcta < 0 || correcta >= rawOpciones.length) correcta = 0;

  const pregunta = cleanExamPhrase(safeQuestion.pregunta || safeQuestion.question || `Pregunta de gramática ${index + 1}`);
  const respuestaCorrecta = cleanExamPhrase(rawOpciones[correcta]);
  if (!pregunta || !respuestaCorrecta) return null;
  if (isAmbiguousGrammarQuestion(pregunta, opciones)) return null;

  const correctIsArabic = containsArabic(respuestaCorrecta);
  const validOpciones = opciones
    .filter(opt => containsArabic(opt) === correctIsArabic)
    .filter(opt => opt === respuestaCorrecta || isOptionLengthClose(opt, respuestaCorrecta));

  if (!validOpciones.includes(respuestaCorrecta) || validOpciones.length < 4) return null;

  const correctedOpciones = shuffleArray([
    respuestaCorrecta,
    ...validOpciones.filter(opt => opt !== respuestaCorrecta).slice(0, 3)
  ]);

  return {
    tipo: 'gramatica',
    direccion: correctIsArabic ? 'GRAM → AR' : 'GRAM → ES',
    pregunta,
    opciones: correctedOpciones,
    correcta: correctedOpciones.indexOf(respuestaCorrecta),
    explicacion: safeQuestion.explicacion || safeQuestion.explanation || 'Respuesta basada en una estructura del material subido.',
    fuente: safeQuestion.fuente || safeQuestion.source || 'Material subido'
  };
}

function isAmbiguousGrammarQuestion(questionText, options) {
  const question = String(questionText || '');
  const optionText = (options || []).join(' ');
  const hasArabicGap = /[\u0600-\u06FF][^؟?]*(\.{2,}|…|___|__|_{2,})/.test(question);
  const hasSuffixOptions = /(كَ|كِ|هُ|هَا|نَا|كُمْ|كُنَّ|هُمْ|هُنَّ)/.test(optionText);
  const hasDisambiguatingCue = /(masculino|femenino|hombre|mujer|él|ella|ellos|ellas|vosotros|vosotras|yo|nosotros|mi|tu|su|nuestro|vuestra|de él|de ella|dirigido|persona|género|número)/i.test(question);
  return hasArabicGap && hasSuffixOptions && !hasDisambiguatingCue;
}

function normalizeGeneratedQuestion(question, index, mode = 'traduccion') {
  const requestedType = String(question?.tipo || question?.type || '').toLowerCase();
  if (mode === 'gramatica' || requestedType.includes('gram')) {
    return normalizeGeneratedGrammarQuestion(question, index);
  }

  const safeQuestion = question && typeof question === 'object' ? question : {};
  const rawOpciones = Array.isArray(safeQuestion.opciones)
    ? safeQuestion.opciones
    : Array.isArray(safeQuestion.options)
      ? safeQuestion.options
      : [];
  const opciones = [...new Set(rawOpciones.map(opt => cleanExamPhrase(opt)).filter(Boolean))];
  let correcta = Number.isInteger(safeQuestion.correcta) ? safeQuestion.correcta : Number(safeQuestion.correcta);
  if (!Number.isInteger(correcta) || correcta < 0 || correcta >= rawOpciones.length) correcta = 0;

  const preguntaOriginal = safeQuestion.pregunta || safeQuestion.question || `Pregunta ${index + 1}`;
  const cuerpoPregunta = getQuestionBody(preguntaOriginal);
  const preguntaEsArabe = containsArabic(cuerpoPregunta);
  const direccion = preguntaEsArabe ? 'ar-es' : 'es-ar';
  const pregunta = buildTranslationQuestionText(cuerpoPregunta, direccion);
  const respuestaCorrecta = cleanExamPhrase(rawOpciones[correcta]);

  if (!isLikelyPhrase(cuerpoPregunta, preguntaEsArabe)) return null;
  if ((mode === 'auditivo' || requestedType.includes('audio')) && !preguntaEsArabe) return null;
  if (!respuestaCorrecta || !optionLanguageMatches(respuestaCorrecta, direccion) || !optionLooksLikeAnswerPhrase(respuestaCorrecta, direccion)) return null;

  const validOpciones = opciones
    .filter(opt => optionLanguageMatches(opt, direccion))
    .filter(opt => optionLooksLikeAnswerPhrase(opt, direccion))
    .filter(opt => opt === respuestaCorrecta || isOptionLengthClose(opt, respuestaCorrecta));

  const sameLanguageOpciones = opciones
    .filter(opt => optionLanguageMatches(opt, direccion))
    .filter(opt => optionLooksLikeAnswerPhrase(opt, direccion));
  const usableOpciones = validOpciones.length >= 4 ? validOpciones : sameLanguageOpciones;

  if (!usableOpciones.includes(respuestaCorrecta) || usableOpciones.length < 4) return null;

  const correctedOpciones = shuffleArray([
    respuestaCorrecta,
    ...shuffleArray(usableOpciones.filter(opt => opt !== respuestaCorrecta)).slice(0, 3)
  ]);
  const finalCorrecta = correctedOpciones.indexOf(respuestaCorrecta);
  
  return {
    tipo: mode === 'auditivo' || requestedType.includes('audio') ? 'audio' : 'traduccion',
    direccion,
    pregunta: mode === 'auditivo' || requestedType.includes('audio') ? 'Escucha la frase y elige la traducción correcta' : pregunta,
    audioText: mode === 'auditivo' || requestedType.includes('audio') ? cuerpoPregunta : '',
    opciones: correctedOpciones,
    correcta: finalCorrecta,
    explicacion: safeQuestion.explicacion || safeQuestion.explanation || 'Respuesta basada en el material subido.',
    fuente: safeQuestion.fuente || safeQuestion.source || 'Material subido'
  };
}

function findFirstQuestionArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];

  const preferredKeys = ['preguntas', 'questions', 'test', 'items', 'simulacro', 'exam'];
  for (const key of preferredKeys) {
    if (Array.isArray(value[key])) return value[key];
  }

  for (const nested of Object.values(value)) {
    const found = findFirstQuestionArray(nested);
    if (found.length > 0) return found;
  }

  return [];
}

function parseGeneratedQuestions(rawContent) {
  const raw = (rawContent || '').trim();
  if (!raw) throw new Error('La IA devolvió una respuesta vacía.');

  try {
    const parsed = JSON.parse(raw);
    return findFirstQuestionArray(parsed);
  } catch (firstError) {
    try {
      return extractJsonArray(raw);
    } catch (secondError) {
      throw new Error(`La IA no devolvió JSON de preguntas válido. Respuesta inicial: ${raw.slice(0, 300)}`);
    }
  }
}


function containsArabic(text) {
  return /[\u0600-\u06FF]/.test(text || '');
}

function getQuestionBody(questionText) {
  return cleanExamPhrase(String(questionText || '')
    .replace(/^Traduce\s+al\s+español\s*:\s*/i, '')
    .replace(/^Traduce\s+al\s+árabe\s*:\s*/i, '')
    .replace(/^Traduce\s+al\s+arabe\s*:\s*/i, '')
    .replace(/^¿Qué\s+significa\s+en\s+español\s*:\s*/i, '')
    .replace(/^Elige\s+la\s+traducción\s+correcta\s+en\s+español\s*:\s*/i, '')
    .replace(/^Marca\s+la\s+opción\s+que\s+traduce\s+esta\s+frase\s*:\s*/i, '')
    .replace(/^¿Cómo\s+se\s+dice\s+en\s+árabe\s*:\s*/i, '')
    .replace(/^Elige\s+la\s+frase\s+árabe\s+correcta\s+para\s*:\s*/i, '')
    .replace(/^Escucha[^:]*:\s*/i, '')
    .trim());
}

function buildTranslationQuestionText(body, direction) {
  const arEsPrompts = [
    `Traduce al español: ${body}`,
    `¿Qué significa en español: ${body}`,
    `Elige la traducción correcta en español: ${body}`,
    `Marca la opción que traduce esta frase: ${body}`
  ];
  const esArPrompts = [
    `Traduce al árabe: ${body}`,
    `¿Cómo se dice en árabe: ${body}`,
    `Elige la frase árabe correcta para: ${body}`
  ];
  return shuffleArray(direction === 'ar-es' ? arEsPrompts : esArPrompts)[0];
}

function cleanExamPhrase(text) {
  const cleaned = String(text || '')
    .replace(/\([A-Za-zÀ-ÿ0-9\s.,;:'"¿?¡!_-]+\)/g, '')
    .replace(/(?:^|[\s:;.,])(?:Ejemplo|Example|Fonética|Fonetica|Transcripción|Transcripcion)\s*:\s*/gi, ' ')
    .replace(/^\s*[:;.,-]+\s*/, '')
    .replace(/\s*[:;.,-]+\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return containsArabic(cleaned) ? normalizeArabicNunation(cleaned) : cleaned;
}

const FIXED_NUNATION_WORDS = new Set([
  'شكرًا', 'شُكْرًا',
  'عفوًا', 'عَفْوًا',
  'أيضًا', 'أَيْضًا',
  'جدًا', 'جِدًّا',
  'طبعًا', 'طَبْعًا',
  'دائمًا', 'دَائِمًا',
  'أحيانًا', 'أَحْيَانًا',
  'مرحبًا', 'مَرْحَبًا',
  'أهلًا', 'أَهْلًا',
  'أهلاً', 'أَهْلًا',
  'مساءً', 'مَسَاءً',
  'صباحًا', 'صَبَاحًا'
]);

function normalizeArabicNunation(text) {
  return String(text || '')
    .split(/(\s+)/)
    .map((part) => {
      if (!containsArabic(part) || !/[ًٌٍ]/.test(part)) return part;
      const bareWord = part.replace(/[^\u0600-\u06FFًٌٍَُِّْٰ]/g, '');
      const comparable = bareWord.replace(/[ـ]/g, '');
      if (FIXED_NUNATION_WORDS.has(comparable)) return part;
      return part.replace(/[ًٌٍ]/g, '');
    })
    .join('');
}

function countUsefulWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function isLikelyPhrase(text, expectsArabic) {
  const clean = getQuestionBody(text);
  if (!clean) return false;
  if (containsArabic(clean) !== expectsArabic) return false;

  // A phrase must have enough context to be exam-like. This rejects isolated
  // items such as "هذا" or "البلد" that made the old simulacros too easy.
  return countUsefulWords(clean) >= (expectsArabic ? 2 : 3);
}

function optionLanguageMatches(option, direction) {
  const hasArabic = containsArabic(option);
  return direction === 'es-ar' ? hasArabic : !hasArabic;
}

function optionLooksLikeAnswerPhrase(option, direction) {
  const clean = cleanExamPhrase(option);
  if (!clean || containsArabic(clean) !== (direction === 'es-ar')) return false;
  return countUsefulWords(clean) >= 2;
}

function isOptionLengthClose(option, reference) {
  const optionLength = String(option || '').trim().length;
  const referenceLength = String(reference || '').trim().length;
  if (!optionLength || !referenceLength) return false;
  const min = referenceLength * 0.35;
  const max = referenceLength * 2.25;
  return optionLength >= min && optionLength <= max;
}

function getQuestionKeywords(question) {
  return normalizeForSearch(`${question?.audioText || ''} ${question?.pregunta || ''} ${question?.opciones?.[question.correcta] || ''}`)
    .split(/\s+/)
    .filter(token => token.length > 3)
    .slice(0, 14);
}

function diversifyExamQuestions(questions, desiredCount) {
  const pool = shuffleArray(questions);
  const selected = [];
  const usedSources = new Map();
  const usedTypes = new Map();
  const usedDirections = new Map();
  const usedKeywords = new Set();

  while (selected.length < desiredCount && pool.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;

    pool.forEach((question, index) => {
      const keywords = getQuestionKeywords(question);
      const repeatedKeywords = keywords.filter(keyword => usedKeywords.has(keyword)).length;
      const sourceCount = usedSources.get(question.fuente || '') || 0;
      const typeCount = usedTypes.get(question.tipo || '') || 0;
      const directionCount = usedDirections.get(question.direccion || '') || 0;
      const score = Math.random()
        - sourceCount * 2.2
        - repeatedKeywords * 1.4
        - typeCount * 0.35
        - directionCount * 0.25;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    const [chosen] = pool.splice(bestIndex, 1);
    selected.push(chosen);
    usedSources.set(chosen.fuente || '', (usedSources.get(chosen.fuente || '') || 0) + 1);
    usedTypes.set(chosen.tipo || '', (usedTypes.get(chosen.tipo || '') || 0) + 1);
    usedDirections.set(chosen.direccion || '', (usedDirections.get(chosen.direccion || '') || 0) + 1);
    getQuestionKeywords(chosen).forEach(keyword => usedKeywords.add(keyword));
  }

  return selected;
}

const EXAM_LOCAL_HISTORY_KEY = 'exam_1a2_local_history';
const EXAM_RECENT_QUESTIONS_KEY = 'exam_1a2_recent_questions';

function getQuestionFingerprint(question) {
  const body = question?.audioText || getQuestionBody(question?.pregunta || '');
  const answer = question?.opciones?.[question.correcta] || '';
  return normalizeForSearch(`${question?.direccion || ''}|${body}|${answer}`).slice(0, 220);
}

function rememberRecentExamQuestions(questions) {
  const current = safeGetStorage(EXAM_RECENT_QUESTIONS_KEY, []);
  const next = [
    ...questions.map(getQuestionFingerprint),
    ...current
  ].filter(Boolean);
  setSafeStorage(EXAM_RECENT_QUESTIONS_KEY, [...new Set(next)].slice(0, 80));
}

function getRecentQuestionHints() {
  return safeGetStorage(EXAM_RECENT_QUESTIONS_KEY, []).slice(0, 20);
}

function buildExamHistoryEntry(question, selectedIndex, isCorrect) {
  return {
    id: getQuestionFingerprint(question),
    date: new Date().toISOString(),
    tipo: question.tipo || 'traduccion',
    pregunta: question.pregunta,
    audioText: question.audioText || '',
    direccion: question.direccion,
    selected: question.opciones[selectedIndex],
    correct: question.opciones[question.correcta],
    explicacion: question.explicacion || '',
    fuente: question.fuente || '',
    isCorrect
  };
}

function addLocalExamHistoryEntry(entry) {
  const current = safeGetStorage(EXAM_LOCAL_HISTORY_KEY, []);
  const next = [entry, ...current].slice(0, 200);
  setSafeStorage(EXAM_LOCAL_HISTORY_KEY, next);
  return next;
}

function stripMarkdownNoise(text) {
  return String(text || '')
    .replace(/^[-*•\d.)\s]+/, '')
    .replace(/\*\*/g, '')
    .trim();
}

function extractStudyPairsFromKnowledge(knowledge) {
  const pairs = [];
  const seen = new Set();

  (knowledge || []).forEach((block) => {
    const source = block?.category || 'Material subido';
    const lines = String(block?.content || '')
      .split(/\n+/)
      .map(stripMarkdownNoise)
      .filter(line => line.length > 3);

    for (const line of lines) {
      if (!containsArabic(line)) continue;

      const separators = [' = ', ' - ', ' – ', ' — ', ':', ' : ', '|', ' | ', ' / ', ' /'];
      for (const sep of separators) {
        if (!line.includes(sep)) continue;
        const parts = line.split(sep).map(stripMarkdownNoise).filter(Boolean);
        if (parts.length < 2) continue;

        const left = parts[0];
        const right = parts.slice(1).join(' ').trim();
        const arabic = cleanExamPhrase(containsArabic(left) ? left : containsArabic(right) ? right : '');
        const spanish = cleanExamPhrase(containsArabic(left) ? right : left);

        if (arabic && spanish && spanish.length > 1) {
          const key = `${arabic}__${spanish}`;
          if (!seen.has(key)) {
            seen.add(key);
            pairs.push({ arabic, spanish, source });
          }
          break;
        }
      }
    }
  });

  return pairs;
}

function buildLocalTranslationTest(knowledge, desiredCount = 10) {
  const pairs = extractStudyPairsFromKnowledge(knowledge)
    .filter(pair => isLikelyPhrase(pair.arabic, true) && isLikelyPhrase(pair.spanish, false));
  if (pairs.length === 0) return [];

  const shuffledPairs = shuffleArray(pairs);
  const arEsCount = Math.ceil(desiredCount / 2);
  const esArCount = desiredCount - arEsCount;
  
  const arEsQuestions = shuffledPairs.slice(0, arEsCount).map((pair) => {
    const correctText = pair.spanish;
    const distractorPool = pairs.filter(p => p !== pair).map(p => p.spanish).filter(Boolean);
    const uniqueDistractors = Array.from(new Set(shuffleArray(distractorPool)));
    const similarDistractors = uniqueDistractors.filter(d => isOptionLengthClose(d, correctText));
    const distractors = similarDistractors.slice(0, 3);
    while (distractors.length < 3) {
      const fallback = uniqueDistractors.find(d => !distractors.includes(d));
      if (!fallback) return null;
      distractors.push(fallback);
    }
    const opciones = shuffleArray([correctText, ...distractors]).slice(0, 4);
    return distractors.length === 3 ? { tipo: 'traduccion', direccion: 'ar-es', pregunta: `Traduce al español: ${pair.arabic}`, opciones, correcta: opciones.indexOf(correctText), explicacion: `Frase del material: "${pair.arabic}"`, fuente: pair.source } : null;
  }).filter(Boolean);

  const esArQuestions = shuffledPairs.slice(arEsCount, arEsCount + esArCount).map((pair) => {
    const correctText = pair.arabic;
    const distractorPool = pairs.filter(p => p !== pair).map(p => p.arabic).filter(Boolean);
    const uniqueDistractors = Array.from(new Set(shuffleArray(distractorPool)));
    const similarDistractors = uniqueDistractors.filter(d => isOptionLengthClose(d, correctText));
    const distractors = similarDistractors.slice(0, 3);
    while (distractors.length < 3) {
      const fallback = uniqueDistractors.find(d => !distractors.includes(d));
      if (!fallback) return null;
      distractors.push(fallback);
    }
    const opciones = shuffleArray([correctText, ...distractors]).slice(0, 4);
    return distractors.length === 3 ? { tipo: 'traduccion', direccion: 'es-ar', pregunta: `Traduce al árabe: ${pair.spanish}`, opciones, correcta: opciones.indexOf(correctText), explicacion: `Frase del material: "${pair.spanish}"`, fuente: pair.source } : null;
  }).filter(Boolean);

  return shuffleArray([...arEsQuestions, ...esArQuestions]).slice(0, desiredCount);
}

function adaptLocalTestToMode(test, mode) {
  if (mode !== 'auditivo') return test;
  return test
    .filter(question => question.direccion === 'ar-es')
    .map(question => ({
      ...question,
      tipo: 'audio',
      audioText: getQuestionBody(question.pregunta),
      pregunta: 'Escucha la frase y elige la traducción correcta'
    }));
}




// --- PANTALLA DE BIENVENIDA ---
function WelcomeScreen({ onStartFlashcards, onStartExam }) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-emerald-50 flex items-center justify-center p-4 relative overflow-hidden notranslate" translate="no">
        <div className="absolute top-10 left-10 text-emerald-500 opacity-10 animate-bounce"><BookOpen size={80} /></div>
        <div className="absolute bottom-20 left-20 text-amber-500 opacity-10"><Volume2 size={60} /></div>
        <div className="absolute top-20 right-10 text-blue-500 opacity-10 animate-pulse"><PlayCircle size={100} /></div>
        <div className="absolute bottom-10 right-20 text-purple-500 opacity-10"><ImageIcon size={70} /></div>

        <div className="bg-white/80 backdrop-blur-md p-8 md:p-12 rounded-3xl shadow-2xl text-center max-w-md w-full z-10 border border-white relative">
            <div className="absolute -top-4 -right-4 bg-yellow-400 text-yellow-900 text-xs font-bold px-3 py-1 rounded-full rotate-12 shadow-md animate-pulse flex items-center gap-1">
                <PartyPopper size={14}/> EOI 1A2 Ready!
            </div>
            <div className="w-28 h-28 bg-gradient-to-br from-emerald-400 to-emerald-600 text-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-200">
                <BookOpen size={50} />
            </div>
            <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">¡Bienvenido a!</p>
            <div className="mb-2 relative inline-block">
                <span className="absolute -top-3 -left-5 text-xs text-slate-400 line-through decoration-red-400/50 font-mono -rotate-12 opacity-80">Al-</span>
                <h1 className="text-4xl font-black text-slate-800"><span className="text-emerald-600 text-5xl mr-0.5">La</span>madrasa</h1>
            </div>
            <h2 className="text-5xl font-arabic text-emerald-600 mb-8 font-bold drop-shadow-sm" dir="rtl">المدرسة</h2>
            
            <div className="flex flex-col gap-4">
                <button onClick={onStartFlashcards} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 px-6 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-3 text-lg">
                    <Grid size={24} /> Repaso de Vocabulario
                </button>
                <button onClick={onStartExam} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 px-6 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-3 text-lg">
                    <Activity size={24} /> Preparación Examen 1A2
                </button>
                <button onClick={() => setIsHelpOpen(true)} className="w-full bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-bold py-3 px-6 rounded-2xl shadow-sm transition-all active:scale-95 flex items-center justify-center gap-3">
                    <HelpCircle size={20} /> Ayuda de uso
                </button>
            </div>
        </div>
        {isHelpOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
              <div className="bg-emerald-700 text-white px-5 py-4 flex items-center justify-between">
                <h2 className="font-bold flex items-center gap-2"><HelpCircle className="w-5 h-5" /> Ayuda de Lamadrasa</h2>
                <button onClick={() => setIsHelpOpen(false)} className="p-1 rounded-full hover:bg-white/20"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 text-left text-sm text-slate-600 space-y-5 overflow-y-auto">
                <div>
                  <p className="font-bold text-slate-800">Repaso de vocabulario</p>
                  <p>Sirve para estudiar las tarjetas una a una. Puedes buscar por texto, filtrar por pista o categoría y cambiar qué idioma aparece primero. Al pulsar una tarjeta cambia de cara: español, árabe y fonética.</p>
                </div>
                <div>
                  <p className="font-bold text-slate-800">Iconos y controles del vocabulario</p>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                    <p className="flex gap-2"><Search className="w-4 h-4 shrink-0 text-emerald-700" /> <span><b>Buscar:</b> localiza tarjetas por español o árabe.</span></p>
                    <p className="flex gap-2"><Filter className="w-4 h-4 shrink-0 text-emerald-700" /> <span><b>Filtro:</b> muestra solo una pista o categoría.</span></p>
                    <p className="flex gap-2"><Gamepad2 className="w-4 h-4 shrink-0 text-emerald-700" /> <span><b>Juegos:</b> abre escucha, quiz, memoria y velocidad.</span></p>
                    <p className="flex gap-2"><Baseline className="w-4 h-4 shrink-0 text-emerald-700" /> <span><b>Vocales:</b> muestra u oculta harakat/diacríticos árabes.</span></p>
                    <p className="flex gap-2"><span className="font-black text-xs bg-slate-100 px-1.5 py-0.5 rounded">ES</span> <span><b>ES:</b> enseña primero el español.</span></p>
                    <p className="flex gap-2"><span className="font-black text-xs bg-slate-100 px-1.5 py-0.5 rounded">AR</span> <span><b>AR:</b> enseña primero el árabe.</span></p>
                    <p className="flex gap-2"><Volume2 className="w-4 h-4 shrink-0 text-emerald-700" /> <span><b>Audio:</b> reproduce la frase o palabra árabe.</span></p>
                    <p className="flex gap-2"><Lock className="w-4 h-4 shrink-0 text-emerald-700" /> <span><b>Candado:</b> activa el modo administrador.</span></p>
                    <p className="flex gap-2"><Edit2 className="w-4 h-4 shrink-0 text-emerald-700" /> <span><b>Editar:</b> modifica una tarjeta en modo admin.</span></p>
                    <p className="flex gap-2"><Trash2 className="w-4 h-4 shrink-0 text-emerald-700" /> <span><b>Borrar:</b> elimina una tarjeta en modo admin.</span></p>
                  </div>
                </div>
                <div>
                  <p className="font-bold text-slate-800">Juegos</p>
                  <p>Son ejercicios cortos para automatizar vocabulario: escuchar y reconocer, elegir la traducción correcta, emparejar tarjetas o responder rápido antes de que acabe el tiempo.</p>
                </div>
                <div>
                  <p className="font-bold text-slate-800">Preparación Examen 1A2</p>
                  <p>Genera simulacros desde el material subido por el administrador. Puedes elegir cantidad de preguntas y modo: traducción de frases, audio con frase árabe escuchada, gramática A2 o mixto.</p>
                </div>
                <div>
                  <p className="font-bold text-slate-800">Modo gramática</p>
                  <p>No busca traducir una frase completa. Pregunta por la forma correcta de una estructura: pronombre sufijado, demostrativo, negación, posesión, concordancia, presente, anexión o partículas de lugar, siempre a partir de patrones del material.</p>
                </div>
                <div>
                  <p className="font-bold text-slate-800">Errores locales</p>
                  <p>Los fallos del simulacro se guardan solo en este navegador para que cada usuario tenga su propio repaso.</p>
                </div>
                <div>
                  <p className="font-bold text-slate-800">Modo administrador</p>
                  <p>Permite importar tarjetas, subir material de examen, añadir comentarios de prioridad y revisar la base de datos.</p>
                </div>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

// --- COMPONENTE PRINCIPAL APP ---
export default function App() {
  const [currentView, setCurrentView] = useState(() => getViewFromHash() || sessionStorage.getItem('current_view') || 'welcome');
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Todos");
  const [frontLanguage, setFrontLanguage] = useState(() => localStorage.getItem('pref_lang') || "spanish");
  const [showDiacritics, setShowDiacritics] = useState(() => safeGetStorage('pref_diacritics', true));
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [editingCard, setEditingCard] = useState(null); 
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSmartImportOpen, setIsSmartImportOpen] = useState(false);
  const [isMaintenanceOpen, setIsMaintenanceOpen] = useState(false);
  const [isGamesHubOpen, setIsGamesHubOpen] = useState(() => safeGetStorage('games_open', false)); 

  useEffect(() => { localStorage.setItem('pref_lang', frontLanguage); }, [frontLanguage]);
  useEffect(() => { localStorage.setItem('pref_diacritics', JSON.stringify(showDiacritics)); }, [showDiacritics]);
  useEffect(() => { localStorage.setItem('games_open', JSON.stringify(isGamesHubOpen)); }, [isGamesHubOpen]);

  useEffect(() => {
    const initialView = APP_VIEWS.has(currentView) ? currentView : 'welcome';
    sessionStorage.setItem('current_view', initialView);
    if (!window.history.state?.appView) {
      window.history.replaceState({ appView: initialView }, '', `#${initialView}`);
    }

    const handlePopState = (event) => {
      const nextView = event.state?.appView || getViewFromHash() || 'welcome';
      sessionStorage.setItem('current_view', nextView);
      setCurrentView(nextView);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const loadVoices = () => { window.speechSynthesis.getVoices(); };
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) window.speechSynthesis.onvoiceschanged = loadVoices;
    fetchAllCards();
  }, []);

  async function fetchAllCards() {
    try {
      setLoading(true);
      let allData = []; let page = 0; const pageSize = 1000; let hasMore = true;
      while (hasMore && page < 10) {
        const { data, error } = await supabase.from('flashcards').select('*').range(page * pageSize, (page + 1) * pageSize - 1).order('id', { ascending: true });
        if (error) throw error;
        if (data && data.length > 0) { allData = [...allData, ...data]; if (data.length < pageSize) hasMore = false; else page++; } else { hasMore = false; }
      }
      const uniqueCards = Array.from(new Map(allData.map(item => [item.id, item])).values());
      setCards(uniqueCards);
    } catch (error) { console.error("Error:", error); } finally { setLoading(false); }
  }

  const navigateTo = (view, { replace = false } = {}) => {
    const nextView = APP_VIEWS.has(view) ? view : 'welcome';
    sessionStorage.setItem('current_view', nextView);
    setCurrentView(nextView);
    const method = replace ? 'replaceState' : 'pushState';
    window.history[method]({ appView: nextView }, '', `#${nextView}`);
  };

  const goToFlashcards = () => navigateTo('flashcards');
  const goToExam = () => navigateTo('exam');
  const goToWelcome = () => {
    if (currentView === 'welcome') return;
    navigateTo('welcome', { replace: true });
  };
  
  const handleAdminToggle = () => { if (isAdminMode) setIsAdminMode(false); else { const p = prompt("🔒 Contraseña:"); if (p === "1234") setIsAdminMode(true); } };

  const handleSaveCard = async (cardData) => {
    try {
      if (cardData.id) {
        const { error } = await supabase.from('flashcards').update({ category: cardData.category, spanish: cardData.spanish, arabic: cardData.arabic, phonetic: cardData.phonetic }).eq('id', cardData.id);
        if (error) throw error;
        setCards(prev => prev.map(c => c.id === cardData.id ? cardData : c));
      } else {
        const { id, ...newCardData } = cardData;
        const { data, error } = await supabase.from('flashcards').insert([newCardData]).select();
        if (error) throw error;
        if (data) setCards(prev => [...prev, data[0]]);
      }
      setIsFormOpen(false); setEditingCard(null);
    } catch (error) { alert("Error: " + error.message); }
  };

  const handleBulkImport = async (newCards) => {
    try {
      const { data, error } = await supabase.from('flashcards').insert(newCards).select();
      if (error) throw error;
      if (data) { setCards(prev => [...prev, ...data]); alert(`¡${data.length} importadas!`); setIsSmartImportOpen(false); }
    } catch (error) { alert("Error: " + error.message); }
  };

  const handleDeleteCard = async (id) => {
    if (!window.confirm("¿Borrar?")) return;
    try {
      const { error } = await supabase.from('flashcards').delete().eq('id', id);
      if (error) throw error;
      setCards(prev => prev.filter(c => c.id !== id));
    } catch (error) { alert("Error: " + error.message); }
  };

  const categories = useMemo(() => {
    const allTags = new Set();
    cards.forEach(card => {
      const tags = (card.category || "General").toString().split(';');
      tags.forEach(tag => { if(tag.trim().length > 0) allTags.add(tag.trim()); });
    });
    const uniqueTags = Array.from(allTags);
    const pistas = uniqueTags.filter(t => t.toLowerCase().startsWith('pista'));
    const otros = uniqueTags.filter(t => !t.toLowerCase().startsWith('pista'));
    pistas.sort((a, b) => { const numA = parseInt(a.match(/\d+/)?.[0] || 0); const numB = parseInt(b.match(/\d+/)?.[0] || 0); return numA - numB; });
    otros.sort((a, b) => a.localeCompare(b));
    return ["Todos", ...pistas, ...otros];
  }, [cards]);

  const filteredCards = useMemo(() => {
    const normalizedTerm = normalizeForSearch(searchTerm);
    let result = cards.filter(card => {
      const s = normalizeForSearch(card.spanish || "");
      const a = normalizeForSearch(card.arabic || "");
      return (s.includes(normalizedTerm) || a.includes(normalizedTerm)) && (selectedCategory === "Todos" || (card.category || "").includes(selectedCategory));
    });
    if (selectedCategory === "Todos" && searchTerm === "") return shuffleArray(result);
    return result;
  }, [cards, searchTerm, selectedCategory]);

  if (currentView === 'welcome') return <WelcomeScreen onStartFlashcards={goToFlashcards} onStartExam={goToExam} />;
  if (currentView === 'exam') return <ExamPrepHub onBack={goToWelcome} apiKey={localStorage.getItem('openai_key')} isAdmin={isAdminMode} onToggleAdmin={handleAdminToggle} />;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans flex flex-col">
      <header className={`text-white shadow-md z-20 sticky top-0 transition-colors ${isAdminMode ? 'bg-slate-800' : 'bg-emerald-700'}`}>
        <div className="w-full px-4 py-3 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
             <button onClick={goToWelcome} className="p-1 hover:bg-white/20 rounded-full transition"><ArrowLeft className="w-5 h-5"/></button>
             <BookOpen className="w-6 h-6" />
             <h1 className="text-xl font-bold notranslate" translate="no">{isAdminMode ? "Modo Admin" : "Lamadrasa"}</h1>
          </div>
          <div className="flex-1 w-full max-w-4xl flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-white/50" />
              <input type="text" placeholder="Buscar..." className="w-full pl-9 pr-4 py-2 bg-black/20 border border-white/10 rounded-lg focus:outline-none text-sm text-white placeholder-white/60" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <div className="relative md:w-64">
                <Filter className="absolute left-3 top-2.5 w-4 h-4 text-white/50 pointer-events-none" />
                <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="w-full pl-9 pr-8 py-2 bg-black/20 border border-white/10 rounded-lg text-sm text-white appearance-none cursor-pointer">
                    {categories.map(cat => <option key={cat} value={cat} className="text-slate-800 bg-white">{cat}</option>)}
                </select>
            </div>
            <div className="flex gap-2">
                <button onClick={() => setIsGamesHubOpen(true)} className="p-2 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white transition-colors shadow-lg" title="Juegos"><Gamepad2 className="w-6 h-6" /></button>
                <div className="flex items-center gap-2 bg-black/20 rounded-lg p-1 border border-white/10">
                    <button onClick={() => setFrontLanguage('spanish')} className={`px-2 py-1.5 rounded-md text-xs font-bold ${frontLanguage === 'spanish' ? 'bg-white text-slate-800' : 'text-white/70'}`}>ES</button>
                    <button onClick={() => setFrontLanguage('arabic')} className={`px-2 py-1.5 rounded-md text-xs font-bold ${frontLanguage === 'arabic' ? 'bg-white text-slate-800' : 'text-white/70'}`}>AR</button>
                    <button onClick={() => setShowDiacritics(!showDiacritics)} className={`px-2 py-1.5 rounded-md text-xs font-bold ${showDiacritics ? 'bg-white text-slate-800' : 'text-white/70'}`}><Baseline className="w-3.5 h-3.5" /></button>
                </div>
                <button onClick={handleAdminToggle} className={`p-2 rounded-lg transition-colors ${isAdminMode ? 'bg-red-500' : 'bg-black/20 text-white/70'}`}>{isAdminMode ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}</button>
            </div>
          </div>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto bg-slate-100 p-4 md:p-8">
          <div className="max-w-6xl mx-auto">
            {isAdminMode && (
              <div className="mb-6 flex flex-wrap justify-center gap-4 animate-fade-in-up">
                <button onClick={() => { setEditingCard(null); setIsFormOpen(true); }} className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-full shadow-lg font-bold"><Plus className="w-5 h-5" /> Añadir</button>
                <button onClick={() => setIsSmartImportOpen(true)} className="flex items-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-full shadow-lg font-bold"><Wand2 className="w-5 h-5" /> Importar</button>
                <button onClick={() => setIsMaintenanceOpen(true)} className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-full shadow-lg font-bold"><Settings className="w-5 h-5" /> Mantenimiento BD</button>
              </div>
            )}
            {loading ? (
               <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3"><Loader className="w-8 h-8 animate-spin text-emerald-600" /><span className="font-medium animate-pulse">Cargando datos...</span></div>
            ) : filteredCards.length === 0 ? (
              <div className="text-center py-20 text-slate-400">No hay tarjetas para esta selección.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredCards.map(card => <Flashcard key={card.id} data={card} frontLanguage={frontLanguage} showDiacritics={showDiacritics} isAdmin={isAdminMode} onDelete={() => handleDeleteCard(card.id)} onEdit={() => { setEditingCard(card); setIsFormOpen(true); }} />)}
              </div>
            )}
            {!loading && <div className="mt-8 text-center text-[10px] text-slate-300 font-mono">Total Tarjetas: {cards.length}</div>}
          </div>
      </div>
      {isFormOpen && <CardFormModal card={editingCard} categories={categories.filter(c => c !== "Todos")} onSave={handleSaveCard} onClose={() => setIsFormOpen(false)} />}
      {isSmartImportOpen && <SmartImportModal onClose={() => setIsSmartImportOpen(false)} onImport={handleBulkImport} />}
      {isMaintenanceOpen && <AdvancedMaintenanceModal onClose={() => setIsMaintenanceOpen(false)} cards={cards} setCards={setCards} refreshCards={fetchAllCards} />}
      {isGamesHubOpen && <GamesHub onClose={() => setIsGamesHubOpen(false)} cards={cards} showDiacritics={showDiacritics} />}
    </div>
  );
}

// --- TUTOR IA (EXAMEN 1A2) ---
// --- TUTOR IA (EXAMEN 1A2) ---
function ExamPrepHub({ onBack, apiKey, isAdmin, onToggleAdmin }) {
    const [examApiKey, setExamApiKey] = useState(() => apiKey || localStorage.getItem('openai_key') || '');
    const [activeTab, setActiveTab] = useState('test');
    const [knowledge, setKnowledge] = useState([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0, text: "" });
    const [textInput, setTextInput] = useState("");
    const [priorityNotes, setPriorityNotes] = useState("");
    const [test, setTest] = useState(null);
    const [examOptions, setExamOptions] = useState(() => safeGetStorage('exam_1a2_options', { count: 10, mode: 'mixto', difficulty: 'examen' }));
    const [answered, setAnswered] = useState({});
    const [localHistory, setLocalHistory] = useState(() => safeGetStorage(EXAM_LOCAL_HISTORY_KEY, []));

    useEffect(() => { setSafeStorage('exam_1a2_options', examOptions); }, [examOptions]);

    // Cargar base de datos al inicio
    useEffect(() => {
        async function fetchKnowledge() { const { data } = await supabase.from('exam_knowledge').select('*'); if (data) setKnowledge(data); }
        fetchKnowledge();
    }, []);

    useEffect(() => {
        if (!isAdmin && activeTab === 'knowledge') setActiveTab('test');
        if (isAdmin) setActiveTab('knowledge');
    }, [isAdmin]);

    // 1. Procesar Texto Libre
    const handleProcessMaterial = async () => {
        if (!textInput.trim()) return;
        if (!examApiKey) { alert("API Key OpenAI requerida."); return; }
        setIsProcessing(true);
        setProgress({ current: 1, total: 1, text: "Analizando texto escrito..." });
        try {
            const openai = new OpenAI({ apiKey: examApiKey, dangerouslyAllowBrowser: true });
            const priorityBlock = priorityNotes.trim()
                ? `
NOTAS DE PRIORIDAD DEL ADMINISTRADOR:
${priorityNotes.trim()}
`
                : "";
            const prompt = `Actúa como profesor de Árabe nivel A2 de EOI.
Analiza este material y extrae SOLO información útil para examen que esté literalmente apoyada en el texto.
Prioriza y conserva frases árabe-español / español-árabe, vocabulario y verbos en presente.
Incluye una sección llamada "FRASES BASE PARA EXAMEN" con pares de traducción cuando existan.
Si hay NOTAS DE PRIORIDAD DEL ADMINISTRADOR, incorpóralas literalmente en una sección "PRIORIDAD PARA EXAMEN" y marca esas frases, temas o documentos como preferentes.
No inventes frases ni tiempos verbales que no aparezcan o no puedan deducirse directamente del material.
${priorityBlock}
MATERIAL:
${textInput}`;
            const res = await openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0.1 });
            const storedContent = `${priorityNotes.trim() ? `PRIORIDAD PARA EXAMEN:
${priorityNotes.trim()}

` : ''}${res.choices[0].message.content}`;
            const { data } = await supabase.from('exam_knowledge').insert([{ category: priorityNotes.trim() ? 'Material EOI · PRIORITARIO' : 'Material EOI', content: storedContent }]).select();
            if (data) { setKnowledge([...knowledge, data[0]]); setTextInput(""); setPriorityNotes(""); alert("¡Material procesado y memorizado!"); }
        } catch (e) { alert("Error: " + e.message); } finally { setIsProcessing(false); setProgress({ current: 0, total: 0, text: "" }); }
    };

    // 2. Procesar Archivos Subidos MÚLTIPLES (PDFs nativos + PDFs escaneados con visión)
    const handleKnowledgeFile = async (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        if (!examApiKey) {
            alert("API Key OpenAI requerida para procesar PDFs e imágenes.");
            e.target.value = null;
            return;
        }

        setIsProcessing(true);
        let processedCount = 0;
        let skippedCount = 0;
        let lastDiagnostic = "";

        try {
            const openai = new OpenAI({ apiKey: examApiKey, dangerouslyAllowBrowser: true });

            for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
                const file = files[fileIndex];
                const currentFile = fileIndex + 1;
                const fileLabel = `${currentFile}/${files.length}: ${file.name}`;

                if (file.type.includes('pdf') || file.name.toLowerCase().endsWith('.pdf')) {
                    setProgress({ current: 0, total: 0, text: `Abriendo PDF ${fileLabel}...` });
                    const ab = await file.arrayBuffer();
                    const pdf = await pdfjsLib.getDocument({ data: ab }).promise;

                    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
                        const page = await pdf.getPage(pageNumber);
                        const category = `PDF: ${file.name} (Pág ${pageNumber})`;
                        setProgress({ current: pageNumber, total: pdf.numPages, text: `Leyendo página ${pageNumber} de ${pdf.numPages} (${file.name})...` });

                        let pageText = await extractTextFromPdfPage(page);

                        // Si el PDF es escaneado o basado en imágenes, la extracción nativa sale vacía:
                        // entonces renderizamos la página a alta resolución y usamos visión/OCR.
                        if (pageText.length < PDF_TEXT_MIN_CHARS) {
                            setProgress({ current: pageNumber, total: pdf.numPages, text: `OCR visual en página ${pageNumber} de ${pdf.numPages} (${file.name})...` });
                            const imageDataUrl = await renderPdfPageToDataUrl(page);
                            const visionResult = await transcribeImageWithOpenAI(openai, imageDataUrl, `página ${pageNumber} del PDF ${file.name}`);
                            pageText = visionResult.content;
                            lastDiagnostic = visionResult.notes || visionResult.content || "Sin texto devuelto por visión.";
                        }

                        page.cleanup?.();

                        if (pageText && pageText.length >= 10) {
                            const summarized = await summarizeMaterialWithOpenAI(openai, pageText, category, priorityNotes);
                            const { data, error } = await supabase
                                .from('exam_knowledge')
                                .insert([{ category: priorityNotes.trim() ? `${category} · PRIORITARIO` : category, content: `${priorityNotes.trim() ? `PRIORIDAD PARA EXAMEN:
${priorityNotes.trim()}

` : ''}${summarized}` }])
                                .select();
                            if (error) throw error;
                            if (data) {
                                setKnowledge(prev => [...prev, data[0]]);
                                processedCount++;
                            }
                        } else {
                            skippedCount++;
                            lastDiagnostic = lastDiagnostic || `Página ${pageNumber}: no se detectó texto legible.`;
                        }
                    }
                } else if (file.type.startsWith('image/')) {
                    setProgress({ current: 1, total: 1, text: `Analizando imagen ${fileLabel}...` });
                    const imageDataUrl = await fileToDataUrl(file);
                    const visionResult = await transcribeImageWithOpenAI(openai, imageDataUrl, `imagen ${file.name}`);
                    lastDiagnostic = visionResult.notes || visionResult.content || "Sin texto devuelto por visión.";

                    if (visionResult.hasText && visionResult.content.length >= 10) {
                        const category = `Foto: ${file.name}`;
                        const summarized = await summarizeMaterialWithOpenAI(openai, visionResult.content, category, priorityNotes);
                        const { data, error } = await supabase
                            .from('exam_knowledge')
                            .insert([{ category: priorityNotes.trim() ? `${category} · PRIORITARIO` : category, content: `${priorityNotes.trim() ? `PRIORIDAD PARA EXAMEN:
${priorityNotes.trim()}

` : ''}${summarized}` }])
                            .select();
                        if (error) throw error;
                        if (data) {
                            setKnowledge(prev => [...prev, data[0]]);
                            processedCount++;
                        }
                    } else {
                        skippedCount++;
                    }
                } else {
                    skippedCount++;
                    lastDiagnostic = `Formato no soportado: ${file.name}`;
                }
            }

            if (processedCount > 0) {
                alert(`Proceso completado. Bloques guardados: ${processedCount}.${skippedCount ? ` Páginas/archivos omitidos: ${skippedCount}.` : ""}`);
            } else {
                alert(`No se guardó ningún bloque. Diagnóstico: ${lastDiagnostic || "no se detectó texto legible en los archivos."}`);
            }
        } catch (err) {
            console.error("Detalle del error al procesar archivos:", err);
            alert("Error procesando archivos: " + (err?.message || err));
        } finally {
            setIsProcessing(false);
            setProgress({ current: 0, total: 0, text: "" });
            e.target.value = null;
        }
    };

    // 3. Generador de Simulacro
    const handleGenerateTest = async () => {
        if (knowledge.length === 0) { alert("Sube material en Conocimiento primero."); return; }
        setIsProcessing(true);
        setAnswered({});
        const desiredCount = Number(examOptions.count) || 10;
        const mode = examOptions.mode || 'mixto';
        const recentQuestionHints = getRecentQuestionHints();
        try {
            if (!examApiKey) {
                if (mode === 'gramatica') {
                    throw new Error('El modo Gramática necesita API Key para crear ejercicios de estructuras A2 a partir del material subido.');
                }
                const localTest = adaptLocalTestToMode(buildLocalTranslationTest(knowledge, mode === 'auditivo' ? desiredCount * 2 : desiredCount), examOptions.mode).slice(0, desiredCount);
                if (localTest.length < desiredCount) {
                    throw new Error(`No hay API Key y no he podido detectar al menos ${desiredCount} frases completas árabe-español con distractores de longitud parecida. El administrador debe subir material con frases bilingües o añadir la API Key para generar preguntas con IA.`);
                }
                rememberRecentExamQuestions(localTest);
                setTest(localTest);
                return;
            }

            const prioritizedKnowledge = knowledge.filter(k => /prioritario|prioridad|importante|examen/i.test(`${k.category || ''}\n${k.content || ''}`));
            const regularKnowledge = knowledge.filter(k => !prioritizedKnowledge.includes(k));
            const context = [...shuffleArray(prioritizedKnowledge), ...shuffleArray(regularKnowledge)]
                .map(k => `FUENTE: ${k.category || 'Material subido'}\n${k.content}`)
                .join("\n\n---\n\n")
                .slice(0, 45000);
            const openai = new OpenAI({ apiKey: examApiKey, dangerouslyAllowBrowser: true });
            const candidateCount = Math.max(32, desiredCount * 4);
            const modeRules = mode === 'gramatica'
                ? `MODO GRAMÁTICA:
- Genera SOLO preguntas de tipo "gramatica".
- No hagas traducciones directas.
- Pregunta por estructuras A2 del material: presente, negación, pronombres personales, pronombres sufijados, demostrativos, posesión, concordancia, género/número, anexión y partículas de lugar.
- Usa formatos como completar hueco, elegir la forma correcta, detectar la frase correcta o elegir la explicación gramatical correcta.
- Alterna formatos: hueco, forma correcta, error a detectar, concordancia, elección de partícula y transformación breve.
- Las 4 opciones deben tener el mismo tipo y el mismo idioma entre sí.
- Si hay un hueco con pronombres sufijados, demostrativos o formas de persona, la pregunta DEBE incluir la pista completa en español: significado objetivo, persona, género y número. Ejemplo válido: "Completa 'tu libro' dirigido a un hombre: كِتَابُ...". Ejemplo inválido: "Completa: كِتَابُ...".
- Nunca generes preguntas donde varias opciones sean gramaticalmente correctas por falta de contexto.
- La explicación debe indicar la regla o patrón del material.`
                : mode === 'auditivo'
                  ? `MODO AUDITIVO:
- Genera SOLO preguntas de tipo "audio".
- En "pregunta" escribe SOLO una frase árabe completa del material, sin "Traduce..." ni texto introductorio.
- Las 4 opciones deben ser traducciones completas en español.
- El usuario escuchará la frase árabe y elegirá la traducción correcta.
- Varía longitud, tema y fuente de las frases árabes.`
                  : mode === 'traduccion'
                    ? `MODO TRADUCCIÓN:
- Genera SOLO preguntas de tipo "traduccion".
- Mezcla árabe→español y español→árabe.
- Cada pregunta debe pedir traducir una frase completa del material.
- Varía el enunciado: "Traduce...", "¿Qué significa...?", "¿Cómo se dice...?", "Elige la frase...".`
                    : `MODO MIXTO:
- Mezcla preguntas de tipo "traduccion", "audio" y "gramatica".
- Aproximadamente un tercio de cada tipo si el material lo permite.
- Traducción practica frases completas; audio usa frase árabe escuchable; gramática pregunta por estructuras A2.
- Evita bloques monótonos: alterna tipo, dirección, tema y fuente.`;
            const formatExample = mode === 'gramatica'
                ? `{
  "preguntas": [
    {
      "tipo": "gramatica",
      "direccion": "GRAM → AR",
      "pregunta": "Completa con el pronombre sufijado correcto: كِتَابُ...",
      "opciones": ["كَ", "كِ", "هُ", "هَا"],
      "correcta": 0,
      "explicacion": "Se usa كَ para 'tu' masculino en anexión.",
      "fuente": "..."
    }
  ]
}`
                : `{
  "preguntas": [
    {
      "tipo": "${mode === 'auditivo' ? 'audio' : 'traduccion'}",
      "direccion": "ar-es",
      "pregunta": "${mode === 'auditivo' ? 'أَسْكُنُ فِي مَدْرِيد' : 'Traduce al español: أَسْكُنُ فِي مَدْرِيد'}",
      "opciones": ["Vivo en Madrid", "Estudio en Madrid", "Voy a Madrid", "Trabajo en Madrid"],
      "correcta": 0,
      "explicacion": "Frase del material: أَسْكُنُ فِي مَدْرِيد",
      "fuente": "..."
    }
  ]
}`;
            const prompt = `Eres profesor de Árabe nivel A2 de EOI.
Actúa como profesor/a de árabe estándar moderno para estudiantes de nivel inicial A1-A2.
Tu tarea es crear preguntas de simulacro y frases con sentido usando el vocabulario y estructuras de la base de conocimiento subida por el usuario.
Configuración del simulacro:
- Número final de preguntas: ${desiredCount}
- Modo: ${examOptions.mode}
- Dificultad: ${examOptions.difficulty}
- Preguntas recientes a evitar: ${recentQuestionHints.length ? recentQuestionHints.join(' | ') : 'ninguna'}

${modeRules}

REGLAS BASE PARA CREAR FRASES Y RESPUESTAS:
1. Usa exclusivamente o principalmente el vocabulario facilitado en la base de conocimiento.
2. Crea frases naturales, sencillas y útiles para un examen de nivel inicial.
3. Usa siempre verbos en presente cuando uses verbos.
4. No uses pasado, futuro, condicional ni imperativo.
5. No inventes vocabulario difícil si no es necesario.
6. Mantén estructuras gramaticales simples.
7. Las frases deben tener sentido real, no ser combinaciones aleatorias de palabras.
8. Usa frases breves: entre 4 y 9 palabras aproximadamente.
9. Incluye variedad de frases afirmativas, negativas e interrogativas.
10. Usa, cuando sea posible: demostrativos هذا، هذه، ذلك، تلك; pronombres personales; posesivos sencillos; nombres comunes; adjetivos básicos; lugares y objetos cotidianos.
11. Escribe el árabe con signos diacríticos cuando sea útil para estudiantes principiantes.
12. Evita la nunación/tanwin salvo excepciones fijas que siempre la usan, como شكرًا، عفوًا، أيضًا، جدًا، طبعًا، دائمًا، أحيانًا، مرحبًا، أهلًا، صباحًا، مساءً.
13. Añade siempre traducción al español cuando la respuesta correcta esté en español o cuando la explicación lo necesite.
14. No incluyas explicaciones largas.
15. No generes frases absurdas o artificiales.

REGLAS TÉCNICAS DEL TEST:
1. Crea ${candidateCount} preguntas candidatas dentro de la propiedad "preguntas"; la aplicación mostrará las ${desiredCount} mejores válidas.
2. Todas las preguntas deben nacer del vocabulario, frases o estructuras del material subido. Puedes crear frases nuevas si usan ese vocabulario de forma natural.
3. En traducción y audio, usa frases completas, nunca palabras sueltas. En gramática, puedes usar huecos o formas cortas si sirven para evaluar la estructura.
4. Si aparece "PRIORIDAD PARA EXAMEN" o notas como "muy importante" / "saldrá en examen", usa ese material PRIMERO (8 preguntas candidatas mínimo).
5. Prioriza verbos en presente salvo que el material de clase pida expresamente otra estructura A2.
6. Evita repetir preguntas recientes, frases base recientes y respuestas correctas recientes cuando haya material alternativo suficiente.
7. Varía fuentes, temas y estructuras: no concentres todo el simulacro en la misma página, lista o ejemplo.
8. Sé creativo dentro del material: usa frases de casa, familia, trabajo, ciudad, nacionalidad, edad, ubicación y clase si aparecen; combina preguntas largas y cortas; no uses siempre el mismo sujeto ni el mismo verbo.
9. Ordena las candidatas de forma variada: no agrupes todas las árabe→español primero ni todas las gramaticales juntas.
10. DIRECCIÓN COHERENTE:
   - Para "direccion": "ar-es", la pregunta debe ser una frase en ÁRABE y las 4 opciones deben estar en ESPAÑOL.
   - Para "direccion": "es-ar", la pregunta debe ser una frase en ESPAÑOL y las 4 opciones deben estar en ÁRABE.
   - Para "direccion": "GRAM → AR" o "GRAM → ES", aplica solo a preguntas de gramática.
11. El texto de "pregunta" puede usar fórmulas variadas: "Traduce...", "¿Qué significa...?", "¿Cómo se dice...?", "Elige la frase...".
   Excepción: tipo "audio" y tipo "gramatica" no deben empezar por "Traduce".
12. Incluye exactamente 4 opciones por pregunta. Solo 1 opción es correcta.
13. REGLA DE IDIOMA ESTRICTA:
   - Pregunta en español → TODAS las 4 opciones en árabe (1 correcta, 3 falsas).
   - Pregunta en árabe → TODAS las 4 opciones en español (1 correcta, 3 falsas).
   - Pregunta auditiva → frase árabe como base y TODAS las 4 opciones en español.
   - Pregunta gramatical → las 4 opciones deben estar en el mismo idioma entre sí.
14. REGLA DE LONGITUD ESTRICTA PARA LAS 4 RESPUESTAS (±50%):
   - Mide cada opción en caracteres.
   - Opción correcta = referencia (X caracteres).
   - Opciones falsas deben estar entre X*0.5 y X*1.5 caracteres.
   - Si una opción no cumple, reemplázala por otra frase del material de longitud similar.
15. Opciones incorrectas deben ser verosímiles (del material A2), no absurdas.
15b. Solo puede haber una respuesta correcta. Si dos opciones son gramaticalmente posibles, añade más contexto a la pregunta o descarta esa pregunta.
16. Las opciones también deben ser frases, no sustantivos aislados, lecciones, etiquetas, números ni títulos.
17. No incluyas etiquetas ni metadatos en preguntas u opciones: elimina "Ejemplo:", "Fonética:", transcripciones latinas entre paréntesis y números de lección.
18. Explicación breve: cita la frase o vocabulario base del material cuando exista, formato: "Base del material: [cita o vocabulario]".
19. Si creas una frase nueva con vocabulario del material, marca: "[Frase creada con vocabulario del material: palabras base]".
20. JSON únicamente, sin texto extra.

Formato obligatorio:
${formatExample}

BASE DE CONOCIMIENTO:
${context}`;
            const res = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.45,
                response_format: { type: "json_object" }
            });
            const raw = res.choices?.[0]?.message?.content || "";
            const parsed = parseGeneratedQuestions(raw);
            const allValid = parsed
                .map((question, index) => normalizeGeneratedQuestion(question, index, examOptions.mode))
                .filter(q => q && q.pregunta && Array.isArray(q.opciones) && q.opciones.length === 4 && q.correcta >= 0);
            const freshValid = allValid.filter(q => !recentQuestionHints.includes(getQuestionFingerprint(q)));
            const selectedFresh = diversifyExamQuestions(freshValid, desiredCount);
            const fallbackPool = allValid.filter(q => !selectedFresh.some(selected => getQuestionFingerprint(selected) === getQuestionFingerprint(q)));
            const selectedQuestions = selectedFresh.length >= desiredCount
                ? selectedFresh
                : [...selectedFresh, ...diversifyExamQuestions(fallbackPool, desiredCount - selectedFresh.length)];
            if (selectedQuestions.length === 0) {
                console.error('Respuesta IA sin preguntas utilizables:', raw);
                throw new Error('No se pudo generar ninguna pregunta válida. Prueba con otro modo o revisa que haya vocabulario suficiente en el material.');
            }
            rememberRecentExamQuestions(selectedQuestions);
            setTest(selectedQuestions);
        } catch (e) { alert("Error: " + e.message); } finally { setIsProcessing(false); }
    };

    const handleAnswerQuestion = (questionIndex, optionIndex) => {
        if (!test?.[questionIndex] || answered[questionIndex]) return;
        const question = test[questionIndex];
        const isCorrect = optionIndex === question.correcta;
        setAnswered(prev => ({ ...prev, [questionIndex]: { optionIndex, isCorrect } }));
        const nextHistory = addLocalExamHistoryEntry(buildExamHistoryEntry(question, optionIndex, isCorrect));
        setLocalHistory(nextHistory);
    };

    const clearLocalHistory = () => {
        setSafeStorage(EXAM_LOCAL_HISTORY_KEY, []);
        setLocalHistory([]);
    };

    const mistakes = localHistory.filter(item => !item.isCorrect);
    const answeredValues = Object.values(answered);
    const correctCount = answeredValues.filter(item => item.isCorrect).length;

    // 4. Ejercicio de escritura a mano: frase en español -> respuesta en árabe


    return (
        <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
            <header className="bg-indigo-700 text-white p-4 shadow flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button onClick={onBack} className="p-2 bg-indigo-800 rounded-full hover:bg-indigo-600 transition"><ArrowLeft size={20}/></button>
                    <h1 className="text-xl font-bold">Tutor IA - EOI 1A2</h1>
                </div>
                {/* CANDADO AÑADIDO A LA PANTALLA */}
                <button onClick={onToggleAdmin} className={`p-2 rounded-lg transition-colors shadow-sm ${isAdmin ? 'bg-red-500 hover:bg-red-600' : 'bg-indigo-800 text-white/70 hover:bg-indigo-600'}`}>
                    {isAdmin ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                </button>
            </header>
            
            <div className="bg-white border-b flex overflow-x-auto">
                {isAdmin && <button onClick={() => setActiveTab('knowledge')} className={`flex items-center gap-2 px-6 py-4 font-bold ${activeTab === 'knowledge' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400 hover:bg-slate-50'}`}><Database className="w-5 h-5"/> Admin · Conocimiento</button>}
                <button onClick={() => setActiveTab('test')} className={`flex items-center gap-2 px-6 py-4 font-bold ${activeTab === 'test' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400 hover:bg-slate-50'}`}><Activity className="w-5 h-5"/> 1. Simulacro</button>

            </div>
            
            <div className="flex-1 p-6 max-w-4xl mx-auto w-full">
                
                {/* PESTAÑA 1: CONOCIMIENTO */}
                {activeTab === 'knowledge' && isAdmin && (
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 animate-fade-in-up">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold text-indigo-800">Alimentar a la IA</h2>
                            {!isAdmin && <span className="bg-red-100 text-red-600 text-xs font-bold px-3 py-1 rounded-full uppercase flex items-center gap-1"><Lock className="w-3 h-3"/> Bloqueado</span>}
                        </div>
                        
                        {isAdmin ? (
                            <>
                                <div className="mb-4 bg-indigo-50 border border-indigo-100 rounded-xl p-3">
                                    <label className="block text-xs font-bold text-indigo-800 uppercase mb-2">OpenAI API Key</label>
                                    <input
                                        type="password"
                                        placeholder="sk-..."
                                        className="w-full p-2 border border-indigo-200 rounded-lg text-xs bg-white"
                                        value={examApiKey}
                                        onChange={(event) => {
                                            setExamApiKey(event.target.value);
                                            localStorage.setItem('openai_key', event.target.value);
                                        }}
                                        disabled={isProcessing}
                                    />
                                </div>
                                <p className="text-sm text-slate-500 mb-4">Sube fotos de la pizarra o PDFs escaneados. La IA leerá primero el texto nativo del PDF y, si la página está basada en imagen, aplicará OCR visual con alta resolución.</p>

                                <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3">
                                    <label className="block text-xs font-bold text-amber-800 uppercase mb-2">Comentarios de prioridad para este material</label>
                                    <textarea
                                        className="w-full h-20 p-3 border border-amber-200 rounded-lg text-sm bg-white"
                                        placeholder={'Ej.: esto es muy importante; esto saldrá en el examen; priorizar demostrativos; practicar frases en presente...'}
                                        value={priorityNotes}
                                        onChange={(event) => setPriorityNotes(event.target.value)}
                                        disabled={isProcessing}
                                    />
                                    <p className="text-[11px] text-amber-700 mt-2">Estas notas se guardan dentro del bloque y el simulacro las usa para priorizar unos documentos, frases o temas por encima de otros.</p>
                                </div>
                                
                                {/* ZONA DE CARGA CON BARRA DE PROGRESO */}
                                <div className="mb-4">
                                    {isProcessing ? (
                                        <div className="bg-indigo-50 border-2 border-indigo-200 rounded-xl p-6 text-center animate-pulse">
                                            <Loader className="w-8 h-8 mx-auto mb-3 animate-spin text-indigo-600"/>
                                            <p className="text-sm font-bold text-indigo-800 mb-2">{progress.text || "Procesando..."}</p>
                                            {progress.total > 0 && (
                                                <div className="w-full bg-indigo-200 rounded-full h-2.5 mt-3 overflow-hidden">
                                                    <div className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${(progress.current / progress.total) * 100}%` }}></div>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <label className="block w-full cursor-pointer bg-slate-50 hover:bg-indigo-50 border-2 border-dashed border-indigo-200 text-indigo-500 rounded-xl p-6 text-center transition-colors">
                                            <input type="file" accept=".pdf,image/*" multiple className="hidden" onChange={handleKnowledgeFile} />
                                            <Upload className="w-8 h-8 mx-auto mb-2 opacity-80 text-indigo-600"/>
                                            <span className="text-sm font-bold block">Haz clic aquí para seleccionar uno o VARIOS archivos</span>
                                        </label>
                                    )}
                                </div>

                                <textarea className="w-full h-32 p-3 border border-slate-300 rounded-xl mb-4 text-sm font-mono" placeholder="...O si tienes texto puro, pégalo aquí." value={textInput} onChange={(e) => setTextInput(e.target.value)} disabled={isProcessing} />
                                
                                <button onClick={handleProcessMaterial} disabled={isProcessing || !textInput} className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 flex justify-center items-center gap-2">
                                    {isProcessing ? <Loader className="animate-spin w-5 h-5"/> : <><Sparkles className="w-5 h-5"/> Extraer Texto y Memorizar</>}
                                </button>
                            </>
                        ) : (
                            <div className="bg-slate-50 border border-slate-200 p-8 rounded-xl text-center text-slate-500">
                                <Lock className="w-12 h-12 mx-auto mb-3 opacity-20" />
                                <h3 className="font-bold text-lg mb-2 text-slate-700">Modo Estudiante</h3>
                                <p className="text-sm">Solo el Administrador puede subir nuevo material de estudio.<br/>Usa el candado de la esquina superior derecha para desbloquear esta función.</p>
                            </div>
                        )}
                        
                        <div className="mt-6 pt-4 border-t border-slate-100 flex justify-between">
                            <span className="text-xs font-bold uppercase text-slate-400">Datos memorizados: {knowledge.length} bloques.</span>
                        </div>
                    </div>
                )}
                
                {/* PESTAÑA 2: SIMULACRO */}
                {activeTab === 'test' && (
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 animate-fade-in-up flex flex-col h-full">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Preguntas</label>
                                <select value={examOptions.count} onChange={(e) => setExamOptions(prev => ({ ...prev, count: Number(e.target.value) }))} className="w-full p-3 border border-slate-200 rounded-xl bg-white font-bold text-slate-700">
                                    <option value={5}>5 rápidas</option>
                                    <option value={10}>10 estándar</option>
                                    <option value={20}>20 intensivo</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Modo</label>
                                <select value={examOptions.mode} onChange={(e) => setExamOptions(prev => ({ ...prev, mode: e.target.value }))} className="w-full p-3 border border-slate-200 rounded-xl bg-white font-bold text-slate-700">
                                    <option value="mixto">Mixto 1A2</option>
                                    <option value="traduccion">Traducción</option>
                                    <option value="auditivo">Auditivo</option>
                                    <option value="gramatica">Gramática</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Dificultad</label>
                                <select value={examOptions.difficulty} onChange={(e) => setExamOptions(prev => ({ ...prev, difficulty: e.target.value }))} className="w-full p-3 border border-slate-200 rounded-xl bg-white font-bold text-slate-700">
                                    <option value="normal">Normal</option>
                                    <option value="examen">Examen</option>
                                    <option value="repaso_errores">Repaso de errores</option>
                                </select>
                            </div>
                        </div>
                        <button onClick={handleGenerateTest} disabled={isProcessing || knowledge.length === 0} className="w-full py-4 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-50 flex justify-center items-center gap-2 text-lg mb-3 shadow-md">{isProcessing ? <Loader className="animate-spin w-6 h-6"/> : <><PlayCircle className="w-6 h-6"/> Generar simulacro del material subido</>}</button>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3">
                                <p className="text-xs font-bold text-indigo-500 uppercase">Sesión actual</p>
                                <p className="text-lg font-black text-indigo-800">{answeredValues.length}{test ? `/${test.length}` : ''} respondidas</p>
                            </div>
                            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                                <p className="text-xs font-bold text-emerald-500 uppercase">Aciertos</p>
                                <p className="text-lg font-black text-emerald-800">{correctCount}</p>
                            </div>
                            <div className="bg-rose-50 border border-rose-100 rounded-xl p-3 flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-xs font-bold text-rose-500 uppercase">Errores locales</p>
                                    <p className="text-lg font-black text-rose-800">{mistakes.length}</p>
                                </div>
                                {localHistory.length > 0 && <button onClick={clearLocalHistory} className="text-xs font-bold text-rose-700 bg-white border border-rose-200 px-3 py-2 rounded-lg hover:bg-rose-100">Vaciar</button>}
                            </div>
                        </div>
                        <div className="flex-1 bg-slate-50 p-4 rounded-xl border border-slate-200">
                            {!test ? <div className="text-center text-slate-400 py-10">Genera un test para empezar.</div> : (
                                <div className="space-y-6">{test.map((q, i) => {
                                    const questionBody = q.audioText || getQuestionBody(q.pregunta);
                                    const questionIsArabic = /[؀-ۿ]/.test(questionBody);
                                    const answerState = answered[i];
                                    return (
                                    <div key={i} className="bg-white p-4 rounded-lg shadow-sm border border-indigo-100">
                                        <div className="flex items-start justify-between gap-3 mb-3">
                                            <div className="flex-1">
                                              <p className="font-bold text-slate-800">
                                                {i+1}. {q.tipo === 'audio' ? (
                                                  <><span>Escucha la frase y elige la traducción correcta: </span><button type="button" onClick={() => playSmartAudio(q.audioText || questionBody)} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-100 text-orange-800 hover:bg-orange-200 text-xs font-bold"><Volume2 className="w-4 h-4" /> Escuchar</button></>
                                                ) : questionIsArabic ? (
                                                  <>{q.pregunta.replace(questionBody, '').trim()} <ArabicTextWithAudio text={questionBody} className="font-arabic text-lg text-indigo-900" buttonClassName="align-middle" /></>
                                                ) : q.pregunta}
                                              </p>
                                            </div>
                                            <span className="shrink-0 text-[10px] uppercase font-bold px-2 py-1 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100">{q.tipo === 'audio' ? 'AUDIO' : q.tipo === 'gramatica' ? 'GRAM' : q.direccion === 'es-ar' ? 'ES → AR' : 'AR → ES'}</span>
                                        </div>
                                        <div className="grid grid-cols-1 gap-2">{q.opciones.map((op, idx) => {
                                            const optionIsArabic = /[؀-ۿ]/.test(op);
                                            const isChosen = answerState?.optionIndex === idx;
                                            const isCorrectOption = idx === q.correcta;
                                            let stateClass = "border-slate-200 hover:bg-indigo-50 hover:border-indigo-300";
                                            if (answerState && isCorrectOption) stateClass = "border-emerald-400 bg-emerald-50 text-emerald-900";
                                            if (answerState && isChosen && !isCorrectOption) stateClass = "border-rose-400 bg-rose-50 text-rose-900";
                                            return (
                                                <button key={idx} disabled={!!answerState} onClick={() => handleAnswerQuestion(i, idx)} className={`flex items-center gap-3 p-3 border rounded text-sm font-medium transition ${stateClass} ${answerState ? 'cursor-default' : 'cursor-pointer'} ${optionIsArabic ? 'font-arabic text-lg text-right justify-between' : 'text-left'}`} dir={optionIsArabic ? 'rtl' : 'ltr'}>
                                                    {optionIsArabic ? <ArabicTextWithAudio text={op} className="flex-1 justify-between" /> : <span className="flex-1">{op}</span>}
                                                </button>
                                            );
                                        })}</div>
                                        {answerState && (
                                            <div className={`mt-3 p-3 rounded-lg text-sm border ${answerState.isCorrect ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-rose-50 border-rose-100 text-rose-800'}`}>
                                                <p className="font-bold">{answerState.isCorrect ? 'Correcto' : 'Incorrecto'}</p>
                                                <p>{q.explicacion || 'Respuesta basada en el material subido.'}</p>
                                            </div>
                                        )}
                                    </div>
                                    );
                                })}</div>
                            )}
                        </div>
                        {mistakes.length > 0 && (
                            <div className="mt-4 bg-white border border-rose-100 rounded-xl p-4">
                                <h3 className="font-bold text-rose-800 mb-3">Errores guardados en este navegador</h3>
                                <div className="space-y-2 max-h-56 overflow-y-auto">
                                    {mistakes.slice(0, 8).map((item, index) => (
                                        <div key={`${item.id}-${item.date}-${index}`} className="text-sm bg-rose-50 border border-rose-100 rounded-lg p-3">
                                            <p className="font-bold text-slate-800">{item.pregunta}</p>
                                            <p className="text-rose-700">Tu respuesta: {item.selected}</p>
                                            <p className="text-emerald-700">Correcta: {item.correct}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
                

            </div>
        </div>
    );
}
// (DEJA AQUÍ DEBAJO EL RESTO DE TUS FUNCIONES: AdvancedMaintenanceModal, TableEditor, etc... QUE YA TENÍAS)

// --- PANEL DE MANTENIMIENTO AVANZADO ---
function AdvancedMaintenanceModal({ onClose, cards, setCards, refreshCards }) {
  const [activeTab, setActiveTab] = useState('table'); 
  return (
    <div className="fixed inset-0 bg-slate-100 z-50 flex flex-col">
        <header className="bg-slate-900 text-white shadow-md z-20"><div className="w-full px-6 py-4 flex justify-between items-center"><h1 className="text-xl font-bold flex items-center gap-2"><Settings className="w-6 h-6 text-blue-400"/> Mantenimiento BD</h1><button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full transition-colors"><X className="w-6 h-6"/></button></div><div className="flex px-6 overflow-x-auto border-t border-slate-800"><button onClick={() => setActiveTab('table')} className={`flex items-center gap-2 px-6 py-3 font-bold text-sm border-b-2 transition-colors ${activeTab === 'table' ? 'border-blue-400 text-blue-400' : 'border-transparent text-slate-400'}`}><Database className="w-4 h-4"/> Editor Rápido</button><button onClick={() => setActiveTab('duplicates')} className={`flex items-center gap-2 px-6 py-3 font-bold text-sm border-b-2 transition-colors ${activeTab === 'duplicates' ? 'border-amber-400 text-amber-400' : 'border-transparent text-slate-400'}`}><Copy className="w-4 h-4"/> Duplicados</button><button onClick={() => setActiveTab('audit')} className={`flex items-center gap-2 px-6 py-3 font-bold text-sm border-b-2 transition-colors ${activeTab === 'audit' ? 'border-purple-400 text-purple-400' : 'border-transparent text-slate-400'}`}><Sparkles className="w-4 h-4"/> Auditoría IA</button></div></header>
        <main className="flex-1 overflow-hidden p-4">
            {activeTab === 'table' && <TableEditor cards={cards} setCards={setCards} />}
            {activeTab === 'duplicates' && <DuplicateFinder cards={cards} setCards={setCards} />}
            {activeTab === 'audit' && <AIAuditor cards={cards} setCards={setCards} refreshCards={refreshCards} />}
        </main>
    </div>
  );
}

function TableEditor({ cards, setCards }) {
    const [searchTerm, setSearchTerm] = useState(""); const [currentPage, setCurrentPage] = useState(1); const itemsPerPage = 100; const [editingId, setEditingId] = useState(null); const [editForm, setEditForm] = useState({});
    const filteredCards = useMemo(() => { const term = normalizeForSearch(searchTerm); if (!term) return cards; return cards.filter(c => (c.spanish || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(term) || (c.arabic || "").includes(term)); }, [cards, searchTerm]);
    const totalPages = Math.ceil(filteredCards.length / itemsPerPage); const displayedCards = useMemo(() => filteredCards.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage), [filteredCards, currentPage]);
    const saveEdit = async () => { try { const { error } = await supabase.from('flashcards').update({ category: editForm.category, spanish: editForm.spanish, arabic: editForm.arabic, phonetic: editForm.phonetic }).eq('id', editingId); if (error) throw error; setCards(prev => prev.map(c => c.id === editingId ? editForm : c)); setEditingId(null); } catch (e) { alert(e.message); } };
    const deleteCard = async (id) => { if (!confirm("¿Borrar definitivamente?")) return; try { const { error } = await supabase.from('flashcards').delete().eq('id', id); if (error) throw error; setCards(prev => prev.filter(c => c.id !== id)); } catch (e) { alert(e.message); } };
    return (
        <div className="flex flex-col h-full bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden max-w-6xl mx-auto"><div className="p-4 bg-slate-50 flex flex-col md:flex-row justify-between items-center border-b gap-4"><div className="relative w-full md:max-w-sm"><Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" /><input type="text" placeholder="Buscar para editar..." className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm" value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} /></div><div className="flex gap-2 items-center text-sm font-bold text-slate-500"><button onClick={()=>setCurrentPage(p=>Math.max(1,p-1))} disabled={currentPage===1} className="p-2 bg-slate-200 rounded hover:bg-slate-300 disabled:opacity-50"><ChevronLeft className="w-4 h-4"/></button>Página {currentPage} de {totalPages || 1}<button onClick={()=>setCurrentPage(p=>Math.min(totalPages,p+1))} disabled={currentPage===totalPages||totalPages===0} className="p-2 bg-slate-200 rounded hover:bg-slate-300 disabled:opacity-50"><ChevronRight className="w-4 h-4"/></button></div></div><div className="flex-1 overflow-auto"><table className="w-full text-left text-sm border-collapse"><thead className="bg-slate-100 text-slate-600 sticky top-0 shadow-sm z-10"><tr><th className="p-3 w-16 text-center">ID</th><th className="p-3 w-1/6">Categoría</th><th className="p-3 w-1/4">Español</th><th className="p-3 w-1/4 text-right">Árabe</th><th className="p-3 w-1/6">Fonética</th><th className="p-3 text-center">Acciones</th></tr></thead><tbody className="divide-y divide-slate-100">{displayedCards.map(c => { const isEd = editingId === c.id; return (<tr key={c.id} className={isEd ? "bg-blue-50" : "hover:bg-slate-50"}><td className="p-3 text-xs text-slate-400 text-center">{c.id}</td>{isEd ? (<><td className="p-2"><input className="w-full p-2 border rounded text-xs" value={editForm.category} onChange={e=>setEditForm({...editForm, category: e.target.value})}/></td><td className="p-2"><input className="w-full p-2 border rounded text-xs" value={editForm.spanish} onChange={e=>setEditForm({...editForm, spanish: e.target.value})}/></td><td className="p-2"><input className="w-full p-2 border rounded text-xs text-right font-arabic" dir="rtl" value={editForm.arabic} onChange={e=>setEditForm({...editForm, arabic: e.target.value})}/></td><td className="p-2"><input className="w-full p-2 border rounded text-xs font-mono" value={editForm.phonetic} onChange={e=>setEditForm({...editForm, phonetic: e.target.value})}/></td><td className="p-2 flex justify-center gap-1"><button onClick={saveEdit} className="p-2 bg-green-500 text-white rounded shadow hover:bg-green-600"><Check className="w-4 h-4"/></button><button onClick={()=>setEditingId(null)} className="p-2 bg-slate-300 text-slate-700 rounded shadow hover:bg-slate-400"><X className="w-4 h-4"/></button></td></>) : (<><td className="p-3"><span className="bg-slate-200 text-slate-700 px-2 py-1 rounded text-[10px] font-bold uppercase">{c.category}</span></td><td className="p-3 font-medium">{c.spanish}</td><td className="p-3 text-right font-arabic text-lg text-blue-700 font-bold" dir="rtl">{c.arabic}</td><td className="p-3 text-xs font-mono text-slate-500">{c.phonetic}</td><td className="p-3 flex justify-center gap-2"><button onClick={()=>{setEditingId(c.id); setEditForm({...c});}} className="text-blue-500 bg-blue-50 p-2 rounded hover:bg-blue-100"><Edit2 className="w-4 h-4"/></button><button onClick={()=>deleteCard(c.id)} className="text-red-500 bg-red-50 p-2 rounded hover:bg-red-100"><Trash2 className="w-4 h-4"/></button></td></>)}</tr>); })}</tbody></table></div></div>
    );
}

function DuplicateFinder({ cards, setCards }) {
    const duplicateGroups = useMemo(() => { const groups = {}; cards.forEach(c => { if (!c.arabic) return; const key = c.arabic.trim(); if (!groups[key]) groups[key] = []; groups[key].push(c); }); return Object.values(groups).filter(g => g.length > 1); }, [cards]);
    const deleteDuplicate = async (id) => { try { const { error } = await supabase.from('flashcards').delete().eq('id', id); if (error) throw error; setCards(prev => prev.filter(c => c.id !== id)); } catch (e) { alert(e.message); } };
    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto w-full"><div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-6 flex gap-4 shadow-sm"><AlertTriangle className="w-8 h-8 text-amber-500 flex-shrink-0" /><div><h2 className="font-bold text-amber-800 text-lg">Buscador de Duplicados</h2><p className="text-amber-700 text-sm mt-1">Busca coincidencias exactas en árabe.</p></div></div><div className="flex-1 overflow-y-auto space-y-6 pb-20">{duplicateGroups.length === 0 ? (<div className="text-center py-20 text-slate-400"><CheckCircle className="w-16 h-16 mx-auto mb-4 opacity-50 text-emerald-500"/><h3 className="text-xl font-bold">¡Todo limpio!</h3></div>) : ( duplicateGroups.map((group, idx) => ( <div key={idx} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden"><div className="bg-slate-800 px-6 py-3 flex justify-between items-center text-white"><span className="font-bold text-sm bg-slate-700 px-3 py-1 rounded-full">Grupo #{idx+1}</span><span className="font-arabic text-2xl text-amber-400 font-bold" dir="rtl">{group[0].arabic}</span></div><div className="divide-y divide-slate-100">{group.map((card, i) => ( <div key={card.id} className={`p-4 flex items-center justify-between ${i === 0 ? 'bg-emerald-50/50' : 'hover:bg-slate-50'}`}><div className="flex flex-col"><span className="font-bold text-slate-800">{card.spanish}</span><span className="text-xs text-slate-500">ID: {card.id} | Cat: {card.category}</span></div><div className="flex items-center gap-3">{i === 0 && <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-1 rounded">Conservar este</span>}<button onClick={() => deleteDuplicate(card.id)} className="p-2 text-red-600 bg-red-100 hover:bg-red-600 hover:text-white rounded transition-colors font-bold text-sm flex items-center gap-2"><Trash2 className="w-4 h-4"/> Borrar</button></div></div> ))}</div></div> )))}</div></div>
    );
}

function AIAuditor({ cards, setCards, refreshCards }) {
    const [apiKey, setApiKey] = useState(localStorage.getItem('openai_key') || ""); const [loading, setLoading] = useState(false); const [logs, setLogs] = useState([]); const [auditResults, setAuditResults] = useState([]);
    const handleAudit = async () => {
        if (!apiKey) { alert("Necesitas tu API Key de OpenAI"); return; }
        setLoading(true); setAuditResults([]); setLogs(["Conectando con IA..."]);
        try {
            const openai = new OpenAI({ apiKey: apiKey, dangerouslyAllowBrowser: true });
            let allIssues = []; const cardsToAudit = cards.slice(0, 150); 
            for (let i = 0; i < cardsToAudit.length; i += 15) {
                const batch = cardsToAudit.slice(i, i + 15);
                setLogs(prev => [`Analizando lote ${Math.floor(i/15)+1}...`, ...prev.slice(0,4)]);
                const miniBatch = batch.map(c => ({ id: c.id, arabic: c.arabic, spanish: c.spanish }));
                const prompt = `Audita este lote. REGLAS: 1. Elimina tanwin/nunación innecesaria en el árabe. 2. Mantén solo excepciones fijas que siempre la usan, como شكرًا، عفوًا، أيضًا، جدًا، طبعًا، دائمًا، أحيانًا، مرحبًا، أهلًا، صباحًا، مساءً. 3. Corrige mala traducción al español. IGNORA SI ESTÁ BIEN. Responde SOLO con JSON array: [{"id": 123, "problem": "motivo", "suggestion": "texto corregido", "field": "arabic" o "spanish"}]. DATOS: ${JSON.stringify(miniBatch)}`;
                const response = await openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0.1 });
                let rawContent = response.choices[0].message.content; const start = rawContent.indexOf('['); const end = rawContent.lastIndexOf(']');
                if (start !== -1 && end !== -1) { try { const batchIssues = JSON.parse(rawContent.substring(start, end + 1)); const validIssues = batchIssues.filter(issue => { const card = batch.find(c => c.id === issue.id); if(!card) return false; const targetField = issue.field || (/[؀-ۿ]/.test(issue.suggestion) ? 'arabic' : 'spanish'); return card[targetField] !== issue.suggestion; }); allIssues = [...allIssues, ...validIssues]; } catch(e) {} }
            }
            setAuditResults(allIssues); setLogs(prev => [`✅ Auditoría terminada. ${allIssues.length} sugerencias.`, ...prev]);
        } catch (e) { setLogs(prev => [`❌ Error: ${e.message}`, ...prev]); } finally { setLoading(false); }
    };
    const applyFix = async (issue) => { try { const updateData = {}; const targetField = issue.field || (/[؀-ۿ]/.test(issue.suggestion) ? 'arabic' : 'spanish'); updateData[targetField] = issue.suggestion; await supabase.from('flashcards').update(updateData).eq('id', issue.id); setAuditResults(prev => prev.filter(p => p.id !== issue.id)); setCards(prev => prev.map(c => c.id === issue.id ? { ...c, ...updateData } : c)); } catch (e) { alert("Error: " + e.message); } };
    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto w-full"><div className="bg-purple-50 border border-purple-200 rounded-xl p-6 mb-6 shadow-sm"><div className="flex gap-4 items-end"><div className="flex-1"><label className="block text-xs font-bold text-purple-800 uppercase mb-2">OpenAI API Key</label><input type="password" placeholder="sk-..." className="w-full p-3 border rounded-lg" value={apiKey} onChange={(e) => { setApiKey(e.target.value); localStorage.setItem('openai_key', e.target.value); }} /></div><button onClick={handleAudit} disabled={loading || !apiKey} className="px-8 py-3 bg-purple-600 text-white rounded-lg font-bold hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2">{loading ? <Loader className="animate-spin" /> : "Auditar"}</button></div>{logs.length > 0 && <div className="mt-4 bg-slate-900 text-green-400 font-mono text-xs p-4 rounded-lg h-24 overflow-y-auto">{logs.map((l, i) => <div key={i}>{l}</div>)}</div>}</div><div className="flex-1 overflow-y-auto space-y-4 pb-20">{auditResults.map(issue => { const original = cards.find(c => c.id === issue.id); if (!original) return null; const fieldToFix = issue.field || (/[؀-ۿ]/.test(issue.suggestion) ? 'arabic' : 'spanish'); const isArabic = fieldToFix === 'arabic'; const originalText = isArabic ? original.arabic : original.spanish; return ( <div key={issue.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200"><div className="flex justify-between items-center mb-4"><span className="text-xs font-mono font-bold text-slate-600 bg-slate-100 px-3 py-1 rounded-full">ID: {original.id} | Corrigiendo: {fieldToFix.toUpperCase()}</span></div><div className="grid grid-cols-2 gap-6 mb-4"><div className="bg-red-50 p-4 rounded text-center border border-red-100 flex flex-col justify-center"><p className="text-xs text-red-500 font-bold mb-3 uppercase">Original</p><p className={`${isArabic ? 'font-arabic text-2xl' : 'text-xl font-bold text-slate-700'}`} dir={isArabic ? "rtl" : "ltr"}>{originalText || "(vacío)"}</p></div><div className="bg-green-50 p-4 rounded text-center border border-green-200 flex flex-col justify-center"><p className="text-xs text-green-600 font-bold mb-3 uppercase">Sugerencia IA</p><p className={`${isArabic ? 'font-arabic text-2xl' : 'text-xl font-bold'} text-green-800`} dir={isArabic ? "rtl" : "ltr"}>{issue.suggestion}</p><p className="text-xs text-green-700 mt-3 italic bg-green-100 px-2 py-1 rounded inline-block self-center">{issue.problem}</p></div></div><button onClick={() => applyFix(issue)} className="w-full bg-green-600 text-white py-3 rounded-lg font-bold flex justify-center items-center gap-2 hover:bg-green-700 transition-colors"><Check className="w-5 h-5"/> Aplicar Corrección</button></div> ); })}{!loading && logs.length > 0 && auditResults.length === 0 && <div className="text-center text-slate-500 py-10 font-bold">¡Auditoría finalizada! Todo correcto.</div>}</div></div>
    );
}

// --- HUB DE JUEGOS ---
function GamesHub({ onClose, cards, showDiacritics }) {
  const [activeGame, setActiveGame] = useState('menu'); 
  if (activeGame === 'quiz') return <QuizGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} showDiacritics={showDiacritics} />;
  if (activeGame === 'memory') return <MemoryGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} showDiacritics={showDiacritics} />;
  if (activeGame === 'truefalse') return <TrueFalseGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} showDiacritics={showDiacritics} />;
  if (activeGame === 'connect') return <ConnectGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} showDiacritics={showDiacritics} />;
  if (activeGame === 'listening') return <ListeningGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} showDiacritics={showDiacritics} />;
  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4"><div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col relative"><div className="bg-slate-800 p-6 text-white flex justify-between items-center"><div className="flex items-center gap-3"><Gamepad2 className="w-8 h-8 text-yellow-400" /><h2 className="font-bold text-2xl">Arcade</h2></div><button onClick={onClose} className="hover:bg-slate-700 p-2 rounded-full transition"><X className="w-6 h-6" /></button></div><div className="p-8 bg-slate-100 grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto max-h-[70vh]"><button onClick={() => setActiveGame('quiz')} className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl transition-all text-left border border-slate-200 group"><div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center mb-4 text-2xl group-hover:bg-indigo-600 group-hover:text-white transition-colors"><HelpCircle className="w-7 h-7" /></div><h3 className="text-xl font-bold text-slate-800 mb-2">Quiz Express</h3><p className="text-sm text-slate-500">¿Eres rápido? Elige la traducción.</p></button><button onClick={() => setActiveGame('memory')} className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl transition-all text-left border border-slate-200 group"><div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center mb-4 text-2xl group-hover:bg-emerald-600 group-hover:text-white transition-colors"><Grid className="w-7 h-7" /></div><h3 className="text-xl font-bold text-slate-800 mb-2">Memoria</h3><p className="text-sm text-slate-500">Encuentra las parejas.</p></button><button onClick={() => setActiveGame('truefalse')} className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl transition-all text-left border border-slate-200 group"><div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center mb-4 text-2xl group-hover:bg-rose-600 group-hover:text-white transition-colors"><Activity className="w-7 h-7" /></div><h3 className="text-xl font-bold text-slate-800 mb-2">Velocidad</h3><p className="text-sm text-slate-500">Verdadero o Falso. Tienes 3, 5 o 10 segundos.</p></button><button onClick={() => setActiveGame('connect')} className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl transition-all text-left border border-slate-200 group"><div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center mb-4 text-2xl group-hover:bg-amber-600 group-hover:text-white transition-colors"><Edit2 className="w-7 h-7" /></div><h3 className="text-xl font-bold text-slate-800 mb-2">Conecta</h3><p className="text-sm text-slate-500">Une las parejas.</p></button><button onClick={() => setActiveGame('listening')} className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl transition-all text-left border border-slate-200 md:col-span-2 group"><div className="w-12 h-12 bg-cyan-100 text-cyan-600 rounded-xl flex items-center justify-center mb-4 text-2xl group-hover:bg-cyan-600 group-hover:text-white transition-colors"><Mic className="w-7 h-7" /></div><h3 className="text-xl font-bold text-slate-800 mb-2">Oído Fino</h3><p className="text-sm text-slate-500">Escucha la palabra en árabe y elige su significado.</p></button></div></div></div>
  );
}

function ListeningGame({ onBack, onClose, cards, showDiacritics }) {
  const [round, setRound] = useState(null); const [score, setScore] = useState(0); const [highScore, setHighScore] = useState(() => safeGetStorage('listen_highscore', 0)); const [selectedOption, setSelectedOption] = useState(null);
  useEffect(() => { startNewRound(); }, []);
  const startNewRound = () => { if (cards.length < 4) return; const correctCard = cards[Math.floor(Math.random() * cards.length)]; const targetType = getCardType(correctCard); let candidates = cards.filter(c => c.id !== correctCard.id && getCardType(c) === targetType); if (candidates.length < 3) candidates = cards.filter(c => c.id !== correctCard.id); const distractors = shuffleArray(candidates).slice(0, 3); setRound({ card: correctCard, options: shuffleArray([correctCard, ...distractors]) }); setSelectedOption(null); setTimeout(() => playSmartAudio(correctCard.arabic), 500); };
  const handleOptionClick = (option) => { if (selectedOption) return; setSelectedOption(option); if (option.id === round.card.id) { setScore(s => { const newScore = s + 1; if (newScore > highScore) { setHighScore(newScore); localStorage.setItem('listen_highscore', newScore.toString()); } return newScore; }); setTimeout(startNewRound, 1000); } else { setScore(0); setTimeout(startNewRound, 2000); } };
  if (!round) return <div className="fixed inset-0 bg-black/90 flex items-center justify-center text-white">Cargando...</div>;
  return ( <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4"><div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col relative"><div className="bg-cyan-600 p-4 text-white flex justify-between items-center"><div className="flex items-center gap-2"><button onClick={onBack} className="hover:bg-cyan-500 p-1 rounded mr-2"><ArrowLeft className="w-5 h-5"/></button><h2 className="font-bold text-lg">Oído Fino</h2></div><button onClick={onClose} className="hover:bg-cyan-500 p-1 rounded"><X className="w-6 h-6" /></button></div><div className="flex justify-between px-6 py-3 bg-cyan-50 border-b border-cyan-100"><div className="flex flex-col items-center"><span className="text-xs font-bold text-cyan-400 uppercase">Racha</span><span className="text-xl font-black text-cyan-700">{score}</span></div><div className="flex flex-col items-center"><span className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1"><Trophy className="w-3 h-3"/> Récord</span><span className="text-xl font-black text-slate-600">{highScore}</span></div></div><div className="p-8 text-center bg-slate-50 flex flex-col items-center justify-center min-h-[180px]">{selectedOption ? ( <div className="animate-fade-in-up"><span className="text-xs font-bold text-slate-400 uppercase mb-2 block">Es...</span><h3 className="text-3xl font-black font-arabic text-slate-800 mb-2" dir="rtl">{showDiacritics ? round.card.arabic : removeArabicDiacritics(round.card.arabic)}</h3></div> ) : <button onClick={() => playSmartAudio(round.card.arabic)} className="w-24 h-24 rounded-full bg-cyan-100 text-cyan-600 flex items-center justify-center hover:scale-110 transition-all shadow-lg border-4 border-white"><Volume2 className="w-12 h-12" /></button>}</div><div className="p-6 grid grid-cols-1 gap-3 bg-white">{round.options.map((option) => ( <button key={option.id} disabled={!!selectedOption} onClick={() => handleOptionClick(option)} className={`p-4 rounded-xl border-2 text-lg font-bold ${selectedOption ? (option.id === round.card.id ? "bg-green-100 border-green-500 text-green-800" : option.id === selectedOption.id ? "bg-red-100 border-red-500 text-red-800" : "opacity-40") : "hover:bg-cyan-50 border-slate-200"}`}>{option.spanish}</button> ))}</div></div></div> );
}

function ConnectGame({ onBack, onClose, cards, showDiacritics }) {
  const [items, setItems] = useState([]); const [selected, setSelected] = useState([]); const [matched, setMatched] = useState([]);
  useEffect(() => { startNewRound(); }, []);
  const startNewRound = () => { if (cards.length < 4) return; const pool = shuffleArray([...cards]).slice(0, 4); const newItems = []; pool.forEach(card => { newItems.push({ id: card.id + '-es', cardId: card.id, text: card.spanish, type: 'es' }); newItems.push({ id: card.id + '-ar', cardId: card.id, text: card.arabic, type: 'ar' }); }); setItems(shuffleArray(newItems)); setMatched([]); setSelected([]); };
  const handleClick = (item) => { if (matched.includes(item.id) || selected.find(s => s.id === item.id)) return; if (item.type === 'ar') playSmartAudio(item.text); const newSelected = [...selected, item]; setSelected(newSelected); if (newSelected.length === 2) { if (newSelected[0].cardId === newSelected[1].cardId) { setMatched([...matched, newSelected[0].id, newSelected[1].id]); setSelected([]); if (matched.length + 2 === 8) setTimeout(startNewRound, 1500); } else { setTimeout(() => setSelected([]), 800); } } };
  return ( <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4"><div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col relative h-[600px]"><div className="bg-amber-600 p-4 text-white flex justify-between items-center"><div className="flex items-center gap-2"><button onClick={onBack} className="hover:bg-amber-500 p-1 rounded mr-2"><ArrowLeft className="w-5 h-5"/></button><h2 className="font-bold text-lg">Conecta</h2></div><button onClick={onClose}><X/></button></div><div className="flex-1 p-4 grid grid-cols-2 gap-3 overflow-y-auto content-center">{items.map(item => { const isSelected = selected.find(s => s.id === item.id); const isMatched = matched.includes(item.id); if (isMatched) return <div key={item.id} className="opacity-0"></div>; let bgClass = isSelected ? (selected.length === 2 && selected[0].cardId !== selected[1].cardId ? "bg-red-100 border-red-500 text-red-800 animate-shake" : "bg-amber-100 border-amber-500 text-amber-900") : "bg-slate-50 border-slate-200 text-slate-700"; return <button key={item.id} onClick={() => handleClick(item)} className={`p-4 rounded-xl border-2 font-bold transition-all text-sm md:text-base flex items-center justify-center min-h-[80px] shadow-sm active:scale-95 ${bgClass}`} dir={item.type === 'ar' ? 'rtl' : 'ltr'}>{item.type === 'ar' ? (showDiacritics ? item.text : removeArabicDiacritics(item.text)) : item.text}</button>; })}</div></div></div> );
}

function QuizGame({ onBack, onClose, cards, showDiacritics }) {
  const [currentRound, setCurrentRound] = useState(null); const [score, setScore] = useState(0); const [highScore, setHighScore] = useState(() => safeGetStorage('quiz_highscore', 0)); const [selectedOption, setSelectedOption] = useState(null);
  useEffect(() => { startNewRound(); }, []);
  const startNewRound = () => { if (cards.length < 4) return; const correctCard = cards[Math.floor(Math.random() * cards.length)]; const targetType = getCardType(correctCard); let candidates = cards.filter(c => c.id !== correctCard.id && getCardType(c) === targetType); if (candidates.length < 3) candidates = cards.filter(c => c.id !== correctCard.id); const distractors = shuffleArray(candidates).slice(0, 3); setCurrentRound({ question: correctCard, options: shuffleArray([correctCard, ...distractors]) }); setSelectedOption(null); }; 
  const handleOptionClick = (option) => { if (selectedOption) return; setSelectedOption(option); const correct = option.id === currentRound.question.id; if (correct) { playSmartAudio(option.arabic); const newScore = score + 1; setScore(newScore); if (newScore > highScore) { setHighScore(newScore); localStorage.setItem('quiz_highscore', newScore.toString()); } setTimeout(startNewRound, 1000); } else { setScore(0); setTimeout(startNewRound, 2500); } };
  if (!currentRound) return <div className="fixed inset-0 bg-black/90 flex items-center justify-center text-white">Cargando...</div>;
  return ( <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4"><div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col relative"><div className="bg-indigo-600 p-4 text-white flex justify-between items-center"><div className="flex items-center gap-2"><button onClick={onBack} className="hover:bg-indigo-500 p-1 rounded mr-2"><ArrowLeft className="w-5 h-5"/></button><h2 className="font-bold text-lg">Quiz</h2></div><button onClick={onClose} className="hover:bg-indigo-500 p-1 rounded"><X className="w-6 h-6" /></button></div><div className="flex justify-between px-6 py-3 bg-indigo-50 border-b border-indigo-100"><div className="flex flex-col items-center"><span className="text-xs font-bold text-indigo-400 uppercase">Racha</span><span className="text-xl font-black text-indigo-700">{score}</span></div><div className="flex flex-col items-center"><span className="text-xs font-bold text-amber-500 uppercase flex items-center gap-1"><Trophy className="w-3 h-3"/> Récord</span><span className="text-xl font-black text-amber-600">{highScore}</span></div></div><div className="p-8 text-center bg-slate-50"><span className="text-xs font-bold text-slate-400 uppercase mb-2 block">¿Cómo se dice en Árabe?</span><h3 className="text-2xl md:text-3xl font-black text-slate-800 animate-fade-in-up">{currentRound.question.spanish}</h3></div><div className="p-6 grid grid-cols-1 gap-3 bg-white">{currentRound.options.map((option) => { let btnClass = "p-4 rounded-xl border-2 text-xl font-arabic text-center transition-all duration-200 shadow-sm "; if (selectedOption) { if (option.id === currentRound.question.id) btnClass += "bg-green-100 border-green-500 text-green-800 scale-105"; else if (option.id === selectedOption.id) btnClass += "bg-red-100 border-red-500 text-red-800 opacity-60"; else btnClass += "bg-slate-50 border-slate-100 text-slate-400 opacity-40"; } else btnClass += "bg-white border-slate-200 text-slate-700 hover:border-indigo-400 hover:bg-indigo-50 hover:shadow-md cursor-pointer active:scale-95"; const textToShow = showDiacritics ? option.arabic : removeArabicDiacritics(option.arabic); return <button key={option.id} disabled={!!selectedOption} onClick={() => handleOptionClick(option)} className={btnClass} dir="rtl">{textToShow}</button>; })}</div></div></div> );
}

function MemoryGame({ onBack, onClose, cards, showDiacritics }) {
  const [gameCards, setGameCards] = useState([]); const [flipped, setFlipped] = useState([]); const [matched, setMatched] = useState([]); const [moves, setMoves] = useState(0);
  useEffect(() => { const gameType = Math.random() > 0.5 ? 'word' : 'phrase'; let pool = cards.filter(c => getCardType(c) === gameType); if (pool.length < 6) pool = cards; if (pool.length < 6) return; const selected = shuffleArray([...pool]).slice(0, 6); const deck = []; selected.forEach(p => { deck.push({ id: p.id, content: p.spanish, type: 'es', pairId: p.id }); deck.push({ id: p.id, content: p.arabic, type: 'ar', pairId: p.id }); }); setGameCards(shuffleArray(deck)); }, []);
  const handleCardClick = (index) => { if (flipped.length === 2 || flipped.includes(index) || matched.includes(gameCards[index].pairId)) return; const card = gameCards[index]; if (card.type === 'ar') playSmartAudio(card.content); const newFlipped = [...flipped, index]; setFlipped(newFlipped); if (newFlipped.length === 2) { setMoves(m => m + 1); if (gameCards[newFlipped[0]].pairId === gameCards[newFlipped[1]].pairId) { setMatched([...matched, gameCards[newFlipped[0]].pairId]); setFlipped([]); } else setTimeout(() => setFlipped([]), 1000); } };
  return ( <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4"><div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col h-[90vh] md:h-auto relative"><div className="bg-emerald-600 p-4 text-white flex justify-between items-center"><div className="flex items-center gap-2"><button onClick={onBack} className="hover:bg-emerald-500 p-1 rounded mr-2"><ArrowLeft className="w-5 h-5"/></button><h2 className="font-bold">Memoria</h2></div><button onClick={onClose} className="hover:bg-emerald-500 p-1 rounded"><X className="w-6 h-6"/></button></div><div className="bg-emerald-50 p-2 flex justify-between items-center text-sm font-bold text-emerald-800 shrink-0"><span>Movimientos: {moves}</span><span>Parejas: {matched.length} / 6</span></div><div className="p-4 bg-slate-100 flex-1 overflow-y-auto">{matched.length === 6 ? <div className="text-center py-20"><h3 className="text-3xl font-bold text-slate-800">¡Ganaste!</h3></div> : <div className="grid grid-cols-3 md:grid-cols-4 gap-3">{gameCards.map((c, i) => { const isFlipped = flipped.includes(i) || matched.includes(c.pairId); return <div key={i} onClick={() => handleCardClick(i)} className={`aspect-[3/4] bg-white rounded-xl border-2 flex items-center justify-center text-center p-2 cursor-pointer transition-all ${isFlipped ? 'border-emerald-500 bg-white' : 'bg-emerald-600 border-emerald-700'}`}>{isFlipped ? <span className={c.type === 'ar' ? 'font-arabic text-xl' : 'text-sm font-bold'}>{c.type === 'ar' && !showDiacritics ? removeArabicDiacritics(c.content) : c.content}</span> : <Grid className="text-white/30 w-8 h-8"/>}</div> })}</div>}</div></div></div> );
}

function TrueFalseGame({ onBack, onClose, cards, showDiacritics }) {
  const [round, setRound] = useState(null); const [score, setScore] = useState(0); const [timer, setTimer] = useState(0); const [gameOver, setGameOver] = useState(false); const [gameState, setGameState] = useState('menu'); const [duration, setDuration] = useState(5); const timerRef = useRef(null);
  useEffect(() => { return () => clearInterval(timerRef.current); }, []); useEffect(() => { if (timer <= 0 && gameState === 'playing') { setGameOver(true); setGameState('timeout'); } }, [timer, gameState]);
  const startGame = (d) => { setDuration(d); setScore(0); setGameOver(false); nextRound(d); };
  const nextRound = (d) => { if (cards.length < 5) return; const base = cards[Math.floor(Math.random() * cards.length)]; const isMatch = Math.random() > 0.5; let arabic = base.arabic; if (!isMatch) { let c = cards.filter(x => x.id !== base.id); arabic = c[Math.floor(Math.random() * c.length)].arabic; } setRound({ spanish: base.spanish, arabic, isMatch }); setTimer(d * 100); setGameState('playing'); playSmartAudio(arabic); clearInterval(timerRef.current); timerRef.current = setInterval(() => setTimer(t => t - 10), 100); };
  const answer = (ans) => { if (gameState !== 'playing') return; clearInterval(timerRef.current); if (ans === round.isMatch) { setScore(s => s + 1); setTimeout(() => nextRound(duration), 500); } else { setGameOver(true); setGameState('incorrect'); } };
  if (gameState === 'menu') return ( <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"><div className="bg-white rounded-2xl p-8 text-center max-w-sm w-full"><h2 className="text-2xl font-bold mb-6">Velocidad</h2><div className="flex flex-col gap-3"><button onClick={() => startGame(3)} className="p-4 bg-red-100 text-red-800 rounded-xl font-bold">Experto (3s)</button><button onClick={() => startGame(5)} className="p-4 bg-orange-100 text-orange-800 rounded-xl font-bold">Normal (5s)</button><button onClick={() => startGame(10)} className="p-4 bg-green-100 text-green-800 rounded-xl font-bold">Zen (10s)</button></div><button onClick={onClose} className="mt-6 text-slate-400">Cerrar</button></div></div> );
  if (!round) return null;
  return ( <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"><div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden relative h-[500px]"><div className="bg-rose-600 p-4 text-white flex justify-between"><button onClick={() => setGameState('menu')}><ArrowLeft/></button><h2 className="font-bold">Racha: {score}</h2><button onClick={onClose}><X/></button></div>{gameOver ? <div className="h-full flex flex-col items-center justify-center text-center p-8"><Frown className="w-16 h-16 text-rose-500 mb-4"/><h3 className="text-2xl font-bold mb-2">¡Fin!</h3><p className="mb-6">Puntuación: {score}</p><button onClick={() => startGame(duration)} className="bg-rose-600 text-white px-6 py-3 rounded-xl font-bold">Repetir</button></div> : <div className="h-full flex flex-col"><div className="h-2 bg-slate-200"><div className="h-full bg-rose-500 transition-all ease-linear" style={{width: `${(timer / (duration * 100)) * 100}%`}}/></div><div className="flex-1 flex flex-col items-center justify-center p-6 gap-6 text-center"><div><p className="text-xs font-bold text-slate-400 uppercase">ESPAÑOL</p><h3 className="text-2xl font-bold text-slate-800">{round.spanish}</h3></div><div><p className="text-xs font-bold text-slate-400 uppercase">ÁRABE</p><h3 className="text-4xl font-bold font-arabic text-rose-600" dir="rtl">{showDiacritics ? round.arabic : removeArabicDiacritics(round.arabic)}</h3></div></div><div className="grid grid-cols-2 gap-4 p-4 bg-slate-50"><button onClick={() => answer(false)} className="py-4 bg-red-100 text-red-800 rounded-xl font-bold">NO</button><button onClick={() => answer(true)} className="py-4 bg-green-100 text-green-800 rounded-xl font-bold">SÍ</button></div></div>}</div></div> );
}

// --- MODALES ---
function CardFormModal({ card, categories, onSave, onClose }) {
  const [formData, setFormData] = useState(card || { category: 'General', spanish: '', arabic: '', phonetic: '' });
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"><div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"><div className="bg-emerald-600 p-4 text-white flex justify-between items-center"><h2 className="font-bold">{card ? 'Editar' : 'Nueva'} Tarjeta</h2><button onClick={onClose}><X className="w-5 h-5"/></button></div><div className="p-6 space-y-4"><div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Categoría</label><input type="text" list="cat-list" className="w-full p-2 border rounded" value={formData.category} onChange={e=>setFormData({...formData, category: e.target.value})} /><datalist id="cat-list">{categories.map(c=><option key={c} value={c}/>)}</datalist></div><div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Español</label><input type="text" className="w-full p-2 border rounded" value={formData.spanish} onChange={e=>setFormData({...formData, spanish: e.target.value})} /></div><div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Árabe</label><input type="text" dir="rtl" className="w-full p-2 border rounded font-arabic" value={formData.arabic} onChange={e=>setFormData({...formData, arabic: e.target.value})} /></div><div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Fonética</label><input type="text" className="w-full p-2 border rounded" value={formData.phonetic} onChange={e=>setFormData({...formData, phonetic: e.target.value})} /></div><button onClick={()=>onSave(formData)} className="w-full bg-emerald-600 text-white py-3 rounded-lg font-bold hover:bg-emerald-700">Guardar</button></div></div></div>
  );
}

function SmartImportModal({ onClose, onImport }) {
  const [activeTab, setActiveTab] = useState('text'); const [text, setText] = useState(""); const [isProcessing, setIsProcessing] = useState(false); const [cameraStream, setCameraStream] = useState(null); const [apiKey, setApiKey] = useState(localStorage.getItem('openai_key') || ""); const videoRef = useRef(null);
  useEffect(() => { return () => { if (cameraStream) cameraStream.getTracks().forEach(t => t.stop()); }; }, [cameraStream]);
  const startCamera = async () => { try { const stream = await navigator.mediaDevices.getUserMedia({ video: true }); setCameraStream(stream); if (videoRef.current) videoRef.current.srcObject = stream; } catch (e) { alert("Error cámara"); } };
  const capture = () => { if (!videoRef.current) return; const canvas = document.createElement('canvas'); canvas.width = videoRef.current.videoWidth; canvas.height = videoRef.current.videoHeight; canvas.getContext('2d').drawImage(videoRef.current, 0, 0); processImage(canvas.toDataURL('image/jpeg')); };
  const processImage = async (base64) => { if (!apiKey) { alert("Requiere API Key"); return; } setIsProcessing(true); try { const openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true }); const res = await openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: [{ type: "text", text: "Extract flashcards JSON: [{category, spanish, arabic, phonetic}]" }, { type: "image_url", image_url: { url: base64 } }] }] }); onImport(JSON.parse(res.choices[0].message.content.match(/\[.*\]/s)[0])); } catch (e) { alert(e.message); } finally { setIsProcessing(false); } };
  const processText = () => { try { const lines = text.split('\n').filter(l=>l.trim()); const newCards = lines.map(line => { const parts = line.split('|'); if (parts.length >= 3) { return { category: parts[0]?.trim() || 'General', spanish: parts[1]?.trim(), arabic: parts[2]?.trim(), phonetic: parts[3]?.trim() || '' }; } return { category: 'Importado', spanish: parts[0]?.trim(), arabic: parts[1]?.trim(), phonetic: parts[2]?.trim() || '' }; }).filter(c => c.spanish && c.arabic); if (newCards.length === 0) { alert("No se encontraron líneas válidas."); return; } onImport(newCards); } catch(e) { alert("Formato incorrecto"); } };
  const handleFile = async (e) => { const file = e.target.files[0]; if (!file) return; if (file.type.includes('pdf')) { setIsProcessing(true); try { const ab = await file.arrayBuffer(); const pdf = await pdfjsLib.getDocument(ab).promise; let str = ""; for(let i=1; i<=pdf.numPages; i++) { const p = await pdf.getPage(i); const t = await p.getTextContent(); str += t.items.map(s=>s.str).join(" ") + "\n"; } setText(str); setActiveTab('text'); } catch(e) { alert("Error PDF"); } finally { setIsProcessing(false); } } else { const reader = new FileReader(); reader.onload = () => processImage(reader.result); reader.readAsDataURL(file); } };
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"><div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"><div className="bg-purple-600 p-4 text-white flex justify-between items-center"><h2 className="font-bold">Importar</h2><button onClick={onClose}><X className="w-5 h-5"/></button></div><div className="flex border-b"><button onClick={()=>setActiveTab('text')} className={`flex-1 py-3 font-bold ${activeTab==='text'?'text-purple-600 border-b-2 border-purple-600':'text-slate-400'}`}>Texto</button><button onClick={()=>setActiveTab('file')} className={`flex-1 py-3 font-bold ${activeTab==='file'?'text-purple-600 border-b-2 border-purple-600':'text-slate-400'}`}>Archivo</button><button onClick={()=>{setActiveTab('camera'); startCamera();}} className={`flex-1 py-3 font-bold ${activeTab==='camera'?'text-purple-600 border-b-2 border-purple-600':'text-slate-400'}`}>Cámara</button></div><div className="p-6 overflow-y-auto"><input type="password" placeholder="API Key (Opcional para texto, Obligatoria para img)" className="w-full p-2 mb-4 border rounded text-xs" value={apiKey} onChange={e=>{setApiKey(e.target.value); localStorage.setItem('openai_key',e.target.value)}}/>{activeTab === 'text' && ( <><textarea className="w-full h-40 p-2 border rounded text-xs font-mono" value={text} onChange={e=>setText(e.target.value)} placeholder="Categoría | Español | Árabe | Fonética"></textarea><button onClick={processText} className="w-full mt-4 bg-purple-600 text-white py-2 rounded-lg font-bold">Procesar Texto</button></> )}{activeTab === 'file' && ( <div className="border-2 border-dashed border-slate-300 rounded-lg h-40 flex flex-col items-center justify-center text-slate-400 relative"><input type="file" accept=".pdf,image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFile}/>{isProcessing ? <Loader className="animate-spin"/> : <><Upload className="mb-2"/> <p>Subir PDF o Imagen</p></>}</div> )}{activeTab === 'camera' && ( <div className="flex flex-col items-center"><div className="w-full aspect-video bg-black rounded-lg overflow-hidden mb-4 relative"><video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover"></video></div><button onClick={capture} disabled={isProcessing} className="bg-purple-600 text-white p-4 rounded-full shadow-lg hover:bg-purple-700 disabled:opacity-50">{isProcessing ? <Loader className="animate-spin w-6 h-6"/> : <Camera className="w-6 h-6"/>}</button></div> )}</div></div></div>
  );
}

function Flashcard({ data, frontLanguage, showDiacritics, isAdmin, onDelete, onEdit }) {
  const [flipState, setFlipState] = useState(0); useEffect(() => { setFlipState(0); }, [frontLanguage]);
  const handleNextFace = () => { if (!isAdmin) setFlipState((prev) => (prev + 1) % 3); };
  const playAudio = (e) => { e.stopPropagation(); playSmartAudio(data?.arabic || ""); };
  const spanishText = data?.spanish || "Sin texto"; const arabicText = data?.arabic || "Sin texto"; const phoneticText = data?.phonetic || "N/A"; const displayArabic = showDiacritics ? arabicText : removeArabicDiacritics(arabicText); const tags = data?.category ? data.category.toString().split(';').map(t => t.trim()).filter(Boolean) : ['General'];
  let content = null;
  if (isAdmin) { content = <><h3 className="text-lg font-bold text-slate-800 line-clamp-2">{spanishText}</h3><h3 className="text-2xl font-arabic text-emerald-700 mt-1" dir="rtl">{displayArabic}</h3><p className="text-sm font-mono text-amber-700 italic opacity-80">{phoneticText}</p></>; } else if (flipState === 2) { content = <><p className="text-xs uppercase text-amber-600 font-bold mb-2">Fonética</p><h3 className="text-lg font-mono text-amber-800 italic">{phoneticText}</h3></>; } else { const isFront = flipState === 0; const currentLang = isFront ? frontLanguage : (frontLanguage === 'spanish' ? 'arabic' : 'spanish'); if (currentLang === 'spanish') { content = <><p className="text-xs uppercase text-slate-400 font-bold mb-2">Español</p><h3 className="text-xl font-bold text-slate-800">{spanishText}</h3></>; } else { content = <><p className="text-xs uppercase text-emerald-600 font-bold mb-2">Árabe</p><h3 className="text-3xl font-arabic text-emerald-900 mb-4" dir="rtl">{displayArabic}</h3><button onClick={playAudio} className="p-2 bg-emerald-200 text-emerald-800 rounded-full hover:bg-emerald-300 transition-colors"><Volume2 className="w-4 h-4"/></button></>; } }
  let bgClass = "bg-white border-slate-200 text-slate-800"; if (!isAdmin) { if (flipState === 0) bgClass = "bg-orange-50 border-orange-100 text-slate-800"; if (flipState === 1) bgClass = "bg-emerald-50 border-emerald-200 text-emerald-900"; if (flipState === 2) bgClass = "bg-amber-100 border-amber-200 text-amber-900"; }
  return ( <div onClick={handleNextFace} className={`relative h-60 w-full rounded-2xl shadow-sm hover:shadow-lg transition-all border flex flex-col p-4 text-center select-none group cursor-pointer ${bgClass}`}>{isAdmin && ( <div className="absolute top-2 right-2 flex gap-2 z-10" onClick={(e) => e.stopPropagation()}><button onClick={() => onEdit()} className="p-2 bg-blue-100 text-blue-600 rounded-full hover:bg-blue-200 transition-colors"><Edit2 className="w-4 h-4" /></button><button onClick={() => onDelete()} className="p-2 bg-red-100 text-red-600 rounded-full hover:bg-red-200 transition-colors"><Trash2 className="w-4 h-4" /></button></div> )}<div className="flex-1 flex flex-col items-center justify-center w-full gap-2 mt-4">{content}</div><div className="mt-auto pt-2 pb-1 flex flex-wrap gap-1 justify-center max-h-12 overflow-hidden">{tags.map((tag, i) => (<span key={i} className="text-[10px] uppercase font-bold tracking-widest bg-black/5 px-2 py-0.5 rounded-full text-slate-500 opacity-70 whitespace-nowrap">{tag}</span>))}</div></div> );
}
