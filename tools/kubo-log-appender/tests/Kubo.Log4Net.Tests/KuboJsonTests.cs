using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Threading;
using Kubo.Log4Net.Internal;
using Xunit;

namespace Kubo.Log4Net.Tests
{
    public class KuboJsonTests
    {
        private static BatchPayload UnLote(LogEventData ev)
        {
            return new BatchPayload
            {
                LoteId = "11111111-2222-3333-4444-555555555555",
                Aplicativo = "Facturador",
                Servidor = "SRV01",
                AppenderVersion = "1.0.0",
                Descartados = 3,
                Eventos = new List<LogEventData> { ev },
            };
        }

        private static LogEventData UnEvento()
        {
            return new LogEventData
            {
                TimestampUtc = new DateTime(2026, 11, 7, 15, 4, 5, 123, DateTimeKind.Utc),
                Level = "ERROR",
                Logger = "App.Foo",
                Message = "falló",
                Exception = "System.Exception: boom",
                Thread = "7",
                Properties = new Dictionary<string, string> { { "k", "v" } },
            };
        }

        [Fact]
        public void Serialize_EscribeLosCamposDelContrato()
        {
            var json = KuboJson.Serialize(UnLote(UnEvento()));
            Assert.Equal(
                "{\"loteId\":\"11111111-2222-3333-4444-555555555555\",\"aplicativo\":\"Facturador\"," +
                "\"servidor\":\"SRV01\",\"appenderVersion\":\"1.0.0\",\"descartados\":3,\"eventos\":[" +
                "{\"ts\":\"2026-11-07T15:04:05.123Z\",\"nivel\":\"ERROR\",\"logger\":\"App.Foo\"," +
                "\"mensaje\":\"falló\",\"excepcion\":\"System.Exception: boom\",\"hilo\":\"7\"," +
                "\"propiedades\":{\"k\":\"v\"}}]}",
                json);
        }

        [Fact]
        public void Serialize_OmiteExcepcionEHiloSiSonNull()
        {
            var ev = UnEvento();
            ev.Exception = null;
            ev.Thread = null;
            var json = KuboJson.Serialize(UnLote(ev));
            Assert.DoesNotContain("excepcion", json);
            Assert.DoesNotContain("hilo", json);
            Assert.Contains("\"propiedades\":{\"k\":\"v\"}", json);
        }

        [Fact]
        public void Ts_EsIsoUtcConMilisegundos()
        {
            var anterior = Thread.CurrentThread.CurrentCulture;
            Thread.CurrentThread.CurrentCulture = new CultureInfo("es-PE");
            try
            {
                var json = KuboJson.Serialize(UnLote(UnEvento()));
                Assert.Contains("\"ts\":\"2026-11-07T15:04:05.123Z\"", json);
            }
            finally
            {
                Thread.CurrentThread.CurrentCulture = anterior;
            }
        }

        [Fact]
        public void WriteString_Escapa()
        {
            var sb = new StringBuilder();
            KuboJson.WriteString(sb, "a\"b\\c\n\r\t\u0001é😀");
            Assert.Equal("\"a\\\"b\\\\c\\n\\r\\t\\u0001é😀\"", sb.ToString());
        }

        [Fact]
        public void WriteString_EscribeSurrogadoSueltoComoUnicode()
        {
            // Un surrogado huérfano no es UTF-8 válido: se escapa para no corromper el cuerpo.
            var sb = new StringBuilder();
            KuboJson.WriteString(sb, "x\ud83dy");
            Assert.Equal("\"x\\ud83dy\"", sb.ToString());
        }

        [Fact]
        public void Truncate_CortaA32KYMarca()
        {
            var largo = new string('x', 40000);
            var cortado = KuboJson.Truncate(largo, KuboJson.MaxTextChars);
            Assert.Equal(32768, cortado.Length);
            Assert.EndsWith("…[recortado]", cortado);

            Assert.Equal("corto", KuboJson.Truncate("corto", KuboJson.MaxTextChars));
            Assert.Null(KuboJson.Truncate(null, KuboJson.MaxTextChars));
        }

        [Fact]
        public void Truncate_NoDejaMedioEmoji()
        {
            // El corte caería entre las dos mitades del emoji: debe retroceder una posición.
            var marca = "…[recortado]";
            var corte = 100 - marca.Length;
            var texto = new string('x', corte - 1) + "😀" + new string('y', 50);
            var cortado = KuboJson.Truncate(texto, 100);
            Assert.EndsWith(marca, cortado);
            Assert.False(char.IsHighSurrogate(cortado[cortado.Length - marca.Length - 1]));
            Assert.True(cortado.Length <= 100);
        }

#if NET
        [Fact]
        public void Serialize_EsParseableYRedondo()
        {
            var ev = UnEvento();
            ev.Message = "a\"b\\c\n\r\t\u0001é😀";
            var json = KuboJson.Serialize(UnLote(ev));

            using (var doc = System.Text.Json.JsonDocument.Parse(json))
            {
                var raiz = doc.RootElement;
                Assert.Equal("11111111-2222-3333-4444-555555555555", raiz.GetProperty("loteId").GetString());
                Assert.Equal("Facturador", raiz.GetProperty("aplicativo").GetString());
                Assert.Equal("SRV01", raiz.GetProperty("servidor").GetString());
                Assert.Equal("1.0.0", raiz.GetProperty("appenderVersion").GetString());
                Assert.Equal(3, raiz.GetProperty("descartados").GetInt64());
                var e = raiz.GetProperty("eventos")[0];
                Assert.Equal("2026-11-07T15:04:05.123Z", e.GetProperty("ts").GetString());
                Assert.Equal("ERROR", e.GetProperty("nivel").GetString());
                Assert.Equal("App.Foo", e.GetProperty("logger").GetString());
                Assert.Equal("a\"b\\c\n\r\t\u0001é😀", e.GetProperty("mensaje").GetString());
                Assert.Equal("System.Exception: boom", e.GetProperty("excepcion").GetString());
                Assert.Equal("7", e.GetProperty("hilo").GetString());
                Assert.Equal("v", e.GetProperty("propiedades").GetProperty("k").GetString());
            }
        }
#endif
    }
}
