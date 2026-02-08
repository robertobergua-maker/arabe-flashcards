import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from './supabaseClient';
import OpenAI from 'openai';
import * as pdfjsLib from 'pdfjs-dist'; 
// IMPORTACIÓN SEGURA: Solo iconos básicos y universales
import { 
  Search, Volume2, BookOpen, X, CheckCircle, 
  Type, Filter, Lock, Unlock, Plus, Trash2, Edit2, Save, 
  Wand2, Image as ImageIcon, FileText, Loader2, FileUp,
  Settings, AlertTriangle, ArrowRight, Check, ArrowLeft, 
  PlayCircle, HelpCircle, Grid, Zap, Activity, Mic, Star, Layout
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
  return text
    .toLowerCase()
    .normalize("NFD") 
    .replace(/[\u0300-\u036f]/g, "") 
    .replace(/[\u064B-\u065F\u0670]/g, ""); 
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

const ARABIC_ALPHABET = [
  'ا', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'ه', 'و', 'ي'
];

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
        const preferredVoice = voices.find(v => 
            v.lang.includes('ar') && 
            (v.name.includes('Google') || v.name.includes('Maged') || v.name.includes('Tariq'))
        );
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
  const [loadingProgress, setLoadingProgress] = useState(""); 
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
    const loadVoices = () => { window.speechSynthesis.getVoices(); };
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
    }
    fetchAllCards();
  }, []);

  async function fetchAllCards() {
    try {
      setLoading(true);
      let allData = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;
      let safetyCounter = 0; 

      while (hasMore && safetyCounter < 50) {
        setLoadingProgress(`Cargando... (${allData.length} tarjetas)`);
        
        const { data, error } = await supabase
          .from('flashcards')
          .select('*')
          .range(page * pageSize, (page + 1) * pageSize - 1)
          .order('id', { ascending: false });

        if (error) throw error;

        if (data && data.length > 0) {
          allData = [...allData, ...data];
          if (data.length < pageSize) hasMore = false;
          else page++;
        } else {
          hasMore = false;
        }
        safetyCounter++;
      }

      const uniqueCards = Array.from(new Map(allData.map(item => [item.id, item])).values());
      setCards(uniqueCards);
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  }

  const handleAdminToggle = () => {
    if (isAdminMode) {
      setIsAdminMode(false);
    } else {
      const password = prompt("🔒 Contraseña:");
      if (password === "1234") setIsAdminMode(true);
    }
  };

  const handleSaveCard = async (cardData) => {
    try {
      if (cardData.id) {
        const { error } = await supabase.from('flashcards').update({
            category: cardData.category,
            spanish: cardData.spanish,
            arabic: cardData.arabic,
            phonetic: cardData.phonetic
          }).eq('id', cardData.id);
        if (error) throw error;
        setCards(prev => prev.map(c => c.id === cardData.id ? cardData : c));
      } else {
        const { id, ...newCardData } = cardData;
        const { data, error } = await supabase.from('flashcards').insert([newCardData]).select();
        if (error) throw error;
        if (data) setCards(prev => [data[0], ...prev]);
      }
      setIsFormOpen(false);
      setEditingCard(null);
    } catch (error) {
      alert("Error: " + error.message);
    }
  };

  const handleBulkImport = async (newCards) => {
    try {
      const cleanCards = newCards.map(c => ({
        category: c.category,
        spanish: c.spanish,
        arabic: c.arabic,
        phonetic: c.phonetic
      }));
      const { data, error } = await supabase.from('flashcards').insert(cleanCards).select();
      if (error) throw error;
      if (data) {
        setCards(prev => [...data, ...prev]);
        alert(`¡${data.length} tarjetas importadas!`);
        setIsSmartImportOpen(false);
      }
    } catch (error) {
      alert("Error: " + error.message);
    }
  };

  const handleDeleteCard = async (id) => {
    if (!window.confirm("¿Borrar?")) return;
    try {
      const { error } = await supabase.from('flashcards').delete().eq('id', id);
      if (error) throw error;
      setCards(prev => prev.filter(c => c.id !== id));
    } catch (error) {
      alert("Error: " + error.message);
    }
  };

  const openNewCardModal = () => { setEditingCard(null); setIsFormOpen(true); };
  const openEditCardModal = (card) => { setEditingCard(card); setIsFormOpen(true); };

  const categories = useMemo(() => {
    const allTags = new Set();
    cards.forEach(card => {
      if (!card.category) { allTags.add("General"); return; }
      const tags = card.category.toString().split(';');
      tags.forEach(tag => {
        const cleanTag = tag.trim();
        if (cleanTag.length > 0) allTags.add(cleanTag);
      });
    });
    const uniqueCats = Array.from(allTags);
    const pistaCats = uniqueCats.filter(c => c.toLowerCase().startsWith('pista'));
    const otherCats = uniqueCats.filter(c => !c.toLowerCase().startsWith('pista'));
    pistaCats.sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)?.[0] || 0);
      const numB = parseInt(b.match(/\d+/)?.[0] || 0);
      return numA - numB;
    });
    otherCats.sort((a, b) => a.localeCompare(b));
    return ["Todos", ...pistaCats, ...otherCats];
  }, [cards]);

  const filteredCards = useMemo(() => {
    const normalizedTerm = normalizeForSearch(searchTerm);
    let result = cards.filter(card => {
      const s = normalizeForSearch(card.spanish || "");
      const a = normalizeForSearch(card.arabic || "");
      const matchesSearch = s.includes(normalizedTerm) || a.includes(normalizedTerm);
      let matchesCategory = false;
      if (selectedCategory === "Todos") {
        matchesCategory = true;
      } else {
        const rawCat = card.category || "General";
        const cardTags = rawCat.toString().split(';').map(t => t.trim());
        matchesCategory = cardTags.includes(selectedCategory);
      }
      return matchesSearch && matchesCategory;
    });
    if (selectedCategory === "Todos" && searchTerm === "") {
      return shuffleArray(result);
    }
    return result;
  }, [cards, searchTerm, selectedCategory]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans flex flex-col">
      <header className={`text-white shadow-md z-20 sticky top-0 transition-colors ${isAdminMode ? 'bg-slate-800' : 'bg-emerald-700'}`}>
        <div className="w-full px-4 py-3 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <BookOpen className="w-7 h-7" />
            <h1 className="text-xl font-bold">{isAdminMode ? "Modo Admin" : "Aprende Árabe"}</h1>
          </div>
          
          <div className="flex-1 w-full max-w-4xl flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-white/50" />
              <input 
                type="text"
                placeholder="Buscar (ej: arbol, kitab)..."
                className="w-full pl-9 pr-4 py-2 bg-black/20 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-white/40 placeholder-white/50 text-sm text-white"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="relative md:w-64">
                <Filter className="absolute left-3 top-2.5 w-4 h-4 text-white/50 pointer-events-none" />
                <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="w-full pl-9 pr-8 py-2 bg-black/20 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-white/40 text-sm text-white appearance-none cursor-pointer">
                    {categories.map(cat => <option key={cat} value={cat} className="text-slate-800 bg-white">{cat}</option>)}
                </select>
            </div>
            
            <div className="flex gap-2">
                <button 
                    onClick={() => setIsGamesHubOpen(true)} 
                    className="p-2 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white transition-colors flex items-center justify-center shadow-lg"
                    title="Juegos"
                >
                    <PlayCircle className="w-6 h-6" />
                </button>

                <div className="flex items-center gap-2 bg-black/20 rounded-lg p-1 border border-white/10">
                    <button onClick={() => setFrontLanguage('spanish')} className={`px-2 py-1.5 rounded-md text-xs font-bold ${frontLanguage === 'spanish' ? 'bg-white text-slate-800' : 'text-white/70'}`}>ES</button>
                    <button onClick={() => setFrontLanguage('arabic')} className={`px-2 py-1.5 rounded-md text-xs font-bold ${frontLanguage === 'arabic' ? 'bg-white text-slate-800' : 'text-white/70'}`}>AR</button>
                    <button onClick={() => setShowDiacritics(!showDiacritics)} className={`px-2 py-1.5 rounded-md text-xs font-bold ${showDiacritics ? 'bg-white text-slate-800' : 'text-white/70'}`}>
                        <Type className="w-3.5 h-3.5" />
                    </button>
                </div>

                <button onClick={handleAdminToggle} className={`p-2 rounded-lg transition-colors ${isAdminMode ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-black/20 hover:bg-black/30 text-white/70'}`}>
                {isAdminMode ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                </button>
            </div>
          </div>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto bg-slate-100 p-4 md:p-8">
          <div className="max-w-6xl mx-auto">
            {isAdminMode && (
              <div className="mb-6 flex flex-wrap justify-center gap-4 animate-fade-in-up">
                <button onClick={openNewCardModal} className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-full shadow-lg hover:bg-emerald-700 hover:scale-105 transition-all font-bold"><Plus className="w-5 h-5" /> Añadir Manual</button>
                <button onClick={() => setIsSmartImportOpen(true)} className="flex items-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-full shadow-lg hover:bg-purple-700 hover:scale-105 transition-all font-bold"><Wand2 className="w-5 h-5" /> Importar con IA</button>
                <button onClick={() => setIsMaintenanceOpen(true)} className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 hover:scale-105 transition-all font-bold"><Settings className="w-5 h-5" /> Mantenimiento BD</button>
              </div>
            )}
            {loading ? (
               <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3"><Loader2 className="w-8 h-8 animate-spin text-emerald-600" /><span className="font-medium animate-pulse">{loadingProgress || "Conectando..."}</span></div>
            ) : filteredCards.length === 0 ? (
              <div className="text-center py-20 text-slate-400">No hay tarjetas para esta selección.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredCards.map(card => <Flashcard key={card.id} data={card} frontLanguage={frontLanguage} showDiacritics={showDiacritics} isAdmin={isAdminMode} onDelete={() => handleDeleteCard(card.id)} onEdit={() => openEditCardModal(card)} />)}
              </div>
            )}
            {!loading && <div className="mt-8 text-center text-[10px] text-slate-300 font-mono">Total Tarjetas: {cards.length} | Categorías: {categories.length - 1}</div>}
          </div>
      </div>
      {isFormOpen && <CardFormModal card={editingCard} categories={categories.filter(c => c !== "Todos")} onSave={handleSaveCard} onClose={() => setIsFormOpen(false)} />}
      {isSmartImportOpen && <SmartImportModal onClose={() => setIsSmartImportOpen(false)} onImport={handleBulkImport} />}
      {isMaintenanceOpen && <MaintenanceModal onClose={() => setIsMaintenanceOpen(false)} cards={cards} refreshCards={fetchAllCards} />}
      {isGamesHubOpen && <GamesHub onClose={() => setIsGamesHubOpen(false)} cards={cards} showDiacritics={showDiacritics} />}
    </div>
  );
}

