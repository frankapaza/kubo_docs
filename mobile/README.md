# Kubo DevDocs Mobile

App Flutter MVP — grabación, envío y visualización de transcripciones.

## Configuración

Editar `lib/core/config.dart` con la URL del backend (por defecto `http://10.0.2.2:3000/api/v1` para emulador Android).

## Permisos

- Android: `android/app/src/main/AndroidManifest.xml` → `RECORD_AUDIO`, `INTERNET`.
- iOS: `ios/Runner/Info.plist` → `NSMicrophoneUsageDescription`.

## Arranque

```bash
flutter pub get
flutter run
```

## Flujo MVP

Login → Lista de reuniones → Reunión (detalle) → Grabar → Subir → Ver transcripción.
