import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from './supabaseClient';
import OpenAI from 'openai';
import * as pdfjsLib from 'pdfjs-dist'; 
// IMPORTACIÓN DE ICONOS (Añadidos Gamepad2 y Baseline)
import { 
  Search, Volume2, BookOpen, X, Check, ArrowLeft, 
  Settings, Filter, Plus, Trash2, Edit2, Lock, Unlock, 
  Image as ImageIcon, Wand2, Loader,
  Trophy, Frown, CheckCircle, HelpCircle, Grid, Activity, Mic, 
  FileText, Camera, Upload, Gamepad2, Baseline
} from 'lucide-react';

// Configuración del Worker de PDF
pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.mjs`;

// --- UTILIDADES ---

const removeArabicDiacritics = (text) => {
  if (!text) return "";
  return text.replace(/[\u064B-\u065F\u0670]/g, '');
};

const normalizeForSearch = (text) => {
  if (!text) return "";
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u064B-\u065F\u0670]/g, ""); 
};

const shuffleArray = (array) => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

// Función segura para leer localStorage
const safeGetStorage = (key, fallback) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch (e) {
    return fallback;
  }
};

const ARABIC_ALPHABET = ['ا', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'ه', 'و', 'ي'];

const getCardType = (card) => {
    if (!card) return 'word';
    if (card.category && card.category.toLowerCase().includes('frases')) return 'phrase';
    const text = card.spanish || "";
    const wordCount = text.trim().split(/\s+/).length;
    return wordCount > 2 ? 'phrase' : 'word';
};

const playSmartAudio = (text) => {
    if (!text) return;
    try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ar-SA';
        utterance.rate = 0.7; 
        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(v => v.lang.includes('ar'));
        if (preferredVoice) utterance.voice = preferredVoice;
        window.speechSynthesis.speak(utterance);
    } catch (e) {
        console.error("Audio error", e);
    }
};

// --- COMPONENTE PRINCIPAL APP ---
export default function App() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Todos");
  
  // Preferencias
  const [frontLanguage, setFrontLanguage] = useState(() => localStorage.getItem('pref_lang') || "spanish");
  const [showDiacritics, setShowDiacritics] = useState(() => safeGetStorage('pref_diacritics', true));
  
  // Modales y Estados
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [editingCard, setEditingCard] = useState(null); 
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSmartImportOpen, setIsSmartImportOpen] = useState(false);
  const [isMaintenanceOpen, setIsMaintenanceOpen] = useState(false);
  const [isGamesHubOpen, setIsGamesHubOpen] = useState(() => safeGetStorage('games_open', false)); 

  // --- AUTO-REPARACIÓN DE ESTILOS ---
  useEffect(() => {
    if (!document.getElementById('tailwind-cdn')) {
      const script = document.createElement('script');
      script.id = 'tailwind-cdn';
      script.src = "https://cdn.tailwindcss.com";
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  useEffect(() => { localStorage.setItem('pref_lang', frontLanguage); }, [frontLanguage]);
  useEffect(() => { localStorage.setItem('pref_diacritics', JSON.stringify(showDiacritics)); }, [showDiacritics]);
  useEffect(() => { localStorage.setItem('games_open', JSON.stringify(isGamesHubOpen)); }, [isGamesHubOpen]);

  useEffect(() => {
    const loadVoices = () => { window.speechSynthesis.getVoices(); };
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) window.speechSynthesis.onvoiceschanged = loadVoices;
    fetchAllCards();
  }, []);

  async function fetchAllCards() {
    try {
      setLoading(true);
      let allData = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;
      while (hasMore && page < 10) {
        const { data, error } = await supabase.from('flashcards').select('*').range(page * pageSize, (page + 1) * pageSize - 1).order('id', { ascending: false });
        if (error) throw error;
        if (data && data.length > 0) {
          allData = [...allData, ...data];
          if (data.length < pageSize) hasMore = false; else page++;
        } else { hasMore = false; }
      }
      const uniqueCards = Array.from(new Map(allData.map(item => [item.id, item])).values());
      setCards(uniqueCards);
    } catch (error) { console.error("Error:", error); } finally { setLoading(false); }
  }

  const handleAdminToggle = () => {
    if (isAdminMode) setIsAdminMode(false);
    else { const p = prompt("🔒 Contraseña:"); if (p === "1234") setIsAdminMode(true); }
  };

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
        if (data) setCards(prev => [data[0], ...prev]);
      }
      setIsFormOpen(false); setEditingCard(null);
    } catch (error) { alert("Error: " + error.message); }
  };

  const handleBulkImport = async (newCards) => {
    try {
      const { data, error } = await supabase.from('flashcards').insert(newCards).select();
      if (error) throw error;
      if (data) { setCards(prev => [...data, ...prev]); alert(`¡${data.length} importadas!`); setIsSmartImportOpen(false); }
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

  const openNewCardModal = () => { setEditingCard(null); setIsFormOpen(true); };
  const openEditCardModal = (card) => { setEditingCard(card); setIsFormOpen(true); };

  const categories = useMemo(() => {
    const allTags = new Set();
    cards.forEach(card => {
      const tags = (card.category || "General").toString().split(';');
      tags.forEach(tag => { if(tag.trim().length > 0) allTags.add(tag.trim()); });
    });
    return ["Todos", ...Array.from(allTags).sort()];
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

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans flex flex-col">
      <header className={`text-white shadow-md z-20 sticky top-0 transition-colors ${isAdminMode ? 'bg-slate-800' : 'bg-emerald-700'}`}>
        <div className="w-full px-4 py-3 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3"><BookOpen className="w-7 h-7" /><h1 className="text-xl font-bold">{isAdminMode ? "Modo Admin" : "Aprende Árabe"}</h1></div>
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
                <button onClick={() => setIsGamesHubOpen(true)} className="p-2 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white transition-colors shadow-lg" title="Juegos">
                    <Gamepad2 className="w-6 h-6" />
                </button>
                <div className="flex items-center gap-2 bg-black/20 rounded-lg p-1 border border-white/10">
                    <button onClick={() => setFrontLanguage('spanish')} className={`px-2 py-1.5 rounded-md text-xs font-bold ${frontLanguage === 'spanish' ? 'bg-white text-slate-800' : 'text-white/70'}`}>ES</button>
                    <button onClick={() => setFrontLanguage('arabic')} className={`px-2 py-1.5 rounded-md text-xs font-bold ${frontLanguage === 'arabic' ? 'bg-white text-slate-800' : 'text-white/70'}`}>AR</button>
                    <button onClick={() => setShowDiacritics(!showDiacritics)} className={`px-2 py-1.5 rounded-md text-xs font-bold ${showDiacritics ? 'bg-white text-slate-800' : 'text-white/70'}`}>
                        <Baseline className="w-3.5 h-3.5" />
                    </button>
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
                <button onClick={openNewCardModal} className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-full shadow-lg font-bold"><Plus className="w-5 h-5" /> Añadir</button>
                <button onClick={() => setIsSmartImportOpen(true)} className="flex items-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-full shadow-lg font-bold"><Wand2 className="w-5 h-5" /> Importar</button>
                <button onClick={() => setIsMaintenanceOpen(true)} className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-full shadow-lg font-bold"><Settings className="w-5 h-5" /> Mantenimiento</button>
              </div>
            )}
            {loading ? (
               <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3"><Loader className="w-8 h-8 animate-spin text-emerald-600" /><span className="font-medium animate-pulse">Cargando datos...</span></div>
            ) : filteredCards.length === 0 ? (
              <div className="text-center py-20 text-slate-400">No hay tarjetas para esta selección.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredCards.map(card => <Flashcard key={card.id} data={card} frontLanguage={frontLanguage} showDiacritics={showDiacritics} isAdmin={isAdminMode} onDelete={() => handleDeleteCard(card.id)} onEdit={() => openEditCardModal(card)} />)}
              </div>
            )}
            {!loading && <div className="mt-8 text-center text-[10px] text-slate-300 font-mono">Total Tarjetas: {cards.length}</div>}
          </div>
      </div>
      {isFormOpen && <CardFormModal card={editingCard} categories={categories.filter(c => c !== "Todos")} onSave={handleSaveCard} onClose={() => setIsFormOpen(false)} />}
      {isSmartImportOpen && <SmartImportModal onClose={() => setIsSmartImportOpen(false)} onImport={handleBulkImport} />}
      {isMaintenanceOpen && <MaintenanceModal onClose={() => setIsMaintenanceOpen(false)} cards={cards} refreshCards={fetchAllCards} />}
      {isGamesHubOpen && <GamesHub onClose={() => setIsGamesHubOpen(false)} cards={cards} showDiacritics={showDiacritics} />}
    </div>
  );
}

// --- HUB DE JUEGOS ---
function GamesHub({ onClose, cards, showDiacritics }) {
  const [activeGame, setActiveGame] = useState(() => localStorage.getItem('current_game') || 'menu'); 
  useEffect(() => { localStorage.setItem('current_game', activeGame); }, [activeGame]);

  if (activeGame === 'quiz') return <QuizGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} showDiacritics={showDiacritics} />;
  if (activeGame === 'memory') return <MemoryGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} showDiacritics={showDiacritics} />;
  if (activeGame === 'truefalse') return <TrueFalseGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} showDiacritics={showDiacritics} />;
  if (activeGame === 'connect') return <ConnectGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} showDiacritics={showDiacritics} />;
  if (activeGame === 'listening') return <ListeningGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} showDiacritics={showDiacritics} />;

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col relative">
        <div className="bg-slate-800 p-6 text-white flex justify-between items-center">
          <div className="flex items-center gap-3"><Gamepad2 className="w-8 h-8 text-yellow-400" /><h2 className="font-bold text-2xl">Arcade</h2></div>
          <button onClick={onClose} className="hover:bg-slate-700 p-2 rounded-full transition"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-8 bg-slate-100 grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto max-h-[70vh]">
          <button onClick={() => setActiveGame('quiz')} className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl transition-all text-left border border-slate-200"><div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center mb-4"><HelpCircle className="w-7 h-7" /></div><h3 className="text-xl font-bold text-slate-800 mb-2">Quiz Express</h3><p className="text-sm text-slate-500">Elige la traducción.</p></button>
          <button onClick={() => setActiveGame('memory')} className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl transition-all text-left border border-slate-200"><div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center mb-4"><Grid className="w-7 h-7" /></div><h3 className="text-xl font-bold text-slate-800 mb-2">Memoria</h3><p className="text-sm text-slate-500">Encuentra las parejas.</p></button>
          <button onClick={() => setActiveGame('truefalse')} className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl transition-all text-left border border-slate-200"><div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center mb-4"><Activity className="w-7 h-7" /></div><h3 className="text-xl font-bold text-slate-800 mb-2">Velocidad</h3><p className="text-sm text-slate-500">Verdadero o Falso.</p></button>
          <button onClick={() => setActiveGame('connect')} className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl transition-all text-left border border-slate-200"><div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center mb-4"><Edit2 className="w-7 h-7" /></div><h3 className="text-xl font-bold text-slate-800 mb-2">Conecta</h3><p className="text-sm text-slate-500">Une las parejas.</p></button>
          <button onClick={() => setActiveGame('listening')} className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl transition-all text-left border border-slate-200 md:col-span-2"><div className="w-12 h-12 bg-cyan-100 text-cyan-600 rounded-xl flex items-center justify-center mb-4"><Mic className="w-7 h-7" /></div><h3 className="text-xl font-bold text-slate-800 mb-2">Oído Fino</h3><p className="text-sm text-slate-500">Escucha y acierta.</p></button>
        </div>
      </div>
    </div>
  );
}

// JUEGOS

function ListeningGame({ onBack, onClose, cards, showDiacritics }) {
  const [round, setRound] = useState(null);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => safeGetStorage('listen_highscore', 0));
  const [selectedOption, setSelectedOption] = useState(null);
  useEffect(() => { startNewRound(); }, []);
  const startNewRound = () => {
    if (cards.length < 4) return;
    const correctCard = cards[Math.floor(Math.random() * cards.length)];
    const targetType = getCardType(correctCard);
    let candidates = cards.filter(c => c.id !== correctCard.id && getCardType(c) === targetType);
    if (candidates.length < 3) candidates = cards.filter(c => c.id !== correctCard.id);
    const distractors = shuffleArray(candidates).slice(0, 3);
    setRound({ card: correctCard, options: shuffleArray([correctCard, ...distractors]) });
    setSelectedOption(null);
    setTimeout(() => playSmartAudio(correctCard.arabic), 500);
  };
  const handleOptionClick = (option) => {
    if (selectedOption) return;
    setSelectedOption(option);
    if (option.id === round.card.id) {
        setScore(s => { const newScore = s + 1; if (newScore > highScore) { setHighScore(newScore); localStorage.setItem('listen_highscore', newScore.toString()); } return newScore; });
        setTimeout(startNewRound, 1000);
    } else { setScore(0); setTimeout(startNewRound, 2000); }
  };
  if (!round) return <div className="fixed inset-0 bg-black/90 flex items-center justify-center text-white">Cargando...</div>;
  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col relative">
        <div className="bg-cyan-600 p-4 text-white flex justify-between items-center"><div className="flex items-center gap-2"><button onClick={onBack} className="hover:bg-cyan-500 p-1 rounded mr-2"><ArrowLeft className="w-5 h-5"/></button><h2 className="font-bold text-lg">Oído Fino</h2></div><button onClick={onClose} className="hover:bg-cyan-500 p-1 rounded"><X className="w-6 h-6" /></button></div>
        <div className="flex justify-between px-6 py-3 bg-cyan-50 border-b border-cyan-100"><div className="flex flex-col items-center"><span className="text-xs font-bold text-cyan-400 uppercase">Racha</span><span className="text-xl font-black text-cyan-700">{score}</span></div><div className="flex flex-col items-center"><span className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1"><Trophy className="w-3 h-3"/> Récord</span><span className="text-xl font-black text-slate-600">{highScore}</span></div></div>
        <div className="p-8 text-center bg-slate-50 flex flex-col items-center justify-center min-h-[180px]">
          {selectedOption ? ( <div className="animate-fade-in-up"><span className="text-xs font-bold text-slate-400 uppercase mb-2 block">Es...</span><h3 className="text-3xl font-black font-arabic text-slate-800 mb-2" dir="rtl">{showDiacritics ? round.card.arabic : removeArabicDiacritics(round.card.arabic)}</h3></div> ) : <button onClick={() => playSmartAudio(round.card.arabic)} className="w-24 h-24 rounded-full bg-cyan-100 text-cyan-600 flex items-center justify-center hover:scale-110 transition-all shadow-lg border-4 border-white"><Volume2 className="w-12 h-12" /></button>}
        </div>
        <div className="p-6 grid grid-cols-1 gap-3 bg-white">{round.options.map((option) => ( <button key={option.id} disabled={!!selectedOption} onClick={() => handleOptionClick(option)} className={`p-4 rounded-xl border-2 text-lg font-bold ${selectedOption ? (option.id === round.card.id ? "bg-green-100 border-green-500 text-green-800" : option.id === selectedOption.id ? "bg-red-100 border-red-500 text-red-800" : "opacity-40") : "hover:bg-cyan-50 border-slate-200"}`}>{option.spanish}</button> ))}</div>
      </div>
    </div>
  );
}

function ConnectGame({ onBack, onClose, cards, showDiacritics }) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState([]);
  const [matched, setMatched] = useState([]);
  useEffect(() => { startNewRound(); }, []);
  const startNewRound = () => {
    if (cards.length < 4) return;
    const pool = shuffleArray([...cards]).slice(0, 4);
    const newItems = [];
    pool.forEach(card => { newItems.push({ id: card.id + '-es', cardId: card.id, text: card.spanish, type: 'es' }); newItems.push({ id: card.id + '-ar', cardId: card.id, text: card.arabic, type: 'ar' }); });
    setItems(shuffleArray(newItems)); setMatched([]); setSelected([]);
  };
  const handleClick = (item) => {
    if (matched.includes(item.id) || selected.find(s => s.id === item.id)) return;
    if (item.type === 'ar') playSmartAudio(item.text);
    const newSelected = [...selected, item]; setSelected(newSelected);
    if (newSelected.length === 2) {
        if (newSelected[0].cardId === newSelected[1].cardId) {
            setMatched([...matched, newSelected[0].id, newSelected[1].id]); setSelected([]);
            if (matched.length + 2 === 8) setTimeout(startNewRound, 1500);
        } else { setTimeout(() => setSelected([]), 800); }
    }
  };
  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col relative h-[600px]">
        <div className="bg-amber-600 p-4 text-white flex justify-between items-center"><div className="flex items-center gap-2"><button onClick={onBack} className="hover:bg-amber-500 p-1 rounded mr-2"><ArrowLeft className="w-5 h-5"/></button><h2 className="font-bold text-lg">Conecta</h2></div><button onClick={onClose}><X/></button></div>
        <div className="flex-1 p-4 grid grid-cols-2 gap-3 overflow-y-auto content-center">
            {items.map(item => {
                const isSelected = selected.find(s => s.id === item.id); const isMatched = matched.includes(item.id);
                if (isMatched) return <div key={item.id} className="opacity-0"></div>;
                let bgClass = isSelected ? (selected.length === 2 && selected[0].cardId !== selected[1].cardId ? "bg-red-100 border-red-500 text-red-800" : "bg-amber-100 border-amber-500 text-amber-900") : "bg-slate-50 border-slate-200 text-slate-700";
                return <button key={item.id} onClick={() => handleClick(item)} className={`p-4 rounded-xl border-2 font-bold transition-all text-sm md:text-base flex items-center justify-center min-h-[80px] shadow-sm active:scale-95 ${bgClass}`} dir={item.type === 'ar' ? 'rtl' : 'ltr'}>{item.type === 'ar' ? (showDiacritics ? item.text : removeArabicDiacritics(item.text)) : item.text}</button>;
            })}
        </div>
      </div>
    </div>
  );
}

function QuizGame({ onBack, onClose, cards, showDiacritics }) {
  const [currentRound, setCurrentRound] = useState(null);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => safeGetStorage('quiz_highscore', 0));
  const [selectedOption, setSelectedOption] = useState(null);
  useEffect(() => { startNewRound(); }, []);
  const startNewRound = () => { if (cards.length < 4) return; const correctCard = cards[Math.floor(Math.random() * cards.length)]; const targetType = getCardType(correctCard); let candidates = cards.filter(c => c.id !== correctCard.id && getCardType(c) === targetType); if (candidates.length < 3) candidates = cards.filter(c => c.id !== correctCard.id); const distractors = shuffleArray(candidates).slice(0, 3); setCurrentRound({ question: correctCard, options: shuffleArray([correctCard, ...distractors]) }); setSelectedOption(null); };
  const handleOptionClick = (option) => { 
      if (selectedOption) return; setSelectedOption(option); const correct = option.id === currentRound.question.id; 
      if (correct) { playSmartAudio(option.arabic); const newScore = score + 1; setScore(newScore); if (newScore > highScore) { setHighScore(newScore); localStorage.setItem('quiz_highscore', newScore.toString()); } setTimeout(startNewRound, 1000); } else { setScore(0); setTimeout(startNewRound, 2500); } 
  };
  if (!currentRound) return <div className="fixed inset-0 bg-black/90 flex items-center justify-center text-white">Cargando...</div>;
  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col relative">
        <div className="bg-indigo-600 p-4 text-white flex justify-between items-center"><div className="flex items-center gap-2"><button onClick={onBack} className="hover:bg-indigo-500 p-1 rounded mr-2"><ArrowLeft className="w-5 h-5"/></button><h2 className="font-bold text-lg">Quiz</h2></div><button onClick={onClose} className="hover:bg-indigo-500 p-1 rounded"><X className="w-6 h-6" /></button></div>
        <div className="flex justify-between px-6 py-3 bg-indigo-50 border-b border-indigo-100"><div className="flex flex-col items-center"><span className="text-xs font-bold text-indigo-400 uppercase">Racha</span><span className="text-xl font-black text-indigo-700">{score}</span></div><div className="flex flex-col items-center"><span className="text-xs font-bold text-amber-500 uppercase flex items-center gap-1"><Trophy className="w-3 h-3"/> Récord</span><span className="text-xl font-black text-amber-600">{highScore}</span></div></div>
        <div className="p-8 text-center bg-slate-50"><span className="text-xs font-bold text-slate-400 uppercase mb-2 block">¿Cómo se dice en Árabe?</span><h3 className="text-2xl md:text-3xl font-black text-slate-800 animate-fade-in-up">{currentRound.question.spanish}</h3></div>
        <div className="p-6 grid grid-cols-1 gap-3 bg-white">{currentRound.options.map((option) => { let btnClass = "p-4 rounded-xl border-2 text-xl font-arabic text-center transition-all duration-200 shadow-sm "; if (selectedOption) { if (option.id === currentRound.question.id) btnClass += "bg-green-100 border-green-500 text-green-800 scale-105"; else if (option.id === selectedOption.id) btnClass += "bg-red-100 border-red-500 text-red-800 opacity-60"; else btnClass += "bg-slate-50 border-slate-100 text-slate-400 opacity-40"; } else btnClass += "bg-white border-slate-200 text-slate-700 hover:border-indigo-400 hover:bg-indigo-50 hover:shadow-md cursor-pointer active:scale-95"; const textToShow = showDiacritics ? option.arabic : removeArabicDiacritics(option.arabic); return <button key={option.id} disabled={!!selectedOption} onClick={() => handleOptionClick(option)} className={btnClass} dir="rtl">{textToShow}</button>; })}</div>
      </div>
    </div>
  );
}

function MemoryGame({ onBack, onClose, cards, showDiacritics }) {
  const [gameCards, setGameCards] = useState([]);
  const [flipped, setFlipped] = useState([]); const [matched, setMatched] = useState([]); const [moves, setMoves] = useState(0);
  useEffect(() => {
    const gameType = Math.random() > 0.5 ? 'word' : 'phrase';
    let pool = cards.filter(c => getCardType(c) === gameType);
    if (pool.length < 6) pool = cards;
    if (pool.length < 6) return;
    const selected = shuffleArray([...pool]).slice(0, 6);
    const deck = []; selected.forEach(p => { deck.push({ id: p.id, content: p.spanish, type: 'es', pairId: p.id }); deck.push({ id: p.id, content: p.arabic, type: 'ar', pairId: p.id }); });
    setGameCards(shuffleArray(deck));
  }, []);
  const handleCardClick = (index) => {
    if (flipped.length === 2 || flipped.includes(index) || matched.includes(gameCards[index].pairId)) return;
    const card = gameCards[index];
    if (card.type === 'ar') playSmartAudio(card.content);
    const newFlipped = [...flipped, index]; setFlipped(newFlipped);
    if (newFlipped.length === 2) {
      setMoves(m => m + 1);
      if (gameCards[newFlipped[0]].pairId === gameCards[newFlipped[1]].pairId) { setMatched([...matched, gameCards[newFlipped[0]].pairId]); setFlipped([]); }
      else setTimeout(() => setFlipped([]), 1000);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col h-[90vh] md:h-auto relative">
        <div className="bg-emerald-600 p-4 text-white flex justify-between items-center"><div className="flex items-center gap-2"><button onClick={onBack} className="hover:bg-emerald-500 p-1 rounded mr-2"><ArrowLeft className="w-5 h-5"/></button><h2 className="font-bold">Memoria</h2></div><button onClick={onClose} className="hover:bg-emerald-500 p-1 rounded"><X className="w-6 h-6"/></button></div>
        <div className="bg-emerald-50 p-2 flex justify-between items-center text-sm font-bold text-emerald-800 shrink-0"><span>Movimientos: {moves}</span><span>Parejas: {matched.length} / 6</span></div>
        <div className="p-4 bg-slate-100 flex-1 overflow-y-auto">{matched.length === 6 ? <div className="text-center py-20"><h3 className="text-3xl font-bold text-slate-800">¡Ganaste!</h3></div> : 
          <div className="grid grid-cols-3 md:grid-cols-4 gap-3">{gameCards.map((c, i) => { 
            const isFlipped = flipped.includes(i) || matched.includes(c.pairId);
            return <div key={i} onClick={() => handleCardClick(i)} className={`aspect-[3/4] bg-white rounded-xl border-2 flex items-center justify-center text-center p-2 cursor-pointer transition-all ${isFlipped ? 'border-emerald-500 bg-white' : 'bg-emerald-600 border-emerald-700'}`}>{isFlipped ? <span className={c.type === 'ar' ? 'font-arabic text-xl' : 'text-sm font-bold'}>{c.type === 'ar' && !showDiacritics ? removeArabicDiacritics(c.content) : c.content}</span> : <Grid className="text-white/30 w-8 h-8"/>}</div>
          })}</div>}
        </div>
      </div>
    </div>
  );
}

function TrueFalseGame({ onBack, onClose, cards, showDiacritics }) {
  const [round, setRound] = useState(null); const [score, setScore] = useState(0); const [timer, setTimer] = useState(0); const [gameOver, setGameOver] = useState(false); const [gameState, setGameState] = useState('menu'); const [duration, setDuration] = useState(5); const timerRef = useRef(null);
  useEffect(() => { return () => clearInterval(timerRef.current); }, []);
  useEffect(() => { if (timer <= 0 && gameState === 'playing') { setGameOver(true); setGameState('timeout'); } }, [timer]);
  const startGame = (d) => { setDuration(d); setScore(0); setGameOver(false); nextRound(d); };
  const nextRound = (d) => {
    if (cards.length < 5) return;
    const base = cards[Math.floor(Math.random() * cards.length)];
    const isMatch = Math.random() > 0.5;
    let arabic = base.arabic;
    if (!isMatch) { let c = cards.filter(x => x.id !== base.id); arabic = c[Math.floor(Math.random() * c.length)].arabic; }
    setRound({ spanish: base.spanish, arabic, isMatch });
    setTimer(d * 100); setGameState('playing');
    playSmartAudio(arabic); // AUDIO AUTOMÁTICO
    clearInterval(timerRef.current); timerRef.current = setInterval(() => setTimer(t => t - 10), 100);
  };
  const answer = (ans) => { if (gameState !== 'playing') return; clearInterval(timerRef.current); if (ans === round.isMatch) { setScore(s => s + 1); setTimeout(() => nextRound(duration), 500); } else { setGameOver(true); setGameState('incorrect'); } };
  if (gameState === 'menu') return ( <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"><div className="bg-white rounded-2xl p-8 text-center max-w-sm w-full"><h2 className="text-2xl font-bold mb-6">Velocidad</h2><div className="flex flex-col gap-3"><button onClick={() => startGame(3)} className="p-4 bg-red-100 text-red-800 rounded-xl font-bold">Experto (3s)</button><button onClick={() => startGame(5)} className="p-4 bg-orange-100 text-orange-800 rounded-xl font-bold">Normal (5s)</button><button onClick={() => startGame(10)} className="p-4 bg-green-100 text-green-800 rounded-xl font-bold">Zen (10s)</button></div><button onClick={onClose} className="mt-6 text-slate-400">Cerrar</button></div></div> );
  if (!round) return null;
  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden relative h-[500px]">
        <div className="bg-rose-600 p-4 text-white flex justify-between"><button onClick={() => setGameState('menu')}><ArrowLeft/></button><h2 className="font-bold">Racha: {score}</h2><button onClick={onClose}><X/></button></div>
        {gameOver ? <div className="h-full flex flex-col items-center justify-center text-center p-8"><Frown className="w-16 h-16 text-rose-500 mb-4"/><h3 className="text-2xl font-bold mb-2">¡Fin!</h3><p className="mb-6">Puntuación: {score}</p><button onClick={() => startGame(duration)} className="bg-rose-600 text-white px-6 py-3 rounded-xl font-bold">Repetir</button></div> : 
        <div className="h-full flex flex-col">
            <div className="h-2 bg-slate-200"><div className="h-full bg-rose-500 transition-all ease-linear" style={{width: `${(timer / (duration * 100)) * 100}%`}}/></div>
            <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6 text-center">
                <div><p className="text-xs font-bold text-slate-400 uppercase">ESPAÑOL</p><h3 className="text-2xl font-bold text-slate-800">{round.spanish}</h3></div>
                <div><p className="text-xs font-bold text-slate-400 uppercase">ÁRABE</p><h3 className="text-4xl font-bold font-arabic text-rose-600" dir="rtl">{showDiacritics ? round.arabic : removeArabicDiacritics(round.arabic)}</h3></div>
            </div>
            <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50"><button onClick={() => answer(false)} className="py-4 bg-red-100 text-red-800 rounded-xl font-bold">NO</button><button onClick={() => answer(true)} className="py-4 bg-green-100 text-green-800 rounded-xl font-bold">SÍ</button></div>
        </div>}
      </div>
    </div>
  );
}

// --- MODALES COMPLETOS ---

function CardFormModal({ card, categories, onSave, onClose }) {
  const [formData, setFormData] = useState(card || { category: 'General', spanish: '', arabic: '', phonetic: '' });
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="bg-emerald-600 p-4 text-white flex justify-between items-center"><h2 className="font-bold">{card ? 'Editar' : 'Nueva'} Tarjeta</h2><button onClick={onClose}><X className="w-5 h-5"/></button></div>
        <div className="p-6 space-y-4">
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Categoría</label><input type="text" list="cat-list" className="w-full p-2 border rounded" value={formData.category} onChange={e=>setFormData({...formData, category: e.target.value})} /><datalist id="cat-list">{categories.map(c=><option key={c} value={c}/>)}</datalist></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Español</label><input type="text" className="w-full p-2 border rounded" value={formData.spanish} onChange={e=>setFormData({...formData, spanish: e.target.value})} /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Árabe</label><input type="text" dir="rtl" className="w-full p-2 border rounded font-arabic" value={formData.arabic} onChange={e=>setFormData({...formData, arabic: e.target.value})} /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Fonética</label><input type="text" className="w-full p-2 border rounded" value={formData.phonetic} onChange={e=>setFormData({...formData, phonetic: e.target.value})} /></div>
            <button onClick={()=>onSave(formData)} className="w-full bg-emerald-600 text-white py-3 rounded-lg font-bold hover:bg-emerald-700">Guardar</button>
        </div>
      </div>
    </div>
  );
}

// RESTAURADO MODAL DE IMPORTACIÓN COMPLETO (TEXTO + ARCHIVO + CÁMARA)
function SmartImportModal({ onClose, onImport }) {
  const [activeTab, setActiveTab] = useState('text'); 
  const [text, setText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [apiKey, setApiKey] = useState(localStorage.getItem('openai_key') || "");
  const videoRef = useRef(null);

  useEffect(() => { return () => { if (cameraStream) cameraStream.getTracks().forEach(t => t.stop()); }; }, [cameraStream]);

  const startCamera = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        setCameraStream(stream);
        if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (e) { alert("Error cámara"); }
  };

  const capture = () => {
      if (!videoRef.current) return;
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth; canvas.height = videoRef.current.videoHeight;
      canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
      processImage(canvas.toDataURL('image/jpeg'));
  };

  const processImage = async (base64) => {
    if (!apiKey) { alert("Requiere API Key"); return; }
    setIsProcessing(true);
    try {
        const openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
        const res = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "user", content: [{ type: "text", text: "Extract flashcards JSON: [{category, spanish, arabic, phonetic}]" }, { type: "image_url", image_url: { url: base64 } }] }]
        });
        onImport(JSON.parse(res.choices[0].message.content.match(/\[.*\]/s)[0]));
    } catch (e) { alert(e.message); } finally { setIsProcessing(false); }
  };

  const processText = () => {
      try {
        const lines = text.split('\n').filter(l=>l.trim());
        const newCards = lines.map(line => {
            const parts = line.split('|');
            return { category: 'Importado', spanish: parts[0]?.trim(), arabic: parts[1]?.trim(), phonetic: parts[2]?.trim() || '' };
        });
        onImport(newCards);
      } catch(e) { alert("Formato incorrecto"); }
  };

  const handleFile = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.type.includes('pdf')) {
          setIsProcessing(true);
          try {
            const ab = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument(ab).promise;
            let str = "";
            for(let i=1; i<=pdf.numPages; i++) { const p = await pdf.getPage(i); const t = await p.getTextContent(); str += t.items.map(s=>s.str).join(" ") + "\n"; }
            setText(str); setActiveTab('text');
          } catch(e) { alert("Error PDF"); } finally { setIsProcessing(false); }
      } else {
          const reader = new FileReader();
          reader.onload = () => processImage(reader.result);
          reader.readAsDataURL(file);
      }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="bg-purple-600 p-4 text-white flex justify-between items-center"><h2 className="font-bold">Importar</h2><button onClick={onClose}><X className="w-5 h-5"/></button></div>
        <div className="flex border-b">
            <button onClick={()=>setActiveTab('text')} className={`flex-1 py-3 font-bold ${activeTab==='text'?'text-purple-600 border-b-2 border-purple-600':'text-slate-400'}`}>Texto</button>
            <button onClick={()=>setActiveTab('file')} className={`flex-1 py-3 font-bold ${activeTab==='file'?'text-purple-600 border-b-2 border-purple-600':'text-slate-400'}`}>Archivo</button>
            <button onClick={()=>{setActiveTab('camera'); startCamera();}} className={`flex-1 py-3 font-bold ${activeTab==='camera'?'text-purple-600 border-b-2 border-purple-600':'text-slate-400'}`}>Cámara</button>
        </div>
        <div className="p-6 overflow-y-auto">
            <input type="password" placeholder="API Key (Opcional para texto, Obligatoria para img)" className="w-full p-2 mb-4 border rounded text-xs" value={apiKey} onChange={e=>{setApiKey(e.target.value); localStorage.setItem('openai_key',e.target.value)}}/>
            
            {activeTab === 'text' && (
                <>
                    <textarea className="w-full h-40 p-2 border rounded text-xs font-mono" value={text} onChange={e=>setText(e.target.value)} placeholder="Ej: Gato | قطة"></textarea>
                    <button onClick={processText} className="w-full mt-4 bg-purple-600 text-white py-2 rounded-lg font-bold">Procesar Texto</button>
                </>
            )}

            {activeTab === 'file' && (
                <div className="border-2 border-dashed border-slate-300 rounded-lg h-40 flex flex-col items-center justify-center text-slate-400 relative">
                    <input type="file" accept=".pdf,image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFile}/>
                    {isProcessing ? <Loader className="animate-spin"/> : <><Upload className="mb-2"/> <p>Subir PDF o Imagen</p></>}
                </div>
            )}

            {activeTab === 'camera' && (
                <div className="flex flex-col items-center">
                    <div className="w-full aspect-video bg-black rounded-lg overflow-hidden mb-4 relative">
                        <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover"></video>
                    </div>
                    <button onClick={capture} disabled={isProcessing} className="bg-purple-600 text-white p-4 rounded-full shadow-lg hover:bg-purple-700 disabled:opacity-50">
                        {isProcessing ? <Loader className="animate-spin w-6 h-6"/> : <Camera className="w-6 h-6"/>}
                    </button>
                </div>
            )}
        </div>
      </div>
    </div>
  );
}

function MaintenanceModal({ onClose, cards, refreshCards }) {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="bg-blue-600 p-4 text-white flex justify-between items-center"><h2 className="font-bold">Mantenimiento</h2><button onClick={onClose}><X className="w-5 h-5"/></button></div>
        <div className="p-6 text-center"><Settings className="w-12 h-12 text-slate-300 mx-auto mb-4"/><p className="text-slate-500">Funciones avanzadas desactivadas en modo seguro.</p></div>
      </div>
    </div>
  );
}

function Flashcard({ data, frontLanguage, showDiacritics, isAdmin, onDelete, onEdit }) {
  const [flipState, setFlipState] = useState(0);
  useEffect(() => { setFlipState(0); }, [frontLanguage]);
  const handleNextFace = () => { if (!isAdmin) setFlipState((prev) => (prev + 1) % 3); };
  const playAudio = (e) => { e.stopPropagation(); playSmartAudio(data?.arabic || ""); };
  const spanishText = data?.spanish || "Sin texto";
  const arabicText = data?.arabic || "Sin texto";
  const phoneticText = data?.phonetic || "N/A";
  const displayArabic = showDiacritics ? arabicText : removeArabicDiacritics(arabicText);
  const tags = data?.category ? data.category.toString().split(';').map(t => t.trim()).filter(Boolean) : ['General'];
  let content = null;
  if (isAdmin) {
    content = <><h3 className="text-lg font-bold text-slate-800 line-clamp-2">{spanishText}</h3><h3 className="text-2xl font-arabic text-emerald-700 mt-1" dir="rtl">{displayArabic}</h3><p className="text-sm font-mono text-amber-700 italic opacity-80">{phoneticText}</p></>;
  } else if (flipState === 2) {
    content = <><p className="text-xs uppercase text-amber-600 font-bold mb-2">Fonética</p><h3 className="text-lg font-mono text-amber-800 italic">{phoneticText}</h3></>;
  } else {
    const isFront = flipState === 0;
    const currentLang = isFront ? frontLanguage : (frontLanguage === 'spanish' ? 'arabic' : 'spanish');
    if (currentLang === 'spanish') {
      content = <><p className="text-xs uppercase text-slate-400 font-bold mb-2">Español</p><h3 className="text-xl font-bold text-slate-800">{spanishText}</h3></>;
    } else {
      content = <><p className="text-xs uppercase text-emerald-600 font-bold mb-2">Árabe</p><h3 className="text-3xl font-arabic text-emerald-900 mb-4" dir="rtl">{displayArabic}</h3><button onClick={playAudio} className="p-2 bg-emerald-200 text-emerald-800 rounded-full hover:bg-emerald-300 transition-colors"><Volume2 className="w-4 h-4"/></button></>;
    }
  }
  let bgClass = "bg-white border-slate-200 text-slate-800";
  if (!isAdmin) {
    if (flipState === 0) bgClass = "bg-orange-50 border-orange-100 text-slate-800";
    if (flipState === 1) bgClass = "bg-emerald-50 border-emerald-200 text-emerald-900";
    if (flipState === 2) bgClass = "bg-amber-100 border-amber-200 text-amber-900";
  }
  return (
    <div onClick={handleNextFace} className={`relative h-60 w-full rounded-2xl shadow-sm hover:shadow-lg transition-all border flex flex-col p-4 text-center select-none group cursor-pointer ${bgClass}`}>
      {isAdmin && (
        <div className="absolute top-2 right-2 flex gap-2 z-10" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => onEdit()} className="p-2 bg-blue-100 text-blue-600 rounded-full hover:bg-blue-200 transition-colors"><Edit2 className="w-4 h-4" /></button>
          <button onClick={() => onDelete()} className="p-2 bg-red-100 text-red-600 rounded-full hover:bg-red-200 transition-colors"><Trash2 className="w-4 h-4" /></button>
        </div>
      )}
      <div className="flex-1 flex flex-col items-center justify-center w-full gap-2 mt-4">{content}</div>
      <div className="mt-auto pt-2 pb-1 flex flex-wrap gap-1 justify-center max-h-12 overflow-hidden">{tags.map((tag, i) => (<span key={i} className="text-[10px] uppercase font-bold tracking-widest bg-black/5 px-2 py-0.5 rounded-full text-slate-500 opacity-70 whitespace-nowrap">{tag}</span>))}</div>
    </div>
  );
}