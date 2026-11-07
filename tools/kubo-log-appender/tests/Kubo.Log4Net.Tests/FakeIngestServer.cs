using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace Kubo.Log4Net.Tests
{
    internal sealed class FakeRequest
    {
        public string RequestLine;
        public Dictionary<string, string> Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        /// <summary>Ya descomprimido si la petición venía con Content-Encoding: gzip.</summary>
        public string Body;
    }

    /// <summary>
    /// Servidor HTTP mínimo sobre TcpListener en loopback (HttpListener exige reservar URL en Windows).
    /// Una conexión por petición (Connection: close): suficiente y evita estados de keep-alive.
    /// </summary>
    internal sealed class FakeIngestServer : IDisposable
    {
        private sealed class Respuesta { public int Status; public string RetryAfter; }

        private readonly TcpListener _listener;
        private readonly object _gate = new object();
        private readonly List<FakeRequest> _requests = new List<FakeRequest>();
        private readonly Queue<Respuesta> _respuestas = new Queue<Respuesta>();
        private readonly ManualResetEvent _stop = new ManualResetEvent(false);
        private readonly int _port;

        /// <summary>Código para cuando la cola de respuestas está vacía (por omisión 202).</summary>
        public volatile int DefaultStatus = 202;
        /// <summary>Retraso antes de responder; simula un servidor colgado.</summary>
        public volatile int DelayMs;

        public FakeIngestServer()
        {
            _listener = new TcpListener(IPAddress.Loopback, 0);
            _listener.Start();
            _port = ((IPEndPoint)_listener.LocalEndpoint).Port;
            var t = new Thread(AcceptLoop) { IsBackground = true, Name = "FakeIngestAccept" };
            t.Start();
        }

        public string BaseUrl { get { return "http://127.0.0.1:" + _port; } }
        public string Url { get { return BaseUrl + "/api/v1/ingest/logs"; } }

        public void Enqueue(int status, string retryAfter = null)
        {
            lock (_gate) _respuestas.Enqueue(new Respuesta { Status = status, RetryAfter = retryAfter });
        }

        public IList<FakeRequest> Requests
        {
            get { lock (_gate) return new List<FakeRequest>(_requests); }
        }

        public bool WaitForRequests(int n, int timeoutMs)
        {
            var fin = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            while (DateTime.UtcNow < fin)
            {
                lock (_gate) if (_requests.Count >= n) return true;
                Thread.Sleep(10);
            }
            lock (_gate) return _requests.Count >= n;
        }

        private void AcceptLoop()
        {
            while (true)
            {
                TcpClient c;
                try { c = _listener.AcceptTcpClient(); }
                catch { return; }
                var t = new Thread(() => Atender(c)) { IsBackground = true };
                t.Start();
            }
        }

        private void Atender(TcpClient c)
        {
            try
            {
                using (c)
                {
                    var s = c.GetStream();
                    var req = Leer(s);
                    if (req == null) return;
                    Respuesta r;
                    lock (_gate)
                    {
                        _requests.Add(req);
                        r = _respuestas.Count > 0 ? _respuestas.Dequeue() : new Respuesta { Status = DefaultStatus };
                    }
                    var delay = DelayMs;
                    if (delay > 0 && _stop.WaitOne(delay)) return;
                    var cuerpo = Encoding.ASCII.GetBytes("{}");
                    var sb = new StringBuilder();
                    sb.Append("HTTP/1.1 ").Append(r.Status).Append(" X\r\n");
                    if (r.RetryAfter != null) sb.Append("Retry-After: ").Append(r.RetryAfter).Append("\r\n");
                    sb.Append("Content-Type: application/json\r\nContent-Length: ").Append(cuerpo.Length).Append("\r\nConnection: close\r\n\r\n");
                    var cab = Encoding.ASCII.GetBytes(sb.ToString());
                    s.Write(cab, 0, cab.Length);
                    s.Write(cuerpo, 0, cuerpo.Length);
                    s.Flush();
                }
            }
            catch { /* el cliente pudo cortar por timeout: no es un fallo de la prueba */ }
        }

        private static FakeRequest Leer(Stream s)
        {
            var req = new FakeRequest();
            req.RequestLine = Linea(s);
            if (req.RequestLine == null) return null;
            string l;
            while (!string.IsNullOrEmpty(l = Linea(s)))
            {
                var i = l.IndexOf(':');
                if (i > 0) req.Headers[l.Substring(0, i).Trim()] = l.Substring(i + 1).Trim();
            }
            var largo = 0;
            string cl;
            if (req.Headers.TryGetValue("Content-Length", out cl)) largo = int.Parse(cl);
            var buf = new byte[largo];
            var leido = 0;
            while (leido < largo)
            {
                var n = s.Read(buf, leido, largo - leido);
                if (n <= 0) break;
                leido += n;
            }
            string enc;
            if (req.Headers.TryGetValue("Content-Encoding", out enc) && enc.Equals("gzip", StringComparison.OrdinalIgnoreCase))
            {
                using (var gz = new GZipStream(new MemoryStream(buf), CompressionMode.Decompress))
                using (var rd = new StreamReader(gz, new UTF8Encoding(false)))
                    req.Body = rd.ReadToEnd();
            }
            else
            {
                req.Body = Encoding.UTF8.GetString(buf);
            }
            return req;
        }

        private static string Linea(Stream s)
        {
            var sb = new StringBuilder();
            int b;
            while ((b = s.ReadByte()) >= 0)
            {
                if (b == '\n') break;
                if (b != '\r') sb.Append((char)b);
            }
            if (b < 0 && sb.Length == 0) return null;
            return sb.ToString();
        }

        public void Dispose()
        {
            _stop.Set();
            try { _listener.Stop(); } catch { }
        }
    }
}
