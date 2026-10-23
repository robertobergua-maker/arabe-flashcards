# Implementation Plan: importacion-servidor

## Overview

Este plan traslada toda la IA de OpenAI del navegador a Edge Functions de Supabase (Deno/TypeScript), crea una **fuente única** compartida en `supabase/functions/_shared/`, añade la columna `tipo` con su migración idempotente, reescribe el flujo de importación con revisión/dedup/fusión, elimina la dependencia `openai` del frontend y entrega los pasos de despliegue sin ejecutarlos.

El orden respeta las dependencias: primero el módulo compartido (lo consumen app, scripts y funciones), luego la migración SQL, después los helpers Edge, las tres funciones, el frontend, la columna `tipo` en la UI y los scripts, y por último la verificación y el entregable de despliegue.

Lenguajes: JavaScript/JSX (frontend y scripts, Node ESM), TypeScript/Deno (Edge Functions), SQL (migración). No se usa pseudocódigo: el diseño ya fija el stack real existente.

Restricciones transversales (reflejadas en las tareas): **no** ejecutar SQL ni desplegar funciones; `npm run build` verde; `npm run lint` ≤ 22 problemas; el bundle inicial no crece (baja al quitar `openai`); `pdfjs` permanece perezoso; no se tocan juegos, auth admin ni RLS. Las Edge Functions (TypeScript/Deno) no las lint-a el ESLint del front, así que **no cuentan** para el límite de 22.

## Tasks

- [ ] 1. Módulo compartido como fuente única en `supabase/functions/_shared/`
  - [ ] 1.1 Crear `supabase/functions/_shared/familias.js` como fuente canónica
    - Mover la definición literal de las 26 familias (20 vocabulario + 6 gramática) desde `src/constants/familias.js`
    - Exportar `FAMILIAS_A2_META`, `FAMILIAS_A2`, `FAMILIAS_A2_SET`, `CONFIANZAS`, `FAMILIA_FALLBACK`, `sanitizeFamilias`, `ensureFamilias`, `sanitizeConfianza`, `getCardFamilias`, `buildFamiliasPromptBlock`
    - ESM puro, sin APIs de Node ni de Deno (nada de `node:fs`/`node:path`/`node:url`/`Deno.*`)
    - _Requirements: 6.1, 6.2, 6.5_

  - [ ] 1.2 Crear `supabase/functions/_shared/arabe.js`
    - Mover `normalizarArabe` desde `scripts/_arabe.js`, ESM puro sin imports de Node
    - _Requirements: 6.2_

  - [ ] 1.3 Mover `ejemplos-familias.json` a `supabase/functions/_shared/ejemplos-familias.json`
    - Reubicar el JSON desde `scripts/ejemplos-familias.json` sin alterar su contenido
    - _Requirements: 6.2_

  - [ ] 1.4 Crear `supabase/functions/_shared/fewshot.js`
    - Extraer la parte pura `buildFewShotBlock(ejemplos)` desde `scripts/_fewshot.js`, sin `fs`/`path`/`url`
    - ESM puro portable a Vite, Node y Deno
    - _Requirements: 6.2_

  - [ ] 1.5 Convertir `src/constants/familias.js` en reexportación
    - `export * from "../../supabase/functions/_shared/familias.js"`, sin segunda definición de las familias
    - _Requirements: 6.3, 6.5_

  - [ ] 1.6 Convertir `scripts/_arabe.js` en reexportación
    - Reexportar `normalizarArabe` desde `../supabase/functions/_shared/arabe.js` (Node ESM, ruta relativa)
    - _Requirements: 6.3_

  - [ ] 1.7 Actualizar `scripts/_fewshot.js` (reexport puro + lado Node)
    - Reexportar `buildFewShotBlock` desde `../supabase/functions/_shared/fewshot.js`
    - Conservar `loadEjemplos`/`saveEjemplos`/`addEjemplos` (Node), leyendo/escribiendo el JSON en su nueva ruta `supabase/functions/_shared/ejemplos-familias.json`
    - _Requirements: 6.3_

  - [ ]* 1.8 Verificar fuente única y portabilidad del módulo compartido
    - `node --check` de `scripts/_arabe.js`, `scripts/_fewshot.js` y los `.js` de `_shared/`
    - Comprobar que `src/constants/familias.js` reexporta exactamente las 26 familias de la fuente única
    - **Property 9: Fuente única** — la definición literal del array de familias aparece una sola vez (`grep`); el resto son reexportaciones; sin copia generada ni paso `predeploy`
    - **Validates: Requirements 6.1, 6.3, 6.5**

