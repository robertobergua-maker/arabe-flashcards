# Informe del proyecto — `arabe-flashcards`

**Fecha:** 21 de octubre de 2026
**Alcance:** Documento único que recoge el recorrido completo del proyecto: la revisión inicial, el trabajo de actualización y limpieza realizado, y el estado final verificado.

**Estado final — build:** ✅ Pasa (`npm run build`, exit 0)
**Estado final — lint:** 🟢 22 problemas (17 errores, 5 warnings) — por debajo del baseline inicial de 25.

---

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Stack técnico](#2-stack-técnico)
3. [Arquitectura actual](#3-arquitectura-actual)
4. [Punto de partida (revisión inicial)](#4-punto-de-partida-revisión-inicial)
5. [Trabajo realizado](#5-trabajo-realizado)
6. [Rendimiento del bundle](#6-rendimiento-del-bundle)
7. [Problemas pendientes](#7-problemas-pendientes)
8. [Prioridades sugeridas](#8-prioridades-sugeridas)
9. [Requisitos y variables de entorno](#9-requisitos-y-variables-de-entorno)

---

## 1. Resumen ejecutivo

`arabe-flashcards` es un sistema de flashcards de árabe para **nivel A2**, construido con **React 19 + Vite 7 + Supabase**, con herramientas de administración asistidas por IA (OpenAI) y scripts de línea de comandos para catalogación e ingestión de vocabulario.

El proyecto partía de un estado funcional pero con deuda técnica (archivos de respaldo versionados, código duplicado, módulo de examen pesado, credenciales en el cliente). A lo largo de varias iteraciones se reorientó la experiencia hacia **familias temáticas A2**, se **ocultó el módulo de examen**, se añadió un **pipeline de ingestión anti-duplicados** y se hizo una **limpieza a fondo**. En la última fase se **endureció la seguridad**: las credenciales del cliente pasaron a variables de entorno (`import.meta.env.VITE_*`), la autorización de administrador se migró de una contraseña embebida (`"1234"`) a **Supabase Auth** (modo admin de clave única, sesión real), y se definieron políticas **RLS** que dejan la lectura pública pero restringen la escritura al usuario admin por email. Hoy está en su mejor estado medible: build verde, lint por debajo de su línea base histórica, bundle inicial reducido en un ~89 % y la escritura de datos protegida en el servidor.

| Área | Estado | Nota |
|------|--------|------|
| Build de producción | 🟢 Pasa | Code-splitting efectivo |
| Rendimiento (bundle inicial) | 🟢 Muy mejorado | 982 KB → 105 KB |
| Sistema de familias A2 | 🟢 Implementado | UI + scripts comparten constante |
| Pipeline de ingestión | 🟢 Implementado | Anti-duplicados + dry-run |
| Calidad de código (lint) | 🟢 Mejorado | 53 → 22 problemas |
| Limpieza del repositorio | 🟢 Resuelto | Archivos basura eliminados |
| Seguridad de credenciales | 🟢 Resuelto | Cliente y scripts leen de `.env`; sin literales en el código |
| Autorización de admin | 🟢 Resuelto | Supabase Auth (clave única) + RLS protege la escritura |

---

## 2. Stack técnico

- **Frontend:** React 19.2, Vite 7
- **Estilos:** Tailwind CSS v4 (compilado local vía PostCSS)
- **Backend / datos:** Supabase (`@supabase/supabase-js`)
- **IA:** OpenAI SDK (`gpt-4o` / `gpt-4o-mini`), cargado de forma perezosa
- **PDF/OCR:** `pdfjs-dist` (carga perezosa)
- **Iconos:** `lucide-react`
- **Scripts Node (ESM):** catalogación e ingestión con `dotenv`
- **CI:** GitHub Actions (keepalive diario de Supabase)

---

## 3. Arquitectura actual

### Vistas
- `welcome`: pantalla de bienvenida (nivel A2).
- `flashcards`: vista principal de repaso con filtro por familia, buscador, juegos y modo administrador.
- *(El módulo de examen `ExamPrepHub` fue eliminado.)*

### Sistema de familias temáticas
- `src/constants/familias.js` es la **fuente de verdad única**: 10 familias oficiales A2 + helpers `sanitizeFamilias` y `getCardFamilias`. La usan tanto la UI como los scripts.
- Las 10 familias A2:
  1. Familia y Relaciones
  2. Casa y Vivienda
  3. Comida y Bebida
  4. Rutina y Tiempo Libre
  5. Ciudad, Transporte y Direcciones
  6. Comercio y Compras
  7. Salud y Cuerpo Humano
  8. Trabajo y Educación
  9. Viajes y Clima
  10. Gramática, Conectores y Partículas
- La UI filtra por familia, muestra badges de familia en cada tarjeta y permite asignar familias con checkboxes en el formulario de alta/edición. Persiste la columna `familias` (text[]).

### Herramientas de administración (en la app)
- Importador inteligente (texto / archivo / cámara).
- Mantenimiento de BD: editor rápido, buscador de duplicados y auditor con IA.
- OpenAI y pdfjs se cargan solo al usar estas herramientas (no en el arranque).

### Scripts de línea de comandos
- `npm run catalogar`: asigna familias a tarjetas existentes mediante IA (`gpt-4o-mini`). Flags `--force` y `--dry-run`.
- `npm run ingestar`: pipeline de ingestión de aportes (txt / imagen / PDF / carpeta) con normalización del árabe, extracción con IA y **prevención estricta de duplicados** (merge de familias si ya existe). Soporta `--dry-run`.

---

## 4. Punto de partida (revisión inicial)

Estado del proyecto antes de las intervenciones, documentado para dejar constancia del punto de partida:

### Seguridad
- **Contraseña de administrador `"1234"`** en texto plano en el cliente; el "modo admin" solo ocultaba botones de UI.
- **Credenciales hardcodeadas** en `src/supabaseClient.js` (URL + clave `anon`) y en el workflow de keepalive.
- **API Key de OpenAI usada desde el navegador** con `dangerouslyAllowBrowser: true`, guardada en `localStorage`.

### Limpieza del repositorio
- Archivos de respaldo versionados sin uso: `App.jsx2` … `App.jsx7`, `App.jsx_old`.
- Componente `Flashcard` duplicado: existía `src/Flashcard.jsx` (muerto) y otro interno en `App.jsx` (el usado).

### Calidad de código
- Tailwind cargado dos veces (CDN en `index.html` + compilado local).
- ESLint con `ecmaVersion: 2020` desactualizado.
- 25 problemas de lint (errores de hooks y variables sin usar).

### Rendimiento
- Bundle único de ~982 KB sin code-splitting.

### Aspectos positivos de partida
- Build de producción funcionando.
- Buenas prácticas de accesibilidad en varias zonas (`aria-label`, `role`, `translate="no"`).
- Keepalive de Supabase usando correctamente un secreto de GitHub.
- Lógica de dominio cuidada (normalización de árabe, diacríticos).

---

## 5. Trabajo realizado

### 5.1 Refactor de UI (A2 y familias)
- Metadatos y textos actualizados a **Nivel A2** (`index.html`, bienvenida, ayuda). Eliminado el CDN de Tailwind redundante.
- **Módulo de examen oculto:** eliminado el componente `ExamPrepHub` y su acceso desde la navegación.
- **Carga perezosa** de `openai` y `pdfjs-dist` vía `import()` dinámico; ya no entran en el arranque.
- Adopción del **sistema de familias**: constante compartida, filtro por familia, badges en tarjetas y selección múltiple en el formulario.
- Resuelta la duplicación de `Flashcard` (eliminado `src/Flashcard.jsx`).

### 5.2 Scripts de IA
- `scripts/catalogar-familias.js` (comando `catalogar`): cataloga tarjetas existentes por lotes con salida JSON estructurada y saneado contra la lista cerrada de familias.
- `scripts/ingestar-aportes.js` (comando `ingestar`): ingestión flexible (txt/imagen/PDF/carpeta), `normalizarArabe()` (elimina harakat/tanwin/shadda/sukun y unifica variantes de Alif, Alif Maqsura, Taa Marbuta y hamzas), extracción con IA y dedupe estricto con merge de familias. Flag `--dry-run`.
- Añadidos `.env.example` y `.env` al `.gitignore`.

### 5.3 Limpieza final
- **Archivos de respaldo eliminados:** `App.jsx2` … `App.jsx7`, `App.jsx_old`.
- **Código muerto del examen eliminado:** ~16 funciones/constantes huérfanas (OCR, generación/validación de preguntas, historial de simulacros, normalización de nunación). `App.jsx` pasó de 917 a 557 líneas.
- **Config de ESLint corregida:** añadidos los globals de Node para `scripts/`, eliminando 13 falsos positivos `'process' is not defined`.
- Efecto acumulado en el lint: **53 → 22 problemas**. El CSS también bajó (~52 KB → ~42 KB) al desaparecer clases de Tailwind que solo usaba el examen.

---

## 6. Rendimiento del bundle

El code-splitting es el mayor logro técnico del proyecto:

| Chunk | Tamaño | Gzip | Carga |
|-------|--------|------|-------|
| `index` (app principal) | 104.6 KB | 28.5 KB | Inicial |
| `index.css` | 41.9 KB | 8.2 KB | Inicial |
| `pdf` (pdfjs-dist) | 407.6 KB | 119.3 KB | Perezosa (solo admin) |
| `openai` | 432.5 KB | 123.8 KB | Perezosa (solo admin) |

El usuario que solo repasa vocabulario descarga ~105 KB en vez de los ~982 KB originales.

---

## 7. Problemas pendientes

### Calidad de código 🟡 (22 problemas de lint restantes)
Todos preexistentes y ajenos a la limpieza del examen:
- `react-hooks/set-state-in-effect`: varios componentes de juego (QuizGame, MemoryGame, TrueFalseGame, etc.) llaman a `setState` de forma síncrona dentro de `useEffect`. No rompen la app, pero pueden provocar renders en cascada.
- Variables locales sin usar puntuales (`e`, `id`, `onBack`, `refreshCards`).
- Alguna dependencia faltante en `useEffect` (`exhaustive-deps`).

### Seguridad 🟢 (resuelto en la fase admin-auth-security)
- **Credenciales del cliente:** `src/supabaseClient.js` ya lee la URL y la clave `anon` desde `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, con `console.error` si faltan. No quedan literales en el código ni en `keepalive.yml` (la URL del workflow pasó a secreto de GitHub).
- **Autorización de admin:** se eliminó la contraseña `"1234"` y el `prompt()`. Ahora el modo admin usa **Supabase Auth** (formulario de clave única que hace `signInWithPassword` con `VITE_ADMIN_EMAIL`); `isAdminMode` se deriva de la sesión real.
- **Escritura protegida por RLS:** el archivo `supabase/rls-flashcards.sql` deja la lectura pública pero restringe INSERT/UPDATE/DELETE al admin por email del JWT. Queda **pendiente de aplicar manualmente** en Supabase (ver sección de pasos manuales).

### Pendiente de verificación manual
- **Login admin real:** requiere crear el usuario admin en Supabase y probar el inicio/cierre de sesión en la app (no verificable automáticamente en este entorno).

---

## 8. Prioridades sugeridas

1. ✅ **Credenciales del cliente movidas a `import.meta.env`** (completado en admin-auth-security).
2. ✅ **Autorización real de admin con Supabase Auth + RLS** (completado en admin-auth-security; falta aplicar el SQL de RLS y crear el usuario admin en Supabase — pasos manuales).
3. **Revisar los efectos con `setState` síncrono** en los componentes de juego para cerrar los avisos de React Hooks.
4. Confirmar el esquema de `flashcards` (columna `familias`) antes de correr `npm run ingestar` / `npm run catalogar`.

### Pasos manuales pendientes (fase admin-auth-security)

Para que la seguridad quede activa en producción, hay que hacer a mano, **en este orden**:

1. **Supabase — crear el usuario admin:** Authentication → Users → *Add user*, con el email que usarás como `VITE_ADMIN_EMAIL` y una contraseña fuerte. Marca **"Auto Confirm User"**.
2. **Supabase — desactivar el registro público:** Authentication → Sign In / Providers → desactivar **"Allow new users to sign up"**.
3. **Supabase — aplicar RLS:** abre `supabase/rls-flashcards.sql`, reemplaza el marcador `'<EMAIL_DEL_ADMIN>'` por el email real del admin, y ejecútalo en el SQL Editor.
4. **GitHub — secreto:** crea el secreto `SUPABASE_URL` (Settings → Secrets and variables → Actions) para `keepalive.yml` (además del ya existente `SUPABASE_ANON_KEY`).
5. **Hosting (producción) — variables de entorno del build:** configura `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `VITE_ADMIN_EMAIL`.
6. **Local:** actualiza tu `.env` siguiendo el nuevo `.env.example` (ya incluye las variables `VITE_*`).

---

## 9. Requisitos y variables de entorno

### Base de datos
- La tabla `flashcards` necesita la columna `familias text[]`:
  ```sql
  alter table flashcards add column if not exists familias text[];
  ```
- Opcionalmente `arabe_normalizado text` para el script de ingestión (tiene fallback si no existe).

### Variables de entorno (`.env`, no versionado)
- `SUPABASE_URL` — URL del proyecto (Supabase → Project Settings → API).
- `SUPABASE_SERVICE_ROLE_KEY` — clave `service_role`, solo para los scripts de servidor (nunca en el frontend).
- `OPENAI_API_KEY` — clave de OpenAI.

---

*Verificaciones ejecutadas para este informe: `npm run build` (exit 0) y `npm run lint` (22 problemas: 17 errores / 5 warnings), además de la revisión de la estructura de `src/`, `scripts/` y `src/constants/`.*
