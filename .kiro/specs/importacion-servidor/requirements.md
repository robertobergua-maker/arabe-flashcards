# Requirements Document

## Introduction

Esta feature traslada **todas** las llamadas a OpenAI del navegador al servidor (Supabase Edge Functions) y rediseña el flujo de importación de tarjetas del modo admin para que sea seguro, con revisión previa, detección de duplicados y clasificación por familias y por tipo.

El trabajo se organiza en cuatro bloques coordinados:

1. **IA en el servidor** — Edge Functions `importar`, `auditar` y `sugerir-familias`, protegidas por JWT + `ADMIN_EMAIL`, con un módulo compartido neutro que es la **fuente única** de familias/reglas/few-shot/normalización árabe.
2. **Tipo de tarjeta** — nueva columna `tipo` (`'palabra' | 'frase'`) con `CHECK`, migración SQL idempotente, relleno desde `catalogar-familias.js --solo-tipo`, sustitución de `getCardType()` y nuevo filtro en la vista principal.
3. **Flujo de importación en la app** — entrada por texto/PDF/imagen/cámara, extracción servidor (texto + visión), detección de duplicados contra la BD con normalización compartida (ignorando el artículo `ال`), pantalla de revisión editable con omitir/fusionar, y reglas de confianza al guardar.
4. **Sugerir familias en la app** — botón en "Mantenimiento BD" que invoca la función `sugerir-familias` y muestra las propuestas (solo informativo).

Los requisitos derivan del documento de diseño aprobado y respetan el código real existente. **No se tocan juegos, auth admin ni RLS.**

## Glossary

- **App_Admin**: modo administrador de la aplicación React (`src/App.jsx`), autenticado por email.
- **Edge_Function**: función de servidor de Supabase (Deno/TypeScript) desplegada en `supabase/functions/<nombre>`. Las tres funciones de esta feature son `importar`, `auditar` y `sugerir-familias`.
- **Funcion_Importar**: Edge Function `importar`, que procesa texto o imagen y devuelve propuestas de tarjetas.
- **Funcion_Auditar**: Edge Function `auditar`, que revisa tarjetas existentes y devuelve incidencias.
- **Funcion_Sugerir**: Edge Function `sugerir-familias`, que propone agrupaciones de familias nuevas.
- **_shared**: carpeta `supabase/functions/_shared/` con el código común entre funciones; el prefijo `_` evita que el CLI la despliegue como función. Contiene la fuente canónica de familias/árabe/few-shot y los helpers de Edge (`auth.ts`, `openai.ts`).
- **Fuente_Unica**: archivo `supabase/functions/_shared/familias.js`, única definición editable de la lista de 26 familias; el resto son reexportaciones.
- **OPENAI_API_KEY**: secreto de Supabase con la clave de la API de OpenAI; nunca presente en el cliente ni en el repo.
- **ADMIN_EMAIL**: secreto de Supabase con el email del administrador autorizado.
- **verifyAdmin**: función de `_shared/auth.ts` que verifica, dentro de cada Edge Function, el JWT del usuario con `supabase.auth.getUser(jwt)` y compara el email con `ADMIN_EMAIL`.
- **verify_jwt**: opción de Supabase que solo comprueba que un token es un JWT válido del proyecto; NO basta como autorización porque la clave anon también es un JWT válido.
- **Clave_Anon**: clave anónima del proyecto Supabase, que es un JWT válido y superaría `verify_jwt` sin pertenecer al admin.
- **normalizarArabe**: función pura compartida (`_shared/arabe.js`) que normaliza texto árabe para comparación.
- **dupKey**: clave de deduplicación = `normalizarArabe(arabe)` tras eliminar el artículo inicial `ال`.
- **ensureFamilias**: función que garantiza al menos una familia por item (usa `FAMILIA_FALLBACK` si hace falta).
- **sanitizeConfianza**: función que normaliza la confianza a `'alta' | 'media' | 'baja'`.
- **getCardFamilias**: función que devuelve las familias de una tarjeta.
- **getCardType**: función del frontend que devuelve el tipo de una tarjeta (`'word' | 'phrase'`).
- **Columna_Tipo**: columna `tipo` de `public.flashcards`, valores `'palabra' | 'frase'` con `CHECK`, admite NULL hasta rellenar.
- **Confianza**: campo `familias_confianza` de una tarjeta, valores `'alta' | 'media' | 'baja'`.
- **Leccion**: texto opcional de origen que se guarda en la columna `category`.
- **CORS**: control de orígenes de las Edge Functions; `ALLOWED_ORIGINS` = dominio de producción + localhost.
- **Pantalla_Revision**: tabla editable de la App_Admin donde el administrador revisa las propuestas antes de guardar.
- **Pendientes_De_Revisar**: filtro existente de la App_Admin que muestra tarjetas con `familias_confianza='baja'`.

