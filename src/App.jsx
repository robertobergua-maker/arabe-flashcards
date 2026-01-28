import React, { useState, useEffect } from 'react'
import { Menu, ArrowLeft, Volume2, BookOpen, Mic, Settings } from 'lucide-react'
import { supabase } from './supabaseClient'

function App() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  
  // Estado para el modo mantenimiento (Simple, solo activado/desactivado)
  const [isMaintenanceMode, setIsMaintenanceMode] = useState(false)

  // Cargar y ORDENAR categorías
  useEffect(() => {
    async function fetchCategories() {
      try {
        setLoading(true)
        // 1. Pedimos todas las categorías
        const { data, error } = await supabase
          .from('categories')
          .select('*')
          .eq('is_category', true)

        if (error) {
          console.error('Error cargando categorías:', error)
        } else {
          // 2. LÓGICA DE ORDENAMIENTO ROBUSTA
          const sortedData = (data || []).sort((a, b) => {
            const titleA = (a.title || '').toLowerCase().trim()
            const titleB = (b.title || '').toLowerCase().trim()
            
            // Verificamos si son pistas
            const isPistaA = titleA.startsWith('pista')
            const isPistaB = titleB.startsWith('pista')

            // CASO A: Ambas son pistas -> Ordenar por el número que contengan
            if (isPistaA && isPistaB) {
              // Extraer solo los números del título (ej: "Pista 14" -> 14)
              const numA = parseInt(titleA.replace(/\D/g, '')) || 0
              const numB = parseInt(titleB.replace(/\D/g, '')) || 0
              return numA - numB
            }

            // CASO B: Solo A es pista -> A va primero (arriba)
            if (isPistaA) return -1

            // CASO C: Solo B es pista -> B va primero
            if (isPistaB) return 1

            // CASO D: Ninguna es pista -> Orden alfabético normal
            return titleA.localeCompare(titleB, 'es', { sensitivity: 'base' })
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

  // Renderizado de la lista de categorías (reutilizable)
  const renderCategoryList = () => (
    <ul className="divide-y divide-gray-100">
      {categories.map((category) => (
        <li key={category.id}>
          <button
            onClick={() => handleCategoryClick(category)}
            className={`w-full text-left p-4 hover:bg-emerald-50 transition-colors flex items-center gap-3
              ${selectedCategory?.id === category.id 
                ? 'bg-emerald-50 text-emerald-700 border-l-4 border-emerald-600' 
                : 'text-gray-700'}
            `}
          >
            {/* Badge opcional para depurar el orden */}
            <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
              {category.id}
            </span>
            <span className="font-medium">{category.title}</span>
          </button>
        </li>
      ))}
    </ul>
  )

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
            {/* Botón Mantenimiento (Discreto) */}
            <button 
               onClick={() => setIsMaintenanceMode(!isMaintenanceMode)}
               className={`p-2 rounded-full transition-colors ${isMaintenanceMode ? 'bg-emerald-800' : 'hover:bg-emerald-700'}`}
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
        <aside className={`
          fixed inset-y-0 left-0 transform ${isMenuOpen ? 'translate-x-0' : '-translate-x-full'}
          md:relative md:translate-x-0 md:w-80 bg-white shadow-xl transition-transform duration-300 ease-in-out z-20
          flex flex-col h-[calc(100vh-64px)] top-[64px]
        `}>
          <div className={`p-4 border-b ${isMaintenanceMode ? 'bg-amber-50' : 'bg-emerald-50'}`}>
            <h2 className={`font-semibold ${isMaintenanceMode ? 'text-amber-800' : 'text-emerald-800'}`}>
              {isMaintenanceMode ? 'Mantenimiento' : 'Temario'}
            </h2>
            {isMaintenanceMode && (
                <p className="text-xs text-amber-600 mt-1">
                    Modo edición activo. Las frases nuevas se auto-categorizan.
                </p>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-gray-500">Cargando lista...</div>
            ) : (
              renderCategoryList()
            )}
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-4 md:p-8 overflow-y-auto h-[calc(100vh-64px)]">
          {selectedCategory ? (
            <div className="max-w-3xl mx-auto space-y-6">
              
              <h2 className="text-2xl font-bold text-gray-800 mb-4">{selectedCategory.title}</h2>

              {isMaintenanceMode ? (
                // --- VISTA DE MANTENIMIENTO SIMPLIFICADA ---
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
                   <h3 className="text-lg font-semibold text-amber-800 mb-4">Gestión de Categoría</h3>
                   <p className="text-gray-700 mb-4">
                     Estás editando: <strong>{selectedCategory.title}</strong>
                   </p>
                   {/* Aquí iría tu componente de subida o edición real */}
                   <div className="flex gap-4">
                      <button className="bg-amber-600 text-white px-4 py-2 rounded hover:bg-amber-700">
                        Añadir Tarjeta
                      </button>
                      <button className="bg-white border border-amber-600 text-amber-600 px-4 py-2 rounded hover:bg-amber-50">
                        Revisar Tarjetas
                      </button>
                   </div>
                </div>
              ) : (
                // --- VISTA DE ESTUDIO (NORMAL) ---
                <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
                  <div className="aspect-video bg-gray-100 rounded-lg flex items-center justify-center mb-6">
                    <div className="text-center text-gray-400">
                        <Volume2 size={48} className="mx-auto mb-2" />
                        <span>Reproductor</span>
                    </div>
                  </div>
                  
                  {/* Tarjeta de ejemplo para mantener diseño */}
                  <div className="p-4 border rounded-lg hover:border-emerald-200 transition-colors cursor-pointer group">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-lg font-medium">Ejemplo de contenido</span>
                      <span className="text-xl font-arabic" dir="rtl">مثال</span>
                    </div>
                    <div className="flex gap-2 mt-2 opacity-50 group-hover:opacity-100 transition-opacity">
                      <button className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-full">
                        <Volume2 size={18} />
                      </button>
                      <button className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-full">
                        <Mic size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            // HOME VACÍO
            <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-4">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600">
                <BookOpen size={32} />
              </div>
              <p className="text-lg">Selecciona una pista del menú para comenzar</p>
            </div>
          )}
        </main>

        {/* Overlay móvil */}
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