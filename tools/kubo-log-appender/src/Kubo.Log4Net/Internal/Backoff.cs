using System;

namespace Kubo.Log4Net.Internal
{
    internal static class Backoff
    {
        private const int BaseMs = 1000;
        private const int MaxMs = 60000;

        /// <summary>
        /// Espera antes del reintento número <paramref name="attempt"/> (0 = primero): 1 s, 2 s, 4 s...
        /// hasta 60 s, más 0-20 % de jitter para que muchos servidores caídos a la vez no reintenten
        /// al unísono. Si el servidor pidió una espera (Retry-After) se respeta si es mayor.
        /// </summary>
        public static int DelayMs(int attempt, int retryAfterMs, Random rnd)
        {
            var baseMs = MaxMs;
            // Por encima de 2^6 ya se topa en 60 s; acotar evita desbordar el desplazamiento.
            if (attempt >= 0 && attempt < 6) baseMs = Math.Min(BaseMs << attempt, MaxMs);
            var jitter = (int)(baseMs * 0.2 * rnd.NextDouble());
            var delay = baseMs + jitter;
            return retryAfterMs > delay ? retryAfterMs : delay;
        }
    }
}