## Requirements

### Requirement 1: IA en el servidor mediante Edge Functions

**User Story:** Como administrador, quiero que todas las llamadas a OpenAI se hagan en Edge Functions del servidor, para que la clave de API nunca viva en el navegador.

#### Acceptance Criteria

1. THE _shared SHALL leer OPENAI_API_KEY desde los secretos de Supabase para todas las llamadas a OpenAI.
2. WHEN la App_Admin necesita procesar una importación, una auditoría o una sugerencia de familias, THE App_Admin SHALL invocar la Edge_Function correspondiente (`importar`, `auditar` o `sugerir-familias`) en lugar de llamar a OpenAI directamente.
3. THE Edge_Function SHALL realizar todas las llamadas a OpenAI usando OPENAI_API_KEY leída de los secretos de Supabase.
4. THE OPENAI_API_KEY SHALL permanecer exclusivamente como secreto de Supabase y SHALL estar ausente del cliente y del repositorio.

### Requirement 2: Autorización por email dentro de cada función

**User Story:** Como administrador, quiero que cada Edge Function verifique mi identidad por email dentro de la función, para que un simple JWT válido no conceda acceso.

#### Acceptance Criteria

1. WHEN una Edge_Function recibe una petición, THE verifyAdmin SHALL verificar el JWT del usuario con `supabase.auth.getUser(jwt)` y comparar el email resuelto con ADMIN_EMAIL de forma case-insensitive.
2. IF una petición a una Edge_Function no incluye una cabecera `Authorization` con `Bearer <jwt>` o el JWT es inválido, THEN THE Edge_Function SHALL responder `401` y SHALL omitir cualquier llamada a OpenAI.
3. IF el email resuelto del JWT no coincide con ADMIN_EMAIL, THEN THE Edge_Function SHALL responder `403` y SHALL omitir cualquier llamada a OpenAI.
4. IF una petición presenta únicamente la Clave_Anon como JWT, THEN THE Edge_Function SHALL responder `403`, dado que la autorización se decide comparando el email y no por verify_jwt.

### Requirement 3: Eliminación de la IA del frontend

**User Story:** Como administrador, quiero que el frontend no contenga ningún resto de integración directa con OpenAI, para reducir la superficie de riesgo y el tamaño del bundle.

#### Acceptance Criteria

1. THE App_Admin SHALL estar libre de la bandera `dangerouslyAllowBrowser`.
2. THE App_Admin SHALL estar libre de lectura o escritura de `localStorage('openai_key')`.
3. THE App_Admin SHALL estar libre de cualquier input de API key en la interfaz.
4. THE App_Admin SHALL estar libre del helper `loadOpenAI` y de cualquier import estático o dinámico del paquete `openai`.
5. THE package.json SHALL estar libre de la dependencia `openai`.

### Requirement 4: CORS para producción y localhost

**User Story:** Como administrador, quiero que las Edge Functions respondan correctamente a CORS desde producción y desarrollo, para que la app funcione en ambos entornos.

#### Acceptance Criteria

1. WHERE el `origin` de la petición pertenece a ALLOWED_ORIGINS (dominio de producción o localhost), THE Edge_Function SHALL incluir en toda respuesta de éxito, de error y de preflight la cabecera `Access-Control-Allow-Origin` igual a ese `origin`, junto con `Access-Control-Allow-Headers: authorization, content-type, apikey` y `Access-Control-Allow-Methods: POST, OPTIONS`.
2. WHEN una Edge_Function recibe una petición `OPTIONS`, THE Edge_Function SHALL responder el preflight con las cabeceras CORS antes de cualquier otra lógica y SHALL omitir cualquier llamada a OpenAI y cualquier escritura en la base de datos.
3. IF el `origin` de la petición no pertenece a ALLOWED_ORIGINS, THEN THE Edge_Function SHALL omitir la cabecera `Access-Control-Allow-Origin` en la respuesta.

### Requirement 5: Límite de tamaño de la entrada

**User Story:** Como administrador, quiero que la importación rechace entradas demasiado grandes, para evitar llamadas costosas o fallidas a OpenAI.

#### Acceptance Criteria

