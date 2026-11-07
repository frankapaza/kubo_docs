// ServicePointManager está marcado obsoleto en .NET moderno, pero es justo lo que el appender (net45) usa y lo que se verifica aquí.
#pragma warning disable SYSLIB0014
using System;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using Kubo.Log4Net.Internal;
using Xunit;

namespace Kubo.Log4Net.Tests
{
    // Toca ServicePointManager (global del proceso): no puede correr en paralelo con otras pruebas que lo toquen.
    [Collection("Global")]
    public class HttpBatchSenderTests
    {
        private static ClientOptions Opciones(string url, int timeoutMs = 5000)
        {
            return new ClientOptions { Url = url, ApiKey = "klog_clave", Aplicativo = "app", Servidor = "srv", AppenderVersion = "1.0.0", TimeoutMs = timeoutMs };
        }

        [Fact]
        public void EnviaGzipConCabecerasDelContrato()
        {
            using (var fake = new FakeIngestServer())
            {
                var json = "{\"loteId\":\"x\",\"mensaje\":\"áéí ñ 日本\"}";
                int ra;
                var r = new HttpBatchSender(Opciones(fake.Url)).Send(json, out ra);
                Assert.Equal(SendOutcome.Ok, r);
                var req = Assert.Single(fake.Requests);
                Assert.StartsWith("POST /api/v1/ingest/logs", req.RequestLine);
                Assert.Equal("klog_clave", req.Headers["X-Kubo-Log-Key"]);
                Assert.Equal("application/json; charset=utf-8", req.Headers["Content-Type"]);
                Assert.Equal("gzip", req.Headers["Content-Encoding"]);
                Assert.Equal(json, req.Body);
            }
        }

        [Theory]
        [InlineData(202, "Ok")]
        [InlineData(503, "Retry")]
        [InlineData(500, "Retry")]
        [InlineData(429, "Retry")]
        [InlineData(401, "RetryLater")]
        [InlineData(400, "Drop")]
        [InlineData(413, "Drop")]
        public void MapeaCodigos(int status, string esperado)
        {
            using (var fake = new FakeIngestServer())
            {
                fake.Enqueue(status);
                int ra;
                Assert.Equal((SendOutcome)Enum.Parse(typeof(SendOutcome), esperado), new HttpBatchSender(Opciones(fake.Url)).Send("{}", out ra));
            }
        }

        [Fact]
        public void MapeaConexionRechazadaComoRetry()
        {
            // Se reserva un puerto libre y se cierra: nadie escucha en él.
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            var puerto = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            int ra;
            Assert.Equal(SendOutcome.Retry, new HttpBatchSender(Opciones("http://127.0.0.1:" + puerto + "/x")).Send("{}", out ra));
        }

        [Fact]
        public void Mapea429ConRetryAfter()
        {
            using (var fake = new FakeIngestServer())
            {
                fake.Enqueue(429, "7");
                int ra;
                Assert.Equal(SendOutcome.Retry, new HttpBatchSender(Opciones(fake.Url)).Send("{}", out ra));
                Assert.Equal(7000, ra);
            }
        }

        [Fact]
        public void RespetaTimeout()
        {
            using (var fake = new FakeIngestServer())
            {
                fake.DelayMs = 3000;
                int ra;
                var sw = Stopwatch.StartNew();
                var r = new HttpBatchSender(Opciones(fake.Url, 300)).Send("{}", out ra);
                Assert.Equal(SendOutcome.Retry, r);
                Assert.True(sw.ElapsedMilliseconds < 2000, "tardó " + sw.ElapsedMilliseconds + " ms");
            }
        }

        [Fact]
        public void UsaElProxy()
        {
            using (var fake = new FakeIngestServer())
            {
                var o = Opciones("http://kubo.invalid/api/v1/ingest/logs");
                o.Proxy = fake.BaseUrl;
                int ra;
                Assert.Equal(SendOutcome.Ok, new HttpBatchSender(o).Send("{}", out ra));
                var req = Assert.Single(fake.Requests);
                Assert.StartsWith("POST http://kubo.invalid/api/v1/ingest/logs", req.RequestLine);
            }
        }

        // Valores numéricos: SecurityProtocolType.Tls está obsoleto en .NET moderno y generaría un aviso.
        private const int Tls = 192, Tls12 = 3072;

        [Fact]
        public void Tls12SeSumaSinQuitar()
        {
            var original = ServicePointManager.SecurityProtocol;
            try
            {
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)Tls;
                TlsSetup.EnsureTls12();
                Assert.Equal(Tls | Tls12, (int)ServicePointManager.SecurityProtocol);

                // SystemDefault (0): no se toca, forzar Tls12 quitaría TLS 1.3 en .NET 5+.
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)0;
                TlsSetup.EnsureTls12();
                Assert.Equal(0, (int)ServicePointManager.SecurityProtocol);
            }
            finally
            {
                ServicePointManager.SecurityProtocol = original;
            }
        }
    }

    [CollectionDefinition("Global", DisableParallelization = true)]
    public class GlobalCollection { }
}
