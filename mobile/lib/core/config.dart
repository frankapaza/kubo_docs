class AppConfig {
  // Configurable vía --dart-define=API_BASE_URL=...
  //   Chrome / iOS simulator / desktop: http://localhost:3000/api/v1
  //   Emulador Android:                 http://10.0.2.2:3000/api/v1
  //   Dispositivo físico:               http://<IP-PC-LAN>:3000/api/v1
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000/api/v1',
  );

  // Debe coincidir con AUDIO_MAX_SIZE_MB del backend.
  static const int audioMaxSizeMb = int.fromEnvironment(
    'AUDIO_MAX_SIZE_MB',
    defaultValue: 100,
  );
}
