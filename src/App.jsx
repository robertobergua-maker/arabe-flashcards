import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from './supabaseClient';
import OpenAI from 'openai';
import * as pdfjsLib from 'pdfjs-dist'; 
import { 
  Search, Volume2, BookOpen, X, CheckCircle, 
  Type, Filter, Lock, Unlock, Plus, Trash2, Edit2, Save, 
  Wand2, Image as ImageIcon, FileText, Loader2, FileUp,
  Settings, Copy, AlertTriangle, Layers
} from 'lucide-react';

// Configuración del Worker de PDF
pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.mjs`;

// --- UTILIDADES ---

const removeDiacritics = (text) => {
  if (!text) return "";
  return text.replace(/[\u064B-\u065F\u0670]/g, '');
};

const shuffleArray = (array) => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

const EXCEPTION_WORDS = [
    "شكراً", "جداً", "أبداً", "حالاً", "طبعاً", "عموماً", 
    "يومياً", "مثلاً", "فعلاً", "تقريباً", "أهلاً", "سهلاً",
    "دائماً", "غالباً", "أحياناً", "قليلاً"
];

const cleanNunationText = (text) => {
  if (!text) return "";
  const words = text.split(" ");
  const cleanedWords = words.map(word => {
    const cleanCheck = word.replace(/[.،]/g, "");
    if (EXCEPTION_WORDS.some(ex => cleanCheck.includes(ex))) {
      return word;
    }
    return word.replace(/[\u064B\u064C\u064D]+$/g, "");
  });
  return cleanedWords.join(" ");
};

export default function App() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
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

  // --- CARGAR DATOS ---
  useEffect(() => {
    fetchCards();
  }, []);

  async function fetchCards() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('flashcards')
        .select('*')
        .order('id', { ascending: false })
        .range(0, 9999); // Carga todas las tarjetas sin límite

      if (error) throw error;
      setCards(data);
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

  // --- FUNCIONES CRUD ---
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
        setCards(cards.map(c => c.id === cardData.id ? cardData : c));
      } else {
        const { id, ...newCardData } = cardData;
        const { data, error } = await supabase.from('flashcards').insert([newCardData]).select();
        if (error) throw error;
        if (data) setCards([data[0], ...cards]);
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
        setCards([...data, ...cards]);
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
      setCards(cards.filter(c => c.id !== id));
    } catch (error) {
      alert("Error al borrar: " + error.message);
    }
  };

  // --- UI Y ORDENACIÓN ---
  const openNewCardModal = () => { setEditingCard(null); setIsFormOpen(true); };
  const openEditCardModal = (card) => { setEditingCard(card); setIsFormOpen(true); };

  const categories = useMemo(() => {
    const cats = new Set(cards.map(c => c.category).filter(Boolean));
    const allCats = Array.from(cats);
    
    const pistaCats = allCats.filter(c => c.toLowerCase().startsWith('pista'));
    const frasesCat = allCats.find(c => c === "Frases");
    const otherCats = allCats.filter(c => !c.toLowerCase().startsWith('pista') && c !== "Frases");

    pistaCats.sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)?.[0] || 0);
      const numB = parseInt(b.match(/\d+/)?.[0] || 0);
      return numA - numB;
    });
    otherCats.sort((a, b) => a.localeCompare(b));

    const result = ["Todos", ...pistaCats];
    if (frasesCat) result.push("Frases");
    return [...result, ...otherCats];
  }, [cards]);

  const filteredCards = useMemo(() => {
    let result = cards.filter(card => {
      const s = (card.spanish || "").toLowerCase();
      const a = removeDiacritics(card.arabic || "");
      const term = searchTerm.toLowerCase();
      const matchesSearch = s.includes(term) || a.includes(term);
      const matchesCategory = selectedCategory === "Todos" || card.category === selectedCategory;
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
                placeholder="Buscar palabra..."
                className="w-full pl-9 pr-4 py-2 bg-black/20 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-white/40 placeholder-white/50 text-sm text-white"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="relative md:w-64">
                <Filter className="absolute left-3 top-2.5 w-4 h-4 text-white/50 pointer-events-none" />
                <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="w-full pl-9 pr-8 py-2 bg-black/20 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-white/40 text-sm text-white appearance-none cursor-pointer"
                >
                    {categories.map(cat => (
                        <option key={cat} value={cat} className="text-slate-800 bg-white">{cat}</option>
                    ))}
                </select>
            </div>

            <div className="flex items-center gap-2 bg-black/20 rounded-lg p-1 border border-white/10">
                <button onClick={() => setFrontLanguage('spanish')} className={`px-2 py-1.5 rounded-md text-xs font-bold ${frontLanguage === 'spanish' ? 'bg-white text-slate-800' : 'text-white/70'}`}>ES</button>
                <button onClick={() => setFrontLanguage('arabic')} className={`px-2 py-1.5 rounded-md text-xs font-bold ${frontLanguage === 'arabic' ? 'bg-white text-slate-800' : 'text-white/70'}`}>AR</button>
                <button onClick={() => setShowDiacritics(!showDiacritics)} className={`px-2 py-1.5 rounded-md text-xs font-bold ${showDiacritics ? 'bg-white text-slate-800' : 'text-white/70'}`}>
                    <Type className="w-3.5 h-3.5" />
                </button>
            </div>

            <button 
              onClick={handleAdminToggle}
              className={`p-2 rounded-lg transition-colors ${isAdminMode ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-black/20 hover:bg-black/30 text-white/70'}`}
              title={isAdminMode ? "Salir de modo edición" : "Entrar en modo edición"}
            >
              {isAdminMode ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto bg-slate-100 p-4 md:p-8">
          <div className="max-w-6xl mx-auto">
            {isAdminMode && (
              <div className="mb-6 flex flex-wrap justify-center gap-4 animate-fade-in-up">
                <button 
                  onClick={openNewCardModal}
                  className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-full shadow-lg hover:bg-emerald-700 hover:scale-105 transition-all font-bold"
                >
                  <Plus className="w-5 h-5" /> Añadir Manual
                </button>
                <button 
                  onClick={() => setIsSmartImportOpen(true)}
                  className="flex items-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-full shadow-lg hover:bg-purple-700 hover:scale-105 transition-all font-bold"
                >
                  <Wand2 className="w-5 h-5" /> Importar con IA
                </button>
                <button 
                  onClick={() => setIsMaintenanceOpen(true)}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 hover:scale-105 transition-all font-bold"
                >
                  <Settings className="w-5 h-5" /> Mantenimiento BD
                </button>
              </div>
            )}

            {loading ? (
               <div className="text-center py-20 text-slate-400 animate-pulse">Cargando...</div>
            ) : filteredCards.length === 0 ? (
              <div className="text-center py-20 text-slate-400">No hay tarjetas.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredCards.map(card => (
                  <Flashcard 
                    key={card.id} 
                    data={card} 
                    frontLanguage={frontLanguage} 
                    showDiacritics={showDiacritics}
                    isAdmin={isAdminMode}
                    onDelete={() => handleDeleteCard(card.id)}
                    onEdit={() => openEditCardModal(card)}
                  />
                ))}
              </div>
            )}
          </div>
      </div>

      {isFormOpen && (
        <CardFormModal 
          card={editingCard} 
          categories={categories.filter(c => c !== "Todos")} 
          onSave={handleSaveCard} 
          onClose={() => setIsFormOpen(false)} 
        />
      )}

      {isSmartImportOpen && (
        <SmartImportModal 
          onClose={() => setIsSmartImportOpen(false)}
          onImport={handleBulkImport}
        />
      )}

      {isMaintenanceOpen && (
        <MaintenanceModal 
          onClose={() => setIsMaintenanceOpen(false)}
          cards={cards}
          refreshCards={fetchCards}
        />
      )}
    </div>
  );
}

