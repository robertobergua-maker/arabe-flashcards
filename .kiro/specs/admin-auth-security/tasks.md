# Implementation Plan: admin-auth-security

## Overview

Este plan convierte el diseño aprobado en pasos de codificación incrementales. El orden es deliberado:
primero se externalizan las credenciales (base de todo), luego se construyen el hook y el formulario de
auth, después se integran en `App.jsx` sustituyendo el secreto `"1234"`/`prompt()`, a continuación se genera
el script de RLS (sin ejecutar), y finalmente se verifica el presupuesto de calidad y se actualiza la
documentación. Cada tarea se apoya en las anteriores y termina cableada; no queda código huérfano.

Lenguaje de implementación: **JavaScript / React (JSX)** — el diseño ya usa este lenguaje de forma explícita.

Restricciones permanentes (Req 13): no tocar familias, juegos ni scripts salvo lo imprescindible; mantener
`openai` y `pdfjs-dist` en carga perezosa; `npm run build` pasa; `npm run lint` ≤ 22 problemas.

## Tasks

- [ ] 1. Externalizar credenciales del cliente Supabase
  - [ ] 1.1 Reescribir `src/supabaseClient.js` para leer credenciales del entorno
    - Leer `supabaseUrl` desde `import.meta.env.VITE_SUPABASE_URL` y `supabaseKey` desde `import.meta.env.VITE_SUPABASE_ANON_KEY`
    - Si falta alguna variable, emitir un único `console.error` descriptivo que identifique las variables (local `.env` / panel del hosting) sin lanzar excepción que rompa el render
    - Mantener el export singleton `export const supabase = createClient(supabaseUrl, supabaseKey)`; no cambiar la forma en que otros módulos lo importan
    - Eliminar cualquier URL o clave `anon` literal del archivo
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3_

  - [ ]* 1.2 Escribir property test de credenciales desde entorno
    - **Property 1: Sin credenciales en el código** — verificar por lectura/`grep` que `src/supabaseClient.js` no contiene la URL literal del proyecto ni la clave `anon` literal
    - **Property 2: Fallo ruidoso de env cliente** — simular `import.meta.env` sin `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` y aseverar al menos un `console.error` descriptivo, sin excepción que rompa el arranque
    - **Validates: Requirements 1.5, 2.1, 2.2, 2.3**

- [ ] 2. Reescribir `.env.example` con secciones separadas
  - [ ] 2.1 Estructurar `.env.example` en secciones CLIENTE y SCRIPTS
    - Sección CLIENTE (prefijo `VITE_`, expuesta al navegador): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ADMIN_EMAIL` con valores de marcador
    - Sección SCRIPTS (sin prefijo `VITE_`, solo servidor): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`
    - Incluir aviso explícito de que `service_role` se salta RLS y NUNCA debe llevar prefijo `VITE_`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.2_

  - [ ]* 2.2 Escribir property test de separación de prefijos
    - **Property 6: Separación de prefijos** — verificar que en `.env.example` ninguna variable de `service_role` lleva prefijo `VITE_` y que las secciones cliente/scripts están correctamente separadas
    - **Validates: Requirements 3.3, 4.2**

- [ ] 3. Eliminar credenciales en claro del workflow keepalive
  - [ ] 3.1 Modificar `.github/workflows/keepalive.yml` para usar secretos
    - Leer la URL del proyecto desde `secrets.SUPABASE_URL` (en lugar de literal) y mantener `secrets.SUPABASE_ANON_KEY`
    - Asegurar que no queda ninguna URL literal del proyecto ni clave `anon` literal en el archivo
    - No alterar la lógica del curl/keepalive más allá del origen de las variables
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ]* 3.2 Escribir property test de ausencia de credenciales en keepalive
    - **Property 1: Sin credenciales en el código** — `grep` sobre `keepalive.yml` confirmando ausencia de URL/clave `anon` literales y presencia de `secrets.SUPABASE_URL` / `secrets.SUPABASE_ANON_KEY`
    - **Validates: Requirements 5.3**

