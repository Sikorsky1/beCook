# Política de privacidad de beCook

Última actualización: 12 de octubre de 2026

## 1. Quién es el responsable

- Responsable: Sergio Ortiz Torrijos, NIF 50909374R
- Contacto para privacidad: sergio.ortiz.torrijos@gmail.com
- beCook es un servicio en fase beta para planificar menús semanales, la lista de la compra y la despensa.

## 2. Qué datos tratamos

| Categoría | Datos | Cuándo |
| --- | --- | --- |
| Cuenta | Email, contraseña si la usas (la guarda cifrada Supabase Auth; no la vemos), proveedor con el que entras (Google), fechas de alta y último acceso, sesiones | Si creas una cuenta |
| Perfil | Comensales, días y tipos de entrenamiento, objetivos, dietas, **alergias e intolerancias**, alimentos que no te gustan. Opcionales: sexo, fecha de nacimiento, altura y peso | Si los rellenas |
| Planificación | Menús por semana, platos, fichas de plato, lista de la compra, despensa, texto de menús que pegues para importarlos | Al usar la app |
| Uso de IA | Tipo de petición, resultado, modelo, tokens, coste estimado, fecha y una huella cifrada de la IP (HMAC con clave secreta; no guardamos la IP) | Cada petición de IA |
| Técnicos | Registros del servidor (ruta, código de respuesta, tiempos) sin contenido de tus menús ni de tu perfil | Al usar la web |
| En tu dispositivo | Si no inicias sesión, tus datos se guardan solo en el almacenamiento local de tu navegador y no llegan a nuestros servidores | Sin cuenta |

Si entras con Google, Google nos facilita tu email, tu nombre, la dirección de tu foto de perfil y un identificador de tu cuenta de Google, y nada más. No usamos la foto.

## 3. Para qué los usamos y con qué base

| Finalidad | Base jurídica |
| --- | --- |
| Crear y mantener tu cuenta, sincronizar tus datos entre dispositivos | Ejecución del contrato (art. 6.1.b) |
| Proponer menús, sustituir platos, preparar fichas y listas de la compra teniendo en cuenta tus dietas y alergias | Contrato; para alergias y dietas, consentimiento explícito (art. 9.2.a) |
| Limitar el uso de IA (cuotas, límite por red, presupuesto) y evitar abusos | Interés legítimo (art. 6.1.f) en mantener el servicio sostenible y seguro |
| Seguridad, copias de seguridad y resolución de incidencias | Interés legítimo (art. 6.1.f) |
| Emails de la cuenta (confirmación de alta, recuperación de contraseña) | Contrato |

No vendemos tus datos, no hacemos publicidad ni perfiles comerciales, y no usamos herramientas de
analítica ni cookies de terceros.

## 4. Inteligencia artificial

Cuando pides un menú, una alternativa a un plato, una ficha de plato, una lista de la compra o importar un menú con IA, enviamos a **OpenAI** lo necesario para esa petición: por ejemplo los platos de la semana, el número de raciones y **tus dietas, alergias y alimentos que no te gustan**, tus objetivos y días de entrenamiento, o el texto que pegaste. No enviamos tu email, tu nombre ni tus datos corporales. Las peticiones se hacen con `store: false` (OpenAI no las guarda para entrenar).

Si subes una foto o un PDF escaneado de tu menú, enviamos las imágenes de sus páginas, reducidas, a nuestro proveedor de IA (OpenAI) solo para transcribir el texto; no guardamos el archivo ni las imágenes, y pedimos a OpenAI que no las almacene. Los PDF con texto se leen en tu dispositivo y no se envían.

Los resultados de la IA son orientativos: la información sobre alérgenos es estimada y no sustituye leer el etiquetado ni el consejo de un profesional sanitario.

## 5. Con quién los compartimos (encargados del tratamiento)

| Proveedor | Servicio | Ubicación | Garantías |
| --- | --- | --- | --- |
| Supabase | Base de datos y autenticación | UE (Irlanda, eu-west-1) | DPA de Supabase |
| Vercel | Alojamiento de la web y funciones del servidor | EE. UU. y red global | DPA, Cláusulas Contractuales Tipo / Data Privacy Framework |
| OpenAI | Generación con IA | EE. UU. | DPA de OpenAI, Cláusulas Contractuales Tipo / DPF |
| Resend | Envío de emails de la cuenta y alertas técnicas (sin datos de usuarios) | EE. UU.| DPA de Resend |
| GitHub | Código y comprobaciones automáticas (no contiene datos de usuarios) | EE. UU. | — |

## 6. Cuánto tiempo los conservamos

| Datos | Plazo |
| --- | --- |
| Cuenta, perfil y planificación | Mientras tengas la cuenta. Al eliminarla se borran **al momento y de forma definitiva** |
| Registro de uso de IA | Al eliminar la cuenta se desvincula de ella (sin email ni identificador de usuario) y se conserva para el control de gasto durante 13 meses. Mantiene la huella cifrada de la IP |
| Copias de seguridad | Copias manuales antes de cambios en la base de datos, guardadas fuera del servicio con acceso restringido. Tus datos pueden seguir en ellas hasta que caducan, como máximo 30 días. Si se restaurase una copia, volveríamos a borrar las cuentas eliminadas después de esa copia |
| Registros técnicos del servidor | Según el plan de Vercel |
| Datos solo en tu dispositivo | Hasta que los borres del navegador; cerrar sesión borra la copia local de tu cuenta |

## 7. Tus derechos

Puedes ejercerlos en la app o escribiendo a **sergio.ortiz.torrijos@gmail.com**:

- **Acceso y portabilidad**: Perfil → «Tus datos» → «Descargar mis datos» (archivo JSON con tu cuenta,
  perfil, menús, compra, despensa, fichas y registro de IA).
- **Supresión**: Perfil → «Tus datos» → «Eliminar tu cuenta» (escribiendo ELIMINAR).
- **Rectificación**: editando tu perfil y tus datos en la app.
- **Retirar el consentimiento** sobre alergias y dietas: borrándolas del perfil (los menús dejarán de
  tenerlas en cuenta).
- **Oposición y limitación**: por email.
- **Reclamar** ante la Agencia Española de Protección de Datos ([www.aepd.es](https://www.aepd.es)).

## 8. Menores

beCook no está dirigido a menores de 14 años.

## 9. Seguridad

Acceso a los datos de cada persona limitado por reglas en la base de datos (RLS), claves de servicio solo en el servidor, IA solo con sesión iniciada y con cuotas, registros sin contenido personal, detección de secretos en el código y copias de seguridad antes de cada cambio de esquema.
