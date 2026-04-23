import 'package:dio/dio.dart';
import '../../models/meeting.dart';
import '../../models/transcription.dart';
import 'api_client.dart';

class MeetingsApi {
  final _dio = ApiClient.instance.dio;

  Future<List<Meeting>> list() async {
    final res = await _dio.get('/meetings');
    return (res.data['data'] as List).map((e) => Meeting.fromJson(e)).toList();
  }

  Future<Meeting> create({
    required int projectId,
    required String title,
    required DateTime scheduledAt,
    String? location,
  }) async {
    final res = await _dio.post('/meetings', data: {
      'projectId': projectId,
      'title': title,
      'scheduledAt': scheduledAt.toIso8601String(),
      if (location != null) 'location': location,
    });
    return Meeting.fromJson(res.data);
  }

  Future<Meeting> findOne(int id) async {
    final res = await _dio.get('/meetings/$id');
    return Meeting.fromJson(res.data);
  }

  Future<Map<String, dynamic>> uploadAudio({
    required int meetingId,
    required String filePath,
    int? durationSeconds,
    void Function(int sent, int total)? onSendProgress,
  }) async {
    final form = FormData.fromMap({
      'file': await MultipartFile.fromFile(filePath),
      'source': 'MOBILE',
      if (durationSeconds != null) 'durationSeconds': durationSeconds,
    });
    final res = await _dio.post(
      '/meetings/$meetingId/audio',
      data: form,
      onSendProgress: onSendProgress,
      options: Options(
        sendTimeout: const Duration(minutes: 30),
        receiveTimeout: const Duration(minutes: 5),
      ),
    );
    return Map<String, dynamic>.from(res.data);
  }

  Future<Transcription?> getTranscription(int meetingId) async {
    final res = await _dio.get('/meetings/$meetingId/transcription');
    if (res.data == null) return null;
    return Transcription.fromJson(res.data);
  }
}
