/**
 * La misma promesa, pero que se rinde al cabo de un rato.
 *
 * **Por qué existe.** Las dos instancias de axios del proyecto --la del panel y
 * la del portal-- se crean sin `timeout`, así que una petición que no llega a
 * responder nunca no falla: se queda esperando para siempre. En una pantalla que
 * deshabilita sus controles mientras hay algo en vuelo, eso no deja «un botón
 * muerto», deja **la pantalla sin salida**: la única escapatoria es recargar, y
 * recargando se pierde lo que el usuario tuviera escrito. Acotar aquí, y no en
 * la instancia, limita la espera de quien lo pide sin cambiársela a nadie más.
 *
 * **Lo que no hace, y hay que tener presente al usarla: no cancela la
 * petición.** No hay forma de cancelarla sin tocar la instancia compartida, así
 * que cuando esto se rinde la petición puede seguir su curso y llegar a
 * completarse en el servidor. De ahí la regla para quien lo pinte: el mensaje
 * que se le enseñe al usuario **no puede afirmar que no se hizo nada**. Con una
 * respuesta que no llega eso no se sabe, y decir «no se envió» es la forma más
 * directa de provocar el reenvío duplicado -- que en un hilo son dos mensajes
 * iguales, y en una respuesta al cliente, dos correos que no se pueden retirar.
 * Por eso el texto de cara al usuario **no vive aquí**: cada superficie lo tiene
 * en su propia constante, redactado para quien lo lee.
 */
export class TimeoutError extends Error {
  constructor(
    message = 'Se agotó el tiempo de espera. La petición puede haberse completado igualmente: no hay respuesta que lo diga.',
  ) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const alarm = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), ms);
  });
  // `finally` y no `then`: el temporizador se apaga tanto si la petición sale
  // bien como si falla, y sin él queda un `setTimeout` vivo por cada llamada.
  return Promise.race([promise, alarm]).finally(() => clearTimeout(timer));
}
