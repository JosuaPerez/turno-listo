# Plan de escalado

La versión actual sigue usando el JSON por barbería y un control de revisión en SQLite y D1. El polling público devuelve la revisión y solo escribe en base de datos cuando cambia algo real: un vencimiento, una ausencia automática o un aviso. Las lecturas tienen límite por IP y barbería en cada instancia del Worker. Las mutaciones siguen usando el límite persistente.

## Separar las tablas sin perder turnos

1. Crear una migración aditiva. Mantener en `shops` la configuración, la cuenta y la revisión. Crear `tickets` con `shop_slug`, identificador, posición, estado, sillón, tiempos y los datos del cliente con fecha de expiración. Crear `history` con los eventos anónimos y el precio guardado. Separar los avisos en `notification_outbox`.
2. Copiar por barbería desde el JSON en lotes reiniciables. Mantener el orden y los identificadores actuales para preservar los enlaces de turno. Dejar los turnos vencidos fuera de la copia y borrar sus datos mediante el proceso de retención. No mover secretos de la cuenta a las tablas de turnos.
3. Verificar recuentos, orden de la fila, sillones ocupados y totales de ingresos entre las dos representaciones. Hacer el corte por barbería solo cuando los datos coincidan. Usar transacciones locales y lotes atómicos en D1 para comprobar la revisión y aplicar las escrituras. Añadir un índice único parcial por barbería y sillón para las atenciones activas y por barbería y número para los turnos activos.
4. Mantener la API y el formato de la revisión. Durante la transición, usar una ventana de escritura detenida o un registro de cambios verificable para que ninguna actualización se pierda entre la copia y el corte. Retener el JSON temporalmente para volver atrás. Borrarlo cuando termine la ventana de reversión y se haya verificado el resultado en producción.

## Verificación de la migración

- Probar una copia de D1 con dos barberías, turnos activos, avisos pendientes y servicios con y sin precio.
- Ejecutar las pruebas actuales sin cambiar su contrato. Añadir pruebas de migración idempotente, de concurrencia en cada sillón y de aislamiento entre barberías durante y después del corte.
- Medir lecturas, escrituras, tiempo de respuesta y costo con una carga similar al piloto. Mover el límite de lectura a una regla del perímetro si se necesita un límite global. El rango de espera y el horario pueden cambiar sin aumentar la revisión, así que el cliente también compara esos valores antes de redibujar.
