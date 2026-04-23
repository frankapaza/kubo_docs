enum RecordingStatus { pending, uploading, failed, done }

RecordingStatus _statusFromString(String? v) {
  switch (v) {
    case 'uploading':
      return RecordingStatus.uploading;
    case 'failed':
      return RecordingStatus.failed;
    case 'done':
      return RecordingStatus.done;
    default:
      return RecordingStatus.pending;
  }
}

String _statusToString(RecordingStatus s) {
  switch (s) {
    case RecordingStatus.pending:
      return 'pending';
    case RecordingStatus.uploading:
      return 'uploading';
    case RecordingStatus.failed:
      return 'failed';
    case RecordingStatus.done:
      return 'done';
  }
}

class PendingRecording {
  final String id;
  final int meetingId;
  final String filePath;
  final DateTime createdAt;
  final int durationSeconds;
  final int sizeBytes;
  final RecordingStatus status;
  final String? lastError;
  final int attempts;

  const PendingRecording({
    required this.id,
    required this.meetingId,
    required this.filePath,
    required this.createdAt,
    required this.durationSeconds,
    required this.sizeBytes,
    required this.status,
    this.lastError,
    this.attempts = 0,
  });

  PendingRecording copyWith({
    RecordingStatus? status,
    String? lastError,
    int? attempts,
    int? sizeBytes,
    int? durationSeconds,
  }) {
    return PendingRecording(
      id: id,
      meetingId: meetingId,
      filePath: filePath,
      createdAt: createdAt,
      durationSeconds: durationSeconds ?? this.durationSeconds,
      sizeBytes: sizeBytes ?? this.sizeBytes,
      status: status ?? this.status,
      lastError: lastError,
      attempts: attempts ?? this.attempts,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'meetingId': meetingId,
        'filePath': filePath,
        'createdAt': createdAt.toIso8601String(),
        'durationSeconds': durationSeconds,
        'sizeBytes': sizeBytes,
        'status': _statusToString(status),
        'lastError': lastError,
        'attempts': attempts,
      };

  factory PendingRecording.fromJson(Map<String, dynamic> j) => PendingRecording(
        id: j['id'] as String,
        meetingId: j['meetingId'] as int,
        filePath: j['filePath'] as String,
        createdAt: DateTime.parse(j['createdAt'] as String),
        durationSeconds: (j['durationSeconds'] as num?)?.toInt() ?? 0,
        sizeBytes: (j['sizeBytes'] as num?)?.toInt() ?? 0,
        status: _statusFromString(j['status'] as String?),
        lastError: j['lastError'] as String?,
        attempts: (j['attempts'] as num?)?.toInt() ?? 0,
      );
}
