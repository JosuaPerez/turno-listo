# API de Turno Listo

Base: `/api/v1`. Las rutas antiguas `/api/…` siguen respondiendo igual y llevan `Deprecation: true`. Todas las respuestas de API llevan `X-Turno-API: 1`. Las rutas de esta guía son relativas a la base.

Envía JSON para los POST. Los errores se devuelven como `{"error":"mensaje"}`; una ruta inexistente devuelve `404` y los métodos no admitidos devuelven `405` donde aplica. Los POST con un `Origin` distinto del sitio se rechazan con `403`, salvo cuando usan la credencial Bearer admitida por esa ruta. **CORS no está habilitado.** Una app nativa puede usar la API; una web alojada en otro origen no está soportada. Un Sites privado exige también acceso a Sites.

## Autenticación

- **Web.** El registro y el login fijan la cookie de sesión HttpOnly. El navegador la envía al mismo origen.
- **Apps.** Envía `"token":true` al registrarte o iniciar sesión para recibir también `token` y `expires` (milisegundos Unix). Usa `Authorization: Bearer <token>` en agenda y logout. Es la misma sesión, dura siete días y se revoca al cerrar sesión o restablecer la contraseña. Guarda el token de forma segura y evita pasarlo por URL.
- **Cliente en la fila.** El alta devuelve un token de turno. Envíalo como `X-Turno-Token` para consultar tu posición, salir o borrar tus datos. Este token solo sirve para ese turno, no para el panel. Un token de sesión del barbero no sustituye al token de turno.
- **Operador.** Mantenimiento y emisión de enlaces de recuperación requieren el secreto de mantenimiento como Bearer. La sesión del barbero no da ese permiso.

## Endpoints

| Método y ruta | Autenticación | Cuerpo | Éxito | Errores típicos |
| --- | --- | --- | --- | --- |
| `POST /auth/register` | Invitación si está configurada; obligatoria en el Worker | `slug`, `name`, `email`, `password`, `invite` si se exige, `token` opcional | `200` con `ok`, `slug`, cookie y, si se pidió, `token`, `expires` | `400` datos inválidos, `403` invitación incorrecta, `409` conflicto, `429` límite, `503` deshabilitado |
| `POST /auth/login` | Correo y contraseña | `email`, `password`, `token` opcional | `200` con `ok`, `slug`, cookie y, si se pidió, `token`, `expires` | `400` datos inválidos, `401` credenciales incorrectas, `429` límite |
| `POST /auth/logout` | Cookie o Bearer | Sin cuerpo requerido | `200` con `ok`; revoca la sesión indicada | `401` Bearer malformado |
| `GET /agenda` | Cookie o Bearer de barbero | — | `200` con fila, sillones, avisos, ajustes y estadísticas de su barbería | `401` sesión inválida, vencida o ausente |
| `POST /agenda` | Cookie o Bearer de barbero | `action` y campos según la acción (ver abajo) | `200` con la agenda actualizada | `400` acción o campos inválidos, `401` sesión inválida, `409` estado en conflicto |
| `GET /b/{slug}/estado` o `GET /b/{slug}/fila` | Pública; `X-Turno-Token` opcional | — | `200` con revisión, estado, rango de espera, servicios y `own` si corresponde | `401` si se intenta usar Bearer, `404` barbería inexistente, `429` límite |
| `POST /b/{slug}/fila` | Pública para `join`; `X-Turno-Token` para `leave` o `erase` | `action:"join"`, `name`, `phone`, `serviceId`, `consent:true`, `chairId` si hay fila por sillón. Para salir o borrar basta `action`. | `200` con estado público y token propio al anotarse | `400` campos inválidos, `401` Bearer no admitido, `403` falta token para borrar, `404` barbería inexistente, `409` fila cerrada, duplicado o turno no disponible, `429` límite |
| `POST /admin/reset` | Bearer de mantenimiento | `email` | `200` con `link`, `expires`; vence en 30 minutos | `400` correo inválido, `404` sin permiso o cuenta inexistente |
| `POST /auth/reset` | Token del enlace de recuperación | `token`, `password` nueva de 12 a 128 caracteres | `200` con `ok`; revoca las sesiones de esa cuenta | `400` datos inválidos, `410` enlace vencido o usado, `429` límite |
| `POST /maintenance` | Bearer de mantenimiento | Sin cuerpo requerido | `200` con `ok` | `404` sin permiso, `500` fallo interno |

