using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using Kubo.Log4Net.Internal;
using Xunit;

namespace Kubo.Log4Net.Tests
{
    // Colección "Global": HttpBatchSender toca ServicePointManager y estas pruebas dependen de tiempos;
    // correrlas solas evita que la CPU compartida las vuelva intermitentes.
    [Collection("Global")]
    public class KuboLogClientTests
    {
        private static ClientOptions Opciones(FakeIngestServer fake)
        {
            return new ClientOptions
            {
                Url = fake.Url, ApiKey = "klog_clave", Aplicativo = "app", Servidor = "srv", AppenderVersion = "1.0.0",
                ShutdownTimeoutMs = 300
            };
        }

        private static LogEventData Ev(string mensaje)
        {
            return new LogEventData { TimestampUtc = DateTime.UtcNow, Level = "INFO", Logger = "t", Message = mensaje };
        }

        private static KuboLogClient Cliente(ClientOptions o, List<string> diag = null)
        {
            return new KuboLogClient(o, new HttpBatchSender(o), (m, e) => { if (diag != null) lock (diag) diag.Add(m); });
        }

        private static int Eventos(FakeRequest r) { return Regex.Matches(r.Body, "\"ts\":\"").Count; }
        private static string LoteId(FakeRequest r) { return Regex.Match(r.Body, "\"loteId\":\"([^\"]+)\"").Groups[1].Value; }

        [Fact]
        public void EnviaAlLlegarABatchSize()
        {
            using (var fake = new FakeIngestServer())
            {
                var o = Opciones(fake); o.BatchSize = 5; o.FlushIntervalMs = 60000;
                using (var c = Cliente(o))
                {
                    var sw = Stopwatch.StartNew();
                    for (var i = 0; i < 5; i++) c.Enqueue(Ev("m" + i));
                    Assert.True(fake.WaitForRequests(1, 2000));
                    Assert.True(sw.ElapsedMilliseconds < 2000);
                    Assert.Equal(5, Eventos(fake.Requests[0]));
                }
            }
        }

        [Fact]
        public void EnviaPorTiempo()
        {
            using (var fake = new FakeIngestServer())
            {
                var o = Opciones(fake); o.FlushIntervalMs = 200;
                using (var c = Cliente(o))
                {
                    c.Enqueue(Ev("solo"));
                    Assert.True(fake.WaitForRequests(1, 2000));
                    Assert.Equal(1, Eventos(fake.Requests[0]));
                }
            }
        }

        [Fact]
        public void EnqueueNoBloqueaConElServidorColgado()
        {
            using (var fake = new FakeIngestServer())
            {
                fake.DelayMs = 10000;
                var o = Opciones(fake);
                using (var c = Cliente(o))
                {
                    var e = Ev("x");
                    var sw = Stopwatch.StartNew();
                    for (var i = 0; i < 10000; i++) c.Enqueue(e);
                    Assert.True(sw.ElapsedMilliseconds < 200, "tardó " + sw.ElapsedMilliseconds + " ms");
                }
            }
        }

        [Fact]
        public void ColaAcotadaDescartaLoMasViejoYLoReporta()
        {
            using (var fake = new FakeIngestServer())
            {
                fake.DefaultStatus = 503;
                // Intervalo y lote grandes: nada se envía hasta el Flush, así el estado de la cola es determinista.
                var o = Opciones(fake); o.MaxQueueSize = 10; o.BatchSize = 1000; o.FlushIntervalMs = 60000;
                using (var c = Cliente(o))
                {
                    for (var i = 0; i < 25; i++) c.Enqueue(Ev("m" + i));
                    Assert.Equal(10, c.QueueCount);
                    Assert.Equal(15, c.DroppedCount);

                    Assert.False(c.Flush(300)); // el servidor responde 503: no se vacía
                    Assert.Equal(10, c.QueueCount);
                    Assert.Equal(15, c.DroppedCount);

                    fake.DefaultStatus = 202;
                    Assert.True(c.Flush(20000));
                    var ultimo = fake.Requests.Last();
                    Assert.Contains("\"descartados\":15", ultimo.Body);
                    Assert.Equal(10, Eventos(ultimo));
                    for (var i = 15; i < 25; i++) Assert.Contains("\"mensaje\":\"m" + i + "\"", ultimo.Body);
                    Assert.DoesNotContain("\"mensaje\":\"m14\"", ultimo.Body);
                    Assert.Equal(0, c.DroppedCount);
                    Assert.Equal(0, c.QueueCount);
                }
            }
        }