- [ ] 4. Implementar el hook `useAdminSession`
  - [ ] 4.1 Crear el hook de sesión admin
    - Al montar: `supabase.auth.getSession()` para resolver sesión existente y `supabase.auth.onAuthStateChange()` para suscribirse a cambios; cancelar la suscripción al desmontar (sin fugas)
    - Estado expuesto: `session`, `isAdminMode` (DERIVADO como `!!session`, nunca un setState manual), `loading`, `error`, `clearError`
    - `signIn(password)`: leer `VITE_ADMIN_EMAIL`; si falta, abortar con error visible en UI + `console.error`; en otro caso invocar `signInWithPassword({ email, password })`; ante error de credenciales exponer mensaje genérico "Contraseña incorrecta" sin revelar email vs password; alternar `loading`
    - `signOut()`: invocar `supabase.auth.signOut()` y alternar `loading`; la sesión pasa a null vía `onAuthStateChange`
    - Ubicar el hook en `src/useAdminSession.js` (o dentro de `App.jsx`), importando el `supabase` singleton
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.5, 8.6, 9.2, 9.3_

  - [ ]* 4.2 Escribir property test de modo admin derivado de sesión
    - **Property 3: Admin derivado de sesión** — `isAdminMode === true ⟺ existe sesión válida`; login válido activa `isAdminMode`, login inválido deja `error` y `session === null`, `signOut` lo desactiva, y la suscripción se cancela al desmontar
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.6, 9.3**

  - [ ]* 4.3 Escribir unit tests de `signIn`/`signOut`
    - Credenciales inválidas → mensaje genérico que no distingue email de password (Req 7.3); `VITE_ADMIN_EMAIL` ausente → aborta sin llamar a Supabase, error en UI + `console.error` (Req 7.4); `loading` activo durante login/logout (Req 7.5)
    - _Requirements: 7.3, 7.4, 7.5_

- [ ] 5. Implementar el componente `AdminLoginForm`
  - [ ] 5.1 Crear el formulario de login de un solo campo
    - Un único `input type="password"` con `autoFocus` y `aria-label`; sin campos de email, registro, recuperación ni gestión de cuentas
    - Props: `onSubmit(password)`, `loading`, `error`, `onClose`
    - En submit invocar `onSubmit(password)` exactamente una vez; mostrar `error` con `role="alert"` cuando no es null; deshabilitar controles y mostrar spinner (`Loader` de `lucide-react`) mientras `loading`
    - Botón "Cancelar" que llama a `onClose` sin iniciar sesión
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 5.2 Escribir property test de login de un solo campo
    - **Property 5: Login de un solo campo** — el DOM renderizado contiene exactamente un input de contraseña y cero campos de email/registro/recuperación
    - **Validates: Requirements 6.1, 6.2**

  - [ ]* 5.3 Escribir unit tests del formulario
    - Submit invoca `onSubmit` una vez con la contraseña (Req 6.3); `error` se muestra con `role="alert"` (Req 6.5); controles deshabilitados en `loading` (Req 6.4); "Cancelar" llama a `onClose` sin loguear (Req 6.6)
    - _Requirements: 6.3, 6.4, 6.5, 6.6_

- [ ] 6. Integrar auth en `App.jsx`
  - [ ] 6.1 Sustituir el secreto embebido por el hook y el formulario
    - Eliminar `const [isAdminMode, setIsAdminMode] = useState(false)` y el `handleAdminToggle` basado en `prompt()`/`"1234"`
    - Usar `useAdminSession()` como única fuente de verdad de `isAdminMode`; añadir estado local `isLoginOpen`
    - Nuevo `handleAdminToggle`: si `isAdminMode` → `signOut()`; si no → `clearError()` + abrir formulario (`setIsLoginOpen(true)`)
    - `useEffect` que cierra el formulario automáticamente cuando `isAdminMode` pasa a true
    - Renderizar `<AdminLoginForm>` (modal/overlay) cuando `isLoginOpen && !isAdminMode`, cableado a `signIn`, `loading`, `error` y `onClose={() => setIsLoginOpen(false)}`
    - Mantener sin cambios de forma el botón Lock/Unlock, el gating `{isAdminMode && (...)}` y el prop `isAdmin={isAdminMode}` de `Flashcard`; `isAdminMode` ahora proviene del hook
    - Eliminar toda ruta que active el modo admin sin sesión; asegurar ausencia de `"1234"` y `prompt(` en el archivo
    - _Requirements: 7.6, 8.4, 9.1_

  - [ ]* 6.2 Escribir property test de ausencia de secreto compartido
    - **Property 4: Sin secreto compartido en cliente** — `grep` sobre `src/` confirmando que `"1234"` y `prompt(` ya no aparecen tras la integración
    - **Validates: Requirements 7.6**

