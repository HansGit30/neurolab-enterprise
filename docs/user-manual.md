# Manual de usuario

## Inicio (M01)
Muestra tus proyectos, entrenamientos activos, versiones de modelo, actividad de 14 días y alertas
(entrenamientos fallidos, modelos pendientes de revisión). Se actualiza solo mientras hay trabajos.

## Proyectos (M02)
*Nuevo proyecto* (administradores y responsables): nombre, descripción, problema a resolver y
etiquetas. Dentro, la pestaña **Contexto** permite editar la documentación, cambiar el estado
(activo/en pausa/archivado), asignar miembros por correo con su rol y seguir el **flujo guiado**
de 7 pasos.

## Fundamentos (M03) y Familias de redes
Laboratorio de una neurona: mueve entradas, pesos y sesgo y cambia la activación para ver
z = Σwᵢxᵢ + b y y = f(z). Incluye estructura en capas, cómo aprende la red, el equivalente en Keras
y un glosario. *Familias de redes* explica Feedforward, RNN, CNN y GAN con casos de uso y reglas.

## Diseñador (M04)
1. Elige la familia. 2. Ajusta la forma de entrada. 3. Agrega capas desde el panel izquierdo (se
insertan tras la seleccionada; la última es la salida). 4. Edita unidades, activación, filtros,
etc. en *Propiedades*. 5. El *Resumen* muestra parámetros, forma de salida, errores y advertencias
calculados por el servidor. 6. *Guardar arquitectura* con una justificación. Guardar con el mismo
nombre crea una nueva versión.

## Datasets (M05)
*Agregar dataset → Demo sintético* (lunas, círculos, espiral, XOR, seno, secuencias, imágenes 8×8,
anillo para GAN) o *Subir CSV* (columnas numéricas + objetivo; si es texto o pocos enteros se trata
como clasificación). Vista previa: dispersión, secuencias o imágenes. Eliminar borra el archivo
pero conserva el registro para la trazabilidad.

## Entrenamientos (M06)
*Nuevo entrenamiento*: arquitectura, dataset, épocas, batch, optimizador, tasa de aprendizaje,
semilla y early stopping. La página del trabajo muestra estado, época, pérdida y métricas en vivo,
la consola del worker y la trazabilidad. Puedes cambiar de pantalla: el entrenamiento continúa.
*Cancelar* envía una solicitud que el worker confirma; *Reintentar* crea un trabajo nuevo igual.

**Red neuronal en vivo.** En la página del entrenamiento, cada columna es una capa (Entrada, H1, H2…,
Salida) con su número de neuronas y función de activación. Cada círculo es una neurona con su
activación real para la muestra elegida; las líneas son los pesos (cian positivos, naranja negativos,
grosor según magnitud) y los pulsos muestran por dónde viaja la señal. Los datos se leen del modelo de
TensorFlow durante el entrenamiento (hasta 60 instantáneas, más los pesos iniciales).
- **Paso a paso** (por defecto): la muestra entra por la capa de Entrada y las señales viajan como esferas hacia H1; al llegar, cada neurona de H1 se enciende con su valor (Σ peso·señal + sesgo, después de la activación) y envía sus señales a H2, y así hasta la Salida, que marca la predicción. Un recuadro explica cada paso y dice si la red acertó. Velocidad 0.5×, 1× o 2×.
- **Flujo continuo**: todas las señales a la vez.
- *Ver cómo aprendió*: reproduce las épocas desde los pesos aleatorios hasta el final.
- Elige otra muestra para ver cómo cambia el recorrido y qué responde la salida.
- Pasa el cursor o haz clic en una neurona: activación, sesgo y las entradas que más aportan (peso × señal).
- Con más de 32 neuronas por capa se muestra una selección fija; en CNN cada nodo es un filtro y en
  RNN una unidad (las conexiones se resumen como promedio).

## Evaluación (M07)
Al terminar: métricas de prueba, matriz de confusión (clasificación), R² (regresión) o muestras
generadas vs reales (GAN). *Comparar* superpone curvas de hasta 6 ejecuciones completadas.

## Modelos (M08)
Cada entrenamiento completado crea una versión inmutable (borrador) con SHA-256. Revisores y
responsables la marcan *Revisado* y luego *Aprobado* (quien la entrenó no puede aprobarla). Solo el
responsable puede *Retirar*. Descarga `.keras` para usarla con `keras.models.load_model`.

## Reportes (M09) e Historial
*Informe del proyecto* → *Exportar PDF*. En **Historial**: CSV de entrenamientos y auditoría del
proyecto (responsables y revisores). En cada entrenamiento: *Métricas CSV*.

## Administración (M10)
Usuarios y roles globales, activar/deshabilitar cuentas, límites de recursos, familias
habilitadas, rol por defecto de las nuevas cuentas, retención, auditoría global y salud del sistema.
