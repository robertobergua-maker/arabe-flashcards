import { createClient } from '@supabase/supabase-js'

// Credenciales del cliente leídas del entorno (ver .env.example).
// Las variables VITE_* se inyectan en el bundle en build time.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl) {
  console.error(
    '[supabaseClient] Falta la variable de entorno VITE_SUPABASE_URL. ' +
    'Defínela en tu archivo .env (local) o en el panel de variables del hosting (producción).'
  )
}
if (!supabaseKey) {
  console.error(
    '[supabaseClient] Falta la variable de entorno VITE_SUPABASE_ANON_KEY. ' +
    'Defínela en tu archivo .env (local) o en el panel de variables del hosting (producción).'
  )
}

export const supabase = createClient(supabaseUrl, supabaseKey)
