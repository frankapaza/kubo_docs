import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'core/storage/token_storage.dart';
import 'core/theme.dart';
import 'screens/login_screen.dart';
import 'screens/register_screen.dart';
import 'screens/meetings_list_screen.dart';
import 'screens/meeting_detail_screen.dart';
import 'screens/pending_recordings_screen.dart';
import 'screens/recording_screen.dart';
import 'screens/transcription_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('es', null);
  runApp(const KuboApp());
}

class KuboApp extends StatelessWidget {
  const KuboApp({super.key});

  @override
  Widget build(BuildContext context) {
    final router = GoRouter(
      initialLocation: '/login',
      redirect: (ctx, state) async {
        final token = await TokenStorage.instance.getAccess();
        final loc = state.matchedLocation;
        final isPublic = loc == '/login' || loc == '/register';
        if (token == null && !isPublic) return '/login';
        if (token != null && isPublic) return '/meetings';
        return null;
      },
      routes: [
        GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
        GoRoute(path: '/register', builder: (_, __) => const RegisterScreen()),
        GoRoute(path: '/meetings', builder: (_, __) => const MeetingsListScreen()),
        GoRoute(path: '/pending', builder: (_, __) => const PendingRecordingsScreen()),
        GoRoute(
          path: '/meetings/:id',
          builder: (_, s) => MeetingDetailScreen(meetingId: int.parse(s.pathParameters['id']!)),
        ),
        GoRoute(
          path: '/meetings/:id/record',
          builder: (_, s) => RecordingScreen(meetingId: int.parse(s.pathParameters['id']!)),
        ),
        GoRoute(
          path: '/meetings/:id/transcription',
          builder: (_, s) =>
              TranscriptionScreen(meetingId: int.parse(s.pathParameters['id']!)),
        ),
      ],
    );

    return MaterialApp.router(
      title: 'Kubo DevDocs',
      debugShowCheckedModeBanner: false,
      theme: KuboTheme.light(),
      routerConfig: router,
    );
  }
}
