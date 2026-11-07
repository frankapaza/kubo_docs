using System;
using Kubo.Log4Net.Internal;
using log4net.Appender;
using log4net.Core;
using log4net.Util;

namespace Kubo.Log4Net
{
    /// <summary>
    /// Appender de log4net que envía los eventos a la plataforma Kubo. Este mismo fichero compila contra
    /// log4net 2.0.8 (net45) y 3.2.0 (net462 y netstandard2.0): no usa ninguna API que difiera.
    /// Append solo copia el evento y lo encola; el envío lo hace el hilo de fondo del cliente, y
    /// nada de lo que falle aquí llega al aplicativo (los fallos van a LogLog).
    /// </summary>
    public class KuboLogAppender : AppenderSkeleton
    {
        // Mismos topes que impone el servidor: recortar aquí evita lotes rechazados por exceso de tamaño.
        private const int MaxTexto = 32768;
        private const int MaxPropiedades = 50;
        private const int MaxPropiedad = 1024;
        private const string PrefijoInterno = "log4net:";

        private const int MaxBatchSize = 1000;
        private const int BatchSizeDefecto = 200;
        private const int FlushIntervalDefecto = 2000;
        private const int MaxQueueDefecto = 10000;
        private const int TimeoutDefecto = 5000;

        private readonly Func<ClientOptions, IBatchSender> _senderFactory;
        private KuboLogClient _client;

        // Parámetros que log4net rellena desde el XML (el nombre del elemento = el de la propiedad).
        public string Url { get; set; }
        public string ApiKey { get; set; }
        public string Aplicativo { get; set; }
        public int BatchSize { get; set; }
        public int FlushIntervalMs { get; set; }
        public int MaxQueueSize { get; set; }
        public int TimeoutMs { get; set; }
        /// <summary>Opcional: si falta se usa el proxy por omisión del sistema.</summary>
        public string Proxy { get; set; }

        /// <summary>log4net exige un constructor sin parámetros para crearlo desde el XML.</summary>
        public KuboLogAppender() : this(o => new HttpBatchSender(o))
        {
        }

        /// <summary>Para las pruebas: permite sustituir el envío HTTP.</summary>
        internal KuboLogAppender(Func<ClientOptions, IBatchSender> senderFactory)
        {
            _senderFactory = senderFactory;
            BatchSize = BatchSizeDefecto;
            FlushIntervalMs = FlushIntervalDefecto;
            MaxQueueSize = MaxQueueDefecto;
            TimeoutMs = TimeoutDefecto;
        }

        public override void ActivateOptions()
        {
            try
            {
                base.ActivateOptions();

                // Si log4net reactiva las opciones, se cierra el cliente anterior para no dejar un hilo huérfano.
                CerrarCliente();

                if (string.IsNullOrEmpty(Url) || string.IsNullOrEmpty(ApiKey) || string.IsNullOrEmpty(Aplicativo))
                {
                    LogLog.Error(typeof(KuboLogAppender),
                        "Kubo: faltan parámetros obligatorios (Url, ApiKey y Aplicativo); el appender queda inactivo.");
                    return;
                }

                // Un valor absurdo en el XML (0 o negativo) haría girar el hilo sin pausa o esperar para siempre.
                if (BatchSize <= 0) { Avisar("BatchSize", BatchSize, BatchSizeDefecto); BatchSize = BatchSizeDefecto; }
                if (FlushIntervalMs <= 0) { Avisar("FlushIntervalMs", FlushIntervalMs, FlushIntervalDefecto); FlushIntervalMs = FlushIntervalDefecto; }
                if (MaxQueueSize <= 0) { Avisar("MaxQueueSize", MaxQueueSize, MaxQueueDefecto); MaxQueueSize = MaxQueueDefecto; }
                // El servidor rechaza con 413 los lotes de más de 1000 eventos y el cliente descarta los 413: sin tope se perderían logs en silencio.
                if (BatchSize > MaxBatchSize) { LogLog.Warn(typeof(KuboLogAppender), "Kubo: BatchSize=" + BatchSize + " supera el máximo del servidor; se usa " + MaxBatchSize + "."); BatchSize = MaxBatchSize; }
                if (TimeoutMs <= 0) { Avisar("TimeoutMs", TimeoutMs, TimeoutDefecto); TimeoutMs = TimeoutDefecto; }

                TlsSetup.EnsureTls12();

                var opciones = new ClientOptions
                {
                    Url = Url,
                    ApiKey = ApiKey,
                    Aplicativo = Aplicativo,
                    Servidor = Environment.MachineName,
                    AppenderVersion = typeof(KuboLogAppender).Assembly.GetName().Version.ToString(3),
                    BatchSize = BatchSize,
                    FlushIntervalMs = FlushIntervalMs,
                    MaxQueueSize = MaxQueueSize,
                    TimeoutMs = TimeoutMs,
                    Proxy = Proxy
                };
                _client = new KuboLogClient(opciones, _senderFactory(opciones), Diagnostico);
            }
            catch (Exception ex)
            {
                // ActivateOptions corre en la configuración del aplicativo: jamás debe tumbarla.
                LogLog.Error(typeof(KuboLogAppender), "Kubo: no se pudo activar el appender", ex);
                _client = null;
            }
        }

