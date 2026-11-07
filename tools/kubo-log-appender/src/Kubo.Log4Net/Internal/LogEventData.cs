using System;
using System.Collections.Generic;

namespace Kubo.Log4Net.Internal
{
    /// <summary>
    /// Copia propia del evento de log4net. Se toma una copia en Append (en el hilo del aplicativo)
    /// porque el LoggingEvent original puede mutar o evaluar propiedades perezosas después, y el
    /// hilo de fondo no debe tocar objetos de log4net.
    /// </summary>
    internal sealed class LogEventData
    {
        public DateTime TimestampUtc;
        public string Level;
        public string Logger;
        public string Message;
        /// <summary>null si el evento no trae excepción.</summary>
        public string Exception;
        /// <summary>null si no hay nombre de hilo.</summary>
        public string Thread;
        /// <summary>Nunca null: el serializador siempre escribe el objeto.</summary>
        public IDictionary<string, string> Properties = new Dictionary<string, string>();
    }
}