        [Fact]
        public void ReintentaElMismoLoteConElMismoLoteId()
        {
            using (var fake = new FakeIngestServer())
            {
                fake.Enqueue(503); fake.Enqueue(503); fake.Enqueue(202);
                var o = Opciones(fake); o.BatchSize = 3; o.FlushIntervalMs = 60000;
                using (var c = Cliente(o))
                {
                    for (var i = 0; i < 3; i++) c.Enqueue(Ev("m" + i));
                    // Espera de 1 s y 2 s (más jitter) entre intentos: margen amplio.
                    Assert.True(fake.WaitForRequests(3, 20000));
                    var reqs = fake.Requests;
                    Assert.Equal(3, reqs.Count);
                    Assert.Equal(LoteId(reqs[0]), LoteId(reqs[1]));
                    Assert.Equal(LoteId(reqs[0]), LoteId(reqs[2]));
                    Assert.Equal(reqs[0].Body, reqs[1].Body);
                    Assert.Equal(reqs[0].Body, reqs[2].Body);
                    Assert.Equal(3, Eventos(reqs[2]));
                }
            }
        }

        [Fact]
        public void Un400DescartaElLoteYSigue()
        {
            using (var fake = new FakeIngestServer())
            {
                fake.Enqueue(400);
                var diag = new List<string>();
                var o = Opciones(fake); o.BatchSize = 1; o.FlushIntervalMs = 60000;
                using (var c = Cliente(o, diag))
                {
                    c.Enqueue(Ev("primero"));
                    c.Enqueue(Ev("segundo"));
                    Assert.True(c.Flush(10000));
                    var reqs = fake.Requests;
                    Assert.Equal(2, reqs.Count);
                    Assert.Contains("primero", reqs[0].Body);
                    Assert.DoesNotContain("primero", reqs[1].Body);
                    Assert.Contains("segundo", reqs[1].Body);
                    lock (diag) Assert.NotEmpty(diag);
                }
            }
        }

        [Fact]
        public void LoteNoSuperaMaxBatchChars()
        {
            using (var fake = new FakeIngestServer())
            {
                var o = Opciones(fake); o.BatchSize = 1000; o.FlushIntervalMs = 60000;
                using (var c = Cliente(o))
                {
                    var texto = new string('x', 30000);
                    for (var i = 0; i < 300; i++) c.Enqueue(Ev(texto));
                    Assert.True(c.Flush(60000));
                    var reqs = fake.Requests;
                    Assert.True(reqs.Count > 1);
                    Assert.All(reqs, r => Assert.True(r.Body.Length <= 1500000, "cuerpo de " + r.Body.Length));
                    Assert.Equal(300, reqs.Sum(r => Eventos(r)));
                }
            }
        }

        [Fact]
        public void DisposeVaciaConTope()
        {
            using (var fake = new FakeIngestServer())
            {
                var o = Opciones(fake); o.BatchSize = 1000; o.FlushIntervalMs = 60000; o.ShutdownTimeoutMs = 10000; // servidor sano: holgura para que la CPU cargada no corte el vaciado
                var c = Cliente(o);
                for (var i = 0; i < 50; i++) c.Enqueue(Ev("m" + i));
                c.Dispose();
                Assert.Equal(50, fake.Requests.Sum(r => Eventos(r)));
            }

            using (var colgado = new FakeIngestServer())
            {
                colgado.DelayMs = 10000;
                var o = Opciones(colgado); o.ShutdownTimeoutMs = 500; o.FlushIntervalMs = 60000;
                var c = Cliente(o);
                for (var i = 0; i < 10; i++) c.Enqueue(Ev("m" + i));
                var sw = Stopwatch.StartNew();
                c.Dispose();
                Assert.True(sw.ElapsedMilliseconds < o.ShutdownTimeoutMs + 1000, "tardó " + sw.ElapsedMilliseconds + " ms");
            }
        }

        private static bool Espera(Func<bool> cond, int ms)
        {
            var fin = DateTime.UtcNow.AddMilliseconds(ms);
            while (DateTime.UtcNow < fin)
            {
                if (cond()) return true;
                Thread.Sleep(10);
            }
            return cond();
        }

        [Fact]
        public void UnFallo503GeneraAvisoEnElPrimerIntento()
        {
            using (var fake = new FakeIngestServer())
            {
                fake.DefaultStatus = 503;
                var diag = new List<string>();
                var o = Opciones(fake); o.FlushIntervalMs = 60000;
                using (var c = Cliente(o, diag))
                {
                    c.Enqueue(Ev("x"));
                    Assert.False(c.Flush(500));
                    Assert.True(Espera(() => { lock (diag) return diag.Any(m => m.Contains("503")); }, 3000));
                }
            }
        }

        [Fact]
        public void LosAvisosDeReintentoSeEspacian()
        {
            Assert.True(KuboLogClient.DebeAvisar(0));
            Assert.True(KuboLogClient.DebeAvisar(1));
            Assert.True(KuboLogClient.DebeAvisar(2));
            Assert.False(KuboLogClient.DebeAvisar(3));
            Assert.True(KuboLogClient.DebeAvisar(4));
            Assert.False(KuboLogClient.DebeAvisar(5));
            Assert.False(KuboLogClient.DebeAvisar(7));
            Assert.True(KuboLogClient.DebeAvisar(8));
            Assert.Equal(8, Enumerable.Range(0, 100).Count(KuboLogClient.DebeAvisar)); // 0,1,2,4,8,16,32,64
        }

