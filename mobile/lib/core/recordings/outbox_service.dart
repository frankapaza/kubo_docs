import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../api/meetings_api.dart';
import 'pending_recording.dart';

/// Outbox persistente para grabaciones.
///
/// El archivo de audio vive en {documents}/recordings/; el índice de estado en
/// {documents}/recordings/outbox.json. Así una grabación sobrevive al cierre
/// de la app y a reintentos de upload fallidos.
class OutboxService {
  OutboxService._();
  static final instance = OutboxService._();

  static const _recordingsDirName = 'recordings';
  static const _indexFileName = 'outbox.json';
  static final RegExp _orphanFileRegex = RegExp(r'^kubo_(\d+)_(\d+)\.m4a$');

  final _api = MeetingsApi();
  final _controller = StreamController<List<PendingRecording>>.broadcast();
  List<PendingRecording>? _cache;
  Future<void>? _loading;

  Stream<List<PendingRecording>> watch() => _controller.stream;

  Future<Directory> recordingsDir() async {
    final docs = await getApplicationDocumentsDirectory();
    final dir = Directory('${docs.path}/$_recordingsDirName');
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
    return dir;
  }

  Future<File> _indexFile() async {
    final dir = await recordingsDir();
    return File('${dir.path}/$_indexFileName');
  }

  Future<List<PendingRecording>> _load() async {
    if (_cache != null) return _cache!;
    _loading ??= () async {
      final file = await _indexFile();
      if (!await file.exists()) {
        _cache = <PendingRecording>[];
        return;
      }
      try {
        final raw = await file.readAsString();
        if (raw.trim().isEmpty) {
          _cache = <PendingRecording>[];
          return;
        }
        final list = jsonDecode(raw) as List;
        _cache = list
            .map((e) => PendingRecording.fromJson(Map<String, dynamic>.from(e)))
            .toList();
      } catch (_) {
        _cache = <PendingRecording>[];
      }
    }();
    await _loading;
    return _cache!;
  }

  Future<void> _persist() async {
    final file = await _indexFile();
    final list = _cache ?? <PendingRecording>[];
    await file.writeAsString(jsonEncode(list.map((e) => e.toJson()).toList()));
    _controller.add(List.unmodifiable(list));
  }

  Future<List<PendingRecording>> all() async {
    final list = await _load();
    list.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return List.unmodifiable(list);
  }

  /// Genera la ruta destino para una nueva grabación.
  Future<String> buildFilePath({required int meetingId}) async {
    final dir = await recordingsDir();
    final ts = DateTime.now().millisecondsSinceEpoch;
    return '${dir.path}/kubo_${meetingId}_$ts.m4a';
  }

  /// Registra una grabación recién terminada.
  Future<PendingRecording> register({
    required int meetingId,
    required String filePath,
    required int durationSeconds,
  }) async {
    final list = await _load();
    final file = File(filePath);
    final size = await file.exists() ? await file.length() : 0;
    final rec = PendingRecording(
      id: '${DateTime.now().microsecondsSinceEpoch}',
      meetingId: meetingId,
      filePath: filePath,
      createdAt: DateTime.now(),
      durationSeconds: durationSeconds,
      sizeBytes: size,
      status: RecordingStatus.pending,
    );
    list.add(rec);
    await _persist();
    return rec;
  }

  Future<void> _replace(PendingRecording updated) async {
    final list = await _load();
    final idx = list.indexWhere((r) => r.id == updated.id);
    if (idx == -1) return;
    list[idx] = updated;
    await _persist();
  }

  Future<PendingRecording?> byId(String id) async {
    final list = await _load();
    final idx = list.indexWhere((r) => r.id == id);
    return idx == -1 ? null : list[idx];
  }

  /// Reintenta subir una grabación. Devuelve true si terminó OK.
  Future<bool> retry(
    String id, {
    void Function(int sent, int total)? onSendProgress,
  }) async {
    final rec = await byId(id);
    if (rec == null) return false;
    if (!await File(rec.filePath).exists()) {
      await _replace(rec.copyWith(
        status: RecordingStatus.failed,
        lastError: 'Archivo local no encontrado',
      ));
      return false;
    }
    await _replace(rec.copyWith(
      status: RecordingStatus.uploading,
      attempts: rec.attempts + 1,
      lastError: null,
    ));
    try {
      await _api.uploadAudio(
        meetingId: rec.meetingId,
        filePath: rec.filePath,
        durationSeconds: rec.durationSeconds,
        onSendProgress: onSendProgress,
      );
      await _replace(rec.copyWith(
        status: RecordingStatus.done,
        attempts: rec.attempts + 1,
        lastError: null,
      ));
      return true;
    } catch (e) {
      await _replace(rec.copyWith(
        status: RecordingStatus.failed,
        attempts: rec.attempts + 1,
        lastError: e.toString(),
      ));
      return false;
    }
  }

  /// Abre el sheet de compartir para una grabación.
  Future<void> share(String id) async {
    final rec = await byId(id);
    if (rec == null) return;
    final file = XFile(rec.filePath);
    await Share.shareXFiles(
      [file],
      subject: 'Grabación Kubo — reunión ${rec.meetingId}',
    );
  }

  /// Elimina la grabación (archivo local + entrada).
  Future<void> discard(String id) async {
    final list = await _load();
    final idx = list.indexWhere((r) => r.id == id);
    if (idx == -1) return;
    final rec = list[idx];
    final f = File(rec.filePath);
    if (await f.exists()) {
      await f.delete();
    }
    list.removeAt(idx);
    await _persist();
  }

  /// Elimina entrada del índice pero deja el archivo físico intacto.
  Future<void> forget(String id) async {
    final list = await _load();
    final idx = list.indexWhere((r) => r.id == id);
    if (idx == -1) return;
    list.removeAt(idx);
    await _persist();
  }

  /// Busca archivos de audio huérfanos (en documents/recordings y en el cache
  /// temporal) que no están en el índice y los registra como pendientes.
  /// Útil para rescatar grabaciones de versiones anteriores de la app.
  Future<int> scanOrphans() async {
    final list = await _load();
    final knownPaths = list.map((r) => r.filePath).toSet();
    int rescued = 0;

    final dirs = <Directory>[
      await recordingsDir(),
      await getTemporaryDirectory(),
    ];

    for (final dir in dirs) {
      if (!await dir.exists()) continue;
      await for (final entity in dir.list(followLinks: false)) {
        if (entity is! File) continue;
        final name = entity.uri.pathSegments.last;
        final match = _orphanFileRegex.firstMatch(name);
        if (match == null) continue;
        if (knownPaths.contains(entity.path)) continue;

        final meetingId = int.tryParse(match.group(1)!);
        final ts = int.tryParse(match.group(2)!);
        if (meetingId == null) continue;

        final size = await entity.length();
        list.add(PendingRecording(
          id: '${DateTime.now().microsecondsSinceEpoch}_$rescued',
          meetingId: meetingId,
          filePath: entity.path,
          createdAt: ts != null
              ? DateTime.fromMillisecondsSinceEpoch(ts)
              : DateTime.now(),
          durationSeconds: 0,
          sizeBytes: size,
          status: RecordingStatus.pending,
          lastError: 'Rescatado del almacenamiento local',
        ));
        knownPaths.add(entity.path);
        rescued++;
      }
    }

    if (rescued > 0) await _persist();
    return rescued;
  }
}
