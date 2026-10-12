# Política de privacidad de beCook

> **Borrador, no publicar.** Texto de trabajo preparado en el paso 37 a partir del código, sin
> revisión jurídica. Debe revisarlo una persona competente en protección de datos antes de
> publicarse o enlazarse desde la app. Los puntos marcados con **[REVISAR]** o **[DECIDIR]**
> necesitan una decisión de Sergio o de quien haga la revisión legal.

Última actualización: [fecha de publicación]

## 1. Quién es el responsable

- Responsable: **[Nombre y apellidos o razón social]**, NIF **[…]**, domicilio **[…]**.
- Contacto para privacidad: **[email de contacto]**.
- beCook es un servicio en fase beta para planificar menús semanales, la lista de la compra y la despensa.

## 2. Qué datos tratamos

| Categoría | Datos | Cuándo |
| --- | --- | --- |
| Cuenta | Email, contraseña (la guarda cifrada Supabase Auth; no la vemos), fechas de alta y último acceso, sesiones | Si creas una cuenta |
| Perfil | Comensales, días y tipos de entrenamiento, objetivos, dietas, **alergias e intolerancias**, alimentos que no te gustan. Opcionales: sexo, fecha de nacimiento, altura y peso | Si los rellenas |
| Planificación | Menús por semana, platos, fichas de plato, lista de la compra, despensa, texto de menús que pegues para importarlos | Al usar la app |
| Uso de IA | Tipo de petición, resultado, modelo, tokens, coste estimado, fecha y una huella cifrada de la IP (HMAC con clave secreta; no guardamos la IP) | Cada petición de IA |
| Técnicos | Registros del servidor (ruta, código de respuesta, tiempos) sin contenido de tus menús ni de tu perfil | Al usar la web |
| En tu dispositivo | Si no inicias sesión, tus datos se guardan solo en el almacenamiento local de tu navegador y no llegan a nuestros servidores | Sin cuenta |

**Datos de salud [REVISAR]**: las alergias, intolerancias y algunas dietas (p. ej. sin gluten por
celiaquía), y los datos corporales opcionales, pueden considerarse datos relativos a la salud
(art. 9 RGPD). Base prevista: **consentimiento explícito** (art. 9.2.a). Hoy la app no pide ese
consentimiento de forma separada: ver §10, «Pendiente».

## 3. Para qué los usamos y con qué base

| Finalidad | Base jurídica [REVISAR] |
| --- | --- |
| Crear y mantener tu cuenta, sincronizar tus datos entre dispositivos | Ejecución del contrato (art. 6.1.b) |
| Proponer menús, sustituir platos, preparar fichas y listas de la compra teniendo en cuenta tus dietas y alergias | Contrato; para alergias y dietas, consentimiento explícito (art. 9.2.a) |
| Limitar el uso de IA (cuotas, límite por red, presupuesto) y evitar abusos | Interés legítimo (art. 6.1.f) en mantener el servicio sostenible y seguro |
| Seguridad, copias de seguridad y resolución de incidencias | Interés legítimo (art. 6.1.f) |
| Emails de la cuenta (confirmación de alta, recuperación de contraseña) | Contrato |

No vendemos tus datos, no hacemos publicidad ni perfiles comerciales, y no usamos herramientas de
analítica ni cookies de terceros.

## 4. Inteligencia artificial

Cuando pides un menú, una alternativa a un plato, una ficha de plato, una lista de la compra o
importar un menú con IA, enviamos a **OpenAI** lo necesario para esa petición: por ejemplo los platos
de la semana, el número de raciones y **tus dietas, alergias y alimentos que no te gustan**, o el texto
que pegaste. No enviamos tu email, tu nombre ni tus datos corporales [REVISAR: confirmar con cada
ruta antes de publicar]. Las peticiones se hacen con `store: false`. **[REVISAR]** plazos de
conservación de OpenAI para la API (seguridad y abuso) y si aplica «zero data retention».

Los resultados de la IA son orientativos: la información sobre alérgenos es estimada y no sustituye
leer el etiquetado ni el consejo de un profesional sanitario.

