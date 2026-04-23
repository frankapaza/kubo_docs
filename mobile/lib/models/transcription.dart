class Transcription {
  final int id;
  final String status;
  final String? contentText;
  final String? errorMessage;

  Transcription({
    required this.id,
    required this.status,
    this.contentText,
    this.errorMessage,
  });

  factory Transcription.fromJson(Map<String, dynamic> j) => Transcription(
        id: _asInt(j['id']),
        status: j['status'] as String,
        contentText: j['contentText'] as String?,
        errorMessage: j['errorMessage'] as String?,
      );

  bool get isTerminal => status == 'COMPLETED' || status == 'FAILED';
}

int _asInt(dynamic v) {
  if (v is int) return v;
  if (v is String) return int.parse(v);
  if (v is num) return v.toInt();
  throw FormatException('Cannot parse int from: $v');
}
