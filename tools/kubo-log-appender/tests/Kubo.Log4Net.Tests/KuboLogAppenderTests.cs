using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Xml;
using Kubo.Log4Net.Internal;
using log4net;
using log4net.Config;
using log4net.Repository;
using Xunit;

namespace Kubo.Log4Net.Tests
{
    /// <summary>
    /// Todas pasan por log4net real (repositorio propio por prueba, configurado desde XML o a mano) contra
    /// FakeIngestServer. Corren en net48 (log4net 2.0.8) y net10.0 (3.2.0). Tocan ThreadContext y
    /// Console.Error, que son globales del proceso: van en la colección "Global".
    /// </summary>
    [Collection("Global")]
    public class KuboLogAppenderTests
    {
        private static ILoggerRepository NuevoRepo()
        {
            return LogManager.CreateRepository("kubo-test-" + Guid.NewGuid().ToString("N"));
        }

        private static KuboLogAppender Configurar(ILoggerRepository repo, string url, string extra = "")
        {
            var xml = new XmlDocument();
            xml.LoadXml(
                "<log4net><appender name=\"Kubo\" type=\"Kubo.Log4Net.KuboLogAppender, Kubo.Log4Net\">" +
                (url == null ? "" : "<Url value=\"" + url + "\"/>") +
                "<ApiKey value=\"klog_clave\"/><Aplicativo value=\"MiApp\"/><BatchSize value=\"50\"/>" +
                "<FlushIntervalMs value=\"100\"/>" + extra +
                "<Threshold value=\"INFO\"/></appender>" +
                "<root><level value=\"ALL\"/><appender-ref ref=\"Kubo\"/></root></log4net>");
            XmlConfigurator.Configure(repo, xml.DocumentElement);
            return (KuboLogAppender)repo.GetAppenders().Single();
        }

        private static string Todo(FakeIngestServer s)
        {
            return string.Concat(s.Requests.Select(r => r.Body));
        }

        [Fact]
        public void ConfiguracionXmlRellenaParametros()
        {
            using (var fake = new FakeIngestServer())
            {
                var repo = NuevoRepo();
                var ap = Configurar(repo, fake.Url);
                var log = LogManager.GetLogger(repo.Name, "t");
                log.Debug("no debe llegar");
                log.Info("si llega");
                Assert.True(ap.Flush(5000));
                var body = Todo(fake);
                Assert.Contains("\"aplicativo\":\"MiApp\"", body);
                Assert.Contains("\"servidor\":\"" + Environment.MachineName + "\"", body);
                Assert.Contains("si llega", body);
                Assert.DoesNotContain("no debe llegar", body);
                repo.Shutdown();
            }
        }

        [Fact]
        public void CopiaPropiedadesEnElHiloQueEscribe()
        {
            using (var fake = new FakeIngestServer())
            {
                var repo = NuevoRepo();
                var ap = Configurar(repo, fake.Url);
                var log = LogManager.GetLogger(repo.Name, "t");
                ThreadContext.Properties["kubo:ruc"] = "20123456789";
                log.Error("con thread context");
                ThreadContext.Properties.Remove("kubo:ruc");
                LogicalThreadContext.Properties["kubo:ruc2"] = "20999999999";
                log.Error("con logical");
                LogicalThreadContext.Properties.Remove("kubo:ruc2");
                Assert.True(ap.Flush(5000));
                var body = Todo(fake);
                Assert.Contains("\"kubo:ruc\":\"20123456789\"", body);
                Assert.Contains("\"kubo:ruc2\":\"20999999999\"", body);
                repo.Shutdown();
            }
        }

        [Fact]
        public void OmitePropiedadesInternasYNormalizaNulos()
        {
            using (var fake = new FakeIngestServer())
            {
                var repo = NuevoRepo();
                var ap = Configurar(repo, fake.Url);
                var log = LogManager.GetLogger(repo.Name, "t");
                ThreadContext.Properties["kubo:nulo"] = null;
                log.Error("x");
                ThreadContext.Properties.Remove("kubo:nulo");
                Assert.True(ap.Flush(5000));
                var body = Todo(fake);
                Assert.DoesNotContain("log4net:", body);
                Assert.Contains("\"kubo:nulo\":\"\"", body);
                Assert.DoesNotContain("null", body);
                repo.Shutdown();
            }
        }

