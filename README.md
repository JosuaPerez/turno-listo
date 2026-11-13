# Turno Listo

Fila web para barberías que atienden por llegada. El barbero abre el panel en el celular. Los clientes usan un enlace o escanean el QR de la barbería para anotarse, ver su turno y salirse.

## Ejecutar en Windows

1. Instala Node.js 22.13 o posterior. El servidor y el build no requieren instalar dependencias de npm.
2. Ejecuta `node server.mjs` o abre **Iniciar demo.cmd**.
3. Abre http://localhost:8787/barbero, crea tu barbería y entra al panel. En **Enlace y QR de la barbería**, descarga el PNG. Si escaneas un QR que apunta a `localhost`, solo funcionará en ese mismo equipo. Para un piloto, usa el QR de la URL HTTPS desplegada.

Usa `npm test` para el servidor, `npm run test:browser` para Playwright y `npm run test:all` para ambas. `node --test` pasa en un clon sin dependencias y omite el navegador si no está disponible. Para habilitarlo ejecuta `npm ci` y `npx playwright install chromium`. La prueba busca primero `TURNO_BROWSER_EXECUTABLE`, luego Edge instalado en Windows y finalmente Chromium de Playwright.

`node build.mjs` prepara el Worker. SQLite local aplica las migraciones de `drizzle/` al arrancar. Para una cuenta local de prueba, configura `DEMO_EMAIL`, `DEMO_PASSWORD` (12 caracteres o más) y, opcionalmente, `DEMO_NAME` y `DEMO_SLUG`. Después ejecuta `node seed.mjs`.

## Configuración

| Variable | Uso |
|---|---|
| `PORT`, `TURNO_HOST`, `TURNO_DATA` | Puerto, interfaz de red y directorio SQLite del servidor local. Por defecto se escucha en 127.0.0.1:8787. |
| `TURNO_INVITE` | Código de registro. Obligatorio en el Worker para habilitar altas. En Node local, si se omite, el registro sigue disponible. |
| `TURNO_PASSWORD_PEPPER` | Secreto aleatorio, estable y separado de D1. Obligatorio en el Worker. Respáldalo en un gestor de contraseñas. Si lo pierdes, las contraseñas de todas las cuentas del Worker quedan bloqueadas hasta que se restablezcan. |
| `TURNO_RATE_SALT` | Valor aleatorio para derivar las claves del límite de peticiones. Configúralo en producción. |
| `TURNO_MAINTENANCE_KEY` | Clave para invocar `POST /api/v1/maintenance` con `Authorization: Bearer …` desde un planificador. |
| `WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_API_VERSION` | Credenciales e identificador de un remitente de WhatsApp Business Cloud API y versión Graph (formato `vXX.X`). |
| `WA_TEMPLATE_SOON`, `WA_TEMPLATE_CALLED`, `WA_LANGUAGE` | Nombres de las dos plantillas aprobadas, sin parámetros, y código de idioma exacto (por defecto `es`). |

Sin credenciales de Meta se muestran enlaces de WhatsApp con el mensaje listo. El barbero debe pulsar **Enviar** en WhatsApp y puede marcar el aviso como enviado en el panel. Las plantillas automáticas deben contener “Te toca en ~15 min, ve saliendo hacia la barbería” y “Es tu turno, pasa por favor”. Si la API rechaza un aviso, aparece la opción manual. La entrega automática necesita un remitente y plantillas aprobadas. El modo automático utiliza el remitente configurado por el operador, compartido por esta instalación.

## Despliegue

En Sites se usa el Worker de `dist/server/index.js` y un binding D1 llamado `DB`. Aplica las migraciones en orden y configura las variables como secretos. En otro despliegue de Cloudflare, vincula D1 y configura un Cron Trigger cada minuto para el handler `scheduled`. En Sites puedes usar `.github/workflows/maintenance.yml` cuando la URL sea pública. En GitHub, agrega los secretos `TURNO_URL` (origen HTTPS) y `TURNO_MAINTENANCE_KEY`, y activa la variable de repositorio `MAINTENANCE_ENABLED=true` solo cuando corresponda. GitHub ejecuta el cron cada 5 minutos o más y no garantiza puntualidad. Los schedules de repositorios públicos se desactivan tras 60 días sin actividad. El sitio privado mantiene el workflow apagado. El servidor Node local ejecuta mantenimiento cada 30 segundos. El vencimiento de 24 horas también se aplica cada vez que alguien abre esa fila. El planificador hace que la limpieza y los avisos ocurran aunque no haya nadie conectado.

