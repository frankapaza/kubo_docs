namespace Kubo.Log4Net.Internal
{
    /// <summary>
    /// Parámetros ya resueltos del cliente de envío. Los valores por omisión son los del plan;
    /// el appender los pisa con lo que el cliente configure en log4net.config.
    /// </summary>
    internal sealed class ClientOptions
    {
        public string Url;
        public string ApiKey;
        public string Aplicativo;
        public string Servidor;
        public string AppenderVersion;
        public int BatchSize = 200;
        public int FlushIntervalMs = 2000;
        public int MaxQueueSize = 10000;
        public int TimeoutMs = 5000;
        /// <summary>Opcional; si es null se usa el proxy por omisión del sistema.</summary>
        public string Proxy;
        public int ShutdownTimeoutMs = 3000;
        /// <summary>
        /// Tope de caracteres del cuerpo JSON de un lote. El servidor rechaza con 413 por encima
        /// de 2 MB descomprimido; 1,5 M deja margen (UTF-8 puede ocupar más de un byte por carácter).
        /// </summary>
        public int MaxBatchChars = 1500000;
    }
}
