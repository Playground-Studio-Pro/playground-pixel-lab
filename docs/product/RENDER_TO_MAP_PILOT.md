# Del render aprobado al mapa y al contenido
Propuesta de Miguel para revisión de Claudio y Codex. Decisión pendiente de Miguel. El alcance de este PR es documentación.

## Qué queremos validar
Que el mapper pueda convertir el escenario aprobado en un proyecto editable más rápido que con su método actual, y que el diseñador pueda producir un loop utilizable con ese mismo proyecto. El equipo de producción que encarga ambos entregables es un posible comprador. La señal comercial sería que pida repetirlo en un próximo show y acepte discutir un piloto de pago.

## Recorrido propuesto
1. Importar el render aprobado. Proponer superficies superpuestas que el operador pueda añadir, borrar, renombrar y corregir. Una perspectiva por sí sola deja las medidas pendientes.
2. Vincular el constructivo acotado. Ejemplo de prueba: central de 6 × 3 m y dos lágrimas de 1.5 × 3 m. Mostrar la cota de origen y pedir confirmación ante ambigüedades o discrepancias.
3. El mapper confirma el modelo de cabinet, filas y columnas. La resolución sale de los píxeles por cabinet y la cantidad instalada. El mapper revisa posiciones físicas, composición de contenido y asignación a la salida por separado. Las correcciones en montaje se reflejan en una nueva exportación.
4. Entregar el proyecto editable, la test card y una plantilla con nombres, dimensiones y coordenadas exactas. El diseñador comprueba en la vista de escenario que una onda pasa de la central a los laterales y que el logo permanece en la central. Verificar el archivo exportado contra el mapa confirmado.
5. Evaluar una API de generación después de validar el flujo. El proveedor generaría material visual. Pixel conservaría geometría, máscaras y composición, y el flujo manual seguiría disponible offline.

## Piloto de un show
Miguel selecciona un show terminado con render, constructivo y mapa final de referencia. Reservar el mapa final para la evaluación. Observar cómo un mapper resuelve el mismo brief con su método habitual y con una propuesta editable que puede prepararse a mano para el primer ensayo. Registrar tiempos, correcciones, ayuda verbal y errores por pantalla. La prueba de ocho pantallas en dos minutos sigue siendo una medida independiente de velocidad de la interfaz.

Dar al diseñador únicamente el paquete que recibiría en producción. Pedirle un loop continuo con el logo en la central y registrar las preguntas que tenga que devolver a producción. Comparar dimensiones y posiciones de salida con el mapa final, documentando cualquier diferencia intencional. Proponer una segunda prueba si el mapper ahorra tiempo, el paquete queda correcto al píxel y el diseñador entrega el loop sin reconstruir el layout. Preguntar quién aprobaría pagar la prueba en el siguiente show.

## Revisión compartida
Claudio, como Lead Architect, contrasta esta propuesta con el handoff local más reciente, [SESSION](../../SESSION.md), [WORKFLOW](WORKFLOW.md) y el [roadmap](ROADMAP.md). Identifica qué se puede demostrar con Mapping Studio, resolveMapping y los exports actuales, el mínimo que habría que simular y qué evidencia cambiaría tu recomendación. Devuelve en este PR tus acuerdos, objeciones, una alternativa si aplica y el reparto mínimo por agente.

Codex contrasta la propuesta técnica con los criterios del piloto y consolida con Claudio una sola recomendación en este PR. Miguel decide el alcance antes de asignar implementación o integrar cambios. La revisión puede avanzar durante la validación física de Alpha 0.1. Cada agente conserva su encargo vigente.
