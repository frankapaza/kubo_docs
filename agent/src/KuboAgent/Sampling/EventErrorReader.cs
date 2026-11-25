using System.Diagnostics.Eventing.Reader;
using System.Globalization;

namespace KuboAgent.Sampling;

/// <summary>
/// Cuenta los eventos críticos (Level=1) y de error (Level=2) de los registros System y
/// Application creados desde un instante, con <c>EventLogReader</c> y una consulta XPath.
/// </summary>
public sealed class EventErrorReader : IEventErrorReader
{
    /// <summary>Tope de cada contador (el mismo que valida la central).</summary>
    public const int MaxCount = 1_000_000_000;

    public EventErrorCounts CountSince(DateTime utc)
    {
        var query = Query(utc);
        return new EventErrorCounts(Count("System", query), Count("Application", query));
    }

    /// <summary>XPath del contrato: <c>*[System[(Level=1 or Level=2) and TimeCreated[@SystemTime&gt;='…']]]</c>.</summary>
    public static string Query(DateTime utc)
    {
        var at = DateTime.SpecifyKind(utc, DateTimeKind.Utc).ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
        return $"*[System[(Level=1 or Level=2) and TimeCreated[@SystemTime>='{at}']]]";
    }

    private static int Count(string logName, string xpath)
    {
        using var reader = new EventLogReader(new EventLogQuery(logName, PathType.LogName, xpath));
        var count = 0;
        while (count < MaxCount)
        {
            using var record = reader.ReadEvent();
            if (record is null) break;
            count++;
        }
        return count;
    }
}
