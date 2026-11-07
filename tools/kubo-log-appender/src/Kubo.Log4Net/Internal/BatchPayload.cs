using System.Collections.Generic;

namespace Kubo.Log4Net.Internal
{
    /// <summary>
    /// Un lote tal como viaja al servidor. LoteId es el mismo en cada reintento del mismo lote
    /// (el servidor lo usa para no contar dos veces las ocurrencias); Descartados son los
    /// eventos que la cola llena tiró desde el último envío.
    /// </summary>
    internal sealed class BatchPayload
    {
        public string LoteId;
        public string Aplicativo;
        public string Servidor;
        public string AppenderVersion;
        public long Descartados;
        public IList<LogEventData> Eventos = new List<LogEventData>();
    }
}
