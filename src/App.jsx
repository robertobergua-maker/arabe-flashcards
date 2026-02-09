import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from './supabaseClient';
import OpenAI from 'openai';
import * as pdfjsLib from 'pdfjs-dist'; 
import { 
  Search, Volume2, BookOpen, X, CheckCircle, 
  Type, Filter, Lock, Unlock, Plus, Trash2, Edit2, Save, 
  Wand2, Image as ImageIcon, FileText, Loader2, FileUp,
  Settings, AlertTriangle, ArrowRight, Check, Trophy, Frown, PartyPopper,
  ArrowLeft, Timer, HelpCircle, Grid, Zap, Edit3, Mic, Activity, Gamepad2
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

export default function App() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(""); 
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Todos");
  const [frontLanguage, setFrontLanguage] = useState("spanish");
  const [showDiacritics, setShowDiacritics] = useState(true);
  
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [editingCard, setEditingCard] = useState(null); 
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSmartImportOpen, setIsSmartImportOpen] = useState(false);
  const [isMaintenanceOpen, setIsMaintenanceOpen] = useState(false);
  const [isGamesHubOpen, setIsGamesHubOpen] = useState(false); 

  useEffect(() => {
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
        } else { hasMore = false; }
        safetyCounter++;
      }
      const uniqueCards = Array.from(new Map(allData.map(item => [item.id, item])).values());
      setCards(uniqueCards);
    } catch (error) {
      console.error("Error cargando tarjetas:", error.message);
    } finally {
      setLoading(false);
    }
  }

  const handleAdminToggle = () => {
    if (isAdminMode) {
      setIsAdminMode(false);
    } else {
      const password = prompt("🔒 Introduce la contraseña de administrador:");
      if (password === "1234") { 
        setIsAdminMode(true);
      } else if (password !== null) {
        alert("⛔ Contraseña incorrecta");
      }
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
      alert("Error al guardar: " + error.message);
    }
  };

  const handleDeleteCard = async (id) => {
    if (!window.confirm("¿Seguro que quieres borrar esta tarjeta?")) return;
    try {
      const { error } = await supabase.from('flashcards').delete().eq('id', id);
      if (error) throw error;
      setCards(prev => prev.filter(c => c.id !== id));
    } catch (error) {
      alert("Error al borrar: " + error.message);
    }
  };

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
              <input type="text" placeholder="Buscar..." className="w-full pl-9 pr-4 py-2 bg-black/20 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-white/40 text-sm text-white" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <div className="relative md:w-64">
                <Filter className="absolute left-3 top-2.5 w-4 h-4 text-white/50 pointer-events-none" />
                <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="w-full pl-9 pr-8 py-2 bg-black/20 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-white/40 text-sm text-white appearance-none cursor-pointer">
                    {categories.map(cat => <option key={cat} value={cat} className="text-slate-800 bg-white">{cat}</option>)}
                </select>
            </div>
            <div className="flex gap-2">
                <button onClick={() => setIsGamesHubOpen(true)} className="p-2 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white transition-colors flex items-center justify-center shadow-lg">
                    <Gamepad2 className="w-6 h-6" />
                </button>
                <div className="flex items-center gap-2 bg-black/20 rounded-lg p-1 border border-white/10">
                    <button onClick={() => setFrontLanguage('spanish')} className={`px-2 py-1.5 rounded-md text-xs font-bold ${frontLanguage === 'spanish' ? 'bg-white text-slate-800' : 'text-white/70'}`}>ES</button>
                    <button onClick={() => setFrontLanguage('arabic')} className={`px-2 py-1.5 rounded-md text-xs font-bold ${frontLanguage === 'arabic' ? 'bg-white text-slate-800' : 'text-white/70'}`}>AR</button>
                    <button onClick={() => setShowDiacritics(!showDiacritics)} className={`px-2 py-1.5 rounded-md text-xs font-bold ${showDiacritics ? 'bg-white text-slate-800' : 'text-white/70'}`}><Type className="w-3.5 h-3.5" /></button>
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
              <div className="mb-6 flex flex-wrap justify-center gap-4">
                <button onClick={() => {setEditingCard(null); setIsFormOpen(true);}} className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-full shadow-lg hover:scale-105 transition-all font-bold"><Plus className="w-5 h-5" /> Añadir Manual</button>
              </div>
            )}
            {loading ? (
               <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3"><Loader2 className="w-8 h-8 animate-spin text-emerald-600" /><span>{loadingProgress}</span></div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredCards.map(card => <Flashcard key={card.id} data={card} frontLanguage={frontLanguage} showDiacritics={showDiacritics} isAdmin={isAdminMode} onDelete={() => handleDeleteCard(card.id)} onEdit={() => {setEditingCard(card); setIsFormOpen(true);}} />)}
              </div>
            )}
          </div>
      </div>
      {isGamesHubOpen && <GamesHub onClose={() => setIsGamesHubOpen(false)} cards={cards} showDiacritics={showDiacritics} />}
    </div>
  );
}