## 5. Con quién los compartimos (encargados del tratamiento)

| Proveedor | Servicio | Ubicación | Garantías [REVISAR] |
| --- | --- | --- | --- |
| Supabase | Base de datos y autenticación | UE (Irlanda, eu-west-1) | DPA de Supabase |
| Vercel | Alojamiento de la web y funciones del servidor | EE. UU. y red global | DPA, Cláusulas Contractuales Tipo / Data Privacy Framework |
| OpenAI | Generación con IA | EE. UU. | DPA de OpenAI, Cláusulas Contractuales Tipo / DPF |
| Resend | Envío de emails de la cuenta y alertas técnicas (sin datos de usuarios) | EE. UU. [REVISAR] | DPA de Resend |
| GitHub | Código y comprobaciones automáticas (no contiene datos de usuarios) | EE. UU. | — |

**[DECIDIR]** Firmar o aceptar el DPA de cada proveedor y guardar una copia.

## 6. Cuánto tiempo los conservamos

| Datos | Plazo |
| --- | --- |
| Cuenta, perfil y planificación | Mientras tengas la cuenta. Al eliminarla se borran **al momento y de forma definitiva** |
| Registro de uso de IA | Al eliminar la cuenta se desvincula de ella (sin email ni identificador de usuario) y se conserva para el control de gasto **[DECIDIR plazo, p. ej. 13 meses]**. Mantiene la huella cifrada de la IP **[DECIDIR si se borra antes]** |
| Copias de seguridad | Copias manuales antes de cambios en la base de datos, guardadas fuera del servicio con acceso restringido **[REVISAR cifrado en reposo]**. Tus datos pueden seguir en ellas hasta que caducan: **[DECIDIR plazo, p. ej. 30 días]**. Si se restaurase una copia, volveríamos a borrar las cuentas eliminadas después de esa copia **[DECIDIR procedimiento]** |
| Registros técnicos del servidor | Según el plan de Vercel **[REVISAR]** |
| Datos solo en tu dispositivo | Hasta que los borres del navegador; cerrar sesión borra la copia local de tu cuenta |

## 7. Tus derechos

Puedes ejercerlos en la app o escribiendo a **[email de contacto]**:

- **Acceso y portabilidad**: Perfil → «Tus datos» → «Descargar mis datos» (archivo JSON con tu cuenta,
  perfil, menús, compra, despensa, fichas y registro de IA).
- **Supresión**: Perfil → «Tus datos» → «Eliminar tu cuenta» (escribiendo ELIMINAR).
- **Rectificación**: editando tu perfil y tus datos en la app.
- **Retirar el consentimiento** sobre alergias y dietas: borrándolas del perfil (los menús dejarán de
  tenerlas en cuenta) [REVISAR efecto en semanas ya planificadas con ese contexto].
- **Oposición y limitación**: por email.
- **Reclamar** ante la Agencia Española de Protección de Datos (www.aepd.es).

## 8. Menores

beCook no está dirigido a menores de 14 años. [REVISAR edad y verificación.]

## 9. Seguridad

Acceso a los datos de cada persona limitado por reglas en la base de datos (RLS), claves de servicio
solo en el servidor, IA solo con sesión iniciada y con cuotas, registros sin contenido personal,
detección de secretos en el código y copias de seguridad antes de cada cambio de esquema.

## 10. Pendiente antes de publicar

- [ ] Datos del responsable y email de contacto.
- [ ] Revisión jurídica completa (bases, transferencias, plazos, menores).
- [ ] Consentimiento explícito para alergias y dietas (art. 9): propuesta en
      `docs/development/progress-p37.md` (casilla separada, no premarcada, antes de guardar esas
      secciones; registro de fecha y versión del texto; poder retirarlo).
- [ ] Plazos de conservación del registro de IA y de las copias de seguridad.
- [ ] DPA de Supabase, Vercel, OpenAI y Resend.
- [ ] Página pública y enlace desde el alta y el perfil (no existen todavía).