Acciones de agenda: `toggle` y `qr-shared` sin campos extra; `add` con `name`, `serviceId`, `phone` opcional y `chairId` si corresponde; `next` con `chairId`; `start` y `finish` con `chairId` e `id` del turno; `no-show` con esos campos y `disposition:"back"` o `"remove"`; `remove` y `notice-done` con `id` del turno o aviso, respectivamente. `settings` recibe `name`, `phone`, `services` (elementos con `id`, `name`, `minutes`, `price` opcional), `chairs` (elementos con `id`, `name`), `mode`, `hours` (`enabled`, `from`, `to`, `days`), `noShowMinutes` y `autoSkip`.

## Límites

Por IP: login, **10 en 15 min** en ambos modos; registro, **4 en 15 min**; restablecimiento, **8 en 15 min**. Por IP y barbería: **20 cambios por minuto** en la fila pública y **300 lecturas por minuto** por instancia del Worker. Si se supera un límite, espera antes de reintentar.

## Ejemplos con curl

Usa una instalación local para estos ejemplos. Sustituye los campos de ejemplo y añade `invite` si corresponde. En la app, conserva el `token` que devuelve el login. El `chairId` de ejemplo es el del sillón inicial.

```sh
BASE=http://localhost:8787/api/v1
curl --json '{"slug":"mi-barberia","name":"Mi barbería","email":"dueno@example.test","password":"<contraseña de 12 caracteres o más>"}' "$BASE/auth/register"
curl --json '{"email":"dueno@example.test","password":"<contraseña>","token":true}' "$BASE/auth/login"

# TOKEN es el valor devuelto por el login, guardado solo en esta sesión.
curl -H "Authorization: Bearer $TOKEN" "$BASE/agenda"
curl --json '{"action":"join","name":"Cliente de prueba","phone":"8095550101","serviceId":"corte","consent":true}' "$BASE/b/mi-barberia/fila"
curl -H "Authorization: Bearer $TOKEN" --json '{"action":"next","chairId":"principal"}' "$BASE/agenda"
```

`finish-next` recibe `chairId` e `id` del corte en curso. Registra su duración real y llama al siguiente turno elegible en una sola actualización de la fila. Si no hay turno elegible, solo termina. Devuelve `409` si el corte ya cambió.

`pause` recibe `chairId` y `minutes` (5, 10 o 15); `resume` recibe `chairId`. El sillón debe estar libre. `reorder` recibe `id`, `direction` (`up`, `down`, `first`) y la `revision` que vio el panel. Devuelve `409` si la fila cambió y `400` si no se puede mover en esa dirección. Subir, bajar y pasar primero cambian el orden de la fila completa, respetando el barbero asignado.

`chairId` en `join` es opcional en `shared` (vacío o `any` para cualquiera), y obligatorio en `individual` con varios barberos. El estado público agrega `chairs[].specialty`, `state`, `range` y `anyRange`. `reassign` recibe `chairId` y `revision`; desde agenda también `id`, desde fila requiere `X-Turno-Token`. Mantiene el lugar original.

`join` acepta `firstVisit` y `note` (120 caracteres); `own` muestra únicamente los del titular. `settings` acepta `firstVisitExtra` (0–15) y `firstVisitMessage` (100 caracteres). El historial de cortes guarda el indicador de primera visita, sin nota ni contacto.
