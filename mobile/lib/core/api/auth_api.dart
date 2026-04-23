import 'api_client.dart';
import '../storage/token_storage.dart';

class AuthApi {
  final _dio = ApiClient.instance.dio;

  Future<Map<String, dynamic>> login(String email, String password) async {
    final res = await _dio.post('/auth/login', data: {
      'email': email,
      'password': password,
    });
    final data = Map<String, dynamic>.from(res.data);
    await TokenStorage.instance.save(data['accessToken'], data['refreshToken']);
    return Map<String, dynamic>.from(data['user']);
  }

  Future<Map<String, dynamic>> register({
    required String email,
    required String password,
    required String fullName,
  }) async {
    final res = await _dio.post('/auth/register', data: {
      'email': email,
      'password': password,
      'fullName': fullName,
    });
    final data = Map<String, dynamic>.from(res.data);
    await TokenStorage.instance.save(data['accessToken'], data['refreshToken']);
    return Map<String, dynamic>.from(data['user']);
  }

  Future<void> logout() => TokenStorage.instance.clear();
}
