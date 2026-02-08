import React, { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "./supabaseClient";
import {
  Search,
  Volume2,
  BookOpen,
  X,
  CheckCircle,
  Type,
  Filter,
  Lock,
  Unlock,
  Plus,
  Trash2,
  Edit2,
  Save,
  Wand2,
  Image as ImageIcon,
  FileText,
  Loader2,
  Settings,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Check,
  Trophy,
  Frown,
  Zap,
  Activity,
} from "lucide-react";

/* =========================================================
   UTILIDADES
========================================================= */

const removeArabicDiacritics = (text = "") =>
  text.replace(/[\u064B-\u065F\u0670]/g, "");

const normalizeForSearch = (text = "") =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u064B-\u065F\u0670]/g, "");

const shuffleArray = (array) => {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const safeGetStorage = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
};

const getCardType = (card) => {
  if (!card) return "word";
  if (card.category?.toLowerCase().includes("frases")) return "phrase";
  const wc = (card.spanish || "").trim().split(/\s+/).length;
  return wc > 2 ? "phrase" : "word";
};

/* =========================================================
   COMPONENTE FLASHCARD (INTEGRADO → NO IMPORTS ROTOS)
========================================================= */

function Flashcard({
  data,
  frontLanguage,
  showDiacritics,
  isAdmin,
  onDelete,
  onEdit,
}) {
  const arabic = showDiacritics
    ? data.arabic
    : removeArabicDiacritics(data.arabic || "");

  const front =
    frontLanguage === "arabic" ? arabic : data.spanish || "";

  return (
    <div className="bg-white rounded-xl shadow p-4 border border-slate-200 flex flex-col justify-between">
      <div>
        <div className="text-[11px] text-slate-500 mb-2">
          {data.category || "General"}
        </div>

        <div
          className={`font-bold ${
            frontLanguage === "arabic"
              ? "text-2xl font-arabic"
              : "text-lg"
          }`}
          dir={frontLanguage === "arabic" ? "rtl" : "ltr"}
        >
          {front}
        </div>

        {data.phonetic && (
          <div className="text-sm italic text-slate-400 mt-1">
            {data.phonetic}
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="flex gap-2 mt-4">
          <button
            onClick={onEdit}
            className="flex-1 px-3 py-1 bg-blue-600 text-white rounded text-sm font-bold"
          >
            Editar
          </button>
          <button
            onClick={onDelete}
            className="flex-1 px-3 py-1 bg-red-600 text-white rounded text-sm font-bold"
          >
            Borrar
          </button>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   APP
========================================================= */

export default function App() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Todos");

  const [frontLanguage, setFrontLanguage] = useState(() => {
    try {
      return localStorage.getItem("pref_lang") || "spanish";
    } catch {
      return "spanish";
    }
  });

  const [showDiacritics, setShowDiacritics] = useState(() =>
    safeGetStorage("pref_diacritics", true)
  );

  const [isAdminMode, setIsAdminMode] = useState(false);

  useEffect(() => {
    localStorage.setItem("pref_lang", frontLanguage);
  }, [frontLanguage]);

  useEffect(() => {
    localStorage.setItem("pref_diacritics", JSON.stringify(showDiacritics));
  }, [showDiacritics]);

  /* =======================
     CARGA DE TARJETAS
  ======================= */

  useEffect(() => {
    fetchAllCards();
  }, []);

  async function fetchAllCards() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("flashcards")
        .select("*")
        .order("id", { ascending: false });

      if (error) throw error;
      setCards(data || []);
    } catch (e) {
      console.error("Error cargando tarjetas:", e);
    } finally {
      setLoading(false);
    }
  }

  /* =======================
     ADMIN
  ======================= */

  const handleAdminToggle = () => {
    if (isAdminMode) {
      setIsAdminMode(false);
    } else {
      const p = prompt("Contraseña admin:");
      if (p === "1234") setIsAdminMode(true);
    }
  };

  /* =======================
     FILTROS
  ======================= */

  const categories = useMemo(() => {
    const set = new Set(["General"]);
    cards.forEach((c) => {
      if (!c.category) return;
      c.category
        .split(";")
        .map((x) => x.trim())
        .filter(Boolean)
        .forEach((x) => set.add(x));
    });
    return ["Todos", ...Array.from(set)];
  }, [cards]);

  const filteredCards = useMemo(() => {
    const t = normalizeForSearch(searchTerm);
    return cards.filter((c) => {
      const okText =
        normalizeForSearch(c.spanish || "").includes(t) ||
        normalizeForSearch(c.arabic || "").includes(t);

      const okCat =
        selectedCategory === "Todos" ||
        (c.category || "General")
          .split(";")
          .map((x) => x.trim())
          .includes(selectedCategory);

      return okText && okCat;
    });
  }, [cards, searchTerm, selectedCategory]);

  /* =======================
     RENDER
  ======================= */

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 flex flex-col">
      <header className="bg-emerald-700 text-white p-4 shadow sticky top-0 z-10">
        <div className="flex flex-wrap gap-3 items-center">
          <BookOpen />
          <h1 className="font-bold text-lg flex-1">Aprende Árabe</h1>

          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar…"
            className="px-3 py-1 rounded text-black"
          />

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-2 py-1 rounded text-black"
          >
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>

          <button
            onClick={() => setFrontLanguage("spanish")}
            className="px-2 py-1 bg-white text-black rounded"
          >
            ES
          </button>
          <button
            onClick={() => setFrontLanguage("arabic")}
            className="px-2 py-1 bg-white text-black rounded"
          >
            AR
          </button>

          <button
            onClick={() => setShowDiacritics((v) => !v)}
            className="px-2 py-1 bg-white text-black rounded"
          >
            <Type size={16} />
          </button>

          <button
            onClick={handleAdminToggle}
            className="px-2 py-1 bg-black/30 rounded"
          >
            {isAdminMode ? <Unlock /> : <Lock />}
          </button>
        </div>
      </header>

      <main className="flex-1 p-6">
        {loading ? (
          <div className="text-center text-slate-400">Cargando…</div>
        ) : filteredCards.length === 0 ? (
          <div className="text-center text-slate-400">
            No hay tarjetas
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredCards.map((card) => (
              <Flashcard
                key={card.id}
                data={card}
                frontLanguage={frontLanguage}
                showDiacritics={showDiacritics}
                isAdmin={isAdminMode}
                onEdit={() => alert("Editar " + card.id)}
                onDelete={() => alert("Borrar " + card.id)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
