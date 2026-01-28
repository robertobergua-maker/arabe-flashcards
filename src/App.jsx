import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import FlashcardList from './components/FlashcardList'
import AdminPanel from './components/AdminPanel' // La lógica de mantenimiento está aquí dentro
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

function App() {
  const [categories, setCategories] = useState([])
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [user, setUser] = useState(null)
  const [showAdminLogin, setShowAdminLogin] = useState(false)

  useEffect(() => {
    checkUser()
    fetchCategories()

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        checkAdminStatus(session.user.id)
      } else {
        setIsAdmin(false)
      }
    })

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [])

  async function checkUser() {
    const { data: { user } } = await supabase.auth.getUser()
    setUser(user)
    if (user) {
      checkAdminStatus(user.id)
    }
  }

  async function checkAdminStatus(userId) {
    // Aquí puedes implementar una verificación más robusta si tienes una tabla de roles
    // Por ahora permitimos acceso admin si está logueado, ajusta según necesites
    setIsAdmin(true)
  }

  async function fetchCategories() {
    // 1. Pedimos todas las categorías
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('is_category', true)

    if (error) {
      console.error('Error fetching categories:', error)
    } else {
      // 2. Lógica de Ordenación Híbrida solicitada
      const sortedCategories = (data || []).sort((a, b) => {
        const titleA = (a.title || '').toLowerCase()
        const titleB = (b.title || '').toLowerCase()
        
        // Verificamos si son pistas
        const isPistaA = titleA.startsWith('pista')
        const isPistaB = titleB.startsWith('pista')

        // Caso 1: Ambas son pistas -> Ordenar por ID (número de pista)
        if (isPistaA && isPistaB) {
          return a.id - b.id
        }

        // Caso 2: Solo A es pista -> A va primero (arriba)
        if (isPistaA) return -1

        // Caso 3: Solo B es pista -> B va primero (arriba)
        if (isPistaB) return 1

        // Caso 4: Ninguna es pista -> Orden Alfabético normal
        return titleA.localeCompare(titleB)
      })

      setCategories(sortedCategories)
    }
  }

  async function handleLogin(e) {
    e.preventDefault()
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      setShowAdminLogin(false)
    } catch (error) {
      alert(error.message)
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    setIsAdmin(false)
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-foreground">Tarjetas de Vocabulario</h1>
          {user ? (
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground hidden md:inline">{user.email}</span>
              <Button variant="outline" onClick={handleLogout}>Cerrar Sesión</Button>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setShowAdminLogin(!showAdminLogin)}>
              {showAdminLogin ? 'Cancelar' : 'Admin'}
            </Button>
          )}
        </header>

        {showAdminLogin && !user && (
          <Card className="max-w-sm mx-auto">
            <CardContent className="pt-6">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input 
                    id="email" 
                    type="email" 
                    value={email} 
                    onChange={(e) => setEmail(e.target.value)} 
                    required 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Contraseña</Label>
                  <Input 
                    id="password" 
                    type="password" 
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                    required 
                  />
                </div>
                <Button type="submit" className="w-full">Entrar</Button>
              </form>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="study" className="w-full">
          {isAdmin && (
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="study">Estudiar</TabsTrigger>
              <TabsTrigger value="admin">Mantenimiento</TabsTrigger>
            </TabsList>
          )}

          <TabsContent value="study" className="space-y-6">
            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-card p-4 rounded-lg shadow-sm">
              <Label className="whitespace-nowrap">Selecciona una categoría:</Label>
              <Select onValueChange={(value) => setSelectedCategory(categories.find(c => c.id.toString() === value))}>
                <SelectTrigger className="w-full sm:w-[300px]">
                  <SelectValue placeholder="Elige un tema..." />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id.toString()}>
                      {category.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedCategory && (
              <FlashcardList categoryId={selectedCategory.id} categoryTitle={selectedCategory.title} />
            )}
            
            {!selectedCategory && (
              <div className="text-center py-12 text-muted-foreground">
                <p>Selecciona una categoría arriba para comenzar a estudiar</p>
              </div>
            )}
          </TabsContent>

          {isAdmin && (
            <TabsContent value="admin">
              <AdminPanel categories={categories} onCategoryUpdate={fetchCategories} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  )
}

export default App