using System;
using Kubo.Log4Net.Internal;
using Xunit;

namespace Kubo.Log4Net.Tests
{
    public class BackoffTests
    {
        [Theory]
        [InlineData(0, 1000)]
        [InlineData(1, 2000)]
        [InlineData(3, 8000)]
        [InlineData(6, 60000)]
        [InlineData(40, 60000)]
        public void CreceYSeTopaEn60sConJitterDeHastaVeintePorCiento(int intento, int baseMs)
        {
            var rnd = new Random(1);
            for (var i = 0; i < 50; i++)
            {
                var d = Backoff.DelayMs(intento, 0, rnd);
                Assert.InRange(d, baseMs, baseMs * 1.2);
            }
        }

        [Fact]
        public void RetryAfterMayorGana()
        {
            Assert.Equal(30000, Backoff.DelayMs(0, 30000, new Random(1)));
            Assert.InRange(Backoff.DelayMs(3, 1000, new Random(1)), 8000, 9600);
        }
    }
}
