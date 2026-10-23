import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from './supabaseClient';
import { FAMILIAS_A2, getCardFamilias } from './constants/familias';
import { CLASES_PALABRA } from './constants/clases';
import { normalizarArabe } from '../supabase/functions/_shared/arabe.js';
import { useAdminSession } from './useAdminSession';
import AdminLoginForm from './AdminLoginForm';
import { 
  Search, Volume2, BookOpen, X, Check, ArrowLeft, ArrowRight,
  PlayCircle, Settings, Filter, Plus, Trash2, Edit2, Lock, Unlock, 
  Image as ImageIcon, Wand2, Loader, Trophy, Frown, CheckCircle, 
  HelpCircle, Grid, Activity, Mic, Camera, Upload, Gamepad2, Baseline, 
  AlertTriangle, ChevronLeft, ChevronRight, Sparkles, Database, Copy, PartyPopper
} from 'lucide-react';

// Llama a una Edge Function de Supabase (importar/auditar/sugerir-familias).
// supabase.functions.invoke adjunta automáticamente el JWT de la sesión admin
// y la apikey; la autorización real (email == ADMIN_EMAIL) la hace la función.
async function callEdgeFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // El cuerpo de error de la función ({ error }) viene en context cuando es no-2xx.
    let detalle = error.message || 'Error desconocido';
    try {
      const ctx = error.context;
      if (ctx && typeof ctx.json === 'function') {
        const payload = await ctx.json();
        if (payload?.error) detalle = payload.error;
      }
    } catch { /* se mantiene el mensaje genérico */ }
    throw new Error(detalle);
  }
  return data;
}