// --- JUEGOS Y MODALES ---

function GamesHub({ onClose, cards, showDiacritics }) {
  const [activeGame, setActiveGame] = useState(() => localStorage.getItem('current_game') || 'menu'); 

  useEffect(() => { localStorage.setItem('current_game', activeGame); }, [activeGame]);

  if (activeGame === 'quiz') return <QuizGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} showDiacritics={showDiacritics} />;
  if (activeGame === 'memory') return <MemoryGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} showDiacritics={showDiacritics} />;
  if (activeGame === 'truefalse') return <TrueFalseGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} showDiacritics={showDiacritics} />;
  if (activeGame === 'lettergap') return <LetterGapGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} showDiacritics={showDiacritics} />;
  if (activeGame === 'listening') return <ListeningGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} showDiacritics={showDiacritics} />;

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col relative">
        <div className="bg-slate-800 p-6 text-white flex justify-between items-center">
          <div className="flex items-center gap-3"><span className="text-2xl">🎮</span><h2 className="font-bold text-2xl">Arcade</h2></div>
          <button onClick={onClose} className="hover:bg-slate-700 p-2 rounded-full transition"><X className="w-6 h-6" /></button>
        </div>

        <div className="p-8 bg-slate-100 grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto max-h-[70vh]">
          {/* Tarjeta Quiz */}
          <button onClick={() => setActiveGame('quiz')} className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl hover:scale-105 transition-all group text-left border border-slate-200">
            <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center mb-4 group-hover:bg-indigo-600 group-hover:text-white transition-colors"><HelpCircle className="w-7 h-7" /></div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">Quiz Express</h3>
            <p className="text-sm text-slate-500">¿Eres rápido? Elige la traducción correcta.</p>
          </button>

          {/* Tarjeta Memory */}
          <button onClick={() => setActiveGame('memory')} className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl hover:scale-105 transition-all group text-left border border-slate-200">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center mb-4 group-hover:bg-emerald-600 group-hover:text-white transition-colors"><Grid className="w-7 h-7" /></div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">Memoria</h3>
            <p className="text-sm text-slate-500">Ejercita tu mente. Encuentra las parejas.</p>
          </button>

          {/* Tarjeta True/False */}
          <button onClick={() => setActiveGame('truefalse')} className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl hover:scale-105 transition-all group text-left border border-slate-200">
            <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center mb-4 group-hover:bg-rose-600 group-hover:text-white transition-colors"><Activity className="w-7 h-7" /></div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">Velocidad</h3>
            <p className="text-sm text-slate-500">Verdadero o Falso. Tienes 3, 5 o 10 segundos.</p>
          </button>

          {/* Tarjeta Letras */}
          <button onClick={() => setActiveGame('lettergap')} className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl hover:scale-105 transition-all group text-left border border-slate-200">
            <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center mb-4 group-hover:bg-amber-600 group-hover:text-white transition-colors"><Edit2 className="w-7 h-7" /></div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">El Escriba</h3>
            <p className="text-sm text-slate-500">Completa la palabra. Elige la letra que falta.</p>
          </button>

          {/* Tarjeta Listening */}
          <button onClick={() => setActiveGame('listening')} className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl hover:scale-105 transition-all group text-left border border-slate-200 md:col-span-2">
            <div className="w-12 h-12 bg-cyan-100 text-cyan-600 rounded-xl flex items-center justify-center mb-4 group-hover:bg-cyan-600 group-hover:text-white transition-colors"><Mic className="w-7 h-7" /></div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">Oído Fino</h3>
            <p className="text-sm text-slate-500">Escucha la palabra en árabe y elige su significado.</p>
          </button>
        </div>
      </div>
    </div>
  );
}

