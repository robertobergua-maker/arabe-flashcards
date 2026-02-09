import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from './supabaseClient';
import { 
  Search, Volume2, BookOpen, X, CheckCircle, 
  Type, Filter, Lock, Unlock, Plus, Trash2, Edit2, Save, 
  Wand2, Image as ImageIcon, FileText, Loader2, FileUp,
  Settings, AlertTriangle, ArrowRight, Check, Trophy, Frown, PartyPopper,
  ArrowLeft, Timer, HelpCircle, Grid, Zap, Edit3, Mic, Activity, Gamepad2
} from 'lucide-react';

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

// Utilidad específica para el Juego del Escriba: Fuerza la forma visual de la letra
const getArabicForm = (char, position, totalLength) => {
  if (!char) return "";
  const tatweel = "ـ";
  if (totalLength <= 1) return char; // Aislada
  if (position === 0) return char + tatweel; // Inicial
  if (position === totalLength - 1) return tatweel + char; // Final
  return tatweel + char + tatweel; // Media
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
    return ["Todos", ...uniqueCats.sort()];
  }, [cards]);

  const filteredCards = useMemo(() => {
    const normalizedTerm = normalizeForSearch(searchTerm);
    let result = cards.filter(card => {
      const s = normalizeForSearch(card.spanish || "");
      const a = normalizeForSearch(card.arabic || "");
      const matchesSearch = s.includes(normalizedTerm) || a.includes(normalizedTerm);
      let matchesCategory = selectedCategory === "Todos" || (card.category || "General").split(';').map(t => t.trim()).includes(selectedCategory);
      return matchesSearch && matchesCategory;
    });
    return (selectedCategory === "Todos" && searchTerm === "") ? shuffleArray(result) : result;
  }, [cards, searchTerm, selectedCategory]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 flex flex-col font-sans">
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
            <div className="flex gap-2">
                <button onClick={() => setIsGamesHubOpen(true)} className="p-2 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white transition-colors shadow-lg">
                    <Gamepad2 className="w-6 h-6" />
                </button>
                <button onClick={handleAdminToggle} className={`p-2 rounded-lg transition-colors ${isAdminMode ? 'bg-red-500 text-white' : 'bg-black/20 text-white/70'}`}>
                {isAdminMode ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-8">
          <div className="max-w-6xl mx-auto">
            {loading ? (
               <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3"><Loader2 className="w-8 h-8 animate-spin text-emerald-600" /><span>{loadingProgress}</span></div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {filteredCards.map(card => <Flashcard key={card.id} data={card} frontLanguage={frontLanguage} showDiacritics={showDiacritics} isAdmin={isAdminMode} onDelete={() => handleDeleteCard(card.id)} />)}
              </div>
            )}
          </div>
      </main>

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
          <div className="flex items-center gap-3"><Gamepad2 className="w-8 h-8 text-yellow-400" /><h2 className="font-bold text-2xl">Arcade</h2></div>
          <button onClick={onClose}><X className="w-6 h-6" /></button>
        </div>
        <div className="p-8 bg-slate-100 grid grid-cols-1 md:grid-cols-2 gap-6">
          <GameOption icon={<HelpCircle/>} title="Quiz" desc="Traduce la palabra." color="indigo" onClick={() => setActiveGame('quiz')}/>
          <GameOption icon={<Grid/>} title="Memoria" desc="Parejas español-árabe." color="emerald" onClick={() => setActiveGame('memory')}/>
          <GameOption icon={<Activity/>} title="Velocidad" desc="¿Cierto o falso?" color="rose" onClick={() => setActiveGame('truefalse')}/>
          <GameOption icon={<Edit3/>} title="El Escriba" desc="Formas de las letras." color="amber" onClick={() => setActiveGame('lettergap')}/>
        </div>
      </div>
    </div>
  );
}

