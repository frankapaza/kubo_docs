using System.ComponentModel;
using System.Runtime.InteropServices;

namespace KuboAgent.Sampling;

/// <summary>Memoria física en uso según <c>GlobalMemoryStatusEx</c>: (total − disponible) ÷ total.</summary>
public sealed class MemoryReader : IMemoryReader
{
    public double ReadPct()
    {
        var status = new MemoryStatusEx { dwLength = (uint)Marshal.SizeOf<MemoryStatusEx>() };
        if (!GlobalMemoryStatusEx(ref status)) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (status.ullTotalPhys == 0) return 0;
        return (status.ullTotalPhys - status.ullAvailPhys) * 100.0 / status.ullTotalPhys;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryStatusEx
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx buffer);
}