// --- HUB DE JUEGOS ---
function GamesHub({ onClose, cards, showDiacritics }) {
  const [activeGame, setActiveGame] = useState('menu'); 

  if (activeGame === 'quiz') return <QuizGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} showDiacritics={showDiacritics} />;
  if (activeGame === 'memory') return <MemoryGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} showDiacritics={showDiacritics} />;
  if (activeGame === 'truefalse') return <TrueFalseGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} showDiacritics={showDiacritics} />;
  if (activeGame === 'lettergap') return <LetterGapGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} showDiacritics={showDiacritics} />;

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col">
        <div className="bg-slate-800 p-6 text-white flex justify-between items-center">
          <div className="flex items-center gap-3"><Gamepad2 className="w-8 h-8 text-yellow-400" /><h2 className="font-bold text-2xl">Arcade de Aprendizaje</h2></div>
          <button onClick={onClose} className="hover:bg-slate-700 p-2 rounded-full transition"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-8 bg-slate-100 grid grid-cols-1 md:grid-cols-2 gap-6">
          <GameOption icon={<HelpCircle/>} title="Quiz Express" desc="Elige la traducción correcta." color="indigo" onClick={() => setActiveGame('quiz')}/>
          <GameOption icon={<Grid/>} title="Memoria" desc="Encuentra las parejas ocultas." color="emerald" onClick={() => setActiveGame('memory')}/>
          <GameOption icon={<Activity/>} title="Velocidad" desc="Verdadero o Falso con tiempo." color="rose" onClick={() => setActiveGame('truefalse')}/>
          <GameOption icon={<Edit3/>} title="El Escriba" desc="Completa la letra que falta." color="amber" onClick={() => setActiveGame('lettergap')}/>
        </div>
      </div>
    </div>
  );
}

