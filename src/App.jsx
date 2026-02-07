import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from './supabaseClient';
import OpenAI from 'openai';
import * as pdfjsLib from 'pdfjs-dist'; 
import { 
  Search, Volume2, BookOpen, X, CheckCircle, 
  Type, Filter, Lock, Unlock, Plus, Trash2, Edit2, Save, 
  Wand2, Image as ImageIcon, FileText, Loader2, FileUp,
  Settings, AlertTriangle, ArrowRight, Check, Gamepad2, Trophy, Frown, PartyPopper,
  Grid3x3, BrainCircuit, ArrowLeft
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

export default function App() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(""); 
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Todos");
  const [frontLanguage, setFrontLanguage] = useState("spanish");
  const [showDiacritics, setShowDiacritics] = useState(true);
  
  // ESTADOS ADMIN / MODALES
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [editingCard, setEditingCard] = useState(null); 
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSmartImportOpen, setIsSmartImportOpen] = useState(false);
  const [isMaintenanceOpen, setIsMaintenanceOpen] = useState(false);
  
  // ESTADO DEL HUB DE JUEGOS
  const [isGamesHubOpen, setIsGamesHubOpen] = useState(false); 

  // --- CARGAR DATOS ---
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
        } else {
          hasMore = false;
        }
        safetyCounter++;
      }

      const uniqueCards = Array.from(new Map(allData.map(item => [item.id, item])).values());
      setCards(uniqueCards);
    } catch (error) {
      console.error("Error cargando tarjetas:", error.message);
      alert("Error de conexión: " + error.message);
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
        alert(`¡${data.length} tarjetas importadas con éxito!`);
        setIsSmartImportOpen(false);
      }
    } catch (error) {
      console.error("Error Supabase:", error);
      alert("Error importando: " + error.message);
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
      const s = normalizeForSearch(card.spanish);
      const a = normalizeForSearch(card.arabic);
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
                    title="Juegos de Práctica"
                >
                    <Gamepad2 className="w-5 h-5" />
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
      {isGamesHubOpen && <GamesHub onClose={() => setIsGamesHubOpen(false)} cards={cards} />}
    </div>
  );
}

// --- HUB DE JUEGOS Y LÓGICA DE JUEGOS ---
function GamesHub({ onClose, cards }) {
  const [activeGame, setActiveGame] = useState('menu'); // menu, quiz, memory

  if (activeGame === 'quiz') return <QuizGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} />;
  if (activeGame === 'memory') return <MemoryGame onBack={() => setActiveGame('menu')} cards={cards} onClose={onClose} />;

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col relative">
        <div className="bg-slate-800 p-6 text-white flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Gamepad2 className="w-8 h-8 text-yellow-400" />
            <h2 className="font-bold text-2xl">Arcade de Aprendizaje</h2>
          </div>
          <button onClick={onClose} className="hover:bg-slate-700 p-2 rounded-full transition"><X className="w-6 h-6" /></button>
        </div>

        <div className="p-8 bg-slate-100 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Tarjeta Quiz */}
          <button onClick={() => setActiveGame('quiz')} className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl hover:scale-105 transition-all group text-left border border-slate-200">
            <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center mb-4 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
              <BrainCircuit className="w-7 h-7" />
            </div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">Quiz Express</h3>
            <p className="text-sm text-slate-500">¿Eres rápido? Elige la traducción correcta de entre 4 opciones antes de que pierdas la racha.</p>
          </button>

          {/* Tarjeta Memory */}
          <button onClick={() => setActiveGame('memory')} className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl hover:scale-105 transition-all group text-left border border-slate-200">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center mb-4 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
              <Grid3x3 className="w-7 h-7" />
            </div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">Memoria de Parejas</h3>
            <p className="text-sm text-slate-500">Ejercita tu mente. Encuentra las parejas de cartas (Español - Árabe) ocultas en el tablero.</p>
          </button>
        </div>
        
        <div className="bg-slate-50 p-4 text-center text-xs text-slate-400 border-t">
            ¡Practicar jugando es la mejor forma de aprender!
        </div>
      </div>
    </div>
  );
}