// --- MODAL DE MANTENIMIENTO BD ---
function MaintenanceModal({ onClose, cards, refreshCards }) {
  const [apiKey, setApiKey] = useState(localStorage.getItem('openai_key') || "");
  const [activeTab, setActiveTab] = useState('phrases'); 
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

  const handleGeneratePhraseCopies = async () => {
    if (!window.confirm("Se buscarán entradas con más de una palabra y se crearán copias en la categoría 'Frases'. ¿Continuar?")) return;
    setLoading(true);
    setLogs(["Iniciando análisis..."]);

    try {
      const candidates = cards.filter(c => c.category !== "Frases" && c.arabic && c.arabic.trim().includes(" "));
      const existingPhrases = new Set(cards.filter(c => c.category === "Frases").map(c => c.arabic.trim()));

      const toCreate = [];
      candidates.forEach(c => {
        if (!existingPhrases.has(c.arabic.trim())) {
          toCreate.push({ 
            category: "Frases", 
            spanish: c.spanish, 
            arabic: c.arabic, 
            phonetic: c.phonetic 
          });
          existingPhrases.add(c.arabic.trim());
        }
      });

      if (toCreate.length === 0) {
        setLogs(prev => [...prev, "✅ No se encontraron frases nuevas para copiar."]);
      } else {
        setLogs(prev => [...prev, `⏳ Creando ${toCreate.length} copias en 'Frases'...`]);
        const { error } = await supabase.from('flashcards').insert(toCreate);
        if (error) throw error;
        setLogs(prev => [...prev, "✅ ¡Hecho! Refrescando base de datos..."]);
        await refreshCards();
      }
    } catch (error) {
      setLogs(prev => [...prev, `❌ Error: ${error.message}`]);
    } finally {
      setLoading(false);
    }
  };

  const handleCleanNunation = async () => {
    setLoading(true);
    setLogs(["Analizando nunaciones..."]);
    let changes = 0;
    try {
      for (const card of cards) {
        if (!card.arabic) continue;
        const clean = cleanNunationText(card.arabic);
        if (card.arabic !== clean) {
          await supabase.from('flashcards').update({ arabic: clean }).eq('id', card.id);
          changes++;
        }
      }
      setLogs(prev => [...prev, `✅ Se limpiaron ${changes} tarjetas.`]);
      if (changes > 0) await refreshCards();
    } catch (error) {
      setLogs(prev => [...prev, `❌ Error: ${error.message}`]);
    } finally {
      setLoading(false);
    }
  };

  const handleAudit = async () => {
    if (!apiKey) { alert("Necesitas la API Key de OpenAI"); return; }
    setLoading(true);
    setAuditResults([]);
    setLogs(["Consultando a la IA..."]);

    try {
        const openai = new OpenAI({ apiKey: apiKey, dangerouslyAllowBrowser: true });
        const batchSize = 20;
        let allIssues = [];
        const cardsToAudit = cards.slice(0, 100); 

        for (let i = 0; i < cardsToAudit.length; i += batchSize) {
            const batch = cardsToAudit.slice(i, i + batchSize);
            const miniBatch = batch.map(c => ({ id: c.id, arabic: c.arabic, spanish: c.spanish }));

            const prompt = `
            Actúa como experto en árabe. Revisa estas tarjetas.
            IGNORA CATEGORÍA Y DUPLICADOS. SOLO revisa traducción Arabic <-> Spanish.
            Datos: ${JSON.stringify(miniBatch)}
            Devuelve JSON: [{ "id": 1, "problem": "Explica el error", "suggestion": "Traducción correcta" }]
            Si todo bien, devuelve [].
            `;

            const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [{ role: "user", content: prompt }]
            });
            const content = response.choices[0].message.content.replace(/```json|```/g, "").trim();
            allIssues = [...allIssues, ...JSON.parse(content)];
        }
        if (allIssues.length === 0) setLogs(prev => [...prev, "🎉 Traducciones perfectas según la IA."]);
        else {
            setAuditResults(allIssues);
            setLogs(prev => [...prev, `⚠️ Se encontraron ${allIssues.length} errores.`]);
        }
    } catch (error) {
        setLogs(prev => [...prev, `❌ Error IA: ${error.message}`]);
    } finally {
        setLoading(false);
    }
  };

  const handleApplyFix = async (issue) => {
    await supabase.from('flashcards').update({ spanish: issue.suggestion }).eq('id', issue.id);
    setAuditResults(prev => prev.filter(p => p.id !== issue.id));
    await refreshCards();
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
            <button onClick={() => setActiveTab('phrases')} className={`px-6 py-3 font-bold text-sm whitespace-nowrap ${activeTab === 'phrases' ? 'text-blue-700 border-b-2 border-blue-700' : 'text-slate-500'}`}>1. Limpieza</button>
            <button onClick={() => setActiveTab('audit')} className={`px-6 py-3 font-bold text-sm whitespace-nowrap ${activeTab === 'audit' ? 'text-blue-700 border-b-2 border-blue-700' : 'text-slate-500'}`}>2. Auditoría IA</button>
            <button onClick={() => setActiveTab('duplicates')} className={`px-6 py-3 font-bold text-sm whitespace-nowrap ${activeTab === 'duplicates' ? 'text-blue-700 border-b-2 border-blue-700' : 'text-slate-500'}`}>3. Duplicados ({duplicateGroups.length})</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
            {/* TAB 1: LIMPIEZA */}
            {activeTab === 'phrases' && (
                <div className="space-y-6">
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <h3 className="font-bold text-lg mb-2 flex items-center gap-2 text-slate-700"><Copy className="w-5 h-5 text-blue-500"/> Copiar a "Frases"</h3>
                        <p className="text-sm text-slate-500 mb-4">Detecta frases y crea copias en su categoría.</p>
                        <button onClick={handleGeneratePhraseCopies} disabled={loading} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50">{loading ? "..." : "Detectar Frases"}</button>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <h3 className="font-bold text-lg mb-2 flex items-center gap-2 text-slate-700"><Type className="w-5 h-5 text-orange-500"/> Limpiar Nunación</h3>
                        <p className="text-sm text-slate-500 mb-4">Elimina tanwin final salvo excepciones.</p>
                        <button onClick={handleCleanNunation} disabled={loading} className="bg-orange-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-orange-700 disabled:opacity-50">{loading ? "..." : "Ejecutar Limpieza"}</button>
                    </div>
                    {logs.length > 0 && <div className="bg-black/80 text-green-400 font-mono text-xs p-4 rounded-lg h-40 overflow-y-auto">{logs.map((log, i) => <div key={i}>{log}</div>)}</div>}
                </div>
            )}

            {/* TAB 2: AUDITORÍA IA */}
            {activeTab === 'audit' && (
                <div className="space-y-4">
                    <div className="bg-purple-50 p-4 rounded-lg border border-purple-100 mb-4">
                        <label className="block text-xs font-bold text-purple-800 uppercase mb-1">OpenAI API Key</label>
                        <input type="password" placeholder="sk-..." className="w-full p-2 border border-purple-200 rounded bg-white text-sm" value={apiKey} onChange={(e) => { setApiKey(e.target.value); localStorage.setItem('openai_key', e.target.value); }} />
                        <button onClick={handleAudit} disabled={loading || !apiKey} className="mt-3 w-full bg-purple-600 text-white py-2 rounded-lg font-bold hover:bg-purple-700 disabled:opacity-50">{loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "🔍 Iniciar Auditoría"}</button>
                    </div>
                    {auditResults.length > 0 ? (
                        <div className="space-y-3">
                            {auditResults.map(issue => {
                                const originalCard = cards.find(c => c.id === issue.id);
                                return (
                                    <div key={issue.id} className="bg-white p-4 rounded-lg shadow border-l-4 border-red-500 flex flex-col gap-2">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-[10px] px-2 py-0.5 bg-slate-200 text-slate-600 rounded uppercase font-bold tracking-wider">{originalCard?.category || 'SIN CAT'}</span>
                                                </div>
                                                <h4 className="font-bold text-red-600 flex items-center gap-2"><AlertTriangle className="w-4 h-4"/> Traducción Dudosa</h4>
                                                <p className="text-lg font-arabic text-right mt-1 text-slate-700" dir="rtl">{originalCard?.arabic}</p>
                                                <p className="text-xs text-slate-400">Actual: {originalCard?.spanish}</p>
                                            </div>
                                            <button onClick={() => setAuditResults(prev => prev.filter(p => p.id !== issue.id))} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4"/></button>
                                        </div>
                                        <div className="bg-green-50 p-2 rounded text-sm text-green-800">
                                            <strong>Sugerencia:</strong> {issue.suggestion}
                                            <p className="text-xs mt-1 opacity-75">{issue.problem}</p>
                                        </div>
                                        <button onClick={() => handleApplyFix(issue)} className="bg-green-600 text-white text-sm py-1 px-3 rounded hover:bg-green-700 self-end">Corregir</button>
                                    </div>
                                );
                            })}
                        </div>
                    ) : <div className="text-center text-slate-400 py-10">{loading ? "Analizando..." : "Sin errores detectados."}</div>}
                </div>
            )}

            {/* TAB 3: DUPLICADOS */}
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
                                                <span className={`text-[10px] px-2 py-1 rounded font-bold uppercase tracking-wider w-24 text-center truncate ${card.category === 'Frases' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
                                                    {card.category || 'GENERAL'}
                                                </span>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-slate-800">{card.spanish}</span>
                                                    <span className="text-xs text-slate-400 font-mono">{card.phonetic}</span>
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

// --- COMPONENTE FLASHCARD (MODIFICADO: Categoría abajo) ---
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

  const displayText = showDiacritics ? data.arabic : removeDiacritics(data.arabic);

  return (
    <div 
      onClick={handleNextFace}
      className={`relative h-60 w-full rounded-2xl shadow-sm hover:shadow-lg transition-all border flex flex-col p-4 text-center select-none group ${getCardStyle()}`}
    >
      {/* Botones Admin */}
      {isAdmin && (
        <div className="absolute top-2 right-2 flex gap-2 z-10">
          <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-2 bg-blue-100 text-blue-600 rounded-full hover:bg-blue-200 transition-colors"><Edit2 className="w-4 h-4" /></button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-2 bg-red-100 text-red-600 rounded-full hover:bg-red-200 transition-colors"><Trash2 className="w-4 h-4" /></button>
        </div>
      )}

      {/* Contenido Principal */}
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

      {/* Categoría (Abajo, sustituyendo leyendas) */}
      <div className="mt-auto pt-2 pb-1 text-center">
        <span className="text-[10px] uppercase font-bold tracking-widest bg-black/5 px-2 py-0.5 rounded-full text-slate-500 opacity-70">
          {data.category || 'General'}
        </span>
      </div>
    </div>
  );
}

function CardFormModal({ card, categories, onSave, onClose }) {
  const [formData, setFormData] = useState({
    category: card?.category || "General",
    spanish: card?.spanish || "",
    arabic: card?.arabic || "",
    phonetic: card?.phonetic || "",
    id: card?.id || null
  });

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-fade-in-up">
        <div className="bg-slate-800 px-6 py-4 flex justify-between items-center text-white">
          <h2 className="text-lg font-bold flex items-center gap-2">
            {card ? <Edit2 className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
            {card ? "Editar Tarjeta" : "Nueva Tarjeta"}
          </h2>
          <button onClick={onClose} className="hover:bg-slate-700 p-1 rounded transition"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave(formData); }} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Categoría</label>
            <input list="categories-list" type="text" required className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} />
            <datalist id="categories-list">{categories.map(cat => <option key={cat} value={cat} />)}</datalist>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Español</label>
            <input type="text" required className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 font-medium" value={formData.spanish} onChange={e => setFormData({...formData, spanish: e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Árabe</label>
              <input type="text" required dir="rtl" className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 font-arabic text-lg" value={formData.arabic} onChange={e => setFormData({...formData, arabic: e.target.value})} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Fonética</label>
              <input type="text" className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-sm" value={formData.phonetic} onChange={e => setFormData({...formData, phonetic: e.target.value})} />
            </div>
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
      
      let prompt = `
        Actúa como traductor experto de árabe a español. Analizas texto en bruto.
        TU MISIÓN: Rescatar vocabulario y frases.

        REGLAS:
        1. PRECISIÓN EN TRADUCCIÓN: Corrige si el original tiene errores.
        2. NUNACIÓN: Elimina el tanwin final salvo excepciones comunes.
        3. Busca palabras O FRASES en árabe.
        4. CATEGORÍA IMPORTANTE: 
           - Si la entrada es una frase completa o una oración larga, sugiérela como categoría "Frases".
           - Si es una palabra suelta, usa su categoría lógica (Animales, Comida...).
        5. Ignora ruido y números.

        Devuelve JSON válido:
        [{ "category": "Categoría", "spanish": "Traducción", "arabic": "Árabe", "phonetic": "Fonética" }]
      `;

      let userContent = "";

      if (activeTab === 'text') {
        userContent = [{ type: "text", text: `Lista: ${textInput}` }];
      } else if (activeTab === 'pdf') {
        const pdfText = await extractTextFromPDF(pdfFile);
        userContent = [{ type: "text", text: `Extrae vocabulario del PDF:\n${pdfText}` }];
      } else {
        const base64Image = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(imageFile);
        });
        userContent = [
          { type: "text", text: "Extrae vocabulario de esta imagen." },
          { type: "image_url", image_url: { url: base64Image } }
        ];
      }

      setStatus("Procesando...");
      const response = await openai.chat.completions.create({
        model: "gpt-4o", 
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: userContent }
        ],
        max_tokens: 3000,
      });

      const rawContent = response.choices[0].message.content;
      const jsonStr = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsedData = JSON.parse(jsonStr);

      setGeneratedCards(parsedData);
      setStatus("¡Hecho! Revisa las tarjetas.");

    } catch (error) {
      console.error(error);
      alert("Error: " + error.message);
      setStatus("Error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="bg-purple-700 px-6 py-4 flex justify-between items-center text-white shrink-0">
          <h2 className="text-lg font-bold flex items-center gap-2"><Wand2 className="w-5 h-5" /> Importador Mágico IA</h2>
          <button onClick={onClose} className="hover:bg-purple-600 p-1 rounded transition"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-6 p-4 bg-purple-50 rounded-lg border border-purple-100">
            <label className="block text-xs font-bold text-purple-800 uppercase mb-1">OpenAI API Key</label>
            <input 
              type="password" 
              placeholder="sk-..." 
              className="w-full p-2 border border-purple-200 rounded bg-white text-sm"
              value={apiKey}
              onChange={handleApiKeyChange}
            />
          </div>

          {generatedCards.length === 0 ? (
            <div className="space-y-6">
              <div className="flex border-b border-slate-200">
                <button onClick={() => setActiveTab('text')} className={`px-4 py-2 text-sm font-bold flex items-center gap-2 border-b-2 transition ${activeTab === 'text' ? 'border-purple-600 text-purple-700' : 'text-slate-500'}`}> <FileText className="w-4 h-4" /> Texto </button>
                <button onClick={() => setActiveTab('image')} className={`px-4 py-2 text-sm font-bold flex items-center gap-2 border-b-2 transition ${activeTab === 'image' ? 'border-purple-600 text-purple-700' : 'text-slate-500'}`}> <ImageIcon className="w-4 h-4" /> Imagen </button>
                <button onClick={() => setActiveTab('pdf')} className={`px-4 py-2 text-sm font-bold flex items-center gap-2 border-b-2 transition ${activeTab === 'pdf' ? 'border-purple-600 text-purple-700' : 'text-slate-500'}`}> <FileUp className="w-4 h-4" /> PDF </button>
              </div>

              <div className="min-h-[200px] flex flex-col justify-center">
                {activeTab === 'text' && <textarea className="w-full h-40 p-4 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none resize-none" placeholder="Escribe lista..." value={textInput} onChange={(e) => setTextInput(e.target.value)} />}
                {activeTab === 'image' && <div className="border-2 border-dashed border-slate-300 rounded-lg p-10 flex flex-col items-center justify-center text-slate-500 hover:bg-slate-50 relative"><input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => setImageFile(e.target.files[0])} />{imageFile ? <p className="text-purple-600 font-bold">{imageFile.name}</p> : <><ImageIcon className="w-10 h-10 opacity-50"/><p>Sube imagen</p></>}</div>}
                {activeTab === 'pdf' && <div className="border-2 border-dashed border-slate-300 rounded-lg p-10 flex flex-col items-center justify-center text-slate-500 hover:bg-slate-50 relative"><input type="file" accept="application/pdf" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => setPdfFile(e.target.files[0])} />{pdfFile ? <p className="text-red-600 font-bold">{pdfFile.name}</p> : <><FileUp className="w-10 h-10 opacity-50"/><p>Sube PDF</p></>}</div>}
              </div>

              <button onClick={handleGenerate} disabled={loading || !apiKey} className="w-full py-4 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />} {loading ? status : "Generar Tarjetas"}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between items-center"><h3 className="font-bold text-lg text-slate-700">Vista Previa ({generatedCards.length})</h3><button onClick={() => setGeneratedCards([])} className="text-xs text-red-500 hover:underline">Descartar</button></div>
              <div className="grid gap-2 max-h-[400px] overflow-y-auto">
                {generatedCards.map((card, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
                    <div className="w-8 h-8 bg-purple-100 text-purple-700 rounded-full flex items-center justify-center font-bold text-xs">{i+1}</div>
                    <div className="flex-1 grid grid-cols-4 gap-2 text-sm">
                      <div className="font-bold text-slate-500 text-xs uppercase">{card.category}</div>
                      <div className="font-bold text-slate-800">{card.spanish}</div>
                      <div className="font-arabic text-emerald-700 text-right" dir="rtl">{card.arabic}</div>
                      <div className="font-mono text-slate-400 text-xs italic">{card.phonetic}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-4 border-t flex justify-end gap-3"><button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg">Cancelar</button><button onClick={() => onImport(generatedCards)} className="px-6 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Importar</button></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}