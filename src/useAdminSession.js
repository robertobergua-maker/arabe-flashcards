import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

// Hook que encapsula la sesión de Supabase Auth y deriva el modo admin.
// isAdminMode es SIEMPRE un valor derivado de la existencia de sesión;
// no hay ningún setState manual que lo active sin una sesión real.
export function useAdminSession() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let mounted = true

    // 1. Resolver la sesión existente al montar.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (mounted) setSession(data?.session ?? null)
      })
      .catch((e) => {
        console.error('[useAdminSession] Error al resolver la sesión inicial:', e)
        if (mounted) setSession(null)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    // 2. Suscribirse a cambios de sesión (SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (mounted) setSession(newSession)
    })

    return () => {
      mounted = false
      sub?.subscription?.unsubscribe()
    }
  }, [])

  async function signIn(password) {
    setError(null)

    if (!password) {
      setError('Introduce la contraseña.')
      return
    }

    const email = import.meta.env.VITE_ADMIN_EMAIL
    if (!email) {
      console.error('[useAdminSession] Falta la variable de entorno VITE_ADMIN_EMAIL.')
      setError('Configuración incompleta: falta el email de administrador.')
      return
    }

    setLoading(true)
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) {
        // Mensaje genérico: no revela si falló el email o la contraseña.
        setError('Contraseña incorrecta.')
      }
      // Si tuvo éxito, onAuthStateChange actualizará `session`.
    } catch (e) {
      console.error('[useAdminSession] Error de red/servicio al iniciar sesión:', e)
      setError('No se pudo contactar con el servicio de autenticación.')
    } finally {
      setLoading(false)
    }
  }

  async function signOut() {
    setLoading(true)
    try {
      await supabase.auth.signOut()
    } catch (e) {
      console.error('[useAdminSession] Error al cerrar sesión:', e)
    } finally {
      // Garantiza salir del modo admin aunque el signOut remoto falle.
      setSession(null)
      setLoading(false)
    }
  }

  return {
    session,
    isAdminMode: !!session, // DERIVADO de la sesión, nunca manual.
    loading,
    error,
    signIn,
    signOut,
    clearError: () => setError(null),
  }
}
