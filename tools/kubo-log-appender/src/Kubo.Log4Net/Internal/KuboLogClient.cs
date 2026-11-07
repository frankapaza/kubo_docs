using System;
using System.Collections.Generic;
using System.Threading;

namespace Kubo.Log4Net.Internal
{
    /// <summary>
    /// Cola acotada + hilo propio que envía lotes. Nada de lo que pase aquí (red caída, servidor
    /// colgado, excepciones) puede llegar al aplicativo: Enqueue solo toma un lock corto y vuelve.
    /// </summary>
    internal sealed class KuboLogClient : IDisposable
    {
        /// <summary>Espera tras un 401: la clave se corrige en el servidor, no tiene sentido insistir cada segundo.</summary>
        private const int RetryLaterMs = 5 * 60 * 1000;
        /// <summary>Por evento: marcas JSON, ts, nivel, logger, claves... el serializador añade ~150-250 caracteres.</summary>
        private const int OverheadPorEvento = 400;

        private readonly ClientOptions _o;
        private readonly IBatchSender _sender;
        private readonly Action<string, Exception> _diag;

        // Un solo lock protege cola, contadores y banderas. Los eventos del lote en vuelo se quedan
        // en la cola (los primeros _inflight): así QueueCount es honesto y un lote que se reintenta
        // no se pierde ni se duplica cuando la cola se llena a su alrededor.
        private readonly object _gate = new object();
        private readonly List<LogEventData> _queue = new List<LogEventData>();
        private int _inflight;
        private long _droppedPending;
        private bool _flushRequested;
        private bool _closing;

        private readonly AutoResetEvent _wake = new AutoResetEvent(false);
        private readonly ManualResetEvent _closeSignal = new ManualResetEvent(false);
        private readonly Thread _worker;
        private readonly Random _rnd = new Random();

        // Estado del lote en vuelo; solo lo toca el hilo de fondo.
        private string _curJson;
        private int _curCount;
        private long _curDropped;

        public KuboLogClient(ClientOptions o, IBatchSender sender, Action<string, Exception> diag)
        {
            _o = o;
            _sender = sender;
            _diag = diag;
            _worker = new Thread(Run) { IsBackground = true, Name = "KuboLogAppender" };
            _worker.Start();
        }

        public long DroppedCount { get { lock (_gate) return _droppedPending; } }
        public int QueueCount { get { lock (_gate) return _queue.Count; } }

        public void Enqueue(LogEventData e)
        {
            try
            {
                if (e == null) return;
                bool despertar;
                lock (_gate)
                {
                    if (_closing) return;
                    if (_queue.Count >= _o.MaxQueueSize)
                    {
                        if (_queue.Count > _inflight)
                        {
                            // Cola llena: se tira lo más viejo que aún no está en vuelo.
                            _queue.RemoveAt(_inflight);
                            _droppedPending++;
                        }
                        else
                        {
                            // Toda la cola es el lote en vuelo (ya serializado): se tira el nuevo.
                            _droppedPending++;
                            return;
                        }
                    }
                    _queue.Add(e);
                    despertar = _queue.Count - _inflight >= _o.BatchSize;
                }
                if (despertar) _wake.Set();
            }
            catch (Exception ex)
            {
                Diag("Kubo: fallo al encolar el evento", ex);
            }
        }

        /// <summary>Pide enviar todo ya y espera hasta <paramref name="timeoutMs"/>. true si la cola quedó vacía.</summary>
        public bool Flush(int timeoutMs)
        {
            try
            {
                var fin = DateTime.UtcNow.AddMilliseconds(timeoutMs);
                lock (_gate)
                {
                    if (_queue.Count == 0) return true;
                    _flushRequested = true;
                }
                _wake.Set();
                lock (_gate)
                {
                    while (_queue.Count > 0)
                    {
                        var resto = (int)(fin - DateTime.UtcNow).TotalMilliseconds;
                        if (resto <= 0) return false;
                        Monitor.Wait(_gate, resto);
                    }
                    return true;
                }
            }
            catch (Exception ex)
            {
                Diag("Kubo: fallo en Flush", ex);
                return false;
            }
        }

        public void Dispose()
        {
            try
            {
                lock (_gate)
                {
                    if (_closing) return;
                    _closing = true;
                }
                _closeSignal.Set();
                _wake.Set();
                // Con tope: si el servidor está colgado, el hilo de fondo (background) muere con el proceso.
                _worker.Join(_o.ShutdownTimeoutMs);
                // _wake y _closeSignal no se liberan: el hilo podría seguir usándolos tras el Join con tope.
            }
            catch (Exception ex)
            {
                Diag("Kubo: fallo al cerrar", ex);
            }
        }

        private void Run()
        {
            try
            {
                while (true)
                {
                    var porTiempo = !_wake.WaitOne(_o.FlushIntervalMs);
                    Drenar(porTiempo);
                    if (_closing)
                    {
                        // Cierre: vaciar con un solo intento por lote y sin esperas.
                        Drenar(true);
                        return;
                    }
                }
            }
            catch (Exception ex)
            {
                Diag("Kubo: el hilo de envío terminó por un error inesperado", ex);
            }
        }

