using System;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Text;

namespace Kubo.Log4Net.Internal
{
    internal enum SendOutcome
    {
        Ok,
        /// <summary>Red, timeout, 5xx, 429: reintentar el mismo lote con espera creciente.</summary>
        Retry,
        /// <summary>401, 403, 404, 407: clave, bloqueo, Url o proxy mal configurados; se corrigen fuera del appender, se reintenta muy espaciado.</summary>
        RetryLater,
        /// <summary>400 o 413: reintentar daría lo mismo, el lote se tira.</summary>
        Drop
    }

    internal interface IBatchSender
    {
        SendOutcome Send(string json, out int retryAfterMs);
    }

    /// <summary>Motivo del último fallo, para que el cliente lo deje en el diagnóstico (LogLog).</summary>
    internal interface IFailureReporter
    {
        string LastFailure { get; }
    }

    internal sealed class HttpBatchSender : IBatchSender, IFailureReporter
    {
        // UTF-8 sin BOM: un BOM al inicio del JSON lo rompe en algunos analizadores.
        private static readonly Encoding Utf8 = new UTF8Encoding(false);
        private readonly ClientOptions _o;

        public HttpBatchSender(ClientOptions o)
        {
            _o = o;
            TlsSetup.EnsureTls12();
        }

        /// <summary>Motivo del último fallo; solo lo escribe y lee el hilo de envío.</summary>
        public string LastFailure { get; private set; }

        public SendOutcome Send(string json, out int retryAfterMs)
        {
            retryAfterMs = 0;
            LastFailure = null;
            HttpWebResponse resp = null;
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(_o.Url);
                req.Method = "POST";
                req.Timeout = _o.TimeoutMs;
                req.ReadWriteTimeout = _o.TimeoutMs;
                req.ContentType = "application/json; charset=utf-8";
                req.Headers["Content-Encoding"] = "gzip";
                req.Headers["X-Kubo-Log-Key"] = _o.ApiKey;
                if (!string.IsNullOrEmpty(_o.Proxy))
                    req.Proxy = new WebProxy(_o.Proxy) { UseDefaultCredentials = true };
                // Después del Proxy: asignarlo vuelve a resolver el ServicePoint y perdería este ajuste.
                req.ServicePoint.Expect100Continue = false;

                byte[] body;
                using (var ms = new MemoryStream())
                {
                    using (var gz = new GZipStream(ms, CompressionMode.Compress, true))
                    {
                        var raw = Utf8.GetBytes(json);
                        gz.Write(raw, 0, raw.Length);
                    }
                    body = ms.ToArray();
                }
                req.ContentLength = body.Length;
                using (var s = req.GetRequestStream())
                    s.Write(body, 0, body.Length);

                resp = (HttpWebResponse)req.GetResponse();
                return MapConMotivo((int)resp.StatusCode, resp, out retryAfterMs);
            }
            catch (WebException ex)
            {
                var er = ex.Response as HttpWebResponse;
                if (er == null)
                {
                    // Sin respuesta: red caída, DNS, rechazo o timeout.
                    LastFailure = "sin respuesta del servidor (" + ex.Status + "): " + ex.Message;
                    return SendOutcome.Retry;
                }
                try { return MapConMotivo((int)er.StatusCode, er, out retryAfterMs); }
                finally { er.Close(); }
            }
            finally
            {
                if (resp != null) resp.Close();
            }
        }

        private SendOutcome MapConMotivo(int status, HttpWebResponse r, out int retryAfterMs)
        {
            var o = Map(status, r, out retryAfterMs);
            if (o != SendOutcome.Ok) LastFailure = "HTTP " + status + CausaProbable(status);
            return o;
        }

        private static string CausaProbable(int status)
        {
            switch (status)
            {
                case 401: return " (clave de ingesta inválida o revocada)";
                case 403: return " (acceso bloqueado, quizá por un firewall o proxy)";
                case 404: return " (la Url no apunta al servidor de logs; revise el parámetro Url)";
                case 407: return " (el proxy exige autenticación)";
                case 429: return " (límite de lotes por minuto)";
                default: return "";
            }
        }

        private static SendOutcome Map(int status, HttpWebResponse r, out int retryAfterMs)
        {
            retryAfterMs = 0;
            if (status >= 200 && status < 300) return SendOutcome.Ok;
            // 401 (clave), 403 (bloqueo), 404 (Url equivocada) y 407 (proxy) son de configuración:
            // reintentar cada segundo no los arregla; se reintenta muy espaciado.
            if (status == 401 || status == 403 || status == 404 || status == 407) return SendOutcome.RetryLater;
            if (status == 400 || status == 413) return SendOutcome.Drop;
            if (status == 429)
            {
                int seg;
                var h = r.Headers["Retry-After"];
                if (h != null && int.TryParse(h.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out seg) && seg > 0)
                    retryAfterMs = seg > 3600 ? 3600000 : seg * 1000;
            }
            // 429, 5xx y cualquier otro código inesperado: lo más seguro es reintentar con espera.
            return SendOutcome.Retry;
        }
    }
}
