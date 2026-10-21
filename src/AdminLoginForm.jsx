import { useState } from 'react'
import { X, Lock, Loader } from 'lucide-react'

// Formulario mínimo de acceso admin: UN solo campo de contraseña.
// Sin email, sin registro, sin recuperación, sin gestión de cuentas.
export default function AdminLoginForm({ onSubmit, loading, error, onClose }) {
  const [password, setPassword] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!password || loading) return
    onSubmit(password)
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="bg-slate-800 p-4 text-white flex justify-between items-center">
          <h2 className="font-bold flex items-center gap-2">
            <Lock className="w-5 h-5" /> Modo administrador
          </h2>
          <button type="button" onClick={onClose} aria-label="Cerrar">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label htmlFor="admin-password" className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Contraseña
            </label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              disabled={loading}
              aria-label="Contraseña de administrador"
              className="w-full p-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-600 font-medium">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-emerald-600 text-white py-2.5 rounded-lg font-bold hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <Loader className="w-5 h-5 animate-spin" /> : 'Entrar'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2.5 rounded-lg font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