// JUEGO 1: QUIZ
function QuizGame({ onBack, onClose, cards }) {
  const [currentRound, setCurrentRound] = useState(null);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(parseInt(localStorage.getItem('quiz_highscore') || '0'));
  const [selectedOption, setSelectedOption] = useState(null);
  const [isCorrect, setIsCorrect] = useState(null);

  useEffect(() => { startNewRound(); }, []);

  const startNewRound = () => {
    if (cards.length < 4) return;
    const correctCard = cards[Math.floor(Math.random() * cards.length)];
    let distractors = [];
    while (distractors.length < 3) {
      const random = cards[Math.floor(Math.random() * cards.length)];
      if (random.id !== correctCard.id && !distractors.find(d => d.id === random.id)) distractors.push(random);
    }
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
        <div className="bg-indigo-600 p-4 text-white flex justify-between items-center">
          <div className="flex items-center gap-2">
            <button onClick={onBack} className="hover:bg-indigo-500 p-1 rounded mr-2"><ArrowLeft className="w-5 h-5"/></button>
            <h2 className="font-bold text-lg">Quiz Express</h2>
          </div>
          <button onClick={onClose} className="hover:bg-indigo-500 p-1 rounded"><X className="w-6 h-6" /></button>
        </div>
        <div className="flex justify-between px-6 py-3 bg-indigo-50 border-b border-indigo-100">
          <div className="flex flex-col items-center"><span className="text-xs font-bold text-indigo-400 uppercase">Racha</span><span className="text-xl font-black text-indigo-700">{score}</span></div>
          <div className="flex flex-col items-center"><span className="text-xs font-bold text-amber-500 uppercase flex items-center gap-1"><Trophy className="w-3 h-3"/> Récord</span><span className="text-xl font-black text-amber-600">{highScore}</span></div>
        </div>
        <div className="p-8 text-center bg-slate-50">
          <span className="text-xs font-bold text-slate-400 uppercase mb-2 block">¿Cómo se dice en Árabe?</span>
          <h3 className="text-2xl md:text-3xl font-black text-slate-800 animate-fade-in-up">{currentRound.question.spanish}</h3>
        </div>
        <div className="p-6 grid grid-cols-1 gap-3 bg-white">
          {currentRound.options.map((option) => {
            let btnClass = "p-4 rounded-xl border-2 text-xl font-arabic text-center transition-all duration-200 shadow-sm ";
            if (selectedOption) {
              if (option.id === currentRound.question.id) btnClass += "bg-green-100 border-green-500 text-green-800 scale-105";
              else if (option.id === selectedOption.id && !isCorrect) btnClass += "bg-red-100 border-red-500 text-red-800 opacity-60";
              else btnClass += "bg-slate-50 border-slate-100 text-slate-400 opacity-40";
            } else btnClass += "bg-white border-slate-200 text-slate-700 hover:border-indigo-400 hover:bg-indigo-50 hover:shadow-md cursor-pointer active:scale-95";
            return <button key={option.id} disabled={!!selectedOption} onClick={() => handleOptionClick(option)} className={btnClass} dir="rtl">{option.arabic}</button>;
          })}
        </div>
        <div className="h-12 flex items-center justify-center bg-slate-100 border-t border-slate-200">
          {selectedOption && (isCorrect ? <span className="text-green-600 font-bold flex items-center gap-2 animate-bounce"><PartyPopper className="w-5 h-5"/> ¡Correcto!</span> : <span className="text-red-500 font-bold flex items-center gap-2 animate-shake"><Frown className="w-5 h-5"/> ¡Ooops! Era la marcada en verde</span>)}
        </div>
      </div>
    </div>
  );
}

