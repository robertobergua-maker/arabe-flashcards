import React, { useState, useEffect } from 'react'
import { Menu, ArrowLeft, Volume2, BookOpen, Mic } from 'lucide-react'
import { supabase } from './supabaseClient'

function App() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  // Cargar categorías al iniciar
  useEffect(() => {
    async function fetchCategories() {
      try {
        setLoading(true)
        const { data, error } = await supabase
          .from('categories')
          .select('*')
          .eq('is_category', true)
          // --- AQUÍ ESTÁ EL CAMBIO IMPORTANTE ---
          .order('id', { ascending: true }) 
          // -------------------------------------

        if (error) {
          console.error('Error cargando categorías:', error)
        } else {
          setCategories(data || [])
        }
      } catch (error) {
        console.error('Error inesperado:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchCategories()
  }, [])

  const handleCategoryClick = (category) => {
    setSelectedCategory(category)
    setIsMenuOpen(false)
  }

  const handleBack = () => {
    setSelectedCategory(null)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-emerald-600 text-white p-4 shadow-lg sticky top-0 z-10">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {selectedCategory ? (
              <button 
                onClick={handleBack}
                className="p-2 hover:bg-emerald-700 rounded-full transition-colors"
              >
                <ArrowLeft size={24} />
              </button>
            ) : (
              <div className="p-2">
                <BookOpen size={24} />
              </div>
            )}
            <h1 className="text-xl font-bold truncate">
              {selectedCategory ? selectedCategory.title : 'Español - Árabe'}
            </h1>
          </div>
          
          <button 
            className="md:hidden p-2 hover:bg-emerald-700 rounded-lg"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            <Menu size={24} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 container mx-auto relative">
        {/* Sidebar / Menu List */}
        <aside className={`
          fixed inset-y-0 left-0 transform ${isMenuOpen ? 'translate-x-0' : '-translate-x-full'}
          md:relative md:translate-x-0 md:w-80 bg-white shadow-xl transition-transform duration-300 ease-in-out z-20
          flex flex-col h-[calc(100vh-64px)] top-[64px]
        `}>
          <div className="p-4 border-b bg-emerald-50">
            <h2 className="font-semibold text-emerald-800">Temario</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-gray-500">Cargando pistas...</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {categories.map((category) => (
                  <li key={category.id}>
                    <button
                      onClick={() => handleCategoryClick(category)}
                      className={`w-full text-left p-4 hover:bg-emerald-50 transition-colors flex items-center gap-3
                        ${selectedCategory?.id === category.id ? 'bg-emerald-50 text-emerald-700 border-l-4 border-emerald-600' : 'text-gray-700'}
                      `}
                    >
                      <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-1 rounded">
                        {category.id}
                      </span>
                      <span className="font-medium">{category.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-4 md:p-8 overflow-y-auto h-[calc(100vh-64px)]">
          {selectedCategory ? (
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">{selectedCategory.title}</h2>
                <div className="aspect-video bg-gray-100 rounded-lg flex items-center justify-center mb-6">
                  <span className="text-gray-400">Reproductor de Audio Aquí</span>
                </div>
                
                {/* Aquí iría el contenido específico de la lección */}
                <div className="grid gap-4">
                  <div className="p-4 border rounded-lg hover:border-emerald-200 transition-colors cursor-pointer group">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-lg font-medium">Hola</span>
                      <span className="text-xl font-arabic" dir="rtl">مرحبا</span>
                    </div>
                    <div className="flex gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-full">
                        <Volume2 size={18} />
                      </button>
                      <button className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-full">
                        <Mic size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-4">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600">
                <BookOpen size={32} />
              </div>
              <p className="text-lg">Selecciona una pista del menú para comenzar</p>
            </div>
          )}
        </main>

        {/* Overlay for mobile menu */}
        {isMenuOpen && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 md:hidden z-10"
            onClick={() => setIsMenuOpen(false)}
          />
        )}
      </div>
    </div>
  )
}

export default App