function ListeningGame({ onBack, onClose, cards, showDiacritics }) {
  const [round, setRound] = useState(null);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => safeGetStorage('listen_highscore', 0));
  const [selectedOption, setSelectedOption] = useState(null);
  const [isCorrect, setIsCorrect] = useState(null);

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
    setIsCorrect(null);
    setTimeout(() => playSmartAudio(correctCard.arabic), 500);
  };

  const handleOptionClick = (option) => {
    if (selectedOption) return;
    setSelectedOption(option);
    const correct = option.id === round.card.id;
    setIsCorrect(correct);
    if (correct) {
      const newScore = score + 1;
      setScore(newScore);
      if (newScore > highScore) { setHighScore(newScore); localStorage.setItem('listen_highscore', newScore.toString()); }
      setTimeout(startNewRound, 1500);
    } else {
      setScore(0);
      setTimeout(startNewRound, 2500);
    }
  };

  if (!round) return <div className="fixed inset-0 bg-black/90 flex items-center justify-center text-white">Cargando...</div>;

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col relative">
        <div className="bg-cyan-600 p-4 text-white flex justify-between items-center"><div className="flex items-center gap-2"><button onClick={onBack} className="hover:bg-cyan-500 p-1 rounded mr-2"><ArrowLeft className="w-5 h-5"/></button><h2 className="font-bold text-lg">Oído Fino</h2></div><button onClick={onClose} className="hover:bg-cyan-500 p-1 rounded"><X className="w-6 h-6" /></button></div>
        <div className="flex justify-between px-6 py-3 bg-cyan-50 border-b border-cyan-100"><div className="flex flex-col items-center"><span className="text-xs font-bold text-cyan-400 uppercase">Racha</span><span className="text-xl font-black text-cyan-700">{score}</span></div><div className="flex flex-col items-center"><span className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1"><Trophy className="w-3 h-3"/> Récord</span><span className="text-xl font-black text-slate-600">{highScore}</span></div></div>
        <div className="p-8 text-center bg-slate-50 flex flex-col items-center justify-center min-h-[180px]">
          {selectedOption ? (
             <div className="animate-fade-in-up">
                 <span className="text-xs font-bold text-slate-400 uppercase mb-2 block">Es...</span>
                 <h3 className="text-3xl font-black font-arabic text-slate-800 mb-2" dir="rtl">{showDiacritics ? round.card.arabic : removeArabicDiacritics(round.card.arabic)}</h3>
                 <p className="text-sm text-slate-500 italic">{round.card.phonetic}</p>
             </div>
          ) : <button onClick={() => playSmartAudio(round.card.arabic)} className="w-24 h-24 rounded-full bg-cyan-100 text-cyan-600 flex items-center justify-center hover:scale-110 hover:bg-cyan-200 transition-all shadow-lg border-4 border-white"><Volume2 className="w-12 h-12" /></button>}
        </div>
        <div className="p-6 grid grid-cols-1 gap-3 bg-white">
          {round.options.map((option) => {
            let btnClass = "p-4 rounded-xl border-2 text-lg text-center transition-all duration-200 shadow-sm font-bold ";
            if (selectedOption) {
              if (option.id === round.card.id) btnClass += "bg-green-100 border-green-500 text-green-800 scale-105";
              else if (option.id === selectedOption.id && !isCorrect) btnClass += "bg-red-100 border-red-500 text-red-800 opacity-60";
              else btnClass += "bg-slate-50 border-slate-100 text-slate-400 opacity-40";
            } else btnClass += "bg-white border-slate-200 text-slate-700 hover:border-cyan-400 hover:bg-cyan-50 hover:shadow-md cursor-pointer active:scale-95";
            return <button key={option.id} disabled={!!selectedOption} onClick={() => handleOptionClick(option)} className={btnClass}>{option.spanish}</button>;
          })}
        </div>
      </div>
    </div>
  );
}