function GameOption({ icon, title, desc, color, onClick }) {
    const colors = { indigo: "bg-indigo-100 text-indigo-600 hover:bg-indigo-600", emerald: "bg-emerald-100 text-emerald-600 hover:bg-emerald-600", rose: "bg-rose-100 text-rose-600 hover:bg-rose-600", amber: "bg-amber-100 text-amber-600 hover:bg-amber-600" };
    return (
        <button onClick={onClick} className="bg-white p-6 rounded-2xl shadow-md hover:scale-105 transition-all group text-left border border-slate-200">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-colors ${colors[color]} group-hover:text-white`}>{icon}</div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">{title}</h3>
            <p className="text-sm text-slate-500">{desc}</p>
        </button>
    );
}

// JUEGO 4: EL ESCRIBA (MEJORADO CON FORMAS DIVERSAS Y COHERENTES)
function LetterGapGame({ onBack, onClose, cards, showDiacritics }) {
  const [round, setRound] = useState(null);
  const [score, setScore] = useState(0);
  const [selectedOption, setSelectedOption] = useState(null);
  const [isCorrect, setIsCorrect] = useState(null);

  useEffect(() => { startNewRound(); }, []);

  const startNewRound = () => {
    if (cards.length < 4) return;
    const candidate = cards.filter(c => getCardType(c) === 'word' && c.arabic.length >= 3);
    const selected = candidate.length > 0 ? candidate[Math.floor(Math.random() * candidate.length)] : cards[0];
    const text = showDiacritics ? selected.arabic : removeArabicDiacritics(selected.arabic);
    const textArr = Array.from(text);
    
    // Solo elegimos letras reales
    const validIndices = textArr.map((c, i) => /[\u0600-\u06FF]/.test(c) ? i : -1).filter(i => i !== -1);
    const indexToHide = validIndices[Math.floor(Math.random() * validIndices.length)];
    
    // Letra correcta con su FORMA COHERENTE
    const correctChar = textArr[indexToHide];
    const correctShape = getArabicForm(correctChar, indexToHide, textArr.length);
    
    // Generar distractores con formas aleatorias
    let distractors = [];
    while(distractors.length < 3) {
        const rChar = ARABIC_ALPHABET[Math.floor(Math.random() * ARABIC_ALPHABET.length)];
        const rPos = Math.floor(Math.random() * 3);
        const rShape = getArabicForm(rChar, rPos, 3); 

        if (rChar !== correctChar && !distractors.includes(rShape)) {
            distractors.push(rShape);
        }
    }

    const masked = [...textArr]; 
    masked[indexToHide] = " ... ";
    
    setRound({ 
      card: selected, 
      questionText: masked.join(""), 
      correctOption: correctShape, 
      options: shuffleArray([correctShape, ...distractors]) 
    });
    setSelectedOption(null); 
    setIsCorrect(null);
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
      <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="bg-amber-600 p-5 text-white flex justify-between items-center">
          <button onClick={onBack}><ArrowLeft/></button>
          <div className="text-center"><h2 className="font-bold">El Escriba</h2><p className="text-[10px] uppercase">Formas Glíficas</p></div>
          <button onClick={onClose}><X/></button>
        </div>
        <div className="p-8 text-center bg-slate-50 flex flex-col justify-center">
            <p className="text-xs font-bold text-slate-400 mb-2 uppercase">({round?.card?.spanish})</p>
            <h3 className="text-6xl font-arabic font-bold py-4" dir="rtl">
              {selectedOption && isCorrect 
                ? (showDiacritics ? round.card.arabic : removeArabicDiacritics(round.card.arabic)) 
                : round?.questionText}
            </h3>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4 bg-white border-t">
            {round?.options.map((opt, i) => (
                <button 
                  key={i} 
                  disabled={!!selectedOption} 
                  onClick={() => handleChoice(opt)} 
                  className={`h-24 rounded-2xl border-2 text-4xl font-arabic flex items-center justify-center transition-all
                    ${selectedOption === opt 
                      ? (isCorrect ? 'bg-green-100 border-green-500 text-green-700' : 'bg-red-100 border-red-500 text-red-700') 
                      : 'bg-slate-50 border-slate-200 hover:border-amber-400 hover:bg-amber-50'}`}
                >
                  {opt}
                </button>
            ))}
        </div>
        <div className="p-4 bg-slate-100 text-center font-bold text-amber-600">Racha: {score}</div>
      </div>
    </div>
  );
}

// RESTO DE COMPONENTES (Resumidos para brevedad, mantener igual que tu original)
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
          <div className="bg-indigo-600 p-4 text-white flex justify-between"><button onClick={onBack}><ArrowLeft/></button><h2 className="font-bold">Quiz</h2><button onClick={onClose}><X/></button></div>
          <div className="p-8 text-center bg-slate-50"><h3 className="text-3xl font-bold">{round.question.spanish}</h3></div>
          <div className="p-6 flex flex-col gap-3">
              {round.options.map(opt => (
                  <button key={opt.id} onClick={() => handleChoice(opt)} className={`p-4 rounded-xl border-2 text-xl font-arabic ${selectedOption?.id === opt.id ? (isCorrect ? 'bg-green-100 border-green-500' : 'bg-red-100 border-red-500') : 'hover:border-indigo-400'}`} dir="rtl">{showDiacritics ? opt.arabic : removeArabicDiacritics(opt.arabic)}</button>
              ))}
          </div>
        </div>
      </div>
    );
}

function TrueFalseGame({ onBack, onClose, cards, showDiacritics }) {
    const [round, setRound] = useState(null);
    const [score, setScore] = useState(0);
    const [timer, setTimer] = useState(100);
    const [gameOver, setGameOver] = useState(false);
    useEffect(() => { startNewRound(); }, []);
    const startNewRound = () => {
      const base = cards[Math.floor(Math.random() * cards.length)];
      const match = Math.random() > 0.5;
      const arabicText = match ? base.arabic : cards[Math.floor(Math.random() * cards.length)].arabic;
      setRound({ spanish: base.spanish, arabic: arabicText, isMatch: match });
      setTimer(100);
    };
    return (
      <div className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden">
            <div className="bg-rose-600 p-4 text-white flex justify-between"><button onClick={onBack}><ArrowLeft/></button><h2 className="font-bold">Velocidad</h2><button onClick={onClose}><X/></button></div>
            <div className="p-8 text-center flex flex-col gap-4">
                <h3 className="text-2xl font-bold">{round?.spanish}</h3>
                <h3 className="text-4xl font-arabic text-rose-600" dir="rtl">{showDiacritics ? round?.arabic : removeArabicDiacritics(round?.arabic)}</h3>
                <div className="grid grid-cols-2 gap-4 mt-4">
                    <button onClick={() => (!round.isMatch ? (setScore(s=>s+1), startNewRound()) : setGameOver(true))} className="p-4 bg-red-100 text-red-700 rounded-xl font-bold">NO</button>
                    <button onClick={() => (round.isMatch ? (setScore(s=>s+1), startNewRound()) : setGameOver(true))} className="p-4 bg-green-100 text-green-700 rounded-xl font-bold">SÍ</button>
                </div>
                {gameOver && <button onClick={() => {setGameOver(false); setScore(0); startNewRound();}} className="mt-4 text-rose-600 font-bold">Reiniciar</button>}
            </div>
        </div>
      </div>
    );
}

function MemoryGame({ onBack, onClose, cards, showDiacritics }) {
    const [deck, setDeck] = useState([]);
    const [flipped, setFlipped] = useState([]);
    const [matched, setMatched] = useState([]);
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
            if (deck[newFlipped[0]].id === deck[newFlipped[1]].id) {
                setMatched(m => [...m, deck[newFlipped[0]].id]);
                setFlipped([]);
            } else { setTimeout(() => setFlipped([]), 1000); }
        }
    };
    return (
      <div className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden p-6">
            <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                {deck.map((card, i) => (
                    <div key={i} onClick={() => handleFlip(i)} className={`aspect-[3/4] cursor-pointer rounded-xl flex items-center justify-center p-2 text-center transition-all ${flipped.includes(i) || matched.includes(card.id) ? 'bg-white border-2 border-emerald-500' : 'bg-emerald-600'}`}>
                        {(flipped.includes(i) || matched.includes(card.id)) ? <span className={card.type === 'ar' ? 'font-arabic text-xl' : 'text-sm'}>{card.type === 'ar' && !showDiacritics ? removeArabicDiacritics(card.content) : card.content}</span> : <Grid className="text-white/20"/>}
                    </div>
                ))}
            </div>
            <button onClick={onBack} className="mt-6 w-full py-2 bg-slate-200 rounded-lg">Volver</button>
        </div>
      </div>
    );
}

function Flashcard({ data, frontLanguage, showDiacritics, isAdmin, onDelete }) {
  const [flipped, setFlipped] = useState(false);
  const displayArabic = showDiacritics ? data.arabic : removeArabicDiacritics(data.arabic);
  return (
    <div onClick={() => !isAdmin && setFlipped(!flipped)} className={`relative h-60 w-full rounded-2xl shadow-sm border p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${flipped ? 'bg-emerald-50' : 'bg-white'}`}>
        {isAdmin ? (
            <div className="flex flex-col gap-2">
                <h3 className="font-bold">{data.spanish}</h3>
                <h3 className="text-2xl font-arabic text-emerald-700" dir="rtl">{displayArabic}</h3>
                <button onClick={(e) => {e.stopPropagation(); onDelete();}} className="p-2 bg-red-100 text-red-600 rounded-full mt-4"><Trash2 size={16}/></button>
            </div>
        ) : (
            <>
                <p className="text-[10px] uppercase font-bold text-slate-400 mb-2">{flipped ? 'Árabe' : 'Español'}</p>
                <h3 className={flipped ? 'text-3xl font-arabic' : 'text-xl font-bold'}>{flipped ? displayArabic : data.spanish}</h3>
            </>
        )}
    </div>
  );
}