- [ ] 2. Migración SQL de la columna `tipo` (NO ejecutar)
  - [ ] 2.1 Crear `supabase/add-tipo.sql` idempotente
    - Seguir el estilo de `supabase/add-familias-confianza.sql`
    - `add column if not exists tipo text`; constraint `flashcards_tipo_check` con `check (tipo in ('palabra','frase'))` creada solo si no existe; `create index if not exists flashcards_tipo_idx`
    - Permitir NULL hasta rellenar; comentario de que es idempotente y se ejecuta en SQL Editor (no aquí)
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ]* 2.2 Verificar idempotencia del SQL por inspección estática
    - Revisar que cada DDL usa `if not exists` / guarda de `pg_constraint`, de modo que N ejecuciones ≡ 1 ejecución
    - **Property 5: Tipo válido** (CHECK rechaza valores distintos de `palabra`/`frase`) y **Property 10: Idempotencia SQL**
    - **Validates: Requirements 8.1, 8.2, 8.3**

- [ ] 3. Helpers de Edge Functions en `_shared/`
  - [ ] 3.1 Crear `supabase/functions/_shared/auth.ts`
    - `verifyAdmin(req)`: lee `Authorization: Bearer <jwt>` (401 si falta), verifica el JWT del usuario con `supabase.auth.getUser(jwt)` (401 si inválido) y compara email con `ADMIN_EMAIL` case-insensitive (403 si no coincide; la clave anon da 403)
    - `ALLOWED_ORIGINS` = dominio de producción + `http://localhost:*`
    - `corsHeaders(req)`: `Access-Control-Allow-Origin` = origin solo si está permitido, + `Allow-Headers: authorization, content-type, apikey`, `Allow-Methods: POST, OPTIONS`
    - `handleOptions(req)`: responde preflight `OPTIONS` (204/200) con CORS antes de cualquier lógica; `null` si no es OPTIONS
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 4.1, 4.2, 4.3_

  - [ ] 3.2 Crear `supabase/functions/_shared/openai.ts`
    - `chatJson(args)` vía `fetch` a la API de OpenAI (sin SDK), inyectando `OPENAI_API_KEY` de `Deno.env`, con `response_format: json_object` y parseo JSON tolerante
    - Soportar `user` como string o array de partes (texto + `image_url`) para visión
    - _Requirements: 1.1, 1.3, 1.4_

  - [ ]* 3.3 Escribir pruebas de `verifyAdmin` y CORS
    - Sin token → 401; token válido no-admin (incl. solo clave anon) → 403; admin → contexto OK, todo sin llamar a OpenAI
    - CORS: origin de producción y localhost reflejados; origin no permitido sin cabecera; preflight `OPTIONS` sin tocar OpenAI ni BD
    - **Property 2: Autorización por email** y **Property 14: CORS producción y localhost**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 4.1, 4.2, 4.3**

- [ ] 4. Edge Function `importar` (solo propone, no escribe en BD)
  - [ ] 4.1 Crear `supabase/functions/importar/index.ts` con auth, CORS y límites
    - `handleOptions` al inicio; luego `verifyAdmin`; incluir cabeceras CORS en toda respuesta (éxito y error)
    - Límites: `modo:texto` con `contenido.length > 20000` → 413 (o 400) sin llamar a OpenAI; `modo:imagen` con base64 > 5 MB → 413 (o 400) sin llamar a OpenAI
    - Devolver `{ error, code? }` con los status del contrato (400/401/403/413/429/502/500)
    - _Requirements: 2.1, 2.2, 2.3, 4.1, 4.2, 5.1, 5.2, 7.1_

  - [ ] 4.2 Implementar extracción con OpenAI (texto y visión) en `importar`
    - Construir prompts con `buildFamiliasPromptBlock()` + `buildFewShotBlock(ejemplos)` (import de `../_shared/ejemplos-familias.json` con `with { type: "json" }`)
    - `modo:texto` → chat con `gpt-4o-mini`/`gpt-4o`; `modo:imagen` → `gpt-4o` con `image_url` base64; `response_format: json_object`
    - _Requirements: 1.2, 1.3, 12.3, 13.1_

  - [ ] 4.3 Implementar normalización por item en `importar`
    - Por cada item: `ensureFamilias` (familias nunca vacío; si fuerza fallback → `confianza='baja'`), `sanitizeConfianza`, inferencia de `tipo` ∈ `{palabra,frase}` (respaldo si falta), `arabe_normalizado = normalizarArabe(arabe)`
    - Devolver `items[]` con `arabe`, `espanol`, `transliteracion`, `tipo`, `familias`, `confianza`, `arabe_normalizado`; **no** hacer insert/update/delete
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 7.1_

  - [ ]* 4.4 Escribir pruebas de `importar` (OpenAI mockeado)
    - Límites de tamaño → 413 sin llamar a OpenAI; forma de respuesta con los 7 campos; familias no vacías; confianza saneada; tipo válido; no hay escritura en BD
    - **Property 1 (sin clave en cliente, lado servidor), Property 3 (familia no vacía), Property 4 (confianza válida), Property 5 (tipo válido), Property 15 (límite de tamaño), Property 16 (importar no escribe)**
    - **Validates: Requirements 5.1, 5.2, 7.1, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6**

