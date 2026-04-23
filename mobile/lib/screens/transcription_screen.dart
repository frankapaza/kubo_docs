import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import '../core/api/meetings_api.dart';
import '../core/theme.dart';
import '../models/transcription.dart';

class TranscriptionScreen extends StatefulWidget {
  final int meetingId;
  const TranscriptionScreen({super.key, required this.meetingId});
  @override
  State<TranscriptionScreen> createState() => _TranscriptionScreenState();
}

class _TranscriptionScreenState extends State<TranscriptionScreen> {
  final _api = MeetingsApi();
  Transcription? _transcription;
  Timer? _poller;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
    _poller = Timer.periodic(const Duration(seconds: 5), (_) => _load());
  }

  @override
  void dispose() {
    _poller?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final t = await _api.getTranscription(widget.meetingId);
      if (!mounted) return;
      setState(() { _transcription = t; _loading = false; _error = null; });
      if (t != null && t.isTerminal) _poller?.cancel();
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _copy(String text) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Transcripción copiada al portapapeles')),
    );
  }

  _StatusInfo _statusInfo(String status) {
    switch (status) {
      case 'PENDING':
        return const _StatusInfo('En cola', 'Esperando procesamiento…',
            Icons.hourglass_top_rounded, Color(0xFFEEF2FF), Color(0xFF3730A3));
      case 'PROCESSING':
        return const _StatusInfo('Transcribiendo', 'Convirtiendo audio a texto…',
            Icons.graphic_eq_rounded, Color(0xFFFCE7F3), Color(0xFF9D174D));
      case 'COMPLETED':
        return const _StatusInfo('Completada', 'La transcripción está lista.',
            Icons.check_circle_rounded, Color(0xFFDCFCE7), Color(0xFF166534));
      case 'FAILED':
        return const _StatusInfo('Falló', 'Hubo un problema al transcribir.',
            Icons.error_rounded, Color(0xFFFEE2E2), Color(0xFF991B1B));
      default:
        return _StatusInfo(status, 'Estado desconocido',
            Icons.help_outline_rounded, const Color(0xFFE5E7EB), const Color(0xFF374151));
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          tooltip: 'Volver',
          onPressed: () {
            if (context.canPop()) {
              context.pop();
            } else {
              context.go('/meetings/${widget.meetingId}');
            }
          },
        ),
        title: const Text('Transcripción'),
        actions: [
          if (_transcription?.contentText != null && _transcription?.status == 'COMPLETED')
            IconButton(
              icon: const Icon(Icons.copy_rounded),
              tooltip: 'Copiar',
              onPressed: () => _copy(_transcription!.contentText!),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _ErrorView(message: _error!, onRetry: () {
                  setState(() { _loading = true; _error = null; });
                  _load();
                })
              : _transcription == null
                  ? _NoAudioView()
                  : _buildContent(scheme),
    );
  }

  Widget _buildContent(ColorScheme scheme) {
    final t = _transcription!;
    final info = _statusInfo(t.status);
    final done = t.status == 'COMPLETED';
    final failed = t.status == 'FAILED';

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Container(
                    width: 44, height: 44,
                    decoration: BoxDecoration(
                      color: info.bg,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(info.icon, color: info.fg),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(info.title,
                          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                        const SizedBox(height: 2),
                        Text(info.subtitle,
                          style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
                      ],
                    ),
                  ),
                  if (!t.isTerminal)
                    const SizedBox(
                      width: 20, height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          if (failed) ...[
            Card(
              color: const Color(0xFFFEF2F2),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
                side: const BorderSide(color: Color(0xFFFECACA)),
              ),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Detalle del error',
                      style: TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w600,
                        color: Color(0xFF991B1B),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(t.errorMessage ?? 'Sin información adicional.',
                      style: const TextStyle(fontSize: 13, color: Color(0xFF7F1D1D))),
                  ],
                ),
              ),
            ),
          ],
          if (done) ...[
            Row(
              children: [
                const Icon(Icons.article_outlined, size: 18),
                const SizedBox(width: 8),
                const Text('Texto transcrito',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                const Spacer(),
                TextButton.icon(
                  icon: const Icon(Icons.copy_rounded, size: 16),
                  label: const Text('Copiar'),
                  onPressed: () => _copy(t.contentText ?? ''),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: SelectableText(
                  (t.contentText?.trim().isEmpty ?? true)
                      ? '(Sin contenido)'
                      : t.contentText!,
                  style: const TextStyle(fontSize: 14, height: 1.55),
                ),
              ),
            ),
          ],
          if (!t.isTerminal) ...[
            const SizedBox(height: 8),
            Center(
              child: Text(
                'Se actualizará automáticamente cada pocos segundos.',
                style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
              ),
            ),
          ],
          if (t.isTerminal) ...[
            const SizedBox(height: 20),
            FilledButton.icon(
              icon: const Icon(Icons.event_note_rounded),
              label: const Text('Volver a la reunión'),
              onPressed: () => context.go('/meetings/${widget.meetingId}'),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              icon: const Icon(Icons.list_rounded),
              label: const Text('Ver todas las reuniones'),
              onPressed: () => context.go('/meetings'),
            ),
          ],
        ],
      ),
    );
  }
}

class _StatusInfo {
  final String title;
  final String subtitle;
  final IconData icon;
  final Color bg;
  final Color fg;
  const _StatusInfo(this.title, this.subtitle, this.icon, this.bg, this.fg);
}

class _NoAudioView extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListView(
      padding: const EdgeInsets.all(32),
      children: [
        const SizedBox(height: 100),
        Container(
          width: 72, height: 72,
          margin: const EdgeInsets.symmetric(horizontal: 140),
          decoration: BoxDecoration(
            color: KuboColors.brandSurface,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Icon(Icons.mic_off_rounded, size: 36, color: scheme.primary),
        ),
        const SizedBox(height: 20),
        const Center(
          child: Text('Aún no hay audio',
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
        ),
        const SizedBox(height: 6),
        Center(
          child: Text('Graba la reunión primero para obtener su transcripción.',
            textAlign: TextAlign.center,
            style: TextStyle(color: scheme.onSurfaceVariant)),
        ),
      ],
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const SizedBox(height: 100),
        Icon(Icons.cloud_off_rounded, size: 52, color: scheme.error),
        const SizedBox(height: 12),
        const Center(
          child: Text('No pudimos cargar la transcripción',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
        ),
        const SizedBox(height: 6),
        Center(
          child: Text(message, textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
        ),
        const SizedBox(height: 20),
        Center(
          child: OutlinedButton.icon(
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Reintentar'),
            onPressed: onRetry,
          ),
        ),
      ],
    );
  }
}
