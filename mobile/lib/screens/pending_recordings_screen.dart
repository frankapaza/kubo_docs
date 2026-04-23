import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/recordings/outbox_service.dart';
import '../core/recordings/pending_recording.dart';

class PendingRecordingsScreen extends StatefulWidget {
  const PendingRecordingsScreen({super.key});
  @override
  State<PendingRecordingsScreen> createState() => _PendingRecordingsScreenState();
}

class _PendingRecordingsScreenState extends State<PendingRecordingsScreen> {
  final _service = OutboxService.instance;
  List<PendingRecording> _items = const [];
  bool _loading = true;
  int _rescued = 0;
  final Map<String, double> _progress = {};
  final Set<String> _busy = {};

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() { _loading = true; });
    final rescued = await _service.scanOrphans();
    final list = await _service.all();
    if (!mounted) return;
    setState(() {
      _items = list;
      _rescued = rescued;
      _loading = false;
    });
  }

  Future<void> _retry(PendingRecording rec) async {
    if (_busy.contains(rec.id)) return;
    setState(() {
      _busy.add(rec.id);
      _progress[rec.id] = 0;
    });
    final ok = await _service.retry(
      rec.id,
      onSendProgress: (sent, total) {
        if (!mounted || total <= 0) return;
        setState(() { _progress[rec.id] = sent / total; });
      },
    );
    if (!mounted) return;
    setState(() {
      _busy.remove(rec.id);
      _progress.remove(rec.id);
    });
    final list = await _service.all();
    if (!mounted) return;
    setState(() { _items = list; });
    if (ok) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Audio subido. Transcripción en curso.'),
      ));
    }
  }

  Future<void> _share(PendingRecording rec) async {
    await _service.share(rec.id);
  }

  Future<void> _confirmDiscard(PendingRecording rec) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Descartar grabación'),
        content: Text(
          'Se eliminará el archivo local de la reunión ${rec.meetingId}. '
          'Esta acción no se puede deshacer.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFFDC2626)),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Descartar'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await _service.discard(rec.id);
    final list = await _service.all();
    if (!mounted) return;
    setState(() { _items = list; });
  }

  Future<void> _forget(PendingRecording rec) async {
    await _service.forget(rec.id);
    final list = await _service.all();
    if (!mounted) return;
    setState(() { _items = list; });
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  String _formatDuration(int seconds) {
    if (seconds <= 0) return '—';
    final h = seconds ~/ 3600;
    final m = (seconds % 3600) ~/ 60;
    final s = seconds % 60;
    String two(int n) => n.toString().padLeft(2, '0');
    if (h > 0) return '${two(h)}:${two(m)}:${two(s)}';
    return '${two(m)}:${two(s)}';
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Pendientes por subir'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Escanear',
            onPressed: _loading ? null : _refresh,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _refresh,
              child: _items.isEmpty
                  ? ListView(
                      children: [
                        const SizedBox(height: 120),
                        Icon(Icons.cloud_done_rounded, size: 64, color: scheme.onSurfaceVariant),
                        const SizedBox(height: 16),
                        const Center(
                          child: Text(
                            'Sin grabaciones pendientes',
                            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
                          ),
                        ),
                        const SizedBox(height: 6),
                        Center(
                          child: Text(
                            'Todo se subió correctamente.',
                            style: TextStyle(color: scheme.onSurfaceVariant),
                          ),
                        ),
                      ],
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                      itemCount: _items.length + (_rescued > 0 ? 1 : 0),
                      separatorBuilder: (_, __) => const SizedBox(height: 10),
                      itemBuilder: (ctx, i) {
                        if (_rescued > 0 && i == 0) {
                          return _RescuedBanner(count: _rescued);
                        }
                        final idx = _rescued > 0 ? i - 1 : i;
                        final rec = _items[idx];
                        return _RecordingCard(
                          rec: rec,
                          progress: _progress[rec.id],
                          busy: _busy.contains(rec.id),
                          formatBytes: _formatBytes,
                          formatDuration: _formatDuration,
                          onRetry: () => _retry(rec),
                          onShare: () => _share(rec),
                          onDiscard: () => _confirmDiscard(rec),
                          onForget: () => _forget(rec),
                        );
                      },
                    ),
            ),
    );
  }
}

class _RescuedBanner extends StatelessWidget {
  final int count;
  const _RescuedBanner({required this.count});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFDCFCE7),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          const Icon(Icons.restore_rounded, size: 20, color: Color(0xFF166534)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              count == 1
                  ? 'Se recuperó 1 grabación del almacenamiento local.'
                  : 'Se recuperaron $count grabaciones del almacenamiento local.',
              style: const TextStyle(fontSize: 13, color: Color(0xFF166534)),
            ),
          ),
        ],
      ),
    );
  }
}