        protected override void Append(LoggingEvent loggingEvent)
        {
            try
            {
                var c = _client;
                if (c == null || loggingEvent == null) return;
                c.Enqueue(Copiar(loggingEvent));
            }
            catch (Exception ex)
            {
                LogLog.Error(typeof(KuboLogAppender), "Kubo: fallo al copiar el evento", ex);
            }
        }

        protected override void OnClose()
        {
            try
            {
                CerrarCliente();
            }
            catch (Exception ex)
            {
                LogLog.Error(typeof(KuboLogAppender), "Kubo: fallo al cerrar", ex);
            }
            base.OnClose();
        }

        /// <summary>IFlushable de log4net: envía lo pendiente y espera hasta el tope. true si la cola quedó vacía.</summary>
        public override bool Flush(int timeoutMs)
        {
            var c = _client;
            return c == null || c.Flush(timeoutMs);
        }

        private void CerrarCliente()
        {
            var c = _client;
            _client = null;
            if (c != null) c.Dispose();
        }

        /// <summary>
        /// Copia el evento en el hilo del aplicativo: el LoggingEvent evalúa perezosamente el contexto
        /// (ThreadContext, propiedades) y el hilo de fondo ya no vería lo mismo.
        /// </summary>
        private static LogEventData Copiar(LoggingEvent e)
        {
            var d = new LogEventData
            {
                // TimeStamp es hora local: sin convertir, el servidor leería la hora de Lima como UTC.
                TimestampUtc = e.TimeStamp.ToUniversalTime(),
                Level = e.Level != null ? e.Level.Name : "INFO",
                Logger = e.LoggerName,
                Message = Recortar(e.RenderedMessage, MaxTexto),
                Exception = Recortar(e.GetExceptionString(), MaxTexto),
                Thread = e.ThreadName
            };
            // Cadena vacía = sin excepción: el serializador omite el campo solo si es null.
            if (string.IsNullOrEmpty(d.Exception)) d.Exception = null;

            var props = e.GetProperties();
            if (props != null)
            {
                // GetKeys + indexador: la enumeración directa devuelve DictionaryEntry en 2.0.8 y
                // KeyValuePair en 3.x; así el mismo código sirve para las dos.
                foreach (var clave in props.GetKeys())
                {
                    if (d.Properties.Count >= MaxPropiedades) break;
                    var v = props[clave];
                    if (string.IsNullOrEmpty(clave) || clave.StartsWith(PrefijoInterno, StringComparison.Ordinal)) continue;
                    // Nunca null: el contrato de ingesta espera cadenas y un null rompería el JSON.
                    var valor = v == null ? "" : (v.ToString() ?? "");
                    d.Properties[Recortar(clave, MaxPropiedad)] = Recortar(valor, MaxPropiedad);
                }
            }
            return d;
        }

        private static string Recortar(string s, int max)
        {
            if (s == null) return null;
            return s.Length <= max ? s : s.Substring(0, max);
        }

        private static void Avisar(string nombre, int valor, int defecto)
        {
            LogLog.Warn(typeof(KuboLogAppender),
                "Kubo: " + nombre + "=" + valor + " no es válido; se usa " + defecto + ".");
        }

        /// <summary>Los fallos del cliente llegan a la salida interna de log4net, que es donde el equipo del aplicativo los ve.</summary>
        private static void Diagnostico(string mensaje, Exception ex)
        {
            if (ex != null) LogLog.Error(typeof(KuboLogAppender), mensaje, ex);
            else LogLog.Warn(typeof(KuboLogAppender), mensaje);
        }
    }
}
