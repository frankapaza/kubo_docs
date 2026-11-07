using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Kubo.Log4Net.Internal
{
    /// <summary>
    /// JSON escrito a mano: el appender no puede arrastrar dependencias (Newtonsoft, System.Text.Json)
    /// al aplicativo del cliente, que ya trae las suyas en versiones incompatibles.
    /// </summary>
    internal static class KuboJson
    {
        /// <summary>Tope del servidor para mensaje y excepción; recortar aquí evita un 413 por un solo evento.</summary>
        public const int MaxTextChars = 32768;

        private const string MarcaRecorte = "…[recortado]";
        private const string FormatoTs = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";

        public static string Serialize(BatchPayload p)
        {
            var sb = new StringBuilder(256 + p.Eventos.Count * 256);
            sb.Append('{');
            Campo(sb, "loteId", p.LoteId); sb.Append(',');
            Campo(sb, "aplicativo", p.Aplicativo); sb.Append(',');
            Campo(sb, "servidor", p.Servidor); sb.Append(',');
            Campo(sb, "appenderVersion", p.AppenderVersion); sb.Append(',');
            sb.Append("\"descartados\":").Append(p.Descartados.ToString(CultureInfo.InvariantCulture)).Append(',');
            sb.Append("\"eventos\":[");
            for (var i = 0; i < p.Eventos.Count; i++)
            {
                if (i > 0) sb.Append(',');
                EscribirEvento(sb, p.Eventos[i]);
            }
            sb.Append("]}");
            return sb.ToString();
        }

        private static void EscribirEvento(StringBuilder sb, LogEventData e)
        {
            sb.Append('{');
            // Cultura invariante: con es-PE u otras, "." y ":" podrían cambiar de separador.
            Campo(sb, "ts", e.TimestampUtc.ToString(FormatoTs, CultureInfo.InvariantCulture)); sb.Append(',');
            Campo(sb, "nivel", e.Level); sb.Append(',');
            Campo(sb, "logger", e.Logger); sb.Append(',');
            Campo(sb, "mensaje", Truncate(e.Message, MaxTextChars));
            if (e.Exception != null)
            {
                sb.Append(',');
                Campo(sb, "excepcion", Truncate(e.Exception, MaxTextChars));
            }
            if (e.Thread != null)
            {
                sb.Append(',');
                Campo(sb, "hilo", e.Thread);
            }
            sb.Append(",\"propiedades\":{");
            var primero = true;
            if (e.Properties != null)
            {
                foreach (KeyValuePair<string, string> kv in e.Properties)
                {
                    if (!primero) sb.Append(',');
                    primero = false;
                    WriteString(sb, kv.Key);
                    sb.Append(':');
                    WriteString(sb, kv.Value);
                }
            }
            sb.Append("}}");
        }

        private static void Campo(StringBuilder sb, string nombre, string valor)
        {
            sb.Append('"').Append(nombre).Append("\":");
            WriteString(sb, valor);
        }

        /// <summary>Escribe un literal JSON (con comillas). null se escribe como null.</summary>
        public static void WriteString(StringBuilder sb, string value)
        {
            if (value == null)
            {
                sb.Append("null");
                return;
            }
            sb.Append('"');
            for (var i = 0; i < value.Length; i++)
            {
                var c = value[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    default:
                        if (c < 0x20)
                        {
                            Unicode(sb, c);
                        }
                        else if (char.IsHighSurrogate(c) && i + 1 < value.Length && char.IsLowSurrogate(value[i + 1]))
                        {
                            // Par válido: se deja tal cual (UTF-8 lo codifica bien).
                            sb.Append(c).Append(value[i + 1]);
                            i++;
                        }
                        else if (char.IsSurrogate(c))
                        {
                            // Surrogado suelto: no es UTF-8 válido, se escapa para no corromper el cuerpo.
                            Unicode(sb, c);
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }
            sb.Append('"');
        }

        private static void Unicode(StringBuilder sb, char c)
        {
            sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
        }

        /// <summary>
        /// Recorta a <paramref name="max"/> caracteres contando la marca. No parte un par sustituto:
        /// si el corte cae entre las dos mitades de un emoji, retrocede una posición.
        /// </summary>
        public static string Truncate(string s, int max)
        {
            if (s == null || s.Length <= max) return s;
            var corte = max - MarcaRecorte.Length;
            if (corte < 0) corte = 0;
            if (corte > 0 && char.IsHighSurrogate(s[corte - 1])) corte--;
            return s.Substring(0, corte) + MarcaRecorte;
        }
    }
}