        [Fact]
        public void Un404EsRetryLaterYAvisaDeLaUrl()
        {
            using (var fake = new FakeIngestServer())
            {
                fake.DefaultStatus = 404;
                var diag = new List<string>();
                var o = Opciones(fake); o.FlushIntervalMs = 60000;
                using (var c = Cliente(o, diag))
                {
                    c.Enqueue(Ev("x"));
                    Assert.False(c.Flush(1500));
                    // RetryLater espera 5 minutos: en este tiempo no hubo un segundo intento.
                    Assert.Single(fake.Requests);
                    Assert.True(Espera(() => { lock (diag) return diag.Any(m => m.Contains("404") && m.Contains("Url")); }, 3000));
                }
            }
        }

        [Fact]
        public void CierreHaceUnSoloIntentoPorLote()
        {
            using (var fake = new FakeIngestServer())
            {
                fake.DefaultStatus = 503;
                var o = Opciones(fake); o.FlushIntervalMs = 60000; o.ShutdownTimeoutMs = 10000;
                var c = Cliente(o);
                c.Enqueue(Ev("x"));
                c.Dispose();
                Assert.Single(fake.Requests);
            }
        }

        [Fact]
        public void LoteConTextoNoAsciiNoSuperaElTopeEnBytes()
        {
            using (var fake = new FakeIngestServer())
            {
                var o = Opciones(fake); o.BatchSize = 1000; o.FlushIntervalMs = 60000;
                using (var c = Cliente(o))
                {
                    var tres = new string('あ', 30000);                                  // 3 bytes por carácter
                    var cuatro = string.Concat(Enumerable.Repeat("\U0001F600", 15000));  // 4 bytes por par
                    for (var i = 0; i < 60; i++) c.Enqueue(Ev(i % 2 == 0 ? tres : cuatro));
                    Assert.True(c.Flush(60000));
                    var reqs = fake.Requests;
                    Assert.True(reqs.Count > 1);
                    Assert.All(reqs, r => Assert.True(System.Text.Encoding.UTF8.GetByteCount(r.Body) <= 1500000, "bytes: " + System.Text.Encoding.UTF8.GetByteCount(r.Body)));
                    Assert.Equal(60, reqs.Sum(r => Eventos(r)));
                }
            }
        }

        // Diccionario cuya enumeración falla: simula un evento que rompe al estimar/serializar.
        private sealed class PropiedadesVenenosas : Dictionary<string, string>, IEnumerable<KeyValuePair<string, string>>
        {
            IEnumerator<KeyValuePair<string, string>> IEnumerable<KeyValuePair<string, string>>.GetEnumerator()
            {
                throw new InvalidOperationException("propiedades rotas");
            }
        }

        [Fact]
        public void UnEventoQueRompeLaPreparacionNoMataElHilo()
        {
            using (var fake = new FakeIngestServer())
            {
                var diag = new List<string>();
                var o = Opciones(fake); o.FlushIntervalMs = 60000;
                using (var c = Cliente(o, diag))
                {
                    var malo = Ev("malo");
                    malo.Properties = new PropiedadesVenenosas();
                    c.Enqueue(malo);
                    Assert.True(c.Flush(5000));
                    lock (diag) Assert.NotEmpty(diag);
                    Assert.Empty(fake.Requests);

                    // El hilo sigue vivo: un evento normal posterior se envía.
                    c.Enqueue(Ev("bueno"));
                    Assert.True(c.Flush(5000));
                    Assert.Contains("bueno", Assert.Single(fake.Requests).Body);
                }
            }
        }

        private sealed class SenderQueLanza : IBatchSender
        {
            public SendOutcome Send(string json, out int retryAfterMs)
            {
                throw new InvalidOperationException("fallo simulado");
            }
        }

        [Fact]
        public void NingunFalloEscapa()
        {
            var errores = new List<Exception>();
            var o = new ClientOptions { Url = "http://x", ShutdownTimeoutMs = 300, FlushIntervalMs = 60000 };
            var c = new KuboLogClient(o, new SenderQueLanza(), (m, e) => { if (e != null) lock (errores) errores.Add(e); });
            c.Enqueue(Ev("x"));
            c.Enqueue(null);
            Assert.False(c.Flush(300));
            c.Dispose();
            c.Dispose();
            c.Enqueue(Ev("después de cerrar")); // tras Dispose se ignora, sin lanzar
            lock (errores) Assert.Contains(errores, e => e is InvalidOperationException);
        }
    }
}