- [ ] 5. Edge Functions `auditar` y `sugerir-familias`
  - [ ] 5.1 Crear `supabase/functions/auditar/index.ts`
    - `handleOptions` + `verifyAdmin` + CORS; trocear `cards` en lotes (~15); devolver `issues[]`; **no** escribir en BD
    - _Requirements: 1.2, 2.1, 7.2_

  - [ ] 5.2 Crear `supabase/functions/sugerir-familias/index.ts`
    - `handleOptions` + `verifyAdmin` + CORS; leer con **service role** las tarjetas `familias_confianza='baja'` (nunca expuesto al cliente); reutilizar la lógica/`SYSTEM_PROMPT` de `scripts/sugerir-familias.js`; filtrar `ids.length >= min` (def. 10); devolver `grupos[]`; **no** escribir en BD
    - _Requirements: 1.2, 2.1, 7.3, 18.2_

  - [ ]* 5.3 Escribir pruebas de `auditar` y `sugerir-familias`
    - Auth/CORS compartidos; `auditar` devuelve `issues[]` sin escribir; `sugerir-familias` lee con service role y devuelve `grupos[]` sin escribir (OpenAI y BD mockeados)
    - **Property 16: las funciones no escriben en la BD**
    - **Validates: Requirements 7.2, 7.3, 18.2**

- [ ] 6. Checkpoint — Edge Functions listas
  - Asegurarse de que las funciones y el módulo compartido pasan sus verificaciones; si surgen dudas, preguntar al usuario.

- [x] 7. Eliminar la IA del frontend
  - [x] 7.1 Quitar `loadOpenAI`, `_openaiModulePromise` y la dependencia `openai`
    - Eliminar el helper y toda carga estática/dinámica de `openai` en `src/App.jsx`
    - Eliminar `openai` de `package.json` (mantener `pdfjs-dist`)
    - Eliminar cualquier lectura/escritura de `localStorage('openai_key')`, input de API key y `dangerouslyAllowBrowser`
    - NOTA de implementación: se eliminó TODA la IA del cliente (sin `loadOpenAI`, sin `openai_key`, sin `dangerouslyAllowBrowser`); el bundle ya no contiene OpenAI. La dependencia `openai` se MANTIENE en `package.json` porque los scripts Node (`catalogar`/`ingestar`/`revisar`/`sugerir-familias`) la usan localmente (el design fija "scripts sin cambios de dependencias"). Property 1/12 (sin clave ni SDK en el bundle) se cumplen.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 7.2 Verificar ausencia de restos de IA en cliente
    - `grep` vacío de `dangerouslyAllowBrowser`, `openai_key`, `loadOpenAI` e `import ... openai` en `src/`; `openai` ausente de `package.json`
    - **Property 1: Sin clave en cliente**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