function GameOption({ icon, title, desc, color, onClick }) {
    const colors = { indigo: "bg-indigo-100 text-indigo-600 hover:bg-indigo-600", emerald: "bg-emerald-100 text-emerald-600 hover:bg-emerald-600", rose: "bg-rose-100 text-rose-600 hover:bg-rose-600", amber: "bg-amber-100 text-amber-600 hover:bg-amber-600" };
    return (
        <button onClick={onClick} className="bg-white p-6 rounded-2xl shadow-md hover:scale-105 transition-all group text-left border border-slate-200">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-colors ${colors[color]} group-hover:text-white`}>{React.cloneElement(icon, {className: "w-7 h-7"})}</div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">{title}</h3>
            <p className="text-sm text-slate-500">{desc}</p>
        </button>
    );
}

// JUEGO 3: VELOCIDAD (MEJORADO CON SELECTOR DE TIEMPO)
function TrueFalseGame({ onBack, onClose, cards, showDiacritics }) {
  const [difficulty, setDifficulty] = useState(null); 
  const [round, setRound] = useState(null);
  const [score, setScore] = useState(0);
  const [timer, setTimer] = useState(0); 
  const [gameOver, setGameOver] = useState(false);
  const [gameState, setGameState] = useState('playing'); 
  const timerRef = useRef(null);

  useEffect(() => {
    if (difficulty) startNewRound();
    return () => clearInterval(timerRef.current);
  }, [difficulty]);

  const startNewRound = () => {
    if (cards.length < 5) return;
    const baseCard = cards[Math.floor(Math.random() * cards.length)];
    const isMatch = Math.random() > 0.5;
    let arabicText = isMatch ? baseCard.arabic : cards.filter(c => c.id !== baseCard.id)[Math.floor(Math.random() * (cards.length - 1))].arabic;

    setRound({ spanish: baseCard.spanish, arabic: arabicText, isMatch });
    setTimer(difficulty * 100); 
    setGameState('playing');
    
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
        setTimer(prev => {
            if (prev <= 0) { endGame(); return 0; }
            return prev - 10;
        });
    }, 100);
  };

  const endGame = () => { clearInterval(timerRef.current); setGameState('timeout'); setGameOver(true); };

  if (!difficulty) {
    return (
      <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50">
        <div className="bg-white p-8 rounded-2xl text-center max-w-xs w-full">
            <h2 className="text-xl font-bold mb-6">¿Cuántos segundos?</h2>
            <div className="flex flex-col gap-3">
                {[3, 5, 10].map(s => <button key={s} onClick={() => setDifficulty(s)} className="py-3 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700">{s} Segundos</button>)}
            </div>
            <button onClick={onBack} className="mt-4 text-slate-400 text-sm">Volver</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col relative h-[500px]">
        <div className="bg-rose-600 p-4 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2"><button onClick={onBack} className="p-1"><ArrowLeft className="w-5 h-5"/></button><h2 className="font-bold">Velocidad</h2></div>
          <button onClick={onClose}><X className="w-6 h-6" /></button>
        </div>
        {gameOver ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                <Frown className="w-16 h-16 text-rose-500 mb-4" />
                <h3 className="text-2xl font-bold mb-2">¡Fin del Juego!</h3>
                <div className="text-4xl font-black text-rose-600 mb-8">{score} Puntos</div>
                <button onClick={() => {setGameOver(false); setScore(0); startNewRound();}} className="w-full bg-rose-600 text-white py-3 rounded-xl font-bold">Reintentar</button>
            </div>
        ) : round && (
            <div className="flex-1 flex flex-col relative">
                <div className="h-2 bg-slate-100 w-full"><div className="h-full bg-rose-500 transition-all duration-100 ease-linear" style={{ width: `${(timer / (difficulty * 100)) * 100}%` }}/></div>
                <div className="p-4 flex justify-between items-center text-rose-800 font-bold bg-rose-50"><span>Racha</span><span className="text-xl">{score}</span></div>
                <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
                    <div className="text-center w-full"><p className="text-xs font-bold text-slate-400">ESPAÑOL</p><h3 className="text-2xl font-bold">{round.spanish}</h3></div>
                    <div className="text-center w-full"><p className="text-xs font-bold text-slate-400">ÁRABE</p><h3 className="text-4xl font-arabic font-bold text-rose-700" dir="rtl">{showDiacritics ? round.arabic : removeArabicDiacritics(round.arabic)}</h3></div>
                </div>
                <div className="p-4 grid grid-cols-2 gap-4 bg-slate-50 border-t">
                    <button onClick={() => (round.isMatch ? setGameOver(true) : (setScore(s=>s+1), startNewRound()))} className="py-4 rounded-xl bg-red-100 text-red-700 font-bold border-2 border-red-200">NO</button>
                    <button onClick={() => (!round.isMatch ? setGameOver(true) : (setScore(s=>s+1), startNewRound()))} className="py-4 rounded-xl bg-green-100 text-green-700 font-bold border-2 border-green-200">SÍ</button>
                </div>
            </div>
        )}
      </div>
    </div>
  );
}

// JUEGO 4: EL ESCRIBA (LÓGICA MEJORADA CON REGEX)
function LetterGapGame({ onBack, onClose, cards, showDiacritics }) {
  const [round, setRound] = useState(null);
  const [score, setScore] = useState(0);
  const [selectedOption, setSelectedOption] = useState(null);
  const [isCorrect, setIsCorrect] = useState(null);

  useEffect(() => { startNewRound(); }, []);

  const startNewRound = () => {
    if (cards.length < 4) return;
    const candidate = cards.filter(c => getCardType(c) === 'word' && c.arabic.length > 2);
    const selected = candidate.length > 0 ? candidate[Math.floor(Math.random() * candidate.length)] : cards[0];
    const text = showDiacritics ? selected.arabic : removeArabicDiacritics(selected.arabic);
    const textArr = Array.from(text);
    
    // Filtra para que falte una letra árabe real (evita espacios o símbolos)
    const validIndices = textArr.map((c, i) => /[\u0600-\u06FF]/.test(c) ? i : -1).filter(i => i !== -1);
    const indexToHide = validIndices[Math.floor(Math.random() * validIndices.length)];
    const correct = textArr[indexToHide];
    
    let distractors = [];
    while(distractors.length < 3) {
        const r = ARABIC_ALPHABET[Math.floor(Math.random() * ARABIC_ALPHABET.length)];
        if (r !== correct) distractors.push(r);
    }

    const masked = [...textArr]; masked[indexToHide] = " _ ";
    setRound({ card: selected, questionText: masked.join(""), correctOption: correct, options: shuffleArray([correct, ...distractors]) });
    setSelectedOption(null); setIsCorrect(null);
  };

  const handleChoice = (opt) => {
    if (selectedOption) return;
    setSelectedOption(opt);
    const win = opt === round.correctOption;
    setIsCorrect(win);
    if (win) { setScore(s=>s+1); setTimeout(startNewRound, 1200); }
    else { setScore(0); setTimeout(startNewRound, 2000); }
  };

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden">
        <div className="bg-amber-600 p-4 text-white flex justify-between"><button onClick={onBack}><ArrowLeft/></button><h2 className="font-bold">El Escriba</h2><button onClick={onClose}><X/></button></div>
        <div className="p-8 text-center bg-slate-50 min-h-[200px] flex flex-col justify-center">
            <p className="text-xs font-bold text-slate-400 mb-2 uppercase">Completa ({round?.card?.spanish})</p>
            <h3 className="text-5xl font-arabic font-bold" dir="rtl">{selectedOption && isCorrect ? (showDiacritics ? round.card.arabic : removeArabicDiacritics(round.card.arabic)) : round?.questionText}</h3>
        </div>
        <div className="p-6 grid grid-cols-4 gap-3 bg-white">
            {round?.options.map((opt, i) => (
                <button key={i} disabled={!!selectedOption} onClick={() => handleChoice(opt)} className={`aspect-square rounded-xl border-2 text-2xl font-arabic flex items-center justify-center transition-all ${selectedOption === opt ? (isCorrect ? 'bg-green-100 border-green-500' : 'bg-red-100 border-red-500') : 'hover:border-amber-400'}`}>{opt}</button>
            ))}
        </div>
        <div className="p-4 bg-slate-100 text-center font-bold">Racha: {score}</div>
      </div>
    </div>
  );
}

// JUEGOS RESTANTES (QUIZ Y MEMORIA) MANTIENEN SU LÓGICA PREVIA
function QuizGame({ onBack, onClose, cards, showDiacritics }) {
  const [round, setRound] = useState(null);
  const [score, setScore] = useState(0);
  const [selectedOption, setSelectedOption] = useState(null);
  const [isCorrect, setIsCorrect] = useState(null);

  useEffect(() => { startNewRound(); }, []);

  const startNewRound = () => {
    if (cards.length < 4) return;
    const correct = cards[Math.floor(Math.random() * cards.length)];
    const distractors = shuffleArray(cards.filter(c => c.id !== correct.id)).slice(0, 3);
    setRound({ question: correct, options: shuffleArray([correct, ...distractors]) });
    setSelectedOption(null); setIsCorrect(null);
  };

  const handleChoice = (opt) => {
    if (selectedOption) return;
    setSelectedOption(opt);
    const win = opt.id === round.question.id;
    setIsCorrect(win);
    if (win) { setScore(s=>s+1); setTimeout(startNewRound, 1000); }
    else { setScore(0); setTimeout(startNewRound, 2000); }
  };

  if (!round) return null;

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden">
        <div className="bg-indigo-600 p-4 text-white flex justify-between"><button onClick={onBack}><ArrowLeft/></button><h2 className="font-bold">Quiz Express</h2><button onClick={onClose}><X/></button></div>
        <div className="p-8 text-center bg-slate-50"><p className="text-xs font-bold text-slate-400 mb-2 uppercase">¿Cómo se dice?</p><h3 className="text-3xl font-bold">{round.question.spanish}</h3></div>
        <div className="p-6 flex flex-col gap-3">
            {round.options.map(opt => (
                <button key={opt.id} disabled={!!selectedOption} onClick={() => handleChoice(opt)} className={`p-4 rounded-xl border-2 text-xl font-arabic transition-all ${selectedOption?.id === opt.id ? (isCorrect ? 'bg-green-100 border-green-500' : 'bg-red-100 border-red-500') : 'hover:border-indigo-400'}`} dir="rtl">{showDiacritics ? opt.arabic : removeArabicDiacritics(opt.arabic)}</button>
            ))}
        </div>
        <div className="p-4 bg-slate-100 text-center font-bold">Racha: {score}</div>
      </div>
    </div>
  );
}

function MemoryGame({ onBack, onClose, cards, showDiacritics }) {
  const [deck, setDeck] = useState([]);
  const [flipped, setFlipped] = useState([]);
  const [matched, setMatched] = useState([]);
  const [moves, setMoves] = useState(0);

  useEffect(() => {
    const selected = shuffleArray(cards).slice(0, 6);
    const cardsDeck = [];
    selected.forEach(c => {
        cardsDeck.push({ id: c.id, content: c.spanish, type: 'es' });
        cardsDeck.push({ id: c.id, content: c.arabic, type: 'ar' });
    });
    setDeck(shuffleArray(cardsDeck));
  }, []);

  const handleFlip = (idx) => {
    if (flipped.length === 2 || flipped.includes(idx) || matched.includes(deck[idx].id)) return;
    const newFlipped = [...flipped, idx];
    setFlipped(newFlipped);
    if (newFlipped.length === 2) {
        setMoves(m => m + 1);
        if (deck[newFlipped[0]].id === deck[newFlipped[1]].id) {
            setMatched(m => [...m, deck[newFlipped[0]].id]);
            setFlipped([]);
        } else { setTimeout(() => setFlipped([]), 1000); }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden">
        <div className="bg-emerald-600 p-4 text-white flex justify-between"><button onClick={onBack}><ArrowLeft/></button><h2 className="font-bold">Memoria</h2><button onClick={onClose}><X/></button></div>
        <div className="p-4 bg-emerald-50 flex justify-between font-bold text-emerald-800"><span>Movimientos: {moves}</span><span>Parejas: {matched.length}/6</span></div>
        <div className="p-6 grid grid-cols-3 md:grid-cols-4 gap-3 bg-slate-100">
            {deck.map((card, i) => {
                const isFlipped = flipped.includes(i) || matched.includes(card.id);
                return (
                    <div key={i} onClick={() => handleFlip(i)} className={`aspect-[3/4] cursor-pointer rounded-xl flex items-center justify-center p-2 text-center transition-all duration-500 shadow-sm ${isFlipped ? 'bg-white border-2 border-emerald-500' : 'bg-emerald-600'}`}>
                        {isFlipped ? <span className={`font-bold ${card.type === 'ar' ? 'font-arabic text-xl' : 'text-sm'}`} dir={card.type === 'ar' ? 'rtl' : 'ltr'}>{card.type === 'ar' && !showDiacritics ? removeArabicDiacritics(card.content) : card.content}</span> : <Grid className="text-white/20"/>}
                    </div>
                );
            })}
        </div>
        {matched.length === 6 && <div className="p-6 text-center"><button onClick={() => window.location.reload()} className="bg-emerald-600 text-white px-8 py-2 rounded-full font-bold">Jugar de nuevo</button></div>}
      </div>
    </div>
  );
}

function Flashcard({ data, frontLanguage, showDiacritics, isAdmin, onDelete, onEdit }) {
  const [flipState, setFlipState] = useState(0);
  useEffect(() => { setFlipState(0); }, [frontLanguage]);
  const displayArabic = showDiacritics ? data.arabic : removeArabicDiacritics(data.arabic);
  const tags = data.category ? data.category.split(';') : ['General'];

  return (
    <div onClick={() => !isAdmin && setFlipState(s => (s+1)%3)} className={`relative h-60 w-full rounded-2xl shadow-sm border p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${flipState === 0 ? 'bg-orange-50' : flipState === 1 ? 'bg-emerald-50' : 'bg-amber-100'}`}>
        {isAdmin ? (
            <div className="flex flex-col gap-2">
                <h3 className="font-bold">{data.spanish}</h3>
                <h3 className="text-2xl font-arabic text-emerald-700" dir="rtl">{displayArabic}</h3>
                <div className="flex gap-2 mt-4 justify-center"><button onClick={(e) => {e.stopPropagation(); onEdit();}} className="p-2 bg-blue-100 text-blue-600 rounded-full"><Edit2 size={16}/></button><button onClick={(e) => {e.stopPropagation(); onDelete();}} className="p-2 bg-red-100 text-red-600 rounded-full"><Trash2 size={16}/></button></div>
            </div>
        ) : (
            <>
                {flipState === 0 && (<div><p className="text-[10px] uppercase font-bold text-slate-400 mb-2">Español</p><h3 className="text-xl font-bold">{data.spanish}</h3></div>)}
                {flipState === 1 && (<div><p className="text-[10px] uppercase font-bold text-emerald-600 mb-2">Árabe</p><h3 className="text-3xl font-arabic" dir="rtl">{displayArabic}</h3></div>)}
                {flipState === 2 && (<div><p className="text-[10px] uppercase font-bold text-amber-600 mb-2">Fonética</p><h3 className="text-lg italic font-mono">{data.phonetic || '---'}</h3></div>)}
                <div className="mt-auto flex flex-wrap gap-1 justify-center">{tags.map((t, i) => <span key={i} className="text-[8px] bg-black/5 px-2 py-0.5 rounded-full uppercase">{t}</span>)}</div>
            </>
        )}
    </div>
  );
}