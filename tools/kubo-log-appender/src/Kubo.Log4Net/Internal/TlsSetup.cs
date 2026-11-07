using System.Net;

namespace Kubo.Log4Net.Internal
{
    internal static class TlsSetup
    {
        // net45 no tiene SecurityProtocolType.Tls12 ni SystemDefault en el enum: se usan los valores numéricos.
        private const int Tls12 = 3072;

        /// <summary>
        /// Suma TLS 1.2 a los protocolos activos sin quitar ninguno: en .NET Framework 4.5 el valor
        /// por omisión no lo incluye y el servidor lo exige. Con 0 (SystemDefault) no se toca: el
        /// sistema ya elige el mejor, y forzar Tls12 ahí quitaría TLS 1.3 en .NET 5+.
        /// </summary>
        public static void EnsureTls12()
        {
            var actual = (int)ServicePointManager.SecurityProtocol;
            if (actual == 0 || (actual & Tls12) == Tls12) return;
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)(actual | Tls12);
        }
    }
}