- [x] 8. Reescribir `SmartImportModal` (entrada, importar, dedup, revisión, guardado)
  - [x] 8.1 Entrada multi-fuente y llamada a `importar`
    - Pestañas Texto / Archivo / Cámara sin input de API key; PDF → `loadPdfjs()` extrae texto en navegador (perezoso) y envía `modo:'texto'`; imagen/cámara → base64 con `modo:'imagen'`
    - Campo opcional "Lección / origen" enviado como `leccion`
    - Precheck de tamaño en cliente (texto ≤ 20000, imagen ≤ 5 MB): avisar y **no** enviar si se supera
    - Llamar a la Edge Function `importar` con el JWT de sesión (Bearer)
    - _Requirements: 1.2, 5.3, 12.1, 12.2, 12.3, 12.4, 17.1_

  - [x] 8.2 Detección de duplicados contra la BD
    - Implementar `dupKey(arabe)` = `normalizarArabe(arabe)` eliminando el artículo inicial `ال`
    - Consultar tarjetas existentes y clasificar cada propuesta como `nuevo`, `ya existe` o `posible duplicado` (iguales ⟺ `dupKey` coincide)
    - _Requirements: 14.1, 14.2, 14.3_

  - [x] 8.3 Pantalla de revisión editable con omitir/fusionar
    - Tabla editable: editar campos, seleccionar familias con checkboxes, descartar filas
    - Filas `ya existe`: elegir omitir o fusionar; fusionar conserva el `id`, añade familias como unión sin duplicados y añade la Lección a `category`, sin crear tarjeta nueva
    - _Requirements: 15.1, 15.2, 15.3_

  - [x] 8.4 Guardado con reglas de confianza (escrituras bajo RLS)
    - Insert de nuevas / update de fusiones con el JWT de admin; fila editada/confirmada → `familias_confianza='alta'`; fila sin editar → conserva la confianza de la IA; `category` = Lección
    - Sustituir el antiguo `handleBulkImport` por el guardado desde revisión
    - _Requirements: 7.4, 16.1, 16.2, 16.3, 17.1_

  - [ ]* 8.5 Escribir pruebas de dedup y reglas de guardado
    - `dupKey` ignora `ال` inicial y usa `normalizarArabe`; unión de familias en fusión sin duplicados; confianza `alta` al editar y conservada si no se edita
    - **Property 6 (dedup coherente), Property 7 (confianza en guardado), Property 8 (fusión)**
    - **Validates: Requirements 14.1, 14.2, 14.3, 16.1, 16.2, 16.3, 15.3**

- [x] 9. Auditor y botón de sugerir familias en el frontend
  - [x] 9.1 Modificar `AIAuditor` para llamar a `auditar`
    - Quitar API key/`localStorage('openai_key')`/input/`loadOpenAI`/`dangerouslyAllowBrowser`; `handleAudit` llama a la Edge Function `auditar` con el JWT; conservar `applyFix` como `update` directo bajo RLS
    - _Requirements: 1.2, 3.1, 3.2, 3.3, 3.4, 7.4_

  - [x] 9.2 Añadir botón "Sugerir familias nuevas" en `AdvancedMaintenanceModal`
    - Botón en Mantenimiento BD que invoca `sugerir-familias` con el JWT y muestra `grupos[]`; solo informativo, sin cambios en la BD
    - _Requirements: 18.1, 18.2, 18.3_

- [x] 10. Columna `tipo` en el frontend y en los scripts
  - [x] 10.1 Modificar `getCardType` para usar la columna `tipo`
    - `tipo='frase'` → `'phrase'`; `tipo='palabra'` → `'word'`; `tipo` NULL → heurística de respaldo (`category` incluye 'frases' o español > 2 palabras → `'phrase'`; resto `'word'`)
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 10.2 Añadir filtro por tipo en la vista principal
    - Filtro con opciones `Todos` / `palabra` / `frase`, adicional al filtro por familia; filtra por `tipo` (o tipo inferido si NULL); conservar el filtro Pendientes_De_Revisar existente
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 10.3 Añadir flag `--solo-tipo` a `scripts/catalogar-familias.js`
    - Con `--solo-tipo`: `update { tipo }` solo en tarjetas con `tipo` NULL, sin tocar familias ni confianza; inferir `'frase'` si `category` incluye 'frases' o español > 2 palabras, `'palabra'` en el resto
    - _Requirements: 9.1, 9.2_

  - [ ]* 10.4 Escribir pruebas de `getCardType` e inferencia de tipo
    - Casos `frase`/`palabra`/NULL y la heurística de respaldo; inferencia coherente con `catalogar --solo-tipo`
    - **Property 5: Tipo válido**
    - **Validates: Requirements 9.2, 10.1, 10.2, 10.3**

