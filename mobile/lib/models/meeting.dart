class Meeting {
  final int id;
  final int projectId;
  final String title;
  final String? description;
  final DateTime scheduledAt;
  final String? location;
  final String status;

  Meeting({
    required this.id,
    required this.projectId,
    required this.title,
    required this.scheduledAt,
    required this.status,
    this.description,
    this.location,
  });

  factory Meeting.fromJson(Map<String, dynamic> j) => Meeting(
        id: _asInt(j['id']),
        projectId: _asInt(j['projectId']),
        title: j['title'] as String,
        description: j['description'] as String?,
        scheduledAt: DateTime.parse(j['scheduledAt'] as String),
        location: j['location'] as String?,
        status: j['status'] as String,
      );
}

int _asInt(dynamic v) {
  if (v is int) return v;
  if (v is String) return int.parse(v);
  if (v is num) return v.toInt();
  throw FormatException('Cannot parse int from: $v');
}