1. IF una petición a la Funcion_Importar con `modo:texto` tiene `contenido` de longitud mayor que 20000 caracteres, THEN THE Funcion_Importar SHALL responder `413` (o `400`) con un objeto `{ error }` claro y SHALL omitir cualquier llamada a OpenAI.
2. IF una petición a la Funcion_Importar con `modo:imagen` tiene una cadena base64 de tamaño mayor que 5 MB, THEN THE Funcion_Importar SHALL responder `413` (o `400`) con un objeto `{ error }` claro y SHALL omitir cualquier llamada a OpenAI.
3. WHEN el administrador prepara una importación en la App_Admin, THE App_Admin SHALL validar el tamaño del contenido antes de enviar la petición y, si supera el límite, SHALL mostrar el aviso y SHALL omitir el envío de la petición.

### Requirement 6: Fuente única del módulo compartido

**User Story:** Como desarrollador, quiero una sola definición editable de familias/reglas/few-shot/normalización árabe, para evitar duplicación y divergencias.

#### Acceptance Criteria

1. THE Fuente_Unica SHALL contener la única definición editable de la lista de 26 familias, escrita en ESM puro sin APIs de Node ni de Deno.
2. THE _shared SHALL contener `familias.js`, `arabe.js`, `fewshot.js` y `ejemplos-familias.json` como módulos neutros portables a Vite, Node y Deno.
3. WHERE `src/constants/familias.js`, `scripts/_arabe.js` o `scripts/_fewshot.js` necesitan familias, normalización árabe o few-shot, THE módulo correspondiente SHALL reexportar desde _shared en lugar de redefinir los datos.
4. WHERE una Edge_Function necesita familias, normalización árabe o few-shot, THE Edge_Function SHALL importar desde `../_shared/` por ruta relativa.
5. THE repositorio SHALL contener la definición literal de la lista de 26 familias exactamente una vez y SHALL no incluir copia generada ni paso `predeploy`.

### Requirement 7: Las funciones de importación y auditoría no escriben en la base de datos

**User Story:** Como administrador, quiero que las funciones de servidor solo propongan cambios, para que toda escritura pase por la app bajo RLS.

#### Acceptance Criteria

1. WHEN la Funcion_Importar procesa una petición, THE Funcion_Importar SHALL devolver únicamente `items[]` y SHALL no ejecutar ningún `insert`, `update` ni `delete` sobre `flashcards`.
2. WHEN la Funcion_Auditar procesa una petición, THE Funcion_Auditar SHALL devolver únicamente `issues[]` y SHALL no ejecutar ningún `insert`, `update` ni `delete` sobre `flashcards`.
3. WHEN la Funcion_Sugerir procesa una petición, THE Funcion_Sugerir SHALL leer las tarjetas con el service role y SHALL devolver únicamente `grupos[]` sin ejecutar ningún `insert`, `update` ni `delete` sobre `flashcards`.
4. WHEN el administrador confirma la revisión o aplica una corrección de auditoría, THE App_Admin SHALL ejecutar las escrituras (insert de nuevas, update de fusiones y `applyFix`) con el JWT de admin bajo RLS.

### Requirement 8: Columna de tipo y migración idempotente

**User Story:** Como desarrollador, quiero una columna `tipo` para distinguir palabras de frases, para poder filtrar y clasificar tarjetas por tipo.

#### Acceptance Criteria

1. THE migración `supabase/add-tipo.sql` SHALL añadir la Columna_Tipo a `public.flashcards` con un `CHECK` que restrinja los valores a `'palabra'` o `'frase'` y SHALL permitir NULL hasta que las tarjetas se rellenen.
2. WHEN la migración `supabase/add-tipo.sql` se ejecuta N veces, THE esquema resultante SHALL ser idéntico al producido al ejecutarla una vez.
3. THE base de datos SHALL rechazar cualquier valor de la Columna_Tipo distinto de `'palabra'` o `'frase'`.

### Requirement 9: Relleno del tipo con catalogar-familias

**User Story:** Como administrador, quiero rellenar el tipo de las tarjetas existentes sin reclasificar sus familias, para completar la migración de forma segura.

#### Acceptance Criteria

1. WHERE se pasa el flag `--solo-tipo` a `catalogar-familias.js`, THE script SHALL rellenar la Columna_Tipo únicamente en las tarjetas con `tipo` NULL y SHALL no modificar las familias ni la Confianza.
2. WHEN `catalogar-familias.js --solo-tipo` infiere el tipo de una tarjeta, THE script SHALL asignar `'frase'` cuando la `category` incluye 'frases' o el español tiene más de dos palabras, y SHALL asignar `'palabra'` en el resto de casos.

