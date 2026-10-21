# Requirements Document

## Introduction

Esta feature endurece la seguridad del SPA `arabe-flashcards` (React 19 + Vite + Supabase) en tres frentes derivados del documento de diseño aprobado: (1) externalizar las credenciales del cliente Supabase (URL y clave `anon`) hacia variables de entorno `import.meta.env.VITE_*`, con fallo ruidoso si faltan y sin literales en el código; (2) sustituir la contraseña embebida `"1234"` y el `prompt()` por un modo admin de clave única respaldado por Supabase Auth (`signInWithPassword`), donde `isAdminMode` se deriva exclusivamente del estado de la sesión Supabase; y (3) definir políticas Row Level Security (RLS) sobre la tabla `flashcards` que permitan lectura pública pero restrinjan la escritura al único usuario admin identificado por su email en el JWT.

El principio rector es que la defensa real reside en RLS del lado del servidor, no en ocultar botones de la interfaz. El modo admin pasa a ser una capa de autenticación legítima en lugar de un candado cosmético. Los scripts de servidor usan `service_role`, que se salta RLS, por lo que no se ven afectados. El diseño es conservador: no toca el sistema de familias, los juegos ni los scripts salvo lo imprescindible, y preserva los límites de `build`, `lint` y la carga perezosa.

## Glossary

- **SPA**: La aplicación React `arabe-flashcards` servida por Vite que se ejecuta en el navegador.
- **Cliente_Supabase**: El módulo `src/supabaseClient.js` que crea e instancia el cliente `@supabase/supabase-js` con la clave `anon`.
- **Hook_Sesion_Admin**: El hook `useAdminSession` que encapsula la sesión de Supabase Auth y deriva el estado de admin; única fuente de verdad de `isAdminMode`.
- **Formulario_Login_Admin**: El componente `AdminLoginForm` que presenta un único campo de contraseña para iniciar sesión como admin.
- **Modo_Admin**: El estado booleano `isAdminMode` que habilita los controles de edición de la interfaz.
- **Sesion_Supabase**: La sesión JWT activa devuelta por Supabase Auth (`getSession`, `onAuthStateChange`).
- **Clave_Anon**: La clave pública `anon` de Supabase, expuesta en el bundle por diseño.
- **Service_Role**: La clave `SUPABASE_SERVICE_ROLE_KEY` de permisos administrativos que se salta RLS; de uso exclusivo del lado servidor.
- **RLS**: Row Level Security de PostgreSQL/Supabase aplicado a la tabla `public.flashcards`.
- **Email_Admin**: El valor de `VITE_ADMIN_EMAIL`; el email del único usuario administrador.
- **Script_SQL_RLS**: El archivo `supabase/rls-flashcards.sql` que activa RLS y define las políticas de la tabla `flashcards`.
- **Workflow_Keepalive**: El archivo `.github/workflows/keepalive.yml` de GitHub Actions.
- **Scripts_Servidor**: Los scripts Node `catalogar-familias.js` e `ingestar-aportes.js` que usan `Service_Role`.
- **Build**: El comando `npm run build` que genera el bundle de producción con Vite.
- **Lint**: El comando `npm run lint` que ejecuta ESLint sobre el proyecto.
- **Informe_Proyecto**: El documento `docs/INFORME-PROYECTO.md`.

## Requirements

### Requirement 1: Credenciales del cliente desde entorno

**User Story:** Como desarrollador, quiero que el cliente Supabase lea sus credenciales desde variables de entorno, para que no haya URLs ni claves literales en el código fuente.

#### Acceptance Criteria

1. THE Cliente_Supabase SHALL leer la URL del proyecto desde `import.meta.env.VITE_SUPABASE_URL`.
2. THE Cliente_Supabase SHALL leer la clave anon desde `import.meta.env.VITE_SUPABASE_ANON_KEY`.
3. WHERE ambas variables de entorno están definidas, THE Cliente_Supabase SHALL crear un cliente Supabase funcional apuntando al proyecto configurado.
4. THE Cliente_Supabase SHALL exportar una única instancia singleton del cliente Supabase.
5. THE SPA SHALL mantener ausente cualquier URL literal del proyecto Supabase y cualquier Clave_Anon literal en todos los archivos versionados del repositorio.