        [Fact]
        public void ExcepcionYNivel()
        {
            using (var fake = new FakeIngestServer())
            {
                var repo = NuevoRepo();
                var ap = Configurar(repo, fake.Url);
                var log = LogManager.GetLogger(repo.Name, "t");
                log.Error("x", new InvalidOperationException("y"));
                log.Fatal("grave");
                Assert.True(ap.Flush(5000));
                var body = Todo(fake);
                Assert.Contains("\"nivel\":\"ERROR\"", body);
                Assert.Contains("\"nivel\":\"FATAL\"", body);
                Assert.Contains("\"excepcion\":\"System.InvalidOperationException: y", body);
                repo.Shutdown();
            }
        }

        [Fact]
        public void LaMarcaDeTiempoEsUtc()
        {
            using (var fake = new FakeIngestServer())
            {
                var repo = NuevoRepo();
                var ap = Configurar(repo, fake.Url);
                LogManager.GetLogger(repo.Name, "t").Info("hora");
                Assert.True(ap.Flush(5000));
                var body = Todo(fake);
                var i = body.IndexOf("\"ts\":\"", StringComparison.Ordinal) + 6;
                var ts = DateTime.Parse(body.Substring(i, body.IndexOf('"', i) - i), CultureInfo.InvariantCulture,
                    DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
                // Si se guardara la hora local sin convertir, en América/Lima la diferencia sería de 5 horas.
                Assert.True(Math.Abs((DateTime.UtcNow - ts).TotalSeconds) < 60, "ts=" + ts);
                repo.Shutdown();
            }
        }

        [Fact]
        public void SinUrlOClaveNoRompe()
        {
            using (var fake = new FakeIngestServer())
            {
                var original = Console.Error;
                var cap = new StringWriter();
                Console.SetError(cap);
                try
                {
                    var repo = NuevoRepo();
                    Configurar(repo, null);
                    LogManager.GetLogger(repo.Name, "t").Info("nada");
                    repo.Shutdown();
                    Assert.Contains("Url", cap.ToString());
                    Assert.Empty(fake.Requests);
                }
                finally { Console.SetError(original); }
            }
        }

        private sealed class ThrowingSender : IBatchSender
        {
            public SendOutcome Send(string json, out int retryAfterMs)
            {
                throw new InvalidOperationException("boom");
            }
        }

        [Fact]
        public void ParametrosAbsurdosVuelvenAlValorPorOmision()
        {
            var ap = new KuboLogAppender(o => new ThrowingSender())
            {
                Url = "http://x/", ApiKey = "k", Aplicativo = "a",
                BatchSize = 0, FlushIntervalMs = -5, MaxQueueSize = 0, TimeoutMs = -1
            };
            ap.ActivateOptions();
            Assert.Equal(200, ap.BatchSize);
            Assert.Equal(2000, ap.FlushIntervalMs);
            Assert.Equal(10000, ap.MaxQueueSize);
            Assert.Equal(5000, ap.TimeoutMs);
            ap.Close();
        }

        [Fact]
        public void NuncaLanzaAlAplicativo()
        {
            var repo = NuevoRepo();
            var ap = new KuboLogAppender(o => new ThrowingSender())
            { Url = "http://x/", ApiKey = "k", Aplicativo = "a", BatchSize = 10, FlushIntervalMs = 50 };
            ap.ActivateOptions();
            BasicConfigurator.Configure(repo, ap);
            var log = LogManager.GetLogger(repo.Name, "t");
            for (var i = 0; i < 1000; i++) log.Error("e" + i);
            repo.Shutdown();
        }

        [Fact]
        public void CerrarElRepositorioVacia()
        {
            using (var fake = new FakeIngestServer())
            {
                var repo = NuevoRepo();
                // Intervalo largo: solo el cierre puede haber vaciado la cola.
                Configurar(repo, fake.Url, "<FlushIntervalMs value=\"60000\"/>");
                var log = LogManager.GetLogger(repo.Name, "t");
                for (var i = 0; i < 20; i++) log.Info("evento-" + i);
                repo.Shutdown();
                var body = Todo(fake);
                for (var i = 0; i < 20; i++) Assert.Contains("evento-" + i + "\"", body);
            }
        }

        [Fact]
        public void LaVarianteDeLog4NetCoincideConLaPlataforma()
        {
            // Prueba que cada plataforma de prueba ejercita la variante prevista (2.x en net48, 3.x en net10.0).
            var asm = typeof(KuboLogAppender).Assembly.GetReferencedAssemblies().Single(a => a.Name == "log4net");
#if NET48
            Assert.Equal(2, asm.Version.Major);
#else
            Assert.Equal(3, asm.Version.Major);
#endif
            Assert.Equal(asm.Version.Major, typeof(ILog).Assembly.GetName().Version.Major);
        }
    }
}