### Requirement 10: getCardType usa la columna tipo

**User Story:** Como usuario, quiero que el tipo mostrado provenga de la columna `tipo`, para que la clasificación sea consistente con la base de datos.

#### Acceptance Criteria

1. WHEN una tarjeta tiene `tipo = 'frase'`, THE getCardType SHALL devolver `'phrase'`.
2. WHEN una tarjeta tiene `tipo = 'palabra'`, THE getCardType SHALL devolver `'word'`.
3. IF una tarjeta tiene `tipo` NULL, THEN THE getCardType SHALL aplicar la heurística de respaldo (`'phrase'` si la `category` incluye 'frases' o el español tiene más de dos palabras; `'word'` en el resto).

### Requirement 11: Filtro por tipo en la vista principal

**User Story:** Como usuario, quiero filtrar las tarjetas por tipo en la vista principal, para encontrar palabras o frases más rápido.

#### Acceptance Criteria

1. THE App_Admin SHALL ofrecer en la vista principal un filtro por tipo con opciones `Todos`, `palabra` y `frase`, adicional al filtro por familia.
2. WHEN el usuario selecciona `palabra` o `frase` en el filtro de tipo, THE App_Admin SHALL mostrar únicamente las tarjetas cuyo tipo (o tipo inferido si es NULL) coincide con la opción seleccionada.
3. THE App_Admin SHALL conservar el filtro Pendientes_De_Revisar existente.

### Requirement 12: Entrada multi-fuente de importación

**User Story:** Como administrador, quiero importar desde texto, PDF, imagen o cámara, para capturar vocabulario de distintas fuentes.

#### Acceptance Criteria

1. THE App_Admin SHALL aceptar la entrada de importación mediante texto, PDF, imagen o cámara.
2. WHEN el administrador aporta un PDF, THE App_Admin SHALL extraer el texto en el navegador con pdfjs cargado de forma perezosa y SHALL enviar ese texto a la Funcion_Importar con `modo:'texto'`.
3. WHEN el administrador aporta una imagen o una foto de cámara, THE App_Admin SHALL enviar la imagen en base64 a la Funcion_Importar con `modo:'imagen'` para procesarla con visión.
4. WHERE el administrador indica una Leccion opcional, THE App_Admin SHALL enviarla como `leccion` a la Funcion_Importar.

### Requirement 13: Forma de las propuestas devueltas por importar

**User Story:** Como administrador, quiero que cada propuesta incluya todos los campos necesarios y correctos, para revisar y guardar con garantías.

#### Acceptance Criteria

1. THE Funcion_Importar SHALL devolver por cada item los campos `arabe` vocalizado, `espanol`, `transliteracion` con diacríticos, `tipo`, `familias`, `confianza` y `arabe_normalizado`.
2. THE Funcion_Importar SHALL garantizar que `item.familias` contiene al menos una familia mediante ensureFamilias.
3. IF ensureFamilias fuerza el fallback de familias de un item, THEN THE Funcion_Importar SHALL asignar `item.confianza = 'baja'`.
4. THE Funcion_Importar SHALL sanear `item.confianza` a uno de `'alta'`, `'media'` o `'baja'` mediante sanitizeConfianza.
5. THE Funcion_Importar SHALL asignar `item.tipo` a `'palabra'` o `'frase'`, infiriéndolo con la heurística de respaldo del servidor si la IA no lo proporciona.
6. THE Funcion_Importar SHALL calcular `item.arabe_normalizado` con normalizarArabe para que el cliente deduplique con el mismo criterio.

### Requirement 14: Detección de duplicados antes de guardar

**User Story:** Como administrador, quiero detectar duplicados contra la base de datos antes de guardar, para no crear tarjetas repetidas.

#### Acceptance Criteria

1. WHEN la App_Admin recibe las propuestas de la Funcion_Importar, THE App_Admin SHALL consultar las tarjetas existentes y comparar cada propuesta usando dupKey, que aplica normalizarArabe compartido e ignora el artículo inicial `ال`.
2. THE App_Admin SHALL considerar iguales un item importado y una tarjeta existente si y solo si `dupKey(item.arabe)` es igual a `dupKey(tarjeta.arabic)`.
3. WHEN la App_Admin clasifica cada propuesta, THE App_Admin SHALL marcarla como `nuevo`, `ya existe` o `posible duplicado`.

### Requirement 15: Pantalla de revisión editable