function LetterGapGame({ onBack, onClose, cards, showDiacritics }) {
  const [round, setRound] = useState(null);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => safeGetStorage('letter_highscore', 0));
  const [selectedOption, setSelectedOption] = useState(null);
  const [isCorrect, setIsCorrect] = useState(null);

  useEffect(() => { startNewRound(); }, []);

  const startNewRound = () => {
    if (cards.length < 4) return;
    let candidate = null;
    for(let i=0; i<20; i++) {
        const randomCard = cards[Math.floor(Math.random() * cards.length)];
        const clean = removeArabicDiacritics(randomCard.arabic);
        if (clean.length > 1 && getCardType(randomCard) === 'word') { candidate = randomCard; break; }
    }
    if (!candidate) candidate = cards[Math.floor(Math.random() * cards.length)];
    const originalText = showDiacritics ? candidate.arabic : removeArabicDiacritics(candidate.arabic);
    const textArray = Array.from(originalText);
    const validIndices = textArray.map((char, index) => ARABIC_ALPHABET.includes(char) || ARABIC_ALPHABET.some(l => removeArabicDiacritics(char) === l) ? index : -1).filter(i => i !== -1);
    if (validIndices.length === 0) { setTimeout(startNewRound, 100); return; }
    const indexToHide = validIndices[Math.floor(Math.random() * validIndices.length)];
    const correctLetter = textArray[indexToHide]; 
    let distractors = [];
    while(distractors.length < 3) {
        const randomLetter = ARABIC_ALPHABET[Math.floor(Math.random() * ARABIC_ALPHABET.length)];
        if (removeArabicDiacritics(randomLetter) !== removeArabicDiacritics(correctLetter)) distractors.push(randomLetter);
    }
    const maskedTextArray = [...textArray];
    maskedTextArray[indexToHide] = "___"; 
    setRound({ card: candidate, questionText: maskedTextArray.join(""), correctOption: correctLetter, options: shuffleArray([correctLetter, ...distractors]) });
    setSelectedOption(null);
    setIsCorrect(null);
  };

  const handleOptionClick = (option) => {
    if (selectedOption) return;
    setSelectedOption(option);
    const correct = option === round.correctOption;
    setIsCorrect(correct);
    if (correct) {
      const newScore = score + 1;
      setScore(newScore);
      if (newScore > highScore) { setHighScore(newScore); localStorage.setItem('letter_highscore', newScore.toString()); }
      setTimeout(startNewRound, 1500);
    } else {
      setScore(0);
      setTimeout(startNewRound, 2500);
    }
  };

  if (!round) return <div className="fixed inset-0 bg-black/90 flex items-center justify-center text-white">Cargando...</div>;

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col relative">
        <div className="bg-amber-600 p-4 text-white flex justify-between items-center">
          <div className="flex items-center gap-2"><button onClick={onBack} className="hover:bg-amber-500 p-1 rounded mr-2"><ArrowLeft className="w-5 h-5"/></button><h2 className="font-bold text-lg">El Escriba</h2></div><button onClick={onClose} className="hover:bg-amber-500 p-1 rounded"><X className="w-6 h-6" /></button>
        </div>
        <div className="flex justify-between px-6 py-3 bg-amber-50 border-b border-amber-100">
          <div className="flex flex-col items-center"><span className="text-xs font-bold text-amber-400 uppercase">Racha</span><span className="text-xl font-black text-amber-700">{score}</span></div>
          <div className="flex flex-col items-center"><span className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1"><Trophy className="w-3 h-3"/> Récord</span><span className="text-xl font-black text-slate-600">{highScore}</span></div>
        </div>
        <div className="p-8 text-center bg-slate-50 flex flex-col items-center justify-center min-h-[200px]">
          <span className="text-xs font-bold text-slate-400 uppercase mb-4 block">Completa: {round.card.spanish}</span>
          <h3 className="text-4xl md:text-5xl font-black font-arabic text-slate-800 animate-fade-in-up leading-relaxed" dir="rtl">
            {selectedOption && isCorrect ? (showDiacritics ? round.card.arabic : removeArabicDiacritics(round.card.arabic)) : round.questionText}
          </h3>
        </div>
        <div className="p-6 grid grid-cols-4 gap-3 bg-white">
          {round.options.map((option, idx) => {
            let btnClass = "aspect-square rounded-xl border-2 text-2xl font-arabic flex items-center justify-center transition-all duration-200 shadow-sm ";
            if (selectedOption) {
              if (option === round.correctOption) btnClass += "bg-green-100 border-green-500 text-green-800 scale-105";
              else if (option === selectedOption && !isCorrect) btnClass += "bg-red-100 border-red-500 text-red-800 opacity-60";
              else btnClass += "bg-slate-50 border-slate-100 text-slate-400 opacity-40";
            } else btnClass += "bg-white border-slate-200 text-slate-700 hover:border-amber-400 hover:bg-amber-50 hover:shadow-md cursor-pointer active:scale-95";
            return <button key={idx} disabled={!!selectedOption} onClick={() => handleOptionClick(option)} className={btnClass}>{option}</button>;
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
  const [isCorrect, setIsCorrect] = useState(null);

  useEffect(() => { startNewRound(); }, []);

  const startNewRound = () => {
    if (cards.length < 4) return;
    const correctCard = cards[Math.floor(Math.random() * cards.length)];
    const targetType = getCardType(correctCard);
    let candidates = cards.filter(c => c.id !== correctCard.id && getCardType(c) === targetType);
    if (candidates.length < 3) candidates = cards.filter(c => c.id !== correctCard.id);
    const distractors = shuffleArray(candidates).slice(0, 3);
    setCurrentRound({ question: correctCard, options: shuffleArray([correctCard, ...distractors]) });
    setSelectedOption(null);
    setIsCorrect(null);
  };

  const handleOptionClick = (option) => {
    if (selectedOption) return;
    setSelectedOption(option);
    const correct = option.id === currentRound.question.id;
    setIsCorrect(correct);
    if (correct) {
      const newScore = score + 1;
      setScore(newScore);
      if (newScore > highScore) { setHighScore(newScore); localStorage.setItem('quiz_highscore', newScore.toString()); }
      setTimeout(startNewRound, 1000);
    } else {
      setScore(0);
      setTimeout(startNewRound, 2500);
    }
  };

  if (!currentRound) return <div className="fixed inset-0 bg-black/90 flex items-center justify-center text-white">Cargando...</div>;

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col relative">
        <div className="bg-indigo-600 p-4 text-white flex justify-between items-center"><div className="flex items-center gap-2"><button onClick={onBack} className="hover:bg-indigo-500 p-1 rounded mr-2"><ArrowLeft className="w-5 h-5"/></button><h2 className="font-bold text-lg">Quiz Express</h2></div><button onClick={onClose} className="hover:bg-indigo-500 p-1 rounded"><X className="w-6 h-6" /></button></div>
        <div className="flex justify-between px-6 py-3 bg-indigo-50 border-b border-indigo-100"><div className="flex flex-col items-center"><span className="text-xs font-bold text-indigo-400 uppercase">Racha</span><span className="text-xl font-black text-indigo-700">{score}</span></div><div className="flex flex-col items-center"><span className="text-xs font-bold text-amber-500 uppercase flex items-center gap-1"><Trophy className="w-3 h-3"/> Récord</span><span className="text-xl font-black text-amber-600">{highScore}</span></div></div>
        <div className="p-8 text-center bg-slate-50"><span className="text-xs font-bold text-slate-400 uppercase mb-2 block">¿Cómo se dice en Árabe?</span><h3 className="text-2xl md:text-3xl font-black text-slate-800 animate-fade-in-up">{currentRound.question.spanish}</h3></div>
        <div className="p-6 grid grid-cols-1 gap-3 bg-white">
          {currentRound.options.map((option) => {
            let btnClass = "p-4 rounded-xl border-2 text-xl font-arabic text-center transition-all duration-200 shadow-sm ";
            if (selectedOption) {
              if (option.id === currentRound.question.id) btnClass += "bg-green-100 border-green-500 text-green-800 scale-105";
              else if (option.id === selectedOption.id && !isCorrect) btnClass += "bg-red-100 border-red-500 text-red-800 opacity-60";
              else btnClass += "bg-slate-50 border-slate-100 text-slate-400 opacity-40";
            } else btnClass += "bg-white border-slate-200 text-slate-700 hover:border-indigo-400 hover:bg-indigo-50 hover:shadow-md cursor-pointer active:scale-95";
            const textToShow = showDiacritics ? option.arabic : removeArabicDiacritics(option.arabic);
            return <button key={option.id} disabled={!!selectedOption} onClick={() => handleOptionClick(option)} className={btnClass} dir="rtl">{textToShow}</button>;
          })}
        </div>
      </div>
    </div>
  );
}

function MemoryGame({ onBack, onClose, cards, showDiacritics }) {
  const [gameCards, setGameCards] = useState([]);
  const [flipped, setFlipped] = useState([]); 
  const [matched, setMatched] = useState([]); 
  const [disabled, setDisabled] = useState(false);
  const [moves, setMoves] = useState(0);

  useEffect(() => { startNewGame(); }, []);

  const startNewGame = () => {
    const gameType = Math.random() > 0.5 ? 'word' : 'phrase';
    let pool = cards.filter(c => getCardType(c) === gameType);
    if (pool.length < 6) pool = cards;
    if (pool.length < 6) return; 
    const selectedPairs = shuffleArray([...pool]).slice(0, 6);
    const deck = [];
    selectedPairs.forEach(pair => {
      deck.push({ id: pair.id, content: pair.spanish, type: 'es', pairId: pair.id });
      deck.push({ id: pair.id, content: pair.arabic, type: 'ar', pairId: pair.id });
    });
    setGameCards(shuffleArray(deck));
    setFlipped([]);
    setMatched([]);
    setMoves(0);
    setDisabled(false);
  };

  const handleCardClick = (index) => {
    if (disabled || flipped.includes(index) || matched.includes(gameCards[index].pairId)) return;
    const newFlipped = [...flipped, index];
    setFlipped(newFlipped);
    if (newFlipped.length === 2) {
      setDisabled(true);
      setMoves(prev => prev + 1);
      const [firstIdx, secondIdx] = newFlipped;
      if (gameCards[firstIdx].pairId === gameCards[secondIdx].pairId) {
        setMatched(prev => [...prev, gameCards[firstIdx].pairId]);
        setFlipped([]);
        setDisabled(false);
      } else {
        setTimeout(() => { setFlipped([]); setDisabled(false); }, 1000);
      }
    }
  };

  const isWin = matched.length === 6;

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col h-[90vh] md:h-auto relative">
        <div className="bg-emerald-600 p-4 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2"><button onClick={onBack} className="hover:bg-emerald-500 p-1 rounded mr-2"><ArrowLeft className="w-5 h-5"/></button><h2 className="font-bold text-lg">Memoria</h2></div><button onClick={onClose} className="hover:bg-emerald-500 p-1 rounded"><X className="w-6 h-6" /></button>
        </div>
        <div className="bg-emerald-50 p-2 flex justify-between items-center text-sm font-bold text-emerald-800 shrink-0"><span>Movimientos: {moves}</span><span>Parejas: {matched.length} / 6</span></div>
        <div className="p-4 bg-slate-100 flex-1 overflow-y-auto">
            {isWin ? (
                <div className="h-full flex flex-col items-center justify-center text-center"><Trophy className="w-20 h-20 text-yellow-500 mb-4 animate-bounce" /><h3 className="text-3xl font-black text-slate-800 mb-2">¡Completado!</h3><button onClick={startNewGame} className="bg-emerald-600 text-white px-6 py-3 rounded-full font-bold shadow-lg hover:bg-emerald-700 transition">Jugar de nuevo</button></div>
            ) : (
                <div className="grid grid-cols-3 md:grid-cols-4 gap-3 h-full content-center">
                    {gameCards.map((card, index) => {
                        const isFlipped = flipped.includes(index) || matched.includes(card.pairId);
                        const textToShow = card.type === 'ar' ? (showDiacritics ? card.content : removeArabicDiacritics(card.content)) : card.content;
                        return (
                            <div key={index} onClick={() => handleCardClick(index)} className="aspect-[3/4] cursor-pointer perspective-1000 group">
                                <div className="relative w-full h-full duration-500 transition-all preserve-3d" style={{ transformStyle: 'preserve-3d', transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}>
                                    <div className="absolute inset-0 backface-hidden bg-emerald-600 rounded-xl border-2 border-emerald-700 flex items-center justify-center shadow-md" style={{ backfaceVisibility: 'hidden' }}><Grid className="text-white/30 w-10 h-10" /></div>
                                    <div className="absolute inset-0 backface-hidden bg-white rounded-xl border-2 border-emerald-500 flex items-center justify-center p-2 text-center shadow-md" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}><span className={`font-bold text-slate-800 ${card.type === 'ar' ? 'font-arabic text-xl' : 'text-sm'}`} dir={card.type === 'ar' ? 'rtl' : 'ltr'}>{textToShow}</span></div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
      </div>
    </div>
  );
}

function TrueFalseGame({ onBack, onClose, cards, showDiacritics }) {
  const [round, setRound] = useState(null);
  const [score, setScore] = useState(0);
  const [timer, setTimer] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [gameState, setGameState] = useState('menu'); 
  const [selectedDuration, setSelectedDuration] = useState(null); 
  const timerRef = useRef(null);

  useEffect(() => { return () => clearInterval(timerRef.current); }, []);
  useEffect(() => { if (timer <= 0 && gameState === 'playing') endGame(); }, [timer]);

  const startGame = (duration) => {
    setSelectedDuration(duration);
    setScore(0);
    setGameOver(false);
    startNewRound(duration);
  };

  const startNewRound = (durationOverride = null) => {
    if (cards.length < 5) return;
    const limit = durationOverride || selectedDuration; 
    const baseCard = cards[Math.floor(Math.random() * cards.length)];
    const targetType = getCardType(baseCard);
    const isMatch = Math.random() > 0.5;
    let arabicText = baseCard.arabic;
    if (!isMatch) {
        let candidates = cards.filter(c => c.id !== baseCard.id && getCardType(c) === targetType);
        if (candidates.length === 0) candidates = cards.filter(c => c.id !== baseCard.id);
        const distractor = candidates[Math.floor(Math.random() * candidates.length)];
        arabicText = distractor.arabic;
    }
    setRound({ spanish: baseCard.spanish, arabic: arabicText, isMatch: isMatch });
    setTimer(limit * 100); 
    setGameState('playing');
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => { setTimer(prev => prev - 10); }, 100);
  };

  const handleChoice = (choice) => { 
    if (gameState !== 'playing') return;
    clearInterval(timerRef.current);
    if (choice === round.isMatch) {
        setGameState('correct');
        setScore(s => s + 1);
        setTimeout(() => startNewRound(), 500);
    } else {
        setGameState('incorrect');
        setGameOver(true);
    }
  };

  const endGame = () => {
    clearInterval(timerRef.current);
    setGameState('timeout');
    setGameOver(true);
  };

  if (gameState === 'menu') {
      return (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col relative">
                <div className="bg-rose-600 p-4 text-white flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-2"><button onClick={onBack} className="hover:bg-rose-500 p-1 rounded mr-2"><ArrowLeft className="w-5 h-5"/></button><h2 className="font-bold text-lg">Velocidad</h2></div><button onClick={onClose} className="hover:bg-rose-500 p-1 rounded"><X className="w-6 h-6" /></button>
                </div>
                <div className="p-8 text-center">
                    <h3 className="text-xl font-bold text-slate-800 mb-6">Elige tu nivel</h3>
                    <div className="flex flex-col gap-3">
                        <button onClick={() => startGame(3)} className="p-4 bg-red-100 text-red-700 rounded-xl font-bold border-2 border-red-200 hover:bg-red-200 flex items-center justify-between group"><span className="flex items-center gap-2"><Zap className="w-5 h-5"/> Experto (3s)</span><ArrowRight className="w-5 h-5 opacity-0 group-hover:opacity-100 transition"/></button>
                        <button onClick={() => startGame(5)} className="p-4 bg-orange-100 text-orange-700 rounded-xl font-bold border-2 border-orange-200 hover:bg-orange-200 flex items-center justify-between group"><span className="flex items-center gap-2"><Clock className="w-5 h-5"/> Normal (5s)</span><ArrowRight className="w-5 h-5 opacity-0 group-hover:opacity-100 transition"/></button>
                        <button onClick={() => startGame(10)} className="p-4 bg-green-100 text-green-700 rounded-xl font-bold border-2 border-green-200 hover:bg-green-200 flex items-center justify-between group"><span className="flex items-center gap-2"><Activity className="w-5 h-5"/> Zen (10s)</span><ArrowRight className="w-5 h-5 opacity-0 group-hover:opacity-100 transition"/></button>
                    </div>
                </div>
            </div>
        </div>
      );
  }

  if (!round) return <div className="fixed inset-0 bg-black/90 flex items-center justify-center text-white">Cargando...</div>;

  const arabicDisplay = showDiacritics ? round.arabic : removeArabicDiacritics(round.arabic);

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col relative h-[500px]">
        <div className="bg-rose-600 p-4 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2"><button onClick={() => setGameState('menu')} className="hover:bg-rose-500 p-1 rounded mr-2"><ArrowLeft className="w-5 h-5"/></button><h2 className="font-bold text-lg">Velocidad</h2></div><button onClick={onClose} className="hover:bg-rose-500 p-1 rounded"><X className="w-6 h-6" /></button>
        </div>
        {gameOver ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-fade-in-up">
                <Frown className="w-20 h-20 text-rose-500 mb-4" /><h3 className="text-3xl font-black text-slate-800 mb-2">¡Fin del Juego!</h3>
                <p className="text-slate-500 mb-2">{gameState === 'timeout' ? "¡Se acabó el tiempo!" : "¡Respuesta incorrecta!"}</p>
                <div className="text-4xl font-black text-rose-600 mb-8">{score} Puntos</div><button onClick={() => startGame(selectedDuration)} className="w-full bg-rose-600 text-white py-3 rounded-xl font-bold shadow-lg hover:bg-rose-700 transition">Intentar de nuevo</button>
            </div>
        ) : (
            <div className="flex-1 flex flex-col relative">
                <div className="h-2 bg-slate-200 w-full"><div className={`h-full transition-all duration-100 ease-linear ${timer < 100 ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${(timer / (selectedDuration * 100)) * 100}%` }}/></div>
                <div className="p-4 flex justify-between items-center text-rose-800 font-bold bg-rose-50"><span className="flex items-center gap-2"><Trophy className="w-4 h-4"/> Puntuación</span><span className="text-xl">{score}</span></div>
                <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6"><div className="text-center w-full"><p className="text-xs uppercase font-bold text-slate-400 mb-2">ESPAÑOL</p><h3 className="text-2xl font-bold text-slate-800 border-b-2 border-slate-100 pb-4 w-full">{round.spanish}</h3></div><div className="text-center w-full"><p className="text-xs uppercase font-bold text-slate-400 mb-2">ÁRABE</p><h3 className="text-4xl font-bold font-arabic text-rose-700 py-2" dir="rtl">{arabicDisplay}</h3></div></div>
                <div className="p-4 grid grid-cols-2 gap-4 bg-slate-50 border-t border-slate-200">
                    <button onClick={() => handleChoice(false)} className="py-4 rounded-xl bg-red-100 text-red-700 font-bold border-2 border-red-200 hover:bg-red-200 hover:border-red-300 transition flex flex-col items-center gap-1"><X className="w-6 h-6" /> NO</button>
                    <button onClick={() => handleChoice(true)} className="py-4 rounded-xl bg-green-100 text-green-700 font-bold border-2 border-green-200 hover:bg-green-200 hover:border-green-300 transition flex flex-col items-center gap-1"><Check className="w-6 h-6" /> SÍ</button>
                </div>
                {gameState === 'correct' && <div className="absolute inset-0 bg-green-500/90 flex items-center justify-center z-10 animate-fade-in"><CheckCircle className="w-20 h-20 text-white animate-bounce" /></div>}
                {gameState === 'incorrect' && <div className="absolute inset-0 bg-red-500/90 flex items-center justify-center z-10 animate-fade-in"><X className="w-20 h-20 text-white animate-shake" /></div>}
            </div>
        )}
      </div>
    </div>
  );
}

// COMPONENTES FLASHCARD Y MODALES FALTABAN AQUÍ
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

function MaintenanceModal({ onClose, cards, refreshCards }) {
  const [apiKey, setApiKey] = useState(localStorage.getItem('openai_key') || "");
  const [activeTab, setActiveTab] = useState('audit'); 
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [auditResults, setAuditResults] = useState([]);
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  useEffect(() => {
    if (activeTab === 'duplicates') {
      const groups = {};
      cards.forEach(c => {
        if (!c.arabic) return;
        const key = c.arabic.trim();
        if (!groups[key]) groups[key] = [];
        groups[key].push(c);
      });
      const dups = Object.values(groups).filter(g => g.length > 1);
      setDuplicateGroups(dups);
    }
  }, [activeTab, cards]);
  const handleAudit = async () => {
    if (!apiKey) { alert("Necesitas la API Key de OpenAI"); return; }
    setLoading(true); setAuditResults([]); setLogs(["Iniciando auditoría..."]);
    try {
        const openai = new OpenAI({ apiKey: apiKey, dangerouslyAllowBrowser: true });
        const batchSize = 20; let allIssues = []; const cardsToAudit = cards; 
        for (let i = 0; i < cardsToAudit.length; i += batchSize) {
            const batch = cardsToAudit.slice(i, i + batchSize);
            setLogs(prev => [`Analizando bloque ${i}...`, ...prev.slice(0,4)]);
            const miniBatch = batch.map(c => ({ id: c.id, arabic: c.arabic, spanish: c.spanish }));
            const prompt = `Audita vocabulario árabe. REGLAS: 1. ELIMINA TANWIN Damma/Kasra. 2. MANTÉN TANWIN Fath solo en adverbios. 3. Traduce bien. JSON: [{ "id": 123, "problem": "..", "suggestion": "..", "field": "arabic/spanish" }]`;
            const response = await openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: prompt + ` DATOS: ${JSON.stringify(miniBatch)}` }], temperature: 0.2 });
            let rawContent = response.choices[0].message.content;
            const start = rawContent.indexOf('['); const end = rawContent.lastIndexOf(']');
            if (start !== -1 && end !== -1) {
                const batchIssues = JSON.parse(rawContent.substring(start, end + 1));
                allIssues = [...allIssues, ...batchIssues];
            }
        }
        setAuditResults(allIssues); setLogs(prev => [`✅ Auditoría terminada. ${allIssues.length} sugerencias.`, ...prev]);
    } catch (error) { console.error(error); setLogs(prev => [`❌ Error: ${error.message}`, ...prev]); } finally { setLoading(false); }
  };
  const handleApplyFix = async (issue) => {
    try {
      const updateData = {};
      if (issue.field === 'arabic' || !issue.field) updateData.arabic = issue.suggestion;
      if (issue.field === 'spanish') updateData.spanish = issue.suggestion;
      if (!issue.field) { if (/[\u0600-\u06FF]/.test(issue.suggestion)) updateData.arabic = issue.suggestion; else updateData.spanish = issue.suggestion; }
      await supabase.from('flashcards').update(updateData).eq('id', issue.id);
      setAuditResults(prev => prev.filter(p => p.id !== issue.id));
      await refreshCards(); 
    } catch (err) { alert("Error: " + err.message); }
  };
  const handleDeleteDuplicate = async (id) => { if(!confirm("¿Borrar?")) return; await supabase.from('flashcards').delete().eq('id', id); await refreshCards(); };
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="bg-blue-700 px-6 py-4 flex justify-between items-center text-white shrink-0"><h2 className="text-lg font-bold flex items-center gap-2"><Settings className="w-5 h-5" /> Mantenimiento BD</h2><button onClick={onClose} className="hover:bg-blue-600 p-1 rounded transition"><X className="w-5 h-5" /></button></div>
        <div className="flex border-b border-slate-200 overflow-x-auto"><button onClick={() => setActiveTab('audit')} className={`px-6 py-3 font-bold text-sm ${activeTab === 'audit' ? 'text-blue-700 border-b-2 border-blue-700' : 'text-slate-500'}`}>1. Auditoría IA</button><button onClick={() => setActiveTab('duplicates')} className={`px-6 py-3 font-bold text-sm ${activeTab === 'duplicates' ? 'text-blue-700 border-b-2 border-blue-700' : 'text-slate-500'}`}>2. Duplicados ({duplicateGroups.length})</button></div>
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
            {activeTab === 'audit' && (
                <div className="space-y-4">
                    <div className="bg-purple-50 p-4 rounded-lg border border-purple-100 mb-4"><label className="block text-xs font-bold text-purple-800 uppercase mb-1">OpenAI API Key</label><input type="password" placeholder="sk-..." className="w-full p-2 border border-purple-200 rounded bg-white text-sm" value={apiKey} onChange={(e) => { setApiKey(e.target.value); localStorage.setItem('openai_key', e.target.value); }} /><div className="flex gap-2 mt-3"><button onClick={handleAudit} disabled={loading || !apiKey} className="flex-1 bg-purple-600 text-white py-2 rounded-lg font-bold hover:bg-purple-700 disabled:opacity-50 flex justify-center gap-2">{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Iniciar Auditoría"}</button></div></div>
                    {logs.length > 0 && <div className="bg-slate-900 text-green-400 font-mono text-[10px] p-3 rounded-lg max-h-32 overflow-y-auto mb-4 border border-slate-700 shadow-inner">{logs.map((log, i) => <div key={i}>{log}</div>)}</div>}
                    {auditResults.length > 0 ? ( <div className="space-y-3">{auditResults.map(issue => { const originalCard = cards.find(c => c.id === issue.id); if (!originalCard) return null; return ( <div key={issue.id} className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex flex-col gap-3"><div className="flex justify-between items-start"><span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono">ID: {originalCard.id}</span><button onClick={() => setAuditResults(prev => prev.filter(p => p.id !== issue.id))} className="text-slate-300 hover:text-red-500"><X className="w-4 h-4"/></button></div><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div className="bg-red-50 p-3 rounded border border-red-100 relative"><span className="absolute top-1 right-2 text-[10px] font-bold text-red-300">ORIGINAL</span><p className="font-arabic text-xl text-slate-800 text-right mb-1" dir="rtl">{originalCard.arabic}</p><p className="text-sm text-slate-600">{originalCard.spanish}</p></div><div className="bg-green-50 p-3 rounded border border-green-100 relative"><span className="absolute top-1 right-2 text-[10px] font-bold text-green-600">SUGERENCIA</span><div className="flex flex-col h-full justify-center"><p className="font-bold text-lg text-green-800 text-center">{issue.suggestion}</p><p className="text-xs text-green-600 text-center mt-1 italic">{issue.problem}</p></div></div></div><button onClick={() => handleApplyFix(issue)} className="self-end bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2"><Check className="w-4 h-4" /> Aplicar</button></div> ); })}</div> ) : !loading && logs.length > 0 && <div className="text-center text-slate-400 py-10">No hay errores pendientes.</div>}
                </div>
            )}
            {activeTab === 'duplicates' && (
                <div className="space-y-6">{duplicateGroups.length === 0 ? <div className="text-center text-slate-400 py-10 flex flex-col items-center"><CheckCircle className="w-12 h-12 mb-2 opacity-20"/><p>¡Limpio!</p></div> : duplicateGroups.map((group, idx) => ( <div key={idx} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden"><div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex justify-between items-center"><span className="font-bold text-slate-600 text-sm">Conflicto #{idx+1}</span><span className="font-arabic text-lg text-emerald-700 font-bold" dir="rtl">{group[0].arabic}</span></div><div className="divide-y divide-slate-100">{group.map(card => (<div key={card.id} className="p-3 flex items-center justify-between hover:bg-slate-50 transition-colors"><div className="flex items-center gap-3"><span className="text-xs text-slate-400 font-mono w-10">#{card.id}</span><div className="flex flex-col"><span className="font-bold text-slate-800">{card.spanish}</span><span className="text-[10px] text-slate-500">{card.category}</span></div></div><button onClick={() => handleDeleteDuplicate(card.id)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"><Trash2 className="w-5 h-5" /></button></div>))}</div></div> ))}</div>
            )}
        </div>
      </div>
    </div>
  );
}