namespace KuboAgent.Sampling;

/// <summary>Uso total de CPU, de 0 a 100.</summary>
public interface ICpuReader
{
    double ReadPct();
}

/// <summary>Memoria física en uso, de 0 a 100.</summary>
public interface IMemoryReader
{
    double ReadPct();
}

/// <summary>Unidades fijas listas.</summary>
public interface IDiskReader
{
    IReadOnlyList<DiskSample> Read();
}

/// <summary>Grupos de aplicaciones de IIS; <c>null</c> si IIS no está instalado o no se puede leer.</summary>
public interface IIisReader
{
    IReadOnlyList<IisPoolSample>? Read();
}

/// <summary>Estado de los servicios de Windows pedidos; uno inexistente da <c>"NotFound"</c>.</summary>
public interface IServiceReader
{
    IReadOnlyList<ServiceSample> Read(IReadOnlyList<string> names);
}

/// <summary>Errores y críticos del Visor de eventos (Sistema y Aplicación) creados en [<c>utc</c>, <c>untilUtc</c>).</summary>
public interface IEventErrorReader
{
    EventErrorCounts CountSince(DateTime utc, DateTime untilUtc);
}