let _pdfjsModulePromise = null;
async function loadPdfjs() {
  if (!_pdfjsModulePromise) {
    _pdfjsModulePromise = import('pdfjs-dist').then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.mjs`;
      return pdfjsLib;
    });
  }
  return _pdfjsModulePromise;
}

// --- UTILIDADES ---
const removeArabicDiacritics = (text) => text ? text.replace(/[\u064B-\u065F\u0670]/g, '') : "";
const normalizeForSearch = (text) => text ? text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u064B-\u065F\u0670]/g, "") : ""; 
const shuffleArray = (array) => { const newArray = [...array]; for (let i = newArray.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [newArray[i], newArray[j]] = [newArray[j], newArray[i]]; } return newArray; };
const safeGetStorage = (key, fallback) => { try { const saved = localStorage.getItem(key); return saved ? JSON.parse(saved) : fallback; } catch (e) { return fallback; } };
// Deriva el tipo ('word' | 'phrase') de una tarjeta. Prioriza la columna `tipo`;
// si está vacía (tarjetas antiguas sin clasificar), recurre a la heurística.
const getCardType = (card) => {
  if (!card) return 'word';
  if (card.tipo === 'frase') return 'phrase';
  if (card.tipo === 'palabra') return 'word';
  if (card.category && card.category.toLowerCase().includes('frases')) return 'phrase';
  return (card.spanish || "").trim().split(/\s+/).length > 2 ? 'phrase' : 'word';
};
// Opción "sin clase" en los selectores de clase de palabra.
const CLASE_NINGUNA = '— sin clase —';
const playSmartAudio = (text) => { if (!text) return; try { window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'ar-SA'; utterance.rate = 0.7; const voices = window.speechSynthesis.getVoices(); const preferredVoice = voices.find(v => v.lang.includes('ar')); if (preferredVoice) utterance.voice = preferredVoice; window.speechSynthesis.speak(utterance); } catch (e) { console.error("Audio error", e); } };
const APP_VIEWS = new Set(['welcome', 'flashcards']);
// Valor especial del filtro (solo admin) para ver tarjetas con confianza baja.
const PENDIENTES_REVISAR = '⚠ Pendientes de revisar';
const getViewFromHash = () => {
  const hashView = window.location.hash.replace(/^#\/?/, '');
  return APP_VIEWS.has(hashView) ? hashView : '';
};

function DeveloperCredit({ dark = false }) {
  return (
    <p className={`text-center text-xs ${dark ? 'text-white/50' : 'text-slate-400'}`}>
      Desarrollado por{' '}
      <a
        href="https://samirarte.com/samirarte-digital/"
        target="_blank"
        rel="noreferrer"
        className={`font-semibold transition-colors ${dark ? 'text-emerald-200 hover:text-white' : 'text-emerald-700 hover:text-emerald-500'}`}
      >
        Samirarte Digital
      </a>
    </p>
  );
}

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

// --- PANTALLA DE BIENVENIDA ---
function WelcomeScreen({ onStartFlashcards }) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-emerald-50 flex items-center justify-center p-4 relative overflow-hidden notranslate" translate="no">
        <div className="absolute top-10 left-10 text-emerald-500 opacity-10 animate-bounce"><BookOpen size={80} /></div>
        <div className="absolute bottom-20 left-20 text-amber-500 opacity-10"><Volume2 size={60} /></div>
        <div className="absolute top-20 right-10 text-blue-500 opacity-10 animate-pulse"><PlayCircle size={100} /></div>
        <div className="absolute bottom-10 right-20 text-purple-500 opacity-10"><ImageIcon size={70} /></div>

        <div className="bg-white/80 backdrop-blur-md p-8 md:p-12 rounded-3xl shadow-2xl text-center max-w-md w-full z-10 border border-white relative">
            <div className="absolute -top-4 -right-4 bg-yellow-400 text-yellow-900 text-xs font-bold px-3 py-1 rounded-full rotate-12 shadow-md animate-pulse flex items-center gap-1">
                <PartyPopper size={14}/> EOI A2 Ready!
            </div>
            <div className="w-32 h-32 bg-white rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-200 ring-8 ring-emerald-50">
                <img src="/lamadrasa-mark.svg" alt="Logotipo de La Madrasa" className="w-full h-full" />
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
                <button onClick={() => setIsHelpOpen(true)} className="w-full bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-bold py-3 px-6 rounded-2xl shadow-sm transition-all active:scale-95 flex items-center justify-center gap-3">
                    <HelpCircle size={20} /> Ayuda de uso
                </button>
            </div>
            <div className="mt-8">
              <DeveloperCredit />
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
                  <p>Sirve para estudiar las tarjetas una a una. Puedes buscar por texto, filtrar por familia temática y cambiar qué idioma aparece primero. Al pulsar una tarjeta cambia de cara: español, árabe y fonética.</p>
                </div>
                <div>
                  <p className="font-bold text-slate-800">Iconos y controles del vocabulario</p>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                    <p className="flex gap-2"><Search className="w-4 h-4 shrink-0 text-emerald-700" /> <span><b>Buscar:</b> localiza tarjetas por español o árabe.</span></p>
                    <p className="flex gap-2"><Filter className="w-4 h-4 shrink-0 text-emerald-700" /> <span><b>Filtro:</b> muestra solo una familia temática.</span></p>
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
                  <p className="font-bold text-slate-800">Familias temáticas</p>
                  <p>Cada tarjeta pertenece a una o varias familias de vocabulario de nivel A2 (Familia y Relaciones, Casa y Vivienda, Comida y Bebida, etc.). Usa el filtro para repasar una familia concreta.</p>
                </div>
                <div>
                  <p className="font-bold text-slate-800">Modo administrador</p>
                  <p>Permite añadir e importar tarjetas, asignarles familias y revisar la base de datos.</p>
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
  const [selectedFamilia, setSelectedFamilia] = useState("Todas");
  const [selectedTipo, setSelectedTipo] = useState("Todos"); // 'Todos' | 'palabra' | 'frase'
  const [selectedClase, setSelectedClase] = useState("Todas"); // 'Todas' | una de las 9 clases
  const [frontLanguage, setFrontLanguage] = useState(() => localStorage.getItem('pref_lang') || "spanish");
  const [showDiacritics, setShowDiacritics] = useState(() => safeGetStorage('pref_diacritics', true));
  const { isAdminMode, loading: authLoading, error: authError, signIn, signOut, clearError } = useAdminSession();
  const [isLoginOpen, setIsLoginOpen] = useState(false);
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
  const goToWelcome = () => {
    if (currentView === 'welcome') return;
    navigateTo('welcome', { replace: true });
  };
  
  const handleAdminToggle = () => {
    if (isAdminMode) { signOut(); }
    else { clearError(); setIsLoginOpen(true); }
  };

  // Cerrar el formulario de login automáticamente cuando la sesión se activa.
  useEffect(() => { if (isAdminMode) setIsLoginOpen(false); }, [isAdminMode]);

  // Si se sale del modo admin con el filtro "Pendientes de revisar" activo,
  // volver a "Todas" para no dejar un filtro no disponible seleccionado.
  useEffect(() => {
    if (!isAdminMode && selectedFamilia === PENDIENTES_REVISAR) setSelectedFamilia('Todas');
  }, [isAdminMode, selectedFamilia]);

  const handleSaveCard = async (cardData) => {
    try {
      // Editada/creada a mano por el admin -> confianza 'alta'.
      if (cardData.id) {
        const updateData = { familias: cardData.familias || [], familias_confianza: 'alta', spanish: cardData.spanish, arabic: cardData.arabic, phonetic: cardData.phonetic, tipo: cardData.tipo ?? null, clase_palabra: cardData.clase_palabra ?? null };
        const { error } = await supabase.from('flashcards').update(updateData).eq('id', cardData.id);
        if (error) throw error;
        setCards(prev => prev.map(c => c.id === cardData.id ? { ...c, ...cardData, familias_confianza: 'alta' } : c));
      } else {
        const { id, ...rest } = cardData;
        const newCardData = { ...rest, familias_confianza: 'alta' };
        const { data, error } = await supabase.from('flashcards').insert([newCardData]).select();
        if (error) throw error;
        if (data) setCards(prev => [...prev, data[0]]);
      }
      setIsFormOpen(false); setEditingCard(null);
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

  // Opciones de filtro: "Todas" + las familias oficiales A2 que realmente
  // aparecen en alguna tarjeta (para no mostrar filtros vacíos).
  const pendientesCount = useMemo(
    () => cards.filter(c => c.familias_confianza === 'baja').length,
    [cards]
  );

  const familiaOptions = useMemo(() => {
    const present = new Set();
    cards.forEach(card => getCardFamilias(card).forEach(f => present.add(f)));
    const base = [
      { value: 'Todas', label: 'Todas' },
      ...FAMILIAS_A2.filter(f => present.has(f)).map(f => ({ value: f, label: f })),
    ];
    // Filtro especial solo para admin: tarjetas con confianza baja.
    // Se muestra SIEMPRE en modo admin, aunque el recuento sea 0.
    if (isAdminMode) {
      base.push({ value: PENDIENTES_REVISAR, label: `⚠ Pendientes de revisar (${pendientesCount})` });
    }
    return base;
  }, [cards, isAdminMode, pendientesCount]);

  // Clases de palabra presentes en las tarjetas (para no mostrar filtros vacíos).
  const claseOptions = useMemo(() => {
    const present = new Set();
    cards.forEach(card => { if (card.clase_palabra) present.add(card.clase_palabra); });
    return ['Todas', ...CLASES_PALABRA.filter(c => present.has(c))];
  }, [cards]);

  const filteredCards = useMemo(() => {
    const normalizedTerm = normalizeForSearch(searchTerm);
    const pendientes = selectedFamilia === PENDIENTES_REVISAR;
    let result = cards.filter(card => {
      const s = normalizeForSearch(card.spanish || "");
      const a = normalizeForSearch(card.arabic || "");
      const matchesSearch = s.includes(normalizedTerm) || a.includes(normalizedTerm);
      const matchesFamilia = pendientes
        ? card.familias_confianza === 'baja'
        : (selectedFamilia === "Todas" || getCardFamilias(card).includes(selectedFamilia));
      // Tipo: usa la columna `tipo` (o la inferida) traducida a 'palabra'/'frase'.
      const cardTipo = getCardType(card) === 'phrase' ? 'frase' : 'palabra';
      const matchesTipo = selectedTipo === "Todos" || cardTipo === selectedTipo;
      // Clase: solo aplica a tarjetas con clase_palabra asignada.
      const matchesClase = selectedClase === "Todas" || card.clase_palabra === selectedClase;
      return matchesSearch && matchesFamilia && matchesTipo && matchesClase;
    });
    if (selectedFamilia === "Todas" && selectedTipo === "Todos" && selectedClase === "Todas" && searchTerm === "") return shuffleArray(result);
    return result;
  }, [cards, searchTerm, selectedFamilia, selectedTipo, selectedClase]);

  if (currentView === 'welcome') return <WelcomeScreen onStartFlashcards={goToFlashcards} />;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans flex flex-col">
      <header className={`text-white shadow-md z-20 sticky top-0 transition-colors ${isAdminMode ? 'bg-slate-800' : 'bg-emerald-700'}`}>
        <div className="w-full px-4 py-3 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
             <button onClick={goToWelcome} className="p-1 hover:bg-white/20 rounded-full transition"><ArrowLeft className="w-5 h-5"/></button>
             <img src="/lamadrasa-mark.svg" alt="" aria-hidden="true" className="w-8 h-8 rounded-lg" />
             <h1 className="text-xl font-bold notranslate" translate="no">{isAdminMode ? "Modo Admin" : "Lamadrasa"}</h1>
          </div>
          <div className="flex-1 w-full max-w-4xl flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-white/50" />
              <input type="text" placeholder="Buscar..." className="w-full pl-9 pr-4 py-2 bg-black/20 border border-white/10 rounded-lg focus:outline-none text-sm text-white placeholder-white/60" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <div className="relative md:w-64">
                <Filter className="absolute left-3 top-2.5 w-4 h-4 text-white/50 pointer-events-none" />
                <select value={selectedFamilia} onChange={(e) => setSelectedFamilia(e.target.value)} className="w-full pl-9 pr-8 py-2 bg-black/20 border border-white/10 rounded-lg text-sm text-white appearance-none cursor-pointer" aria-label="Filtrar por familia">
                    {familiaOptions.map(opt => <option key={opt.value} value={opt.value} className="text-slate-800 bg-white">{opt.label}</option>)}
                </select>
            </div>
            <div className="relative md:w-36">
                <select value={selectedTipo} onChange={(e) => setSelectedTipo(e.target.value)} className="w-full px-3 pr-8 py-2 bg-black/20 border border-white/10 rounded-lg text-sm text-white appearance-none cursor-pointer" aria-label="Filtrar por tipo">
                    <option value="Todos" className="text-slate-800 bg-white">Tipo: todos</option>
                    <option value="palabra" className="text-slate-800 bg-white">Palabras</option>
                    <option value="frase" className="text-slate-800 bg-white">Frases</option>
                </select>
            </div>
            {claseOptions.length > 1 && (
              <div className="relative md:w-44">
                  <select value={selectedClase} onChange={(e) => setSelectedClase(e.target.value)} className="w-full px-3 pr-8 py-2 bg-black/20 border border-white/10 rounded-lg text-sm text-white appearance-none cursor-pointer" aria-label="Filtrar por clase de palabra">
                      {claseOptions.map(c => <option key={c} value={c} className="text-slate-800 bg-white">{c === 'Todas' ? 'Clase: todas' : c}</option>)}
                  </select>
              </div>
            )}
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
      <div className="bg-white border-t border-slate-200 py-3">
        <DeveloperCredit />
      </div>
      {isFormOpen && <CardFormModal card={editingCard} onSave={handleSaveCard} onClose={() => setIsFormOpen(false)} />}
      {isSmartImportOpen && <SmartImportModal onClose={() => setIsSmartImportOpen(false)} existingCards={cards} onSaved={fetchAllCards} />}
      {isMaintenanceOpen && <AdvancedMaintenanceModal onClose={() => setIsMaintenanceOpen(false)} cards={cards} setCards={setCards} />}
      {isGamesHubOpen && <GamesHub onClose={() => setIsGamesHubOpen(false)} cards={cards} showDiacritics={showDiacritics} />}
      {isLoginOpen && !isAdminMode && (
        <AdminLoginForm
          onSubmit={signIn}
          loading={authLoading}
          error={authError}
          onClose={() => { clearError(); setIsLoginOpen(false); }}
        />
      )}
    </div>
  );
}

// (DEJA AQUÍ DEBAJO EL RESTO DE TUS FUNCIONES: AdvancedMaintenanceModal, TableEditor, etc... QUE YA TENÍAS)

// --- PANEL DE MANTENIMIENTO AVANZADO ---
function AdvancedMaintenanceModal({ onClose, cards, setCards }) {
  const [activeTab, setActiveTab] = useState('table'); 
  return (
    <div className="fixed inset-0 bg-slate-100 z-50 flex flex-col">
        <header className="bg-slate-900 text-white shadow-md z-20"><div className="w-full px-6 py-4 flex justify-between items-center"><h1 className="text-xl font-bold flex items-center gap-2"><Settings className="w-6 h-6 text-blue-400"/> Mantenimiento BD</h1><button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full transition-colors"><X className="w-6 h-6"/></button></div><div className="flex px-6 overflow-x-auto border-t border-slate-800"><button onClick={() => setActiveTab('table')} className={`flex items-center gap-2 px-6 py-3 font-bold text-sm border-b-2 transition-colors ${activeTab === 'table' ? 'border-blue-400 text-blue-400' : 'border-transparent text-slate-400'}`}><Database className="w-4 h-4"/> Editor Rápido</button><button onClick={() => setActiveTab('duplicates')} className={`flex items-center gap-2 px-6 py-3 font-bold text-sm border-b-2 transition-colors ${activeTab === 'duplicates' ? 'border-amber-400 text-amber-400' : 'border-transparent text-slate-400'}`}><Copy className="w-4 h-4"/> Duplicados</button><button onClick={() => setActiveTab('audit')} className={`flex items-center gap-2 px-6 py-3 font-bold text-sm border-b-2 transition-colors ${activeTab === 'audit' ? 'border-purple-400 text-purple-400' : 'border-transparent text-slate-400'}`}><Sparkles className="w-4 h-4"/> Auditoría IA</button><button onClick={() => setActiveTab('suggest')} className={`flex items-center gap-2 px-6 py-3 font-bold text-sm border-b-2 transition-colors ${activeTab === 'suggest' ? 'border-emerald-400 text-emerald-400' : 'border-transparent text-slate-400'}`}><Sparkles className="w-4 h-4"/> Sugerir familias</button></div></header>
        <main className="flex-1 overflow-hidden p-4">
            {activeTab === 'table' && <TableEditor cards={cards} setCards={setCards} />}
            {activeTab === 'duplicates' && <DuplicateFinder cards={cards} setCards={setCards} />}
            {activeTab === 'audit' && <AIAuditor cards={cards} setCards={setCards} />}
            {activeTab === 'suggest' && <FamilySuggester />}
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

function AIAuditor({ cards, setCards }) {
    const [loading, setLoading] = useState(false); const [logs, setLogs] = useState([]); const [auditResults, setAuditResults] = useState([]);
    const handleAudit = async () => {
        setLoading(true); setAuditResults([]); setLogs(["Conectando con el servidor de IA..."]);
        try {
            // La Edge Function trocea en lotes de 15 internamente; enviamos hasta 150.
            const cardsToAudit = cards.slice(0, 150).map(c => ({ id: c.id, arabic: c.arabic, spanish: c.spanish, phonetic: c.phonetic }));
            const data = await callEdgeFunction('auditar', { cards: cardsToAudit });
            const allIssues = Array.isArray(data?.issues) ? data.issues : [];
            setAuditResults(allIssues); setLogs([`✅ Auditoría terminada. ${allIssues.length} sugerencias.`]);
        } catch (e) { setLogs(prev => [`❌ Error: ${e.message}`, ...prev]); } finally { setLoading(false); }
    };
    const applyFix = async (issue) => { try { const updateData = {}; const targetField = issue.field || (/[؀-ۿ]/.test(issue.suggestion) ? 'arabic' : 'spanish'); updateData[targetField] = issue.suggestion; const { error } = await supabase.from('flashcards').update(updateData).eq('id', issue.id); if (error) throw error; setAuditResults(prev => prev.filter(p => p.id !== issue.id)); setCards(prev => prev.map(c => c.id === issue.id ? { ...c, ...updateData } : c)); } catch (e) { alert("Error: " + e.message); } };
    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto w-full"><div className="bg-purple-50 border border-purple-200 rounded-xl p-6 mb-6 shadow-sm"><div className="flex gap-4 items-center justify-between"><p className="text-sm text-purple-800">Revisa las primeras 150 tarjetas con la IA del servidor (no necesita clave).</p><button onClick={handleAudit} disabled={loading} className="px-8 py-3 bg-purple-600 text-white rounded-lg font-bold hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2 shrink-0">{loading ? <Loader className="animate-spin" /> : "Auditar"}</button></div>{logs.length > 0 && <div className="mt-4 bg-slate-900 text-green-400 font-mono text-xs p-4 rounded-lg h-24 overflow-y-auto">{logs.map((l, i) => <div key={i}>{l}</div>)}</div>}</div><div className="flex-1 overflow-y-auto space-y-4 pb-20">{auditResults.map(issue => { const original = cards.find(c => c.id === issue.id); if (!original) return null; const fieldToFix = issue.field || (/[؀-ۿ]/.test(issue.suggestion) ? 'arabic' : 'spanish'); const isArabic = fieldToFix === 'arabic'; const originalText = isArabic ? original.arabic : original.spanish; return ( <div key={issue.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200"><div className="flex justify-between items-center mb-4"><span className="text-xs font-mono font-bold text-slate-600 bg-slate-100 px-3 py-1 rounded-full">ID: {original.id} | Corrigiendo: {fieldToFix.toUpperCase()}</span></div><div className="grid grid-cols-2 gap-6 mb-4"><div className="bg-red-50 p-4 rounded text-center border border-red-100 flex flex-col justify-center"><p className="text-xs text-red-500 font-bold mb-3 uppercase">Original</p><p className={`${isArabic ? 'font-arabic text-2xl' : 'text-xl font-bold text-slate-700'}`} dir={isArabic ? "rtl" : "ltr"}>{originalText || "(vacío)"}</p></div><div className="bg-green-50 p-4 rounded text-center border border-green-200 flex flex-col justify-center"><p className="text-xs text-green-600 font-bold mb-3 uppercase">Sugerencia IA</p><p className={`${isArabic ? 'font-arabic text-2xl' : 'text-xl font-bold'} text-green-800`} dir={isArabic ? "rtl" : "ltr"}>{issue.suggestion}</p><p className="text-xs text-green-700 mt-3 italic bg-green-100 px-2 py-1 rounded inline-block self-center">{issue.problem}</p></div></div><button onClick={() => applyFix(issue)} className="w-full bg-green-600 text-white py-3 rounded-lg font-bold flex justify-center items-center gap-2 hover:bg-green-700 transition-colors"><Check className="w-5 h-5"/> Aplicar Corrección</button></div> ); })}{!loading && logs.length > 0 && auditResults.length === 0 && <div className="text-center text-slate-500 py-10 font-bold">¡Auditoría finalizada! Todo correcto.</div>}</div></div>
    );
}

// Sugerir familias nuevas (solo informativo): llama a la Edge Function
// sugerir-familias, que agrupa las tarjetas de confianza baja. No escribe nada.
function FamilySuggester() {
    const [loading, setLoading] = useState(false);
    const [grupos, setGrupos] = useState(null);
    const [error, setError] = useState("");
    const handleSuggest = async () => {
        setLoading(true); setError(""); setGrupos(null);
        try {
            const data = await callEdgeFunction('sugerir-familias', { min: 10 });
            setGrupos(Array.isArray(data?.grupos) ? data.grupos : []);
        } catch (e) { setError(e.message); } finally { setLoading(false); }
    };
    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto w-full">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 mb-6 shadow-sm flex gap-4 items-center justify-between">
                <p className="text-sm text-emerald-800">Agrupa por tema las tarjetas con confianza baja y propone posibles familias nuevas (con al menos 10 tarjetas). Solo informativo: no cambia nada en la base de datos.</p>
                <button onClick={handleSuggest} disabled={loading} className="px-8 py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2 shrink-0">{loading ? <Loader className="animate-spin" /> : "Sugerir"}</button>
            </div>
            {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm p-4 rounded-lg">❌ {error}</div>}
            <div className="flex-1 overflow-y-auto space-y-4 pb-20">
                {grupos && grupos.length === 0 && <div className="text-center text-slate-500 py-10 font-bold">No hay propuestas: ninguna agrupación alcanza el mínimo de tarjetas.</div>}
                {grupos && grupos.map((g, i) => (
                    <div key={i} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="font-bold text-slate-800">{g.nombre}</h3>
                            <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-100 px-3 py-1 rounded-full">{g.ids?.length || 0} tarjetas</span>
                        </div>
                        {g.descripcion && <p className="text-sm text-slate-500 mb-3">{g.descripcion}</p>}
                        <div className="flex flex-wrap gap-1">
                            {(g.ejemplos || []).map((ej, j) => <span key={j} className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{ej}</span>)}
                        </div>
                    </div>
                ))}
            </div>
        </div>
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
function CardFormModal({ card, onSave, onClose }) {
  const [formData, setFormData] = useState(() => ({
    ...(card || {}),
    spanish: card?.spanish || '',
    arabic: card?.arabic || '',
    phonetic: card?.phonetic || '',
  }));
  const [familias, setFamilias] = useState(() => getCardFamilias(card));
  const [tipo, setTipo] = useState(() => card?.tipo || 'palabra'); // 'palabra' | 'frase'
  const [clase, setClase] = useState(() => card?.clase_palabra || '');

  const toggleFamilia = (familia) => {
    setFamilias(prev => prev.includes(familia) ? prev.filter(f => f !== familia) : [...prev, familia]);
  };

  // Las frases no llevan clase de palabra.
  const esFrase = tipo === 'frase';

  const handleSave = () => {
    if (!formData.spanish?.trim() || !formData.arabic?.trim()) { alert("Español y árabe son obligatorios."); return; }
    const clase_palabra = esFrase ? null : (clase || null);
    onSave({ ...formData, familias, tipo, clase_palabra });
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
        <div className="bg-emerald-600 p-4 text-white flex justify-between items-center shrink-0">
          <h2 className="font-bold">{card ? 'Editar' : 'Nueva'} Tarjeta</h2>
          <button onClick={onClose} aria-label="Cerrar"><X className="w-5 h-5"/></button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Español</label>
            <input type="text" className="w-full p-2 border rounded" value={formData.spanish} onChange={e=>setFormData({...formData, spanish: e.target.value})} />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Árabe</label>
            <input type="text" dir="rtl" className="w-full p-2 border rounded font-arabic" value={formData.arabic} onChange={e=>setFormData({...formData, arabic: e.target.value})} />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Fonética</label>
            <input type="text" className="w-full p-2 border rounded" value={formData.phonetic} onChange={e=>setFormData({...formData, phonetic: e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo</label>
              <select className="w-full p-2 border rounded text-sm bg-white" value={tipo} onChange={e => setTipo(e.target.value)}>
                <option value="palabra">Palabra</option>
                <option value="frase">Frase</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Clase de palabra</label>
              <select className="w-full p-2 border rounded text-sm bg-white disabled:bg-slate-100 disabled:text-slate-400" value={esFrase ? '' : clase} onChange={e => setClase(e.target.value)} disabled={esFrase} title={esFrase ? 'Las frases no llevan clase de palabra' : undefined}>
                <option value="">{CLASE_NINGUNA}</option>
                {CLASES_PALABRA.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Familias temáticas</label>
            <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto border border-slate-200 rounded-lg p-2">
              {FAMILIAS_A2.map(familia => (
                <label key={familia} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer hover:bg-slate-50 rounded px-2 py-1">
                  <input type="checkbox" className="accent-emerald-600 w-4 h-4" checked={familias.includes(familia)} onChange={() => toggleFamilia(familia)} />
                  <span>{familia}</span>
                </label>
              ))}
            </div>
            {familias.length === 0 && <p className="text-xs text-amber-600 mt-1">Selecciona al menos una familia.</p>}
          </div>
          <button onClick={handleSave} className="w-full bg-emerald-600 text-white py-3 rounded-lg font-bold hover:bg-emerald-700">Guardar</button>
        </div>
      </div>
    </div>
  );
}

// Límites de entrada (coinciden con los validados por la Edge Function importar).
const MAX_TEXTO_IMPORT = 20000;        // caracteres
const MAX_IMAGEN_BASE64 = 5 * 1024 * 1024; // ~5 MB de cadena base64

// Clave de deduplicación: normaliza el árabe (misma función que el servidor) e
// ignora el artículo inicial "ال" para no tratar "el libro" y "libro" como distintos.
function dupKey(arabe) {
  const n = normalizarArabe(arabe || "");
  return n.replace(/^ال/, "").trim();
}

function SmartImportModal({ onClose, existingCards = [], onSaved }) {
  const [activeTab, setActiveTab] = useState('text');
  const [text, setText] = useState("");
  const [leccion, setLeccion] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState(null); // null = aún no hay revisión; [] = sin resultados
  const [cameraStream, setCameraStream] = useState(null);
  const videoRef = useRef(null);

  useEffect(() => { return () => { if (cameraStream) cameraStream.getTracks().forEach(t => t.stop()); }; }, [cameraStream]);

  // Índice de árabes existentes por clave de deduplicación.
  const existentesPorClave = useMemo(() => {
    const map = new Map();
    for (const c of existingCards) {
      if (!c.arabic) continue;
      const key = dupKey(c.arabic);
      if (key && !map.has(key)) map.set(key, c);
    }
    return map;
  }, [existingCards]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setCameraStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch { setError("No se pudo acceder a la cámara."); }
  };

  // Convierte los items devueltos por `importar` en filas editables de revisión.
  const buildRows = (items) => items.map((it, idx) => {
    const key = dupKey(it.arabe);
    const match = key ? existentesPorClave.get(key) : null;
    return {
      _id: idx,
      arabe: it.arabe || "",
      espanol: it.espanol || "",
      transliteracion: it.transliteracion || "",
      tipo: it.tipo === 'frase' ? 'frase' : 'palabra',
      clase_palabra: it.clase_palabra || "",
      familias: Array.isArray(it.familias) ? it.familias : [],
      confianza: it.confianza || 'media',
      estado: match ? 'existe' : 'nuevo',
      match: match || null,
      accion: match ? 'omitir' : 'crear', // para 'existe': 'omitir' | 'fusionar'
      descartada: false,
      editada: false,
    };
  });

  const llamarImportar = async (modo, contenido) => {
    setError(""); setIsProcessing(true);
    try {
      const data = await callEdgeFunction('importar', { modo, contenido, leccion: leccion.trim() || undefined });
      const items = Array.isArray(data?.items) ? data.items : [];
      if (items.length === 0) { setError("La IA no devolvió ningún elemento."); return; }
      setRows(buildRows(items));
    } catch (e) { setError(e.message); } finally { setIsProcessing(false); }
  };

  const processText = () => {
    const contenido = text.trim();
    if (!contenido) { setError("Pega algo de texto primero."); return; }
    if (contenido.length > MAX_TEXTO_IMPORT) { setError(`Texto demasiado largo (máx. ${MAX_TEXTO_IMPORT} caracteres).`); return; }
    llamarImportar('texto', contenido);
  };

  const processImage = (base64) => {
    if (!base64) return;
    if (base64.length > MAX_IMAGEN_BASE64) { setError("Imagen demasiado grande (máx. ~5 MB)."); return; }
    llamarImportar('imagen', base64);
  };

  const capture = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth; canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
    processImage(canvas.toDataURL('image/jpeg'));
  };

  const handleFile = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (file.type.includes('pdf')) {
      setIsProcessing(true); setError("");
      try {
        const pdfjsLib = await loadPdfjs();
        const ab = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(ab).promise;
        let str = "";
        for (let i = 1; i <= pdf.numPages; i++) { const p = await pdf.getPage(i); const t = await p.getTextContent(); str += t.items.map(s => s.str).join(" ") + "\n"; }
        setText(str); setActiveTab('text');
      } catch { setError("No se pudo leer el PDF."); } finally { setIsProcessing(false); }
    } else {
      const reader = new FileReader();
      reader.onload = () => processImage(reader.result);
      reader.readAsDataURL(file);
    }
  };

  // --- Edición de filas de revisión ---
  const patchRow = (id, patch) => setRows(prev => prev.map(r => r._id === id ? { ...r, ...patch, editada: true } : r));
  const toggleFamiliaRow = (id, familia) => setRows(prev => prev.map(r => {
    if (r._id !== id) return r;
    const familias = r.familias.includes(familia) ? r.familias.filter(f => f !== familia) : [...r.familias, familia];
    return { ...r, familias, editada: true };
  }));

  const guardar = async () => {
    setSaving(true); setError("");
    try {
      const activas = rows.filter(r => !r.descartada && !(r.estado === 'existe' && r.accion === 'omitir'));
      const nuevas = [];
      const fusiones = [];
      for (const r of activas) {
        const clase_palabra = r.tipo === 'frase' ? null : (r.clase_palabra || null);
        if (r.estado === 'existe' && r.accion === 'fusionar' && r.match) {
          const familiasUnion = [...new Set([...(r.match.familias || []), ...r.familias])];
          const patch = { familias: familiasUnion };
          if (leccion.trim()) patch.category = leccion.trim();
          if (!r.match.clase_palabra && clase_palabra) patch.clase_palabra = clase_palabra;
          if (!r.match.tipo) patch.tipo = r.tipo;
          fusiones.push({ id: r.match.id, patch });
        } else {
          nuevas.push({
            category: leccion.trim() || 'Importado',
            spanish: r.espanol,
            arabic: r.arabe,
            phonetic: r.transliteracion,
            tipo: r.tipo,
            clase_palabra,
            familias: r.familias,
            // Fila editada/confirmada por el admin -> alta; si no, conserva la de la IA.
            familias_confianza: r.editada ? 'alta' : r.confianza,
          });
        }
      }
      if (nuevas.length) { const { error: insErr } = await supabase.from('flashcards').insert(nuevas); if (insErr) throw insErr; }
      for (const f of fusiones) { const { error: updErr } = await supabase.from('flashcards').update(f.patch).eq('id', f.id); if (updErr) throw updErr; }
      alert(`Guardado: ${nuevas.length} nuevas, ${fusiones.length} fusionadas.`);
      if (onSaved) await onSaved();
      onClose();
    } catch (e) { setError("Error al guardar: " + e.message); } finally { setSaving(false); }
  };

  const resumen = rows ? {
    total: rows.length,
    nuevas: rows.filter(r => !r.descartada && r.estado === 'nuevo').length,
    existentes: rows.filter(r => r.estado === 'existe').length,
    descartadas: rows.filter(r => r.descartada).length,
  } : null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl shadow-xl w-full ${rows ? 'max-w-5xl' : 'max-w-lg'} overflow-hidden flex flex-col max-h-[92vh]`}>
        <div className="bg-purple-600 p-4 text-white flex justify-between items-center shrink-0">
          <h2 className="font-bold">{rows ? 'Revisar importación' : 'Importar'}</h2>
          <button onClick={onClose} aria-label="Cerrar"><X className="w-5 h-5"/></button>
        </div>

        {error && <div className="bg-red-50 border-b border-red-200 text-red-700 text-sm px-6 py-3">❌ {error}</div>}

        {!rows ? (
          <>
            <div className="flex border-b shrink-0">
              <button onClick={()=>setActiveTab('text')} className={`flex-1 py-3 font-bold ${activeTab==='text'?'text-purple-600 border-b-2 border-purple-600':'text-slate-400'}`}>Texto</button>
              <button onClick={()=>setActiveTab('file')} className={`flex-1 py-3 font-bold ${activeTab==='file'?'text-purple-600 border-b-2 border-purple-600':'text-slate-400'}`}>Archivo</button>
              <button onClick={()=>{setActiveTab('camera'); startCamera();}} className={`flex-1 py-3 font-bold ${activeTab==='camera'?'text-purple-600 border-b-2 border-purple-600':'text-slate-400'}`}>Cámara</button>
            </div>
            <div className="p-6 overflow-y-auto">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Lección / origen (opcional)</label>
              <input type="text" placeholder="Ej.: Pista 32: La ropa" className="w-full p-2 mb-4 border rounded text-sm" value={leccion} onChange={e=>setLeccion(e.target.value)} />
              {activeTab === 'text' && (
                <>
                  <textarea className="w-full h-40 p-2 border rounded text-xs font-mono" value={text} onChange={e=>setText(e.target.value)} placeholder="Pega aquí el vocabulario (texto libre o 'español | árabe')."></textarea>
                  <p className="text-[11px] text-slate-400 mt-1">{text.length}/{MAX_TEXTO_IMPORT} caracteres</p>
                  <button onClick={processText} disabled={isProcessing} className="w-full mt-3 bg-purple-600 text-white py-2 rounded-lg font-bold disabled:opacity-50 flex items-center justify-center gap-2">{isProcessing ? <Loader className="animate-spin w-5 h-5"/> : 'Procesar texto'}</button>
                </>
              )}
              {activeTab === 'file' && (
                <div className="border-2 border-dashed border-slate-300 rounded-lg h-40 flex flex-col items-center justify-center text-slate-400 relative">
                  <input type="file" accept=".pdf,image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFile}/>
                  {isProcessing ? <Loader className="animate-spin"/> : <><Upload className="mb-2"/> <p>Subir PDF o imagen</p></>}
                </div>
              )}
              {activeTab === 'camera' && (
                <div className="flex flex-col items-center">
                  <div className="w-full aspect-video bg-black rounded-lg overflow-hidden mb-4 relative"><video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover"></video></div>
                  <button onClick={capture} disabled={isProcessing} className="bg-purple-600 text-white p-4 rounded-full shadow-lg hover:bg-purple-700 disabled:opacity-50">{isProcessing ? <Loader className="animate-spin w-6 h-6"/> : <Camera className="w-6 h-6"/>}</button>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="px-6 py-3 bg-slate-50 border-b text-xs font-bold text-slate-600 flex flex-wrap gap-x-6 gap-y-1 shrink-0">
              <span>Total: {resumen.total}</span>
              <span className="text-emerald-700">Nuevas: {resumen.nuevas}</span>
              <span className="text-amber-700">Ya existen: {resumen.existentes}</span>
              <span className="text-slate-400">Descartadas: {resumen.descartadas}</span>
              {leccion.trim() && <span>Lección: {leccion.trim()}</span>}
            </div>
            <div className="flex-1 overflow-auto p-4">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100 text-slate-600 sticky top-0 z-10">
                  <tr>
                    <th className="p-2">Estado</th>
                    <th className="p-2">Español</th>
                    <th className="p-2 text-right">Árabe</th>
                    <th className="p-2">Fonética</th>
                    <th className="p-2">Tipo</th>
                    <th className="p-2">Clase</th>
                    <th className="p-2">Familias</th>
                    <th className="p-2 text-center">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(r => (
                    <tr key={r._id} className={r.descartada ? 'opacity-40 bg-slate-50' : r.estado === 'existe' ? 'bg-amber-50/50' : 'hover:bg-slate-50'}>
                      <td className="p-2">
                        {r.estado === 'existe'
                          ? <span className="text-amber-700 font-bold">Ya existe</span>
                          : <span className="text-emerald-700 font-bold">Nueva</span>}
                        {r.confianza === 'baja' && <span className="block text-[10px] text-rose-500">conf. baja</span>}
                      </td>
                      <td className="p-2"><input className="w-full p-1 border rounded" value={r.espanol} onChange={e=>patchRow(r._id, { espanol: e.target.value })} /></td>
                      <td className="p-2"><input dir="rtl" className="w-full p-1 border rounded font-arabic text-right" value={r.arabe} onChange={e=>patchRow(r._id, { arabe: e.target.value })} /></td>
                      <td className="p-2"><input className="w-full p-1 border rounded font-mono" value={r.transliteracion} onChange={e=>patchRow(r._id, { transliteracion: e.target.value })} /></td>
                      <td className="p-2">
                        <select className="w-full p-1 border rounded bg-white" value={r.tipo} onChange={e=>patchRow(r._id, { tipo: e.target.value, clase_palabra: e.target.value === 'frase' ? '' : r.clase_palabra })}>
                          <option value="palabra">Palabra</option>
                          <option value="frase">Frase</option>
                        </select>
                      </td>
                      <td className="p-2">
                        <select className="w-full p-1 border rounded bg-white disabled:bg-slate-100 disabled:text-slate-400" value={r.tipo === 'frase' ? '' : r.clase_palabra} disabled={r.tipo === 'frase'} onChange={e=>patchRow(r._id, { clase_palabra: e.target.value })}>
                          <option value="">—</option>
                          {CLASES_PALABRA.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="p-2">
                        <details>
                          <summary className="cursor-pointer text-purple-700">{r.familias.length} familia(s)</summary>
                          <div className="mt-1 max-h-40 overflow-y-auto border rounded p-1 bg-white">
                            {FAMILIAS_A2.map(f => (
                              <label key={f} className="flex items-center gap-1 px-1 py-0.5 hover:bg-slate-50 rounded cursor-pointer">
                                <input type="checkbox" className="accent-emerald-600" checked={r.familias.includes(f)} onChange={()=>toggleFamiliaRow(r._id, f)} />
                                <span>{f}</span>
                              </label>
                            ))}
                          </div>
                        </details>
                      </td>
                      <td className="p-2 text-center whitespace-nowrap">
                        {r.estado === 'existe' && !r.descartada && (
                          <select className="p-1 border rounded bg-white mb-1" value={r.accion} onChange={e=>setRows(prev => prev.map(x => x._id === r._id ? { ...x, accion: e.target.value } : x))}>
                            <option value="omitir">Omitir</option>
                            <option value="fusionar">Fusionar</option>
                          </select>
                        )}
                        <button onClick={()=>setRows(prev => prev.map(x => x._id === r._id ? { ...x, descartada: !x.descartada } : x))} className={`block w-full text-[11px] font-bold px-2 py-1 rounded ${r.descartada ? 'bg-slate-200 text-slate-600' : 'bg-rose-100 text-rose-700'}`}>{r.descartada ? 'Restaurar' : 'Descartar'}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t bg-slate-50 flex justify-between items-center shrink-0">
              <button onClick={()=>{ setRows(null); setError(""); }} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded-lg">← Volver</button>
              <button onClick={guardar} disabled={saving} className="px-8 py-2 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2">{saving ? <Loader className="animate-spin w-5 h-5"/> : <Check className="w-5 h-5"/>} Guardar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Flashcard({ data, frontLanguage, showDiacritics, isAdmin, onDelete, onEdit }) {
  const [flipState, setFlipState] = useState(0); useEffect(() => { setFlipState(0); }, [frontLanguage]);
  const handleNextFace = () => { if (!isAdmin) setFlipState((prev) => (prev + 1) % 3); };
  const playAudio = (e) => { e.stopPropagation(); playSmartAudio(data?.arabic || ""); };
  const spanishText = data?.spanish || "Sin texto"; const arabicText = data?.arabic || "Sin texto"; const phoneticText = data?.phonetic || "N/A"; const displayArabic = showDiacritics ? arabicText : removeArabicDiacritics(arabicText); const familias = getCardFamilias(data); const clasePalabra = data?.clase_palabra || null;
  let content = null;
  if (isAdmin) { content = <><h3 className="text-lg font-bold text-slate-800 line-clamp-2">{spanishText}</h3><h3 className="text-2xl font-arabic text-emerald-700 mt-1" dir="rtl">{displayArabic}</h3><p className="text-sm font-mono text-amber-700 italic opacity-80">{phoneticText}</p></>; } else if (flipState === 2) { content = <><p className="text-xs uppercase text-amber-600 font-bold mb-2">Fonética</p><h3 className="text-lg font-mono text-amber-800 italic">{phoneticText}</h3></>; } else { const isFront = flipState === 0; const currentLang = isFront ? frontLanguage : (frontLanguage === 'spanish' ? 'arabic' : 'spanish'); if (currentLang === 'spanish') { content = <><p className="text-xs uppercase text-slate-400 font-bold mb-2">Español</p><h3 className="text-xl font-bold text-slate-800">{spanishText}</h3></>; } else { content = <><p className="text-xs uppercase text-emerald-600 font-bold mb-2">Árabe</p><h3 className="text-3xl font-arabic text-emerald-900 mb-4" dir="rtl">{displayArabic}</h3><button onClick={playAudio} className="p-2 bg-emerald-200 text-emerald-800 rounded-full hover:bg-emerald-300 transition-colors"><Volume2 className="w-4 h-4"/></button></>; } }
  let bgClass = "bg-white border-slate-200 text-slate-800"; if (!isAdmin) { if (flipState === 0) bgClass = "bg-orange-50 border-orange-100 text-slate-800"; if (flipState === 1) bgClass = "bg-emerald-50 border-emerald-200 text-emerald-900"; if (flipState === 2) bgClass = "bg-amber-100 border-amber-200 text-amber-900"; }
  return ( <div onClick={handleNextFace} className={`relative h-60 w-full rounded-2xl shadow-sm hover:shadow-lg transition-all border flex flex-col p-4 text-center select-none group cursor-pointer ${bgClass}`}>{isAdmin && ( <div className="absolute top-2 right-2 flex gap-2 z-10" onClick={(e) => e.stopPropagation()}><button onClick={() => onEdit()} className="p-2 bg-blue-100 text-blue-600 rounded-full hover:bg-blue-200 transition-colors"><Edit2 className="w-4 h-4" /></button><button onClick={() => onDelete()} className="p-2 bg-red-100 text-red-600 rounded-full hover:bg-red-200 transition-colors"><Trash2 className="w-4 h-4" /></button></div> )}<div className="flex-1 flex flex-col items-center justify-center w-full gap-2 mt-4">{content}</div><div className="mt-auto pt-2 pb-1 flex flex-wrap gap-1 justify-center max-h-12 overflow-hidden">{clasePalabra && (<span className="text-[10px] font-bold tracking-wide bg-indigo-600/10 text-indigo-700 px-2 py-0.5 rounded-full whitespace-nowrap">{clasePalabra}</span>)}{familias.length > 0 ? familias.map((familia, i) => (<span key={i} className="text-[10px] font-bold tracking-wide bg-emerald-600/10 text-emerald-700 px-2 py-0.5 rounded-full whitespace-nowrap">{familia}</span>)) : (<span className="text-[10px] font-bold tracking-wide bg-slate-200 text-slate-400 px-2 py-0.5 rounded-full">Sin familia</span>)}</div></div> );
}