Al actualizar la demo anterior se descarta su fila de ejemplo y se crea una cuenta desde el panel. Cada barbería tiene un enlace `/b/su-nombre` y su cuenta usa correo y contraseña. La contraseña se guarda con PBKDF2-SHA256 y sal aleatoria. Node local usa 600 000 iteraciones sin secreto adicional. El Worker usa HMAC-SHA256 con un secreto del servidor antes de PBKDF2 con 100 000 iteraciones, el límite de su entorno. Las sesiones caducan a los siete días.

## Decisiones del MVP

- Se llama al siguiente y, cuando llega, se toca **Empezar corte**. Así el tiempo de llegada se registra aparte. Tras tres servicios del mismo tipo en el mismo sillón, la estimación usa el promedio de hasta los últimos 12 servicios.
- La espera se expresa en rangos de 5 minutos. En fila común, se simula el siguiente sillón libre. En fila por barbero, el cálculo usa el sillón elegido.
- El horario usa días seleccionados y una franja diaria en hora de Santo Domingo. El barbero puede pausar la recepción en cualquier momento. Las personas que ya están anotadas conservan su lugar.
- El cliente puede guardar su enlace personal para recuperar la reserva en otro dispositivo. El identificador se elimina de la barra de dirección después de abrirlo. Los nombres y teléfonos no se muestran en la vista de otros clientes. Los datos se eliminan al salir, al pedir su borrado o al cumplir 24 horas en la fila. Las métricas conservan eventos sin nombre ni teléfono. El plazo de limpieza en segundo plano depende del intervalo de mantenimiento.
- El resumen semanal cuenta desde el lunes. «Ausencias» cuenta cada vez que se marca una ausencia. Si el cliente vuelve al final y falta otra vez, cuenta otra ausencia.

## Recuperar una cuenta

El operador puede generar un enlace que vence a los 30 minutos con `node reset.mjs correo@ejemplo.com`. En producción, envía `POST /api/v1/admin/reset` con un cuerpo JSON que incluya `email` y autorización Bearer con el valor de `TURNO_MAINTENANCE_KEY`. El origen del enlace usa `TURNO_PUBLIC_ORIGIN` si está configurado. Entrégalo únicamente al titular por un canal que ya conozcas.

El servidor guarda el hash del token y, al usarlo, anula las sesiones y los otros enlaces de recuperación de esa cuenta. Más adelante, un proveedor de correo o WhatsApp puede entregar el enlace tras confirmar la titularidad del canal. El formulario público debería dar la misma respuesta exista o no la cuenta.
Los ingresos son una estimación, no un registro de cobros. Al terminar un corte se guarda el precio configurado en ese momento. Los turnos sin precio y las ausencias quedan fuera de la suma. Si ningún corte del período tiene precio, se omite el total. La espera promedio de hoy mide desde que el cliente se anota hasta que lo llaman.

El plan para separar el JSON de cada barbería en tablas está en [docs/escalado.md](docs/escalado.md). La consulta pública usa un límite en memoria por instancia, y la revisión evita redibujar una fila que no cambió. El reloj y los rangos se comparan aparte.

Consulta [la guía de la API v1](docs/api.md) para usar Turno Listo desde un cliente propio.

El sonido de nuevos turnos se activa después de tocar el panel y se puede apagar por dispositivo en Ajustes > Cuenta. Safari en iPhone no admite vibración web.

El panel se puede instalar desde Ajustes > Cuenta en un navegador compatible. El service worker usa caché versionada para el shell y red primero para HTML, CSS y scripts. Las solicitudes de la API y enlaces de turno con `?t=` quedan fuera de la caché. Para regenerar los iconos, instala las dependencias de prueba y ejecuta `node generate-icons.mjs`.

Con varios barberos, el cliente puede elegir uno o pedir el primero disponible según el modo de fila. La espera se estima por barbero y la elección puede cambiarse sin volver al final. El enlace manual de WhatsApp incluye el barbero o indica el primero disponible.

Los turnos de primera visita pueden sumar 0–15 minutos y mostrar una promo. No se usan para aprender la duración habitual. Nombre, WhatsApp, servicio y barbero solo se guardan para reutilizar en el dispositivo si el cliente marca «Recordarme»; la nota no se guarda en el dispositivo.