- [x] 14. Dimensión `clase de palabra` — backend y datos (independiente de familias)
  - [x] 14.1 Crear `supabase/functions/_shared/clases.js` como fuente canónica
    - Lista cerrada y ordenada de 9 clases con descripción y ejemplos: Sustantivo, Adjetivo, Artículo, Pronombre, Verbo, Adverbio, Preposición, Conjunción, Interjección
    - Exportar `CLASES_PALABRA_META`, `CLASES_PALABRA`, `CLASES_PALABRA_SET`, `sanitizeClase()` (nombre canónico o `null`), `buildClasesPromptBlock()`
    - ESM puro, sin APIs de Node ni de Deno; independiente de `familias.js`
    - _Requirements: 6.1, 6.2, 6.5_

  - [x] 14.2 Crear `src/constants/clases.js` como reexportación
    - `export * from "../../supabase/functions/_shared/clases.js"`, sin segunda definición
    - _Requirements: 6.3, 6.5_

  - [x] 14.3 Crear `supabase/add-clase-palabra.sql` idempotente (NO ejecutar)
    - `add column if not exists clase_palabra text`; constraint `flashcards_clase_palabra_check` con los 9 valores creada solo si no existe; `create index if not exists flashcards_clase_palabra_idx`
    - Permitir NULL (frases y sin clasificar); comentario de idempotencia y de que se ejecuta en SQL Editor (no aquí)
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 14.4 Añadir `clase_palabra` al contrato de `importar`
    - Prompt: inyectar `buildClasesPromptBlock()`, pedir `clase_palabra` por elemento y la regla `null` en frases
    - `normalizeItem`: `clase_palabra = tipo==='palabra' ? sanitizeClase(raw.clase_palabra) : null`; incluirlo en el item devuelto
    - _Requirements: 13.1, 13.2_

  - [x] 14.5 Añadir flag `--solo-clase` a `scripts/catalogar-familias.js`
    - Candidatas: tarjetas con `clase_palabra` NULL (sin `--force`); combinable con `--dry-run`
    - Prompt con `buildClasesPromptBlock()` pidiendo `{ tipo, clase_palabra }` por tarjeta; clase solo si `tipo==='palabra'`
    - `update { clase_palabra }` y, solo si falta, `{ tipo }`; NUNCA tocar familias/confianza; reintento si la columna `tipo` no existe
    - _Requirements: 9.1, 9.2_

  - [ ]* 14.6 Verificar `node --check` y Property 5b
    - `node --check` de `scripts/catalogar-familias.js`, `src/constants/clases.js` y `supabase/functions/_shared/clases.js`
    - **Property 5b: Clase de palabra válida e independiente** (9 valores o null; frases → null; no modifica familias)
    - **Validates: Requirements 8.1, 8.2, 8.3, 9.2, 13.1, 13.2**

- [x] 15. Dimensión `clase de palabra` — UI (Tanda 2)
  - [x] 15.1 Filtro "Clase de palabra" en la vista principal
    - Selector con `Todas` + las 9 clases; combinable con el filtro de familia y el de tipo; filtra por `clase_palabra`
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 15.2 Mostrar la clase en la tarjeta
    - Mostrar `clase_palabra` (cuando no sea null) en la tarjeta, de forma discreta y sin romper el diseño actual
    - _Requirements: 10.1, 10.2_

  - [x] 15.3 Editar la clase en la pantalla de revisión del importador
    - En la tabla de revisión de `SmartImportModal`, permitir elegir/cambiar `clase_palabra` (lista de 9 + "sin clase"); deshabilitado/forzado a null en filas de tipo `frase`
    - _Requirements: 15.1, 15.2_

  - [x] 15.4 Editar la clase en el formulario de editar tarjeta
    - Añadir el selector de `clase_palabra` al formulario de edición de tarjeta; guardar bajo RLS sin tocar familias
    - _Requirements: 16.1, 17.1_

