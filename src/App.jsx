import React, { useState, useEffect } from 'react'
import { Menu, ArrowLeft, Volume2, BookOpen, Mic, Settings, Check, X } from 'lucide-react'
import { supabase } from './supabaseClient'

// Componente simple para revisar tarjetas (Placeholder para la lógica de revisión)
const CardReviewer = ({ categoryId, mode, onBack }) => {
  const [cards, setCards] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchCards() {
      setLoading(true)
      try {
        let query = supabase
          .from('flashcards')
          .select('*')
          .eq('category_id', categoryId)

        // Lógica de filtrado según el modo (simplificado tras eliminar opciones antiguas)
        if (mode === 'review_category') {
          // Por defecto traemos las que no están validadas o todas, según tu lógica
          // Aquí traigo todas para mantenimiento
        }

        const { data, error } = await query
        
        if (error) throw error
        setCards(data || [])
      } catch (error) {
        console.error('Error fetching cards:', error)
      } finally {
        setLoading(false)
      }
    }

    if (categoryId) fetchCards()
  }, [categoryId, mode])

  const handleCardAction = async (action) => {
    // Aquí iría la lógica para validar/editar la tarjeta
    console.log(`Tarjeta ${cards[currentIndex].id} acción: ${action}`)
    if (currentIndex < cards.length - 1) {
      setCurrentIndex(prev => prev + 1)
    } else {
      alert('Revisión de esta categoría completada')
      onBack()
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando tarjetas...</div>
  if (cards.length === 0) return <div className="p-8 text-center text-gray-500">No hay tarjetas para revisar en esta categoría.</div>

  const currentCard = cards[currentIndex]

  return (
    <div className="max-w-md mx-auto bg-white rounded-xl shadow-md overflow-hidden mt-4 p-6">
      <div className="text-center mb-6">
        <span className="text-sm text-gray-400">Tarjeta {currentIndex + 1} de {cards.length}</span>
      </div>
      
      <div className="space-y-4 mb-8">
        <div className="text-center">
          <h3 className="text-lg font-semibold text-gray-600">Español</h3>
          <p className="text-2xl font-bold text-gray-800">{currentCard.spanish}</p>
        </div>
        <div className="border-t border-gray-100 my-4"></div>
        <div className="text-center">
          <h3 className="text-lg font-semibold text-gray-600">Árabe</h3>
          <p className="text-3xl font-arabic text-emerald-600" dir="rtl">{currentCard.arabic}</p>
        </div>
      </div>

      <div className="flex justify-between gap-4">
        <button 
          onClick={() => handleCardAction('reject')}
          className="flex-1 bg-red-50 text-red-600 py-3 rounded-lg flex items-center justify-center gap-2 hover:bg-red-100 transition"
        >
          <X size={20} /> Revisar
        </button>
        <button 
          onClick={() => handleCardAction('approve')}
          className="flex-1 bg-emerald-50 text-emerald-600 py-3 rounded-lg flex items-center justify-center gap-2 hover:bg-emerald-100 transition"
        >
          <Check size={20} /> Correcto
        </button>
      </div>
    </div>
  )
}

function App() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  
  // Estados para Mantenimiento
  const [isMaintenanceMode, setIsMaintenanceMode] = useState(false)
  const [maintenanceOption, setMaintenanceOption] = useState('review_category')

  // Cargar categorías al iniciar
  useEffect(() => {
    async function fetchCategories() {
      try {
        setLoading(true)
        // 1. Traemos TODAS las categorías sin ordenar en la query para hacerlo custom en JS
        const { data, error } = await supabase
          .from('categories')
          .select('*')
          .eq('is_category', true)

        if (error) {
          console.error('Error cargando categorías:', error)
        } else {
          // 2. Lógica de Ordenación Personalizada
          const sortedData = (data || []).sort((a, b) => {
            const titleA = (a.title || '').toLowerCase()
            const titleB = (b.title || '').toLowerCase()
            
            // Detectar si son "Pistas" (empiezan por "Pista" o "track")
            const isPistaA = titleA.startsWith('pista')
            const isPistaB = titleB.startsWith('pista')

            // CASO 1: Ambas son pistas -> Ordenar por ID numérico (1, 2... 10)
            if (isPistaA && isPistaB) {
              return a.id - b.id
            }

            // CASO 2: Solo A es pista -> A va primero
            if (isPistaA) return -1

            // CASO 3: Solo B es pista -> B va primero
            if (isPistaB) return 1

            // CASO 4: Ninguna es pista -> Orden Alfabético normal
            return titleA.localeCompare(titleB)
          })

          setCategories(sortedData)
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
          
          <div className="flex items-center gap-2">
            {/* Botón de Mantenimiento Toggle */}
            <button 
               onClick={() => {
                 setIsMaintenanceMode(!isMaintenanceMode)
                 setSelectedCategory(null) // Resetear selección al cambiar modo
               }}
               className={`p-2 rounded-full transition-colors ${isMaintenanceMode ? 'bg-emerald-800 text-white' : 'hover:bg-emerald-700 text-emerald-100'}`}
               title="Modo Mantenimiento"
            >
              <Settings size={20} />
            </button>

            <button 
              className="md:hidden p-2 hover:bg-emerald-700 rounded-lg"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              <Menu size={24} />
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 container mx-auto relative">
        {/* Sidebar / Menu List */}
        {/* Si estamos en modo mantenimiento y hay una categoría seleccionada, ocultamos el sidebar en móvil para dar foco */}
        <aside className={`
          fixed inset-y-0 left-0 transform ${isMenuOpen ? 'translate-x-0' : '-translate-x-full'}
          md:relative md:translate-x-0 md:w-80 bg-white shadow-xl transition-transform duration-300 ease-in-out z-20
          flex flex-col h-[calc(100vh-64px)] top-[64px]
          ${(isMaintenanceMode && selectedCategory) ? 'hidden md:flex' : ''}
        `}>
          
          {/* Cabecera del Sidebar según el modo */}
          <div className={`p-4 border-b ${isMaintenanceMode ? 'bg-amber-50' : 'bg-emerald-50'}`}>
            <h2 className={`font-semibold ${isMaintenanceMode ? 'text-amber-800' : 'text-emerald-800'}`}>
              {isMaintenanceMode ? 'Mantenimiento' : 'Temario'}
            </h2>
            
            {/* Opciones extra solo en mantenimiento */}
            {isMaintenanceMode && (
              <div className="mt-3">
                <select 
                  value={maintenanceOption}
                  onChange={(e) => setMaintenanceOption(e.target.value)}
                  className="w-full text-sm p-2 border border-amber-200 rounded bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="review_category">Revisar por Categoría</option>
                  {/* Eliminadas opciones de aninunación y frases según solicitud */}
                </select>
                <p className="text-xs text-gray-500 mt-2 italic">
                  * Las frases nuevas se añaden a "Frases". 
                  <br/>* Palabras nuevas se categorizan autom.
                </p>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-gray-500">Cargando datos...</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {categories.map((category) => (
                  <li key={category.id}>
                    <button
                      onClick={() => handleCategoryClick(category)}
                      className={`w-full text-left p-4 hover:bg-gray-50 transition-colors flex items-center gap-3
                        ${selectedCategory?.id === category.id 
                          ? (isMaintenanceMode ? 'bg-amber-50 text-amber-900 border-l-4 border-amber-500' : 'bg-emerald-50 text-emerald-700 border-l-4 border-emerald-600') 
                          : 'text-gray-700'}
                      `}
                    >
                      <span className={`text-xs font-bold px-2 py-1 rounded 
                        ${isMaintenanceMode ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
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
              
              {/* Título de la sección */}
              <div className="flex items-center justify-between mb-4">
                 <h2 className="text-2xl font-bold text-gray-800">{selectedCategory.title}</h2>
                 {isMaintenanceMode && (
                   <span className="bg-amber-100 text-amber-800 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide">
                     Modo Editor
                   </span>
                 )}
              </div>

              {/* CONTENIDO: MODO MANTENIMIENTO O MODO ESTUDIO */}
              {isMaintenanceMode ? (
                // MODO MANTENIMIENTO
                <CardReviewer 
                  categoryId={selectedCategory.id}
                  mode={maintenanceOption}
                  onBack={handleBack}
                />
              ) : (
                // MODO ESTUDIO (Usuario normal)
                <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
                  <div className="aspect-video bg-gray-100 rounded-lg flex items-center justify-center mb-6 relative overflow-hidden group">
                     {/* Placeholder del reproductor */}
                     <div className="text-center">
                        <Volume2 size={48} className="mx-auto text-emerald-400 mb-2" />
                        <span className="text-gray-400 font-medium">Reproductor de Audio</span>
                     </div>
                  </div>
                  
                  {/* Lista de vocabulario de ejemplo */}
                  <div className="grid gap-4">
                    <div className="p-4 border rounded-lg hover:border-emerald-200 transition-colors cursor-pointer group bg-white">
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-lg font-medium text-gray-800">Ejemplo de palabra</span>
                        <span className="text-xl font-arabic text-emerald-700" dir="rtl">مثال</span>
                      </div>
                      <div className="flex gap-2 mt-2 opacity-50 group-hover:opacity-100 transition-opacity">
                        <button className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-full" title="Escuchar">
                          <Volume2 size={18} />
                        </button>
                        <button className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-full" title="Grabar">
                          <Mic size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            // Pantalla vacía (Home)
            <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center 
                ${isMaintenanceMode ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                {isMaintenanceMode ? <Settings size={32} /> : <BookOpen size={32} />}
              </div>
              <p className="text-lg font-medium">
                {isMaintenanceMode 
                  ? 'Selecciona una categoría para editar' 
                  : 'Selecciona una pista del menú para comenzar'}
              </p>
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