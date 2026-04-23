import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:just_audio/just_audio.dart';
import 'package:record/record.dart';
import '../core/config.dart';
import '../core/recordings/outbox_service.dart';
import '../core/theme.dart';

class RecordingScreen extends StatefulWidget {
  final int meetingId;
  const RecordingScreen({super.key, required this.meetingId});
  @override
  State<RecordingScreen> createState() => _RecordingScreenState();
}

class _RecordingScreenState extends State<RecordingScreen>
    with SingleTickerProviderStateMixin {
  final _recorder = AudioRecorder();
  final _player = AudioPlayer();

  String? _filePath;
  String? _pendingId;
  bool _isRecording = false;
  bool _isPaused = false;
  Duration _elapsed = Duration.zero;
  Timer? _ticker;
  bool _uploading = false;
  double? _uploadProgress;
  String? _message;
  bool _messageIsError = false;

  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _ticker?.cancel();
    _pulse.dispose();
    _recorder.dispose();
    _player.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    if (!await _recorder.hasPermission()) {
      setState(() {
        _message = 'Permiso de micrófono denegado.';
        _messageIsError = true;
      });
      return;
    }
    final path = await OutboxService.instance.buildFilePath(meetingId: widget.meetingId);
    await _recorder.start(const RecordConfig(encoder: AudioEncoder.aacLc), path: path);
    _filePath = path;
    _pendingId = null;
    setState(() {
      _isRecording = true;
      _isPaused = false;
      _elapsed = Duration.zero;
      _message = null;
    });
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && !_isPaused) setState(() { _elapsed += const Duration(seconds: 1); });
    });
  }

  Future<void> _pause() async {
    await _recorder.pause();
    setState(() { _isPaused = true; });
  }

  Future<void> _resume() async {
    await _recorder.resume();
    setState(() { _isPaused = false; });
  }

  Future<void> _stop() async {
    _ticker?.cancel();
    final path = await _recorder.stop();
    final resolved = path ?? _filePath;
    setState(() {
      _isRecording = false;
      _isPaused = false;
      _filePath = resolved;
    });
    if (resolved != null && File(resolved).existsSync()) {
      final rec = await OutboxService.instance.register(
        meetingId: widget.meetingId,
        filePath: resolved,
        durationSeconds: _elapsed.inSeconds,
      );
      _pendingId = rec.id;
    }
  }

  Future<void> _playPreview() async {
    if (_filePath == null) return;
    await _player.setFilePath(_filePath!);
    await _player.play();
  }

  Future<void> _discard() async {
    await _player.stop();
    if (_pendingId != null) {
      await OutboxService.instance.discard(_pendingId!);
    } else if (_filePath != null) {
      final f = File(_filePath!);
      if (await f.exists()) await f.delete();
    }
    if (!mounted) return;
    setState(() {
      _filePath = null;
      _pendingId = null;
      _elapsed = Duration.zero;
      _message = null;
    });
  }

  Future<void> _upload() async {
    if (_filePath == null || !File(_filePath!).existsSync()) return;
    if (_pendingId == null) return;

    final sizeBytes = await File(_filePath!).length();
    final sizeMb = sizeBytes / (1024 * 1024);
    const maxMb = AppConfig.audioMaxSizeMb;
    if (sizeMb > maxMb) {
      setState(() {
        _message =
            'El archivo pesa ${sizeMb.toStringAsFixed(1)} MB y excede el máximo de $maxMb MB. '
            'Reduce la duración o divide la grabación. '
            'Mientras tanto queda guardada en Pendientes por subir.';
        _messageIsError = true;
      });
      return;
    }

    setState(() {
      _uploading = true;
      _uploadProgress = 0;
      _message = null;
      _messageIsError = false;
    });
    final ok = await OutboxService.instance.retry(
      _pendingId!,
      onSendProgress: (sent, total) {
        if (!mounted || total <= 0) return;
        setState(() { _uploadProgress = sent / total; });
      },
    );
    if (!mounted) return;
    setState(() {
      _uploading = false;
      _uploadProgress = null;
    });
    if (ok) {
      setState(() {
        _message = 'Audio enviado. Transcripción en curso.';
        _messageIsError = false;
      });
      await Future.delayed(const Duration(seconds: 1));
      if (!mounted) return;
      context.go('/meetings/${widget.meetingId}/transcription');
    } else {
      final rec = await OutboxService.instance.byId(_pendingId!);
      if (!mounted) return;
      setState(() {
        _message = 'No se pudo subir: ${rec?.lastError ?? 'error desconocido'}. '
            'La grabación quedó guardada en Pendientes por subir.';
        _messageIsError = true;
      });
    }
  }

  String _fmt(Duration d) {
    String two(int n) => n.toString().padLeft(2, '0');
    final h = d.inHours;
    if (h > 0) return '${two(h)}:${two(d.inMinutes % 60)}:${two(d.inSeconds % 60)}';
    return '${two(d.inMinutes)}:${two(d.inSeconds % 60)}';
  }

  String get _statusLabel {
    if (_isRecording && _isPaused) return 'Pausado';
    if (_isRecording) return 'Grabando…';
    if (_filePath != null) return 'Lista para enviar';
    return 'Listo para grabar';
  }

  Color _statusBg(ColorScheme scheme) {
    if (_isRecording && !_isPaused) return const Color(0xFFFEE2E2);
    if (_isPaused) return const Color(0xFFFEF3C7);
    if (_filePath != null) return const Color(0xFFDCFCE7);
    return KuboColors.brandSurface;
  }

  Color _statusFg(ColorScheme scheme) {
    if (_isRecording && !_isPaused) return const Color(0xFF991B1B);
    if (_isPaused) return const Color(0xFF92400E);
    if (_filePath != null) return const Color(0xFF166534);
    return scheme.primary;
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final hasFile = _filePath != null && !_isRecording;
    final activePulse = _isRecording && !_isPaused;

    return Scaffold(
      appBar: AppBar(title: const Text('Grabación')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                alignment: Alignment.center,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: _statusBg(scheme),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (activePulse)
                        _LiveDot(color: _statusFg(scheme))
                      else
                        Icon(
                          _isPaused
                              ? Icons.pause_rounded
                              : (hasFile ? Icons.check_circle_rounded : Icons.mic_rounded),
                          size: 14,
                          color: _statusFg(scheme),
                        ),
                      const SizedBox(width: 6),
                      Text(_statusLabel,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: _statusFg(scheme),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 28),
              Center(
                child: AnimatedBuilder(
                  animation: _pulse,
                  builder: (ctx, _) {
                    final t = activePulse ? _pulse.value : 0.0;
                    return Stack(
                      alignment: Alignment.center,
                      children: [
                        if (activePulse)
                          Container(
                            width: 200 + t * 40,
                            height: 200 + t * 40,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: Colors.red.withOpacity(0.10 * (1 - t)),
                            ),
                          ),
                        Container(
                          width: 170,
                          height: 170,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: activePulse
                                ? const Color(0xFFFEE2E2)
                                : KuboColors.brandSurface,
                          ),
                          child: Icon(
                            activePulse ? Icons.graphic_eq_rounded : Icons.mic_rounded,
                            size: 72,
                            color: activePulse ? const Color(0xFFDC2626) : scheme.primary,
                          ),
                        ),
                      ],
                    );
                  },
                ),
              ),
              const SizedBox(height: 28),
              Text(
                _fmt(_elapsed),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 52,
                  fontWeight: FontWeight.w300,
                  letterSpacing: 1.5,
                  fontFeatures: [FontFeature.tabularFigures()],
                ),
              ),
              const SizedBox(height: 8),
              Text(
                _isRecording
                    ? 'Habla con claridad, la sala de reuniones es tuya.'
                    : (hasFile
                        ? 'Escucha un preview o envía a transcripción.'
                        : 'Toca para comenzar a grabar esta reunión.'),
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
              ),
              const Spacer(),
              if (!_isRecording && !hasFile)
                FilledButton.icon(
                  icon: const Icon(Icons.mic_rounded),
                  label: const Text('Iniciar grabación'),
                  onPressed: _start,
                ),
              if (_isRecording) ...[
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        icon: Icon(_isPaused ? Icons.play_arrow_rounded : Icons.pause_rounded),
                        label: Text(_isPaused ? 'Reanudar' : 'Pausar'),
                        onPressed: _isPaused ? _resume : _pause,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton.icon(
                        style: FilledButton.styleFrom(
                          backgroundColor: const Color(0xFFDC2626),
                        ),
                        icon: const Icon(Icons.stop_rounded),
                        label: const Text('Finalizar'),
                        onPressed: _stop,
                      ),
                    ),
                  ],
                ),
              ],
              if (hasFile) ...[
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        icon: const Icon(Icons.play_arrow_rounded),
                        label: const Text('Reproducir'),
                        onPressed: _uploading ? null : _playPreview,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton.icon(
                        icon: _uploading
                            ? const SizedBox(
                                width: 16, height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2, color: Colors.white))
                            : const Icon(Icons.cloud_upload_rounded),
                        label: Text(
                          _uploading
                              ? (_uploadProgress == null
                                  ? 'Enviando…'
                                  : 'Enviando ${(_uploadProgress! * 100).toStringAsFixed(0)}%')
                              : 'Enviar',
                        ),
                        onPressed: _uploading ? null : _upload,
                      ),
                    ),
                  ],
                ),
                if (_uploading) ...[
                  const SizedBox(height: 12),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(999),
                    child: LinearProgressIndicator(
                      value: _uploadProgress,
                      minHeight: 6,
                    ),
                  ),
                ],
                const SizedBox(height: 10),
                TextButton.icon(
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('Descartar y grabar otra vez'),
                  onPressed: _uploading ? null : _discard,
                ),
              ],
              if (_message != null) ...[
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  decoration: BoxDecoration(
                    color: _messageIsError ? scheme.errorContainer : const Color(0xFFDCFCE7),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(children: [
                    Icon(
                      _messageIsError ? Icons.error_outline_rounded : Icons.check_circle_rounded,
                      size: 18,
                      color: _messageIsError ? scheme.onErrorContainer : const Color(0xFF166534),
                    ),
                    const SizedBox(width: 10),
                    Expanded(child: Text(_message!,
                      style: TextStyle(
                        fontSize: 13,
                        color: _messageIsError ? scheme.onErrorContainer : const Color(0xFF166534),
                      ),
                    )),
                  ]),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _LiveDot extends StatefulWidget {
  final Color color;
  const _LiveDot({required this.color});
  @override
  State<_LiveDot> createState() => _LiveDotState();
}

class _LiveDotState extends State<_LiveDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat(reverse: true);

  @override
  void dispose() { _c.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: Tween(begin: 0.35, end: 1.0).animate(_c),
      child: Container(
        width: 10, height: 10,
        decoration: BoxDecoration(color: widget.color, shape: BoxShape.circle),
      ),
    );
  }
}