// JUEGO 2: MEMORIA (PAREJAS)
function MemoryGame({ onBack, onClose, cards }) {
  const [gameCards, setGameCards] = useState([]);
  const [flipped, setFlipped] = useState([]); // Índices de cartas volteadas
  const [matched, setMatched] = useState([]); // IDs de cartas emparejadas
  const [disabled, setDisabled] = useState(false);
  const [moves, setMoves] = useState(0);

  useEffect(() => {
    startNewGame();
  }, []);

  const startNewGame = () => {
    if (cards.length < 6) return;
    // Seleccionar 6 pares
    const selectedPairs = shuffleArray([...cards]).slice(0, 6);
    
    // Crear el mazo de juego (12 cartas: 6 ES, 6 AR)
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
        // MATCH
        setMatched(prev => [...prev, gameCards[firstIdx].pairId]);
        setFlipped([]);
        setDisabled(false);
      } else {
        // NO MATCH
        setTimeout(() => {
          setFlipped([]);
          setDisabled(false);
        }, 1000);
      }
    }
  };

  const isWin = matched.length === 6;

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col h-[90vh] md:h-auto relative">
        <div className="bg-emerald-600 p-4 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={onBack} className="hover:bg-emerald-500 p-1 rounded mr-2"><ArrowLeft className="w-5 h-5"/></button>
            <h2 className="font-bold text-lg">Memoria</h2>
          </div>
          <button onClick={onClose} className="hover:bg-emerald-500 p-1 rounded"><X className="w-6 h-6" /></button>
        </div>

        <div className="bg-emerald-50 p-2 flex justify-between items-center text-sm font-bold text-emerald-800 shrink-0">
            <span>Movimientos: {moves}</span>
            <span>Parejas: {matched.length} / 6</span>
        </div>

        <div className="p-4 bg-slate-100 flex-1 overflow-y-auto">
            {isWin ? (
                <div className="h-full flex flex-col items-center justify-center text-center">
                    <Trophy className="w-20 h-20 text-yellow-500 mb-4 animate-bounce" />
                    <h3 className="text-3xl font-black text-slate-800 mb-2">¡Completado!</h3>
                    <p className="text-slate-500 mb-6">Lo lograste en {moves} movimientos.</p>
                    <button onClick={startNewGame} className="bg-emerald-600 text-white px-6 py-3 rounded-full font-bold shadow-lg hover:bg-emerald-700 transition">Jugar de nuevo</button>
                </div>
            ) : (
                <div className="grid grid-cols-3 md:grid-cols-4 gap-3 h-full content-center">
                    {gameCards.map((card, index) => {
                        const isFlipped = flipped.includes(index) || matched.includes(card.pairId);
                        return (
                            <div 
                                key={index} 
                                onClick={() => handleCardClick(index)}
                                className={`aspect-[3/4] rounded-xl cursor-pointer perspective-1000 relative transition-all duration-300 ${isFlipped ? '' : 'hover:scale-105'}`}
                            >
                                <div className={`w-full h-full transition-all duration-500 transform-style-3d relative ${isFlipped ? 'rotate-y-180' : ''}`}>
                                    {/* DORSO (Boca abajo) */}
                                    <div className={`absolute inset-0 backface-hidden bg-emerald-600 rounded-xl border-2 border-emerald-700 flex items-center justify-center ${isFlipped ? 'opacity-0' : 'opacity-100'}`}>
                                        <Grid3x3 className="text-white/30 w-8 h-8" />
                                    </div>
                                    
                                    {/* FRENTE (Boca arriba) */}
                                    <div className={`absolute inset-0 backface-hidden bg-white rounded-xl border-2 border-emerald-500 flex items-center justify-center p-2 text-center shadow-md ${isFlipped ? 'opacity-100 rotate-y-180' : 'opacity-0'}`}>
                                        <span className={`font-bold ${card.type === 'ar' ? 'font-arabic text-xl' : 'text-sm'}`} dir={card.type === 'ar' ? 'rtl' : 'ltr'}>
                                            {card.content}
                                        </span>
                                    </div>
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

// --- MODAL DE MANTENIMIENTO BD ---
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
    setLoading(true);
    setAuditResults([]);
    setLogs(["Iniciando auditoría lingüística..."]);

    try {
        const openai = new OpenAI({ apiKey: apiKey, dangerouslyAllowBrowser: true });
        const batchSize = 20;
        let allIssues = [];
        const cardsToAudit = cards; 
        
        for (let i = 0; i < cardsToAudit.length; i += batchSize) {
            const batch = cardsToAudit.slice(i, i + batchSize);
            setLogs(prev => [`Analizando bloque ${i} - ${i+batchSize}...`, ...prev.slice(0,4)]);
            
            const miniBatch = batch.map(c => ({ id: c.id, arabic: c.arabic, spanish: c.spanish }));

            const prompt = `
            Eres un experto lingüista árabe-español. Audita estas flashcards.
            
            REGLAS ESTRICTAS DE NUNACIÓN (TANWIN):
            1. ELIMINA SIEMPRE el Tanwin Damma (un - ٌ ) y Tanwin Kasra (in - ِ ). Usamos forma pausal.
            2. MANTÉN el Tanwin Fath (an - ً ) SOLO si es un adverbio fosilizado (ej: Shukran, Jiddan, Tabaan, Aydan, Masalan, Afwan...).
            3. Si es un sustantivo común con Tanwin Fath innecesario, SUGIERE ELIMINARLO.
            
            REGLAS DE TRADUCCIÓN:
            1. Verifica concordancia de género/número.
            2. Mejora la traducción si es incorrecta.
            
            FORMATO:
            Devuelve SOLO un array JSON válido sin texto adicional.
            Estructura: [{ "id": 123, "problem": "Explica error", "suggestion": "Nueva versión árabe o español", "field": "arabic/spanish" }]
            Si la tarjeta está bien, ignórala.
            
            DATOS: ${JSON.stringify(miniBatch)}
            `;

            const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.2
            });

            let rawContent = response.choices[0].message.content;
            const start = rawContent.indexOf('[');
            const end = rawContent.lastIndexOf(']');
            
            if (start !== -1 && end !== -1) {
                const jsonStr = rawContent.substring(start, end + 1);
                const batchIssues = JSON.parse(jsonStr);
                allIssues = [...allIssues, ...batchIssues];
            }
        }

        if (allIssues.length === 0) {
            setLogs(prev => ["🎉 ¡Increíble! No se detectaron errores.", ...prev]);
        } else {
            setAuditResults(allIssues);
            setLogs(prev => [`✅ Auditoría terminada. ${allIssues.length} sugerencias encontradas.`, ...prev]);
        }
    } catch (error) {
        console.error(error);
        setLogs(prev => [`❌ Error crítico: ${error.message}`, ...prev]);
    } finally {
        setLoading(false);
    }
  };

  const handleApplyFix = async (issue) => {
    try {
      const updateData = {};
      if (issue.field === 'arabic' || !issue.field) updateData.arabic = issue.suggestion;
      if (issue.field === 'spanish') updateData.spanish = issue.suggestion;

      if (!issue.field) {
         if (/[\u0600-\u06FF]/.test(issue.suggestion)) updateData.arabic = issue.suggestion;
         else updateData.spanish = issue.suggestion;
      }

      await supabase.from('flashcards').update(updateData).eq('id', issue.id);
      setAuditResults(prev => prev.filter(p => p.id !== issue.id));
      await refreshCards(); 
    } catch (err) {
      alert("Error aplicando corrección: " + err.message);
    }
  };

  const handleDeleteDuplicate = async (id) => {
    if(!confirm("¿Borrar esta copia?")) return;
    await supabase.from('flashcards').delete().eq('id', id);
    await refreshCards();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="bg-blue-700 px-6 py-4 flex justify-between items-center text-white shrink-0">
          <h2 className="text-lg font-bold flex items-center gap-2"><Settings className="w-5 h-5" /> Mantenimiento BD</h2>
          <button onClick={onClose} className="hover:bg-blue-600 p-1 rounded transition"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex border-b border-slate-200 overflow-x-auto">
            <button onClick={() => setActiveTab('audit')} className={`px-6 py-3 font-bold text-sm whitespace-nowrap ${activeTab === 'audit' ? 'text-blue-700 border-b-2 border-blue-700' : 'text-slate-500'}`}>1. Auditoría IA</button>
            <button onClick={() => setActiveTab('duplicates')} className={`px-6 py-3 font-bold text-sm whitespace-nowrap ${activeTab === 'duplicates' ? 'text-blue-700 border-b-2 border-blue-700' : 'text-slate-500'}`}>2. Duplicados ({duplicateGroups.length})</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
            {/* TAB 1: AUDITORÍA IA */}
            {activeTab === 'audit' && (
                <div className="space-y-4">
                    <div className="bg-purple-50 p-4 rounded-lg border border-purple-100 mb-4">
                        <label className="block text-xs font-bold text-purple-800 uppercase mb-1">OpenAI API Key</label>
                        <input type="password" placeholder="sk-..." className="w-full p-2 border border-purple-200 rounded bg-white text-sm" value={apiKey} onChange={(e) => { setApiKey(e.target.value); localStorage.setItem('openai_key', e.target.value); }} />
                        <div className="flex gap-2 mt-3">
                            <button onClick={handleAudit} disabled={loading || !apiKey} className="flex-1 bg-purple-600 text-white py-2 rounded-lg font-bold hover:bg-purple-700 disabled:opacity-50 flex justify-center gap-2">
                                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Settings className="w-5 h-5" /> Auditar Todo (Lento)</>}
                            </button>
                        </div>
                    </div>

                    {logs.length > 0 && <div className="bg-slate-900 text-green-400 font-mono text-[10px] p-3 rounded-lg max-h-32 overflow-y-auto mb-4 border border-slate-700 shadow-inner">{logs.map((log, i) => <div key={i}>{log}</div>)}</div>}

                    {auditResults.length > 0 ? (
                        <div className="space-y-3">
                            <h3 className="font-bold text-slate-700 flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-500"/> Sugerencias ({auditResults.length})</h3>
                            {auditResults.map(issue => {
                                const originalCard = cards.find(c => c.id === issue.id);
                                if (!originalCard) return null;
                                return (
                                    <div key={issue.id} className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex flex-col gap-3 hover:border-purple-300 transition-colors">
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono">ID: {originalCard.id}</span>
                                                <span className="text-xs font-bold text-slate-400 uppercase">{originalCard.category?.split(';')[0]}</span>
                                            </div>
                                            <button onClick={() => setAuditResults(prev => prev.filter(p => p.id !== issue.id))} className="text-slate-300 hover:text-red-500"><X className="w-4 h-4"/></button>
                                        </div>
                                        
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="bg-red-50 p-3 rounded border border-red-100 relative">
                                                <span className="absolute top-1 right-2 text-[10px] font-bold text-red-300">ORIGINAL</span>
                                                <p className="font-arabic text-xl text-slate-800 text-right mb-1" dir="rtl">{originalCard.arabic}</p>
                                                <p className="text-sm text-slate-600">{originalCard.spanish}</p>
                                            </div>
                                            
                                            <div className="bg-green-50 p-3 rounded border border-green-100 relative">
                                                <span className="absolute top-1 right-2 text-[10px] font-bold text-green-600">SUGERENCIA</span>
                                                <div className="flex flex-col h-full justify-center">
                                                    <p className="font-bold text-lg text-green-800 text-center">{issue.suggestion}</p>
                                                    <p className="text-xs text-green-600 text-center mt-1 italic">{issue.problem}</p>
                                                </div>
                                            </div>
                                        </div>

                                        <button onClick={() => handleApplyFix(issue)} className="self-end bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 shadow-sm transition-transform active:scale-95">
                                            <Check className="w-4 h-4" /> Aplicar Corrección
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    ) : !loading && logs.length > 0 && <div className="text-center text-slate-400 py-10">No hay errores pendientes.</div>}
                </div>
            )}

            {/* TAB 2: DUPLICADOS */}
            {activeTab === 'duplicates' && (
                <div className="space-y-6">
                    {duplicateGroups.length === 0 ? (
                         <div className="text-center text-slate-400 py-10 flex flex-col items-center">
                            <CheckCircle className="w-12 h-12 mb-2 opacity-20"/>
                            <p>¡Limpio! No se encontraron duplicados exactos en árabe.</p>
                         </div>
                    ) : (
                        duplicateGroups.map((group, idx) => (
                            <div key={idx} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                                <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex justify-between items-center">
                                    <span className="font-bold text-slate-600 text-sm">Conflicto #{idx+1}</span>
                                    <span className="font-arabic text-lg text-emerald-700 font-bold" dir="rtl">{group[0].arabic}</span>
                                </div>
                                <div className="divide-y divide-slate-100">
                                    {group.map(card => (
                                        <div key={card.id} className="p-3 flex items-center justify-between hover:bg-slate-50 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs text-slate-400 font-mono w-10">#{card.id}</span>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-slate-800">{card.spanish}</span>
                                                    <span className="text-[10px] text-slate-500">{card.category}</span>
                                                </div>
                                            </div>
                                            <button 
                                                onClick={() => handleDeleteDuplicate(card.id)}
                                                className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                                                title="Borrar esta versión"
                                            >
                                                <Trash2 className="w-5 h-5" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
      </div>
    </div>
  );
}

// --- COMPONENTE FLASHCARD ---
function Flashcard({ data, frontLanguage, showDiacritics, isAdmin, onDelete, onEdit }) {
  const [flipState, setFlipState] = useState(0);
  useEffect(() => { setFlipState(0); }, [frontLanguage]);
  const handleNextFace = () => { if (!isAdmin) setFlipState((prev) => (prev + 1) % 3); };

  const playAudio = (e) => {
    e.stopPropagation();
    const utterance = new SpeechSynthesisUtterance(data.arabic || "");
    utterance.lang = 'ar-SA';
    window.speechSynthesis.speak(utterance);
  };

  const getCardStyle = () => {
    if (isAdmin) return "bg-white border-slate-200 text-slate-800 cursor-default ring-2 ring-slate-100"; 
    switch(flipState) {
      case 0: return "bg-orange-50 border-orange-100 text-slate-800"; 
      case 1: return "bg-emerald-50 border-emerald-200 text-emerald-900";
      case 2: return "bg-amber-100 border-amber-200 text-amber-900";
      default: return "";
    }
  };

  // Usamos removeArabicDiacritics para el toggle visual, no el normalizador de búsqueda
  const displayText = showDiacritics ? data.arabic : removeArabicDiacritics(data.arabic);
  const tags = data.category ? data.category.toString().split(';').map(t => t.trim()).filter(Boolean) : ['General'];

  return (
    <div 
      onClick={handleNextFace}
      className={`relative h-60 w-full rounded-2xl shadow-sm hover:shadow-lg transition-all border flex flex-col p-4 text-center select-none group ${getCardStyle()}`}
    >
      {isAdmin && (
        <div className="absolute top-2 right-2 flex gap-2 z-10">
          <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-2 bg-blue-100 text-blue-600 rounded-full hover:bg-blue-200 transition-colors"><Edit2 className="w-4 h-4" /></button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-2 bg-red-100 text-red-600 rounded-full hover:bg-red-200 transition-colors"><Trash2 className="w-4 h-4" /></button>
        </div>
      )}

      <div className="flex-1 flex flex-col items-center justify-center w-full gap-2 mt-4">
        {isAdmin ? (
          <>
            <h3 className="text-lg font-bold text-slate-800 line-clamp-2">{data.spanish}</h3>
            <h3 className="text-2xl font-arabic text-emerald-700 mt-1" dir="rtl">{displayText}</h3>
            <p className="text-sm font-mono text-amber-700 italic opacity-80">{data.phonetic}</p>
          </>
        ) : (
          <>
            {flipState === 2 ? (
                <>
                    <p className="text-xs uppercase text-amber-600 font-bold mb-2">Fonética</p>
                    <h3 className="text-lg font-mono text-amber-800 italic">{data.phonetic}</h3>
                </>
            ) : (frontLanguage === 'spanish' && flipState === 0) || (frontLanguage === 'arabic' && flipState === 1) ? (
                <>
                    <p className="text-xs uppercase text-slate-400 font-bold mb-2">Español</p>
                    <h3 className="text-xl font-bold">{data.spanish}</h3>
                </>
            ) : (
                <>
                    <p className="text-xs uppercase text-emerald-600 font-bold mb-2">Árabe</p>
                    <h3 className="text-3xl font-arabic mb-4" dir="rtl">{displayText}</h3>
                    <button onClick={playAudio} className="p-2 bg-emerald-200 rounded-full hover:bg-emerald-300 transition-colors"><Volume2 className="w-4 h-4"/></button>
                </>
            )}
          </>
        )}
      </div>

      <div className="mt-auto pt-2 pb-1 flex flex-wrap gap-1 justify-center max-h-12 overflow-hidden">
        {tags.map((tag, i) => (
          <span key={i} className="text-[10px] uppercase font-bold tracking-widest bg-black/5 px-2 py-0.5 rounded-full text-slate-500 opacity-70 whitespace-nowrap">{tag}</span>
        ))}
      </div>
    </div>
  );
}

function CardFormModal({ card, categories, onSave, onClose }) {
  const [formData, setFormData] = useState({
    category: card?.category || "",
    spanish: card?.spanish || "",
    arabic: card?.arabic || "",
    phonetic: card?.phonetic || "",
    id: card?.id || null
  });

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-fade-in-up">
        <div className="bg-slate-800 px-6 py-4 flex justify-between items-center text-white">
          <h2 className="text-lg font-bold flex items-center gap-2">{card ? <Edit2 className="w-5 h-5" /> : <Plus className="w-5 h-5" />}{card ? "Editar Tarjeta" : "Nueva Tarjeta"}</h2>
          <button onClick={onClose} className="hover:bg-slate-700 p-1 rounded transition"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave(formData); }} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Categoría(s)</label>
            <div className="bg-blue-50 text-blue-800 text-xs p-2 rounded mb-2 border border-blue-100 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                <span>Tip: Usa <strong>punto y coma (;)</strong> para asignar múltiples categorías.</span>
            </div>
            <input list="categories-list" type="text" className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} placeholder="Ej: Pista 1; Saludos" />
            <datalist id="categories-list">{categories.map(cat => <option key={cat} value={cat} />)}</datalist>
          </div>
          <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Español</label><input type="text" required className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 font-medium" value={formData.spanish} onChange={e => setFormData({...formData, spanish: e.target.value})} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Árabe</label><input type="text" required dir="rtl" className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 font-arabic text-lg" value={formData.arabic} onChange={e => setFormData({...formData, arabic: e.target.value})} /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Fonética</label><input type="text" className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-sm" value={formData.phonetic} onChange={e => setFormData({...formData, phonetic: e.target.value})} /></div>
          </div>
          <div className="pt-4 flex justify-end gap-3 border-t mt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">Cancelar</button>
            <button type="submit" className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-bold flex items-center gap-2"><Save className="w-4 h-4" /> Guardar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SmartImportModal({ onClose, onImport }) {
  const [apiKey, setApiKey] = useState(localStorage.getItem('openai_key') || "");
  const [activeTab, setActiveTab] = useState('text'); 
  const [textInput, setTextInput] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [pdfFile, setPdfFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generatedCards, setGeneratedCards] = useState([]);
  const [status, setStatus] = useState("");

  const handleApiKeyChange = (e) => {
    setApiKey(e.target.value);
    localStorage.setItem('openai_key', e.target.value);
  };

  const extractTextFromPDF = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    setStatus(`Leyendo PDF (${pdf.numPages} páginas)...`);
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += `--- Página ${i} ---\n${pageText}\n`;
    }
    return fullText;
  };

  const handleGenerate = async () => {
    if (!apiKey) { alert("Por favor introduce tu API Key de OpenAI"); return; }
    if (activeTab === 'text' && !textInput) return;
    if (activeTab === 'image' && !imageFile) return;
    if (activeTab === 'pdf' && !pdfFile) return;

    setLoading(true);
    setStatus("Conectando con la IA...");

    try {
      const openai = new OpenAI({ apiKey: apiKey, dangerouslyAllowBrowser: true });
      let prompt = `Actúa como traductor experto. Analiza texto en bruto. TU MISIÓN: Rescatar vocabulario. REGLAS: 1. PRECISIÓN. 2. NUNACIÓN: Elimina tanwin final salvo excepciones. 3. Busca palabras/frases. 4. CATEGORÍA: Sugiere "Frases" o tema lógico. 5. Separa categorías con PUNTO Y COMA (;). Devuelve JSON válido: [{ "category": "...", "spanish": "...", "arabic": "...", "phonetic": "..." }]`;
      let userContent = "";
      if (activeTab === 'text') userContent = [{ type: "text", text: `Lista: ${textInput}` }];
      else if (activeTab === 'pdf') { const pdfText = await extractTextFromPDF(pdfFile); userContent = [{ type: "text", text: `PDF: ${pdfText}` }]; }
      else { const base64Image = await new Promise((r) => { const reader = new FileReader(); reader.onloadend = () => r(reader.result); reader.readAsDataURL(imageFile); }); userContent = [{ type: "text", text: "Imagen:" }, { type: "image_url", image_url: { url: base64Image } }]; }

      const response = await openai.chat.completions.create({
        model: "gpt-4o", 
        messages: [{ role: "system", content: prompt }, { role: "user", content: userContent }],
        max_tokens: 3000,
      });
      const rawContent = response.choices[0].message.content;
      const start = rawContent.indexOf('['); const end = rawContent.lastIndexOf(']');
      if (start !== -1 && end !== -1) {
          setGeneratedCards(JSON.parse(rawContent.substring(start, end + 1)));
          setStatus("¡Hecho!");
      } else { throw new Error("No se encontró JSON válido"); }
    } catch (error) { console.error(error); alert("Error: " + error.message); setStatus("Error."); } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="bg-purple-700 px-6 py-4 flex justify-between items-center text-white shrink-0"><h2 className="text-lg font-bold flex items-center gap-2"><Wand2 className="w-5 h-5" /> Importador Mágico IA</h2><button onClick={onClose} className="hover:bg-purple-600 p-1 rounded transition"><X className="w-5 h-5" /></button></div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-6 p-4 bg-purple-50 rounded-lg border border-purple-100"><label className="block text-xs font-bold text-purple-800 uppercase mb-1">OpenAI API Key</label><input type="password" placeholder="sk-..." className="w-full p-2 border border-purple-200 rounded bg-white text-sm" value={apiKey} onChange={handleApiKeyChange} /></div>
          {generatedCards.length === 0 ? (
            <div className="space-y-6">
              <div className="flex border-b border-slate-200"><button onClick={() => setActiveTab('text')} className={`px-4 py-2 text-sm font-bold flex items-center gap-2 border-b-2 transition ${activeTab === 'text' ? 'border-purple-600 text-purple-700' : 'text-slate-500'}`}> <FileText className="w-4 h-4" /> Texto </button><button onClick={() => setActiveTab('image')} className={`px-4 py-2 text-sm font-bold flex items-center gap-2 border-b-2 transition ${activeTab === 'image' ? 'border-purple-600 text-purple-700' : 'text-slate-500'}`}> <ImageIcon className="w-4 h-4" /> Imagen </button><button onClick={() => setActiveTab('pdf')} className={`px-4 py-2 text-sm font-bold flex items-center gap-2 border-b-2 transition ${activeTab === 'pdf' ? 'border-purple-600 text-purple-700' : 'text-slate-500'}`}> <FileUp className="w-4 h-4" /> PDF </button></div>
              <div className="min-h-[200px] flex flex-col justify-center">
                {activeTab === 'text' && <textarea className="w-full h-40 p-4 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none resize-none" placeholder="Escribe lista..." value={textInput} onChange={(e) => setTextInput(e.target.value)} />}
                {activeTab === 'image' && <div className="border-2 border-dashed border-slate-300 rounded-lg p-10 flex flex-col items-center justify-center text-slate-500 hover:bg-slate-50 relative"><input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => setImageFile(e.target.files[0])} />{imageFile ? <p className="text-purple-600 font-bold">{imageFile.name}</p> : <><ImageIcon className="w-10 h-10 opacity-50"/><p>Sube imagen</p></>}</div>}
                {activeTab === 'pdf' && <div className="border-2 border-dashed border-slate-300 rounded-lg p-10 flex flex-col items-center justify-center text-slate-500 hover:bg-slate-50 relative"><input type="file" accept="application/pdf" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => setPdfFile(e.target.files[0])} />{pdfFile ? <p className="text-red-600 font-bold">{pdfFile.name}</p> : <><FileUp className="w-10 h-10 opacity-50"/><p>Sube PDF</p></>}</div>}
              </div>
              <button onClick={handleGenerate} disabled={loading || !apiKey} className="w-full py-4 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50">{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />} {loading ? status : "Generar Tarjetas"}</button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between items-center"><h3 className="font-bold text-lg text-slate-700">Vista Previa ({generatedCards.length})</h3><button onClick={() => setGeneratedCards([])} className="text-xs text-red-500 hover:underline">Descartar</button></div>
              <div className="grid gap-2 max-h-[400px] overflow-y-auto">{generatedCards.map((card, i) => (<div key={i} className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg shadow-sm"><div className="w-8 h-8 bg-purple-100 text-purple-700 rounded-full flex items-center justify-center font-bold text-xs">{i+1}</div><div className="flex-1 grid grid-cols-4 gap-2 text-sm"><div className="font-bold text-slate-500 text-xs uppercase">{card.category}</div><div className="font-bold text-slate-800">{card.spanish}</div><div className="font-arabic text-emerald-700 text-right" dir="rtl">{card.arabic}</div><div className="font-mono text-slate-400 text-xs italic">{card.phonetic}</div></div></div>))}</div>
              <div className="p-4 border-t flex justify-end gap-3"><button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg">Cancelar</button><button onClick={() => onImport(generatedCards)} className="px-6 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Importar</button></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}