class _RecordingCard extends StatelessWidget {
  final PendingRecording rec;
  final double? progress;
  final bool busy;
  final String Function(int) formatBytes;
  final String Function(int) formatDuration;
  final VoidCallback onRetry;
  final VoidCallback onShare;
  final VoidCallback onDiscard;
  final VoidCallback onForget;

  const _RecordingCard({
    required this.rec,
    required this.progress,
    required this.busy,
    required this.formatBytes,
    required this.formatDuration,
    required this.onRetry,
    required this.onShare,
    required this.onDiscard,
    required this.onForget,
  });

  ({Color bg, Color fg, String label, IconData icon}) _statusStyle() {
    switch (rec.status) {
      case RecordingStatus.pending:
        return (
          bg: const Color(0xFFFEF3C7),
          fg: const Color(0xFF92400E),
          label: 'Pendiente',
          icon: Icons.cloud_upload_outlined,
        );
      case RecordingStatus.uploading:
        return (
          bg: const Color(0xFFE0F2FE),
          fg: const Color(0xFF075985),
          label: 'Subiendo',
          icon: Icons.sync_rounded,
        );
      case RecordingStatus.failed:
        return (
          bg: const Color(0xFFFEE2E2),
          fg: const Color(0xFF991B1B),
          label: 'Falló',
          icon: Icons.error_outline_rounded,
        );
      case RecordingStatus.done:
        return (
          bg: const Color(0xFFDCFCE7),
          fg: const Color(0xFF166534),
          label: 'Subida',
          icon: Icons.check_circle_rounded,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final s = _statusStyle();
    final df = DateFormat("d 'de' MMM HH:mm", 'es');
    final isDone = rec.status == RecordingStatus.done;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Reunión ${rec.meetingId}',
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: s.bg,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(s.icon, size: 12, color: s.fg),
                      const SizedBox(width: 4),
                      Text(s.label,
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: s.fg,
                          )),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Icon(Icons.schedule_rounded, size: 14, color: scheme.onSurfaceVariant),
                const SizedBox(width: 4),
                Text(formatDuration(rec.durationSeconds),
                    style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
                const SizedBox(width: 12),
                Icon(Icons.storage_rounded, size: 14, color: scheme.onSurfaceVariant),
                const SizedBox(width: 4),
                Text(formatBytes(rec.sizeBytes),
                    style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
                const SizedBox(width: 12),
                Icon(Icons.event_rounded, size: 14, color: scheme.onSurfaceVariant),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(df.format(rec.createdAt),
                      style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                      overflow: TextOverflow.ellipsis),
                ),
              ],
            ),
            if (rec.lastError != null && rec.status != RecordingStatus.done) ...[
              const SizedBox(height: 8),
              Text(
                rec.lastError!,
                style: const TextStyle(fontSize: 12, color: Color(0xFF991B1B)),
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
            ],
            if (busy) ...[
              const SizedBox(height: 10),
              ClipRRect(
                borderRadius: BorderRadius.circular(999),
                child: LinearProgressIndicator(value: progress, minHeight: 6),
              ),
              if (progress != null) ...[
                const SizedBox(height: 4),
                Text('${(progress! * 100).toStringAsFixed(0)}%',
                    style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant)),
              ],
            ],
            const SizedBox(height: 12),
            Row(
              children: [
                if (isDone) ...[
                  Expanded(
                    child: FilledButton.icon(
                      icon: const Icon(Icons.delete_outline_rounded, size: 18),
                      label: const Text('Quitar de la lista'),
                      onPressed: onForget,
                    ),
                  ),
                ] else ...[
                  Expanded(
                    child: FilledButton.icon(
                      icon: const Icon(Icons.cloud_upload_rounded, size: 18),
                      label: Text(busy ? 'Subiendo…' : 'Reintentar'),
                      onPressed: busy ? null : onRetry,
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.outlined(
                    tooltip: 'Compartir',
                    icon: const Icon(Icons.share_rounded, size: 18),
                    onPressed: busy ? null : onShare,
                  ),
                  const SizedBox(width: 4),
                  IconButton.outlined(
                    tooltip: 'Descartar',
                    icon: const Icon(Icons.delete_outline_rounded, size: 18),
                    onPressed: busy ? null : onDiscard,
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}