- [ ] 7. Checkpoint - Verificar auth integrada
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Generar el script de políticas RLS
  - [ ] 8.1 Crear `supabase/rls-flashcards.sql` (NO ejecutar)
    - `alter table public.flashcards enable row level security`
    - Política SELECT para roles `anon` y `authenticated` con `using (true)` (lectura pública)
    - Políticas INSERT/UPDATE/DELETE restringidas a `authenticated` con `auth.jwt() ->> 'email' = '<EMAIL_DEL_ADMIN>'` (en `with check` y/o `using` según la operación)
    - Incluir el marcador literal `'<EMAIL_DEL_ADMIN>'` y una nota indicando que debe reemplazarse por el email real, idéntico a `VITE_ADMIN_EMAIL`, y que `service_role` se salta RLS
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ]* 8.2 Escribir property test de estructura del script RLS
    - **Property 7: RLS correcto** — verificar que el SQL activa RLS, define SELECT para `anon`+`authenticated`, restringe INSERT/UPDATE/DELETE por coincidencia de email en el JWT, e incluye el marcador `'<EMAIL_DEL_ADMIN>'` (verificación estática del contenido del archivo; la comprobación de ejecución es manual en Supabase)
    - **Validates: Requirements 10.2, 10.3, 10.4, 10.5, 11.1, 11.2, 11.3, 11.4, 11.5**

- [ ] 9. Verificación del presupuesto de calidad y carga perezosa
  - [ ] 9.1 Verificar build, lint, carga perezosa y ausencia de literales
    - Ejecutar `npm run build` y confirmar compilación con éxito
    - Ejecutar `npm run lint` y confirmar ≤ 22 problemas
    - Inspeccionar el manifest/salida del build para confirmar que `openai` y `pdfjs-dist` siguen en chunks dinámicos (fuera del entry inicial)
    - `grep` final de que `"1234"`, `prompt(` y la URL/clave `anon` literales ya no existen en `src/` ni en `keepalive.yml`
    - Confirmar que `catalogar-familias.js` e `ingestar-aportes.js` quedan intactos (sin cambios de comportamiento) y que familias/juegos no se han tocado
    - _Requirements: 11.5, 12.1, 12.2, 13.1, 13.2, 13.3, 13.4, 13.5_

  - [ ]* 9.2 Escribir checks ejecutables de propiedades de calidad
    - **Property 8: Carga perezosa intacta** — `openai`/`pdfjs-dist` solo vía `import()` dinámico, fuera del entry (Req 13.3, 13.4)
    - **Property 9: Scripts intactos** — `catalogar`/`ingestar` sin cambios funcionales (Req 12.1, 12.2)
    - **Property 10: Presupuesto de calidad** — `npm run build` pasa; `npm run lint` ≤ 22 problemas (Req 13.1, 13.2)
    - **Validates: Requirements 12.1, 12.2, 13.1, 13.2, 13.3, 13.4**

- [ ] 10. Entregables documentales
  - [ ] 10.1 Actualizar `docs/INFORME-PROYECTO.md` y documentar pasos manuales
    - Sección 1 (Resumen ejecutivo): reflejar auth admin vía Supabase Auth y protección de escritura por RLS
    - Sección 7 (Problemas pendientes): retirar/actualizar "Credenciales en el cliente" y "Contraseña de admin `1234`" como resueltos
    - Sección 8 (Prioridades sugeridas): marcar prioridades 1 y 2 como completadas
    - Producir la lista de pasos manuales (como sección en el informe y/o archivo de entrega): Supabase → crear usuario admin con "Auto Confirm User", desactivar "Allow new users to sign up", ejecutar el SQL de RLS reemplazando el marcador; Hosting → configurar `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ADMIN_EMAIL`; GitHub → crear el secreto `SUPABASE_URL`; Local → actualizar `.env` siguiendo el nuevo `.env.example`
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [ ] 11. Checkpoint final - Verificar todo el conjunto
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Las tareas marcadas con `*` son opcionales (tests/property tests) y pueden omitirse para un MVP más rápido; las tareas sin `*` son obligatorias.
- Cada tarea referencia cláusulas de requisito granulares para trazabilidad.
- Las tareas de property test referencian explícitamente su propiedad del diseño (Property 1–10) y las cláusulas de requisito que validan.
- El script `supabase/rls-flashcards.sql` se genera pero NO se ejecuta; su ejecución es un paso manual en Supabase (Task 10.1 documenta el procedimiento).
- Los pasos manuales de Supabase/hosting/GitHub no son tareas de código: se entregan como documentación en la Task 10.1.
- No se añaden dependencias nuevas; se reutilizan `@supabase/supabase-js` y `lucide-react`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "4.1", "5.1", "8.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.2", "4.2", "4.3", "5.2", "5.3", "8.2", "6.1"] },
    { "id": 2, "tasks": ["6.2", "9.1"] },
    { "id": 3, "tasks": ["9.2", "10.1"] }
  ]
}
```
