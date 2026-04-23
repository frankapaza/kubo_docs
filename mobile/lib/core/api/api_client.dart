import 'package:dio/dio.dart';
import '../config.dart';
import '../storage/token_storage.dart';

class ApiClient {
  ApiClient._() {
    dio = Dio(BaseOptions(
      baseUrl: AppConfig.apiBaseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
    ));

    _refreshDio = Dio(BaseOptions(
      baseUrl: AppConfig.apiBaseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
    ));

    dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await TokenStorage.instance.getAccess();
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (err, handler) async {
        final req = err.requestOptions;
        final isAuthEndpoint =
            req.path.contains('/auth/login') || req.path.contains('/auth/refresh');
        if (err.response?.statusCode != 401 || isAuthEndpoint || req.extra['_retried'] == true) {
          return handler.next(err);
        }

        final newAccess = await _refreshAccessToken();
        if (newAccess == null) {
          await TokenStorage.instance.clear();
          return handler.next(err);
        }

        req.extra['_retried'] = true;
        req.headers['Authorization'] = 'Bearer $newAccess';
        try {
          final retry = await dio.fetch(req);
          return handler.resolve(retry);
        } catch (e) {
          return handler.next(e is DioException ? e : err);
        }
      },
    ));
  }

  static final instance = ApiClient._();
  late final Dio dio;
  late final Dio _refreshDio;

  Future<String?>? _inflightRefresh;

  Future<String?> _refreshAccessToken() {
    return _inflightRefresh ??= _doRefresh().whenComplete(() {
      _inflightRefresh = null;
    });
  }

  Future<String?> _doRefresh() async {
    final refresh = await TokenStorage.instance.getRefresh();
    if (refresh == null) return null;
    try {
      final res = await _refreshDio.post('/auth/refresh', data: {'refreshToken': refresh});
      final data = Map<String, dynamic>.from(res.data);
      final newAccess = data['accessToken'] as String;
      final newRefresh = data['refreshToken'] as String;
      await TokenStorage.instance.save(newAccess, newRefresh);
      return newAccess;
    } catch (_) {
      return null;
    }
  }
}