        /// <summary>Envía lotes mientras toque. <paramref name="todo"/>: ignorar el umbral de BatchSize.</summary>
        private void Drenar(bool todo)
        {
            while (true)
            {
                if (_curJson == null)
                {
                    if (!PrepararLote(todo)) return;
                }
                if (!EnviarLote()) return;
            }
        }

        private bool PrepararLote(bool todo)
        {
            List<LogEventData> lote;
            long descartados;
            lock (_gate)
            {
                var n = _queue.Count;
                if (n == 0)
                {
                    _flushRequested = false;
                    Monitor.PulseAll(_gate);
                    return false;
                }
                if (!(todo || _flushRequested || _closing || n >= _o.BatchSize)) return false;

                var total = 0L;
                var tomar = 0;
                while (tomar < n && tomar < _o.BatchSize)
                {
                    total += Estimar(_queue[tomar]);
                    // Siempre al menos un evento; si no, uno enorme bloquearía la cola para siempre.
                    if (tomar > 0 && total > _o.MaxBatchChars) break;
                    tomar++;
                }
                _inflight = tomar;
                lote = _queue.GetRange(0, tomar);
                descartados = _droppedPending;
            }

            var p = new BatchPayload
            {
                LoteId = Guid.NewGuid().ToString(),
                Aplicativo = _o.Aplicativo,
                Servidor = _o.Servidor,
                AppenderVersion = _o.AppenderVersion,
                Descartados = descartados,
                Eventos = lote
            };
            // Se serializa una sola vez: los reintentos reenvían exactamente el mismo cuerpo y loteId.
            _curJson = KuboJson.Serialize(p);
            _curCount = lote.Count;
            _curDropped = descartados;
            return true;
        }

        /// <summary>true si el lote quedó resuelto (aceptado o descartado); false si se abandonó por cierre.</summary>
        private bool EnviarLote()
        {
            var intento = 0;
            while (true)
            {
                int retryAfterMs = 0;
                SendOutcome r;
                try
                {
                    r = _sender.Send(_curJson, out retryAfterMs);
                }
                catch (Exception ex)
                {
                    Diag("Kubo: error al enviar el lote", ex);
                    r = SendOutcome.Retry;
                }

                if (r == SendOutcome.Ok || r == SendOutcome.Drop)
                {
                    if (r == SendOutcome.Drop)
                        Diag("Kubo: el servidor rechazó el lote (400/413); se descarta " + _curCount + " evento(s)", null);
                    Terminar(r == SendOutcome.Ok);
                    return true;
                }

                if (_closing) return false; // cierre: un intento por lote

                var espera = r == SendOutcome.RetryLater
                    ? RetryLaterMs
                    : Backoff.DelayMs(intento, retryAfterMs, _rnd);
                if (r == SendOutcome.RetryLater)
                    Diag("Kubo: clave rechazada (401); se reintenta en 5 minutos", null);
                intento++;
                // La espera se corta al cerrar; el bucle hace entonces su último intento.
                _closeSignal.WaitOne(espera);
            }
        }

        private void Terminar(bool aceptado)
        {
            lock (_gate)
            {
                _queue.RemoveRange(0, _curCount);
                _inflight = 0;
                // Solo un lote aceptado reporta de verdad lo descartado; en un Drop se reintenta en el siguiente.
                if (aceptado) _droppedPending -= _curDropped;
                Monitor.PulseAll(_gate);
            }
            _curJson = null;
            _curCount = 0;
            _curDropped = 0;
        }

        /// <summary>Cota superior del largo JSON del evento, escapes incluidos.</summary>
        private static long Estimar(LogEventData e)
        {
            long n = OverheadPorEvento;
            n += LargoEscapado(e.Message, KuboJson.MaxTextChars);
            n += LargoEscapado(e.Exception, KuboJson.MaxTextChars);
            n += LargoEscapado(e.Logger, int.MaxValue);
            n += LargoEscapado(e.Thread, int.MaxValue);
            if (e.Properties != null)
                foreach (var kv in e.Properties)
                    n += 8 + LargoEscapado(kv.Key, int.MaxValue) + LargoEscapado(kv.Value, int.MaxValue);
            return n;
        }

        private static long LargoEscapado(string s, int tope)
        {
            if (s == null) return 0;
            var largo = Math.Min(s.Length, tope);
            long n = 0;
            for (var i = 0; i < largo; i++)
            {
                var c = s[i];
                if (c == '"' || c == '\\' || c == '\n' || c == '\r' || c == '\t' || c == '\b' || c == '\f') n += 2;
                else if (c < 0x20 || char.IsSurrogate(c)) n += 6;
                else n++;
            }
            return n;
        }

        private void Diag(string msg, Exception ex)
        {
            try { if (_diag != null) _diag(msg, ex); }
            catch { /* el diagnóstico nunca debe romper nada */ }
        }
    }
}