### Requirement 2: Fallo ruidoso ante credenciales de cliente ausentes

**User Story:** Como desarrollador, quiero un error claro en consola cuando falten las variables de entorno del cliente, para que el problema sea atribuible y no un fallo silencioso.

#### Acceptance Criteria

1. IF `VITE_SUPABASE_URL` está ausente al cargar el Cliente_Supabase, THEN THE Cliente_Supabase SHALL emitir al menos un `console.error` descriptivo que identifique la variable faltante.
2. IF `VITE_SUPABASE_ANON_KEY` está ausente al cargar el Cliente_Supabase, THEN THE Cliente_Supabase SHALL emitir al menos un `console.error` descriptivo que identifique la variable faltante.
3. THE Cliente_Supabase SHALL continuar el arranque del módulo sin lanzar una excepción que rompa el render inicial de la aplicación.

### Requirement 3: Documentación de separación de variables en `.env.example`

**User Story:** Como desarrollador, quiero que `.env.example` separe claramente las variables de cliente y de scripts, para que nunca exponga el service_role en el navegador.

#### Acceptance Criteria

1. THE `.env.example` SHALL agrupar las variables de cliente con prefijo `VITE_` en una sección identificada como variables de cliente/navegador.
2. THE `.env.example` SHALL agrupar las variables de scripts sin prefijo `VITE_` en una sección identificada como variables de scripts/servidor.
3. THE `.env.example` SHALL documentar que la clave Service_Role nunca debe llevar el prefijo `VITE_`.
4. THE `.env.example` SHALL incluir las claves de cliente `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `VITE_ADMIN_EMAIL` con valores de marcador.

### Requirement 4: Separación de prefijos de variables de entorno

**User Story:** Como responsable de seguridad, quiero que ninguna credencial de service_role lleve prefijo VITE_, para que no acabe en el bundle del navegador.

#### Acceptance Criteria

1. THE SPA SHALL mantener la variable Service_Role sin el prefijo `VITE_` en todos los archivos versionados.
2. THE `.env.example` SHALL declarar la variable Service_Role sin el prefijo `VITE_`.
3. THE SPA SHALL mantener ausente cualquier referencia a Service_Role en el código que se incluye en el bundle del navegador.

### Requirement 5: Eliminación de credenciales del workflow keepalive

**User Story:** Como responsable del repositorio, quiero que el workflow keepalive no contenga credenciales ni URLs en claro, para que no se filtren datos del proyecto en el repositorio.

#### Acceptance Criteria

1. THE Workflow_Keepalive SHALL leer la URL del proyecto desde el secreto de GitHub `secrets.SUPABASE_URL`.
2. THE Workflow_Keepalive SHALL leer la Clave_Anon desde el secreto de GitHub `secrets.SUPABASE_ANON_KEY`.
3. THE Workflow_Keepalive SHALL mantener ausente cualquier URL literal del proyecto Supabase y cualquier Clave_Anon literal en su contenido.

### Requirement 6: Formulario de login admin de un solo campo

**User Story:** Como administrador, quiero un formulario con un único campo de contraseña, para iniciar sesión sin exponer gestión de cuentas innecesaria.

#### Acceptance Criteria

1. THE Formulario_Login_Admin SHALL presentar exactamente un campo de entrada de tipo contraseña.
2. THE Formulario_Login_Admin SHALL mantener ausente cualquier campo de email, enlace de registro, enlace de recuperación de contraseña y control de gestión de cuentas.
3. WHEN el usuario envía el Formulario_Login_Admin, THE Formulario_Login_Admin SHALL invocar exactamente una vez la operación de inicio de sesión con el valor de la contraseña introducida.
4. WHILE una operación de inicio de sesión está en curso, THE Formulario_Login_Admin SHALL deshabilitar sus controles de envío e indicar el estado de carga.
5. IF existe un mensaje de error de inicio de sesión, THEN THE Formulario_Login_Admin SHALL mostrar el mensaje con `role="alert"`.
6. WHEN el usuario cancela el Formulario_Login_Admin, THE Formulario_Login_Admin SHALL cerrarse sin iniciar sesión.

### Requirement 7: Autenticación admin mediante Supabase Auth

**User Story:** Como administrador, quiero autenticarme con Supabase Auth usando una contraseña, para que el acceso de escritura dependa de una sesión real y no de un secreto embebido.

#### Acceptance Criteria

1. WHEN el usuario envía una contraseña en el Formulario_Login_Admin, THE Hook_Sesion_Admin SHALL invocar `signInWithPassword` usando el Email_Admin leído de `VITE_ADMIN_EMAIL` junto con la contraseña introducida.
2. WHEN `signInWithPassword` tiene éxito, THE Hook_Sesion_Admin SHALL establecer una Sesion_Supabase activa a través de `onAuthStateChange`.
3. IF `signInWithPassword` devuelve un error de credenciales, THEN THE Hook_Sesion_Admin SHALL exponer un mensaje de error genérico que no revele si el fallo corresponde al email o a la contraseña.
4. IF `VITE_ADMIN_EMAIL` está ausente cuando se intenta iniciar sesión, THEN THE Hook_Sesion_Admin SHALL abortar el inicio de sesión, exponer un mensaje de error visible en la interfaz y emitir un `console.error`.
5. WHILE una operación de inicio o cierre de sesión está en curso, THE Hook_Sesion_Admin SHALL exponer un estado de carga activo.
6. THE SPA SHALL mantener ausente la contraseña literal `"1234"` y la invocación `prompt()` en todos los archivos versionados tras la implementación.

### Requirement 8: Modo admin derivado de la sesión Supabase

**User Story:** Como responsable de seguridad, quiero que el modo admin se derive únicamente de la sesión Supabase, para que no exista ninguna ruta que lo active sin autenticación real.

#### Acceptance Criteria

1. THE Hook_Sesion_Admin SHALL resolver la Sesion_Supabase existente mediante `getSession` al montarse y suscribirse a sus cambios mediante `onAuthStateChange`.
2. WHILE existe una Sesion_Supabase válida, THE Hook_Sesion_Admin SHALL mantener Modo_Admin en verdadero.
3. WHILE no existe una Sesion_Supabase válida, THE Hook_Sesion_Admin SHALL mantener Modo_Admin en falso.
4. THE SPA SHALL derivar Modo_Admin exclusivamente del Hook_Sesion_Admin, sin ninguna ruta de código que active Modo_Admin sin una Sesion_Supabase.
5. WHEN la Sesion_Supabase expira o se recibe el evento `SIGNED_OUT`, THE Hook_Sesion_Admin SHALL establecer Modo_Admin en falso automáticamente.
6. WHEN el Hook_Sesion_Admin se desmonta, THE Hook_Sesion_Admin SHALL cancelar la suscripción a `onAuthStateChange`.

### Requirement 9: Cierre de sesión admin

**User Story:** Como administrador, quiero un control para cerrar sesión, para poder abandonar el modo admin de forma explícita.

#### Acceptance Criteria

1. WHILE Modo_Admin está activo, THE SPA SHALL ofrecer un control de cierre de sesión.
2. WHEN el usuario activa el cierre de sesión, THE Hook_Sesion_Admin SHALL invocar `signOut` de Supabase Auth.
3. WHEN `signOut` finaliza, THE Hook_Sesion_Admin SHALL establecer la Sesion_Supabase en nula y Modo_Admin en falso.

### Requirement 10: Generación del script de políticas RLS

**User Story:** Como responsable de datos, quiero generar un script SQL de políticas RLS para flashcards, para restringir la escritura al admin manteniendo la lectura pública.

#### Acceptance Criteria

1. THE SPA SHALL generar el archivo `supabase/rls-flashcards.sql` sin ejecutarlo como parte de la implementación.
2. THE Script_SQL_RLS SHALL activar RLS sobre la tabla `public.flashcards`.
3. THE Script_SQL_RLS SHALL definir una política que permita la operación SELECT sobre `flashcards` a los roles `anon` y `authenticated`.
4. THE Script_SQL_RLS SHALL definir políticas que restrinjan las operaciones INSERT, UPDATE y DELETE sobre `flashcards` a los clientes cuyo `auth.jwt() ->> 'email'` coincida con el Email_Admin.
5. THE Script_SQL_RLS SHALL incluir un marcador `'<EMAIL_DEL_ADMIN>'` destinado a ser sustituido por el usuario junto con una nota que indique que debe coincidir con `VITE_ADMIN_EMAIL`.

### Requirement 11: Autorización de escritura por RLS

**User Story:** Como responsable de seguridad, quiero que las políticas RLS autoricen la escritura solo al admin, para que ni visitantes anónimos ni otros usuarios autenticados puedan modificar flashcards.

#### Acceptance Criteria

1. WHILE RLS está activo en `flashcards`, THE RLS SHALL permitir SELECT a un cliente que use la Clave_Anon.
2. WHILE RLS está activo en `flashcards`, IF un cliente que usa la Clave_Anon intenta INSERT, UPDATE o DELETE, THEN THE RLS SHALL rechazar la operación.
3. WHILE RLS está activo en `flashcards`, IF un cliente autenticado cuyo email no coincide con el Email_Admin intenta INSERT, UPDATE o DELETE, THEN THE RLS SHALL rechazar la operación.
4. WHILE RLS está activo en `flashcards`, WHERE el cliente autenticado tiene un email en el JWT que coincide con el Email_Admin, THE RLS SHALL permitir las operaciones INSERT, UPDATE y DELETE.
5. WHILE RLS está activo en `flashcards`, THE RLS SHALL permitir las operaciones SELECT, INSERT, UPDATE y DELETE a los Scripts_Servidor que usan Service_Role, saltándose RLS.

### Requirement 12: Scripts de servidor sin cambios de comportamiento

**User Story:** Como mantenedor, quiero que los scripts con service_role sigan funcionando igual, para no romper los flujos de catalogación e ingesta.

#### Acceptance Criteria

1. THE Scripts_Servidor SHALL continuar usando Service_Role para operar sobre `flashcards`.
2. WHILE RLS está activo en `flashcards`, THE Scripts_Servidor SHALL conservar el mismo comportamiento funcional que antes de activar RLS.

### Requirement 13: Preservación del presupuesto de calidad y carga perezosa

**User Story:** Como mantenedor, quiero que la implementación preserve build, lint y la carga perezosa, para no degradar la calidad ni el rendimiento del bundle.

#### Acceptance Criteria

1. WHEN se ejecuta Build, THE SPA SHALL completar la compilación con éxito.
2. WHEN se ejecuta Lint, THE SPA SHALL producir como máximo 22 problemas.
3. THE SPA SHALL mantener `openai` fuera del chunk inicial del bundle, cargándolo únicamente mediante `import()` dinámico.
4. THE SPA SHALL mantener `pdfjs-dist` fuera del chunk inicial del bundle, cargándolo únicamente mediante `import()` dinámico.
5. THE SPA SHALL preservar sin cambios el sistema de familias, los juegos y los Scripts_Servidor salvo las modificaciones imprescindibles para esta feature.

### Requirement 14: Entregables documentales

**User Story:** Como responsable del proyecto, quiero que al terminar la implementación se actualice el informe y se entregue la lista de pasos manuales, para operar el despliegue de forma segura.

#### Acceptance Criteria

1. WHEN la implementación finaliza, THE SPA SHALL actualizar las secciones 1, 7 y 8 del Informe_Proyecto para reflejar la auth admin vía Supabase Auth y la protección de escritura por RLS.
2. WHEN la implementación finaliza, THE SPA SHALL entregar una lista de pasos manuales de Supabase que incluya crear el usuario admin con la opción "Auto Confirm User" activada, desactivar "Allow new users to sign up" y ejecutar el Script_SQL_RLS.
3. WHEN la implementación finaliza, THE SPA SHALL entregar una instrucción manual para configurar `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `VITE_ADMIN_EMAIL` en el hosting de producción.
4. WHEN la implementación finaliza, THE SPA SHALL entregar una instrucción manual para crear el secreto de GitHub `SUPABASE_URL` destinado al Workflow_Keepalive.
5. WHEN la implementación finaliza, THE SPA SHALL entregar una instrucción manual para actualizar el archivo `.env` local siguiendo el nuevo `.env.example`.