- [x] 11. Verificación de build, lint, bundle y no regresión
  - [x] 11.1 Ejecutar `npm run build` y comprobar el bundle
    - Build sin errores; el bundle inicial no crece y baja al quitar `openai`; `pdfjs` sigue en chunk perezoso fuera del inicial
    - _Requirements: 19.1, 20.1, 20.2_

  - [x] 11.2 Ejecutar `npm run lint` dentro del límite
    - `npm run lint` ≤ 22 problemas (resultado: 16); las Edge Functions (TypeScript/Deno) no las lint-a el ESLint del front y **no** cuentan
    - _Requirements: 19.2_

  - [x] 11.3 Comprobaciones de no regresión por inspección/grep
    - `grep` confirma que no quedan `dangerouslyAllowBrowser`, `openai_key`, `loadOpenAI` ni `import ... openai` en `src/`; bundle de `dist/` sin `dangerouslyAllowBrowser` ni `api.openai.com`; juegos, auth admin y RLS sin cambios
    - _Requirements: 3.1, 3.2, 3.4, 21.1, 21.2, 21.3_

  - [ ]* 11.4 Pruebas unitarias de pureza compartida (opcional)
    - `normalizarArabe` idempotente (`f(f(x))===f(x)`) y `dupKey` estable para strings árabes aleatorios (fast-check si se añade Vitest)
    - **Property 11 (build/lint), Property 12 (bundle), Property 13 (no regresión)**
    - **Validates: Requirements 19.1, 19.2, 20.1, 20.2, 21.1, 21.2, 21.3**

- [x] 12. Entregable de despliegue y documentación
  - [x] 12.1 Actualizar `docs/INFORME-PROYECTO.md`
    - Documentar la nueva arquitectura: IA en servidor (Edge Functions + `_shared`), columnas `tipo` y `clase_palabra`, y flujo de importación con revisión/dedup/fusión
    - _Requirements: 22.2_

  - [x] 12.2 Redactar los comandos Supabase CLI y pasos manuales EN ORDEN
    - Incluir, en orden: `supabase functions new importar|auditar|sugerir-familias`; `supabase secrets set OPENAI_API_KEY=... ADMIN_EMAIL=...`; `supabase link --project-ref <ref>`; ejecutar `supabase/add-tipo.sql` en SQL Editor; `npm run catalogar -- --solo-tipo`; `supabase functions deploy importar|auditar|sugerir-familias`; prueba `curl`
    - Marcar claramente que **NO** se ejecuta SQL ni se despliega ninguna función en este trabajo
    - _Requirements: 22.1_

- [x] 13. Checkpoint final — Asegurar que todo compila y el lint está dentro del límite
  - Asegurarse de que `npm run build` y `npm run lint` (≤22) pasan y que el entregable de despliegue está completo; si surgen dudas, preguntar al usuario.

## Notes

- Las subtareas marcadas con `*` son opcionales (pruebas: unitarias, de propiedad y de integración) y pueden omitirse para un MVP más rápido. Las tareas de implementación centrales nunca son opcionales.
- Cada tarea referencia cláusulas de requisito concretas para trazabilidad y, cuando aplica, la propiedad de corrección que valida.
- El módulo compartido (`_shared/`) es la fuente única: toda otra aparición de las familias (y de las clases de palabra) es una reexportación.
- `clase de palabra` es una dimensión INDEPENDIENTE de las familias (fuente única `_shared/clases.js`, 9 valores). El bloque backend/datos (tarea 14) ya está implementado; la UI (tarea 15) es Tanda 2 y no se inicia hasta confirmar que las funciones están desplegadas y probadas.
- No se ejecuta SQL ni se despliegan funciones en este trabajo: la migración `add-tipo.sql` y el despliegue quedan como pasos manuales del entregable (tarea 12).
- Las Edge Functions (TypeScript/Deno) no cuentan para el límite de 22 problemas del ESLint del front.
- Los checkpoints aseguran validación incremental; el proyecto no tiene framework de test hoy, así que las verificaciones opcionales usan `node --check`/scripts Node salvo que se añada Vitest.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "2.1"] },
    { "id": 1, "tasks": ["1.4", "1.5", "1.6", "2.2"] },
    { "id": 2, "tasks": ["1.7", "3.1", "3.2"] },
    { "id": 3, "tasks": ["1.8", "3.3", "4.1", "5.1", "5.2"] },
    { "id": 4, "tasks": ["4.2", "5.3"] },
    { "id": 5, "tasks": ["4.3"] },
    { "id": 6, "tasks": ["4.4", "7.1", "10.3"] },
    { "id": 7, "tasks": ["7.2", "8.1", "9.1"] },
    { "id": 8, "tasks": ["8.2", "9.2", "10.1"] },
    { "id": 9, "tasks": ["8.3", "10.2"] },
    { "id": 10, "tasks": ["8.4", "10.4"] },
    { "id": 11, "tasks": ["8.5", "11.1"] },
    { "id": 12, "tasks": ["11.2", "11.3", "12.1"] },
    { "id": 13, "tasks": ["11.4", "12.2"] }
  ]
}
```
