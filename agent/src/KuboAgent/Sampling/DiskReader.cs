namespace KuboAgent.Sampling;

/// <summary>Unidades <c>DriveType.Fixed</c> con <c>IsReady</c>; el nombre va sin barra final (<c>"C:"</c>).</summary>
public sealed class DiskReader : IDiskReader
{
    public IReadOnlyList<DiskSample> Read()
    {
        var disks = new List<DiskSample>();
        foreach (var drive in DriveInfo.GetDrives())
        {
            try
            {
                if (drive.DriveType != DriveType.Fixed || !drive.IsReady) continue;
                disks.Add(new DiskSample(drive.Name.TrimEnd('\\'), drive.TotalSize, drive.TotalFreeSpace));
            }
            catch (IOException)
            {
                // La unidad dejó de estar lista entre IsReady y la lectura: se omite en esta muestra.
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
        return disks;
    }
}
