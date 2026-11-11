# Turno Listo

Demo para una barbería de Santo Domingo con una fila compartida entre la vista del cliente y el panel del barbero.

## Abrir la demo en Windows

1. Extrae el ZIP en una carpeta. Necesitas Node.js 22 o posterior.
2. Haz doble clic en **Iniciar demo.cmd**. Mantén abierta esa ventana mientras usas la demo.
3. Abre http://localhost:8787/barbero y entra con la clave que muestra la ventana. Abre http://localhost:8787 en otra pestaña para ver lo que verá un cliente.

## Mostrar el flujo

1. En el panel, agrega a Luis con 25 minutos y toca **Llamar al siguiente**. Agrega a Juan con otros 25 minutos.
2. En la vista del cliente, toca **Actualizar** o espera hasta 15 segundos. Aparecerá que hay gente en turno y una espera aproximada.
3. Termina el turno actual, llama al siguiente y termina ese turno. Cuando la fila se vacíe, la vista del cliente dirá **Puedes pasar**.
4. Pausa y reabre la recepción para mostrar cómo se controla la disponibilidad. En **Ajustes de la barbería**, puedes poner el WhatsApp del negocio para activar el botón de contacto.

La fila y la clave se guardan en la carpeta local `.data`. La vista de clientes muestra el estado, la cantidad en espera y la estimación sin mostrar nombres. El botón de WhatsApp abre un mensaje para que el cliente lo envíe.

La demo incluida se abre en el equipo donde la inicias. Para que los clientes puedan consultar desde sus propios celulares fuera de esa red, hace falta alojar la aplicación y habilitar el acceso a la vista pública.