**User Story:** Como administrador, quiero revisar y editar las propuestas antes de guardar, para corregir errores y decidir qué guardar.

#### Acceptance Criteria

1. WHEN la App_Admin muestra la Pantalla_Revision, THE App_Admin SHALL permitir editar los campos de cada fila, seleccionar familias mediante checkboxes y descartar filas.
2. WHERE una fila está marcada como `ya existe`, THE App_Admin SHALL permitir elegir entre omitir la fila o fusionarla con la tarjeta existente.
3. WHEN el administrador elige fusionar una fila marcada como `ya existe`, THE App_Admin SHALL conservar el `id` de la tarjeta existente, SHALL añadir las familias como unión sin duplicados y SHALL añadir la Leccion a `category`, sin crear una tarjeta nueva.

### Requirement 16: Reglas de confianza al guardar

**User Story:** Como administrador, quiero que las filas que confirmo queden con confianza alta, para que solo el resto aparezca como pendiente de revisar.

#### Acceptance Criteria

1. WHEN el administrador guarda una fila editada o confirmada, THE App_Admin SHALL asignar `familias_confianza = 'alta'` a esa fila.
2. WHEN el administrador guarda una fila sin editar, THE App_Admin SHALL conservar la Confianza asignada por la IA.
3. WHILE una tarjeta guardada tiene `familias_confianza = 'baja'`, THE App_Admin SHALL incluirla en el filtro Pendientes_De_Revisar.

### Requirement 17: Lección opcional guardada en category

**User Story:** Como administrador, quiero indicar una lección u origen opcional, para registrar la procedencia de las tarjetas importadas.

#### Acceptance Criteria

1. WHERE el administrador rellena el campo opcional "Lección / origen", THE App_Admin SHALL guardar ese valor en la columna `category` de las tarjetas correspondientes.

### Requirement 18: Sugerir familias en la app

**User Story:** Como administrador, quiero un botón para sugerir familias nuevas desde Mantenimiento BD, para descubrir agrupaciones sin modificar nada.

#### Acceptance Criteria

1. THE App_Admin SHALL ofrecer en Mantenimiento BD un botón que invoca la Funcion_Sugerir.
2. WHEN el administrador pulsa el botón de sugerir familias, THE App_Admin SHALL mostrar las propuestas devueltas (`grupos[]`) que incluyen grupos con al menos `min` tarjetas.
3. THE App_Admin SHALL presentar las propuestas de familias únicamente de forma informativa y SHALL no realizar ningún cambio en la base de datos a partir de ellas.

### Requirement 19: Build y lint

**User Story:** Como desarrollador, quiero que el proyecto siga compilando y pasando el lint dentro de los límites, para no introducir regresiones de calidad.

#### Acceptance Criteria

1. WHEN se ejecuta `npm run build`, THE proyecto SHALL completar la compilación sin errores.
2. WHEN se ejecuta `npm run lint`, THE proyecto SHALL reportar como máximo 22 problemas.

### Requirement 20: Tamaño del bundle y carga perezosa

**User Story:** Como usuario, quiero que el bundle inicial no crezca, para mantener la app rápida de cargar.

#### Acceptance Criteria

1. WHEN se elimina la dependencia `openai`, THE tamaño del bundle inicial del frontend SHALL no crecer y SHALL disminuir respecto al estado anterior.
2. THE App_Admin SHALL mantener pdfjs en carga perezosa, fuera del chunk inicial.

### Requirement 21: No regresión de juegos, auth admin y RLS

**User Story:** Como administrador, quiero que esta feature no altere los juegos, la autenticación admin ni las políticas RLS, para preservar el comportamiento existente.

#### Acceptance Criteria

1. THE feature SHALL mantener los juegos sin cambios funcionales.
2. THE feature SHALL mantener la autenticación admin sin cambios funcionales.
3. THE feature SHALL mantener las políticas RLS sin cambios funcionales.

### Requirement 22: Entregable de despliegue sin ejecutar

**User Story:** Como administrador, quiero recibir los comandos de Supabase CLI y los pasos manuales en orden sin que se ejecuten, para desplegar yo mismo de forma controlada.

#### Acceptance Criteria

1. THE feature SHALL entregar los comandos de Supabase CLI y los pasos manuales de despliegue en orden, sin ejecutar SQL ni desplegar funciones durante este trabajo.
2. WHEN la implementación finaliza, THE feature SHALL actualizar `docs/INFORME-PROYECTO.md` con la nueva arquitectura (IA en servidor, columna `tipo` y flujo de importación con revisión).
