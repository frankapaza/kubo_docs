import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../core/api/auth_api.dart';
import '../core/api/meetings_api.dart';
import '../core/storage/token_storage.dart';
import '../core/theme.dart';
import '../models/meeting.dart';

class MeetingsListScreen extends StatefulWidget {
  const MeetingsListScreen({super.key});
  @override
  State<MeetingsListScreen> createState() => _MeetingsListScreenState();
}

class _MeetingsListScreenState extends State<MeetingsListScreen> {
  final _api = MeetingsApi();
  late Future<List<Meeting>> _future;

  @override
  void initState() {
    super.initState();
    _future = _api.list();
  }

  Future<void> _refresh() async {
    setState(() { _future = _api.list(); });
    try {
      await _future;
    } on DioException catch (e) {
      if (e.response?.statusCode == 401 && mounted) {
        await TokenStorage.instance.clear();
        if (mounted) context.go('/login');
      }
    }
  }

  void _quickMeeting() async {
    final projectCtrl = TextEditingController(text: '1');
    final titleCtrl = TextEditingController(text: 'Reunión rápida');
    DateTime selectedDate = DateTime.now();

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('Reunión rápida'),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: projectCtrl,
                decoration: const InputDecoration(labelText: 'Project ID'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: titleCtrl,
                decoration: const InputDecoration(labelText: 'Título'),
              ),
              const SizedBox(height: 12),
              InkWell(
                onTap: () async {
                  final picked = await showDatePicker(
                    context: ctx,
                    initialDate: selectedDate,
                    firstDate: DateTime(2020),
                    lastDate: DateTime(2100),
                    locale: const Locale('es'),
                  );
                  if (picked != null) {
                    setLocal(() {
                      selectedDate = DateTime(
                        picked.year,
                        picked.month,
                        picked.day,
                        selectedDate.hour,
                        selectedDate.minute,
                      );
                    });
                  }
                },
                borderRadius: BorderRadius.circular(8),
                child: InputDecorator(
                  decoration: const InputDecoration(
                    labelText: 'Fecha',
                    suffixIcon: Icon(Icons.calendar_today_rounded, size: 18),
                  ),
                  child: Text(
                    DateFormat("EEEE, d 'de' MMMM y", 'es').format(selectedDate),
                    style: const TextStyle(fontSize: 14),
                  ),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Crear')),
          ],
        ),
      ),
    );
    if (ok != true) return;

    final meeting = await _api.create(
      projectId: int.parse(projectCtrl.text),
      title: titleCtrl.text,
      scheduledAt: selectedDate,
    );
    if (mounted) context.push('/meetings/${meeting.id}/record');
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Reuniones'),
        actions: [
          IconButton(
            icon: const Icon(Icons.cloud_upload_outlined),
            tooltip: 'Pendientes por subir',
            onPressed: () => context.push('/pending'),
          ),
          IconButton(
            icon: const Icon(Icons.logout_rounded),
            tooltip: 'Cerrar sesión',
            onPressed: () async {
              await AuthApi().logout();
              if (mounted) context.go('/login');
            },
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        icon: const Icon(Icons.mic_rounded),
        label: const Text('Reunión rápida'),
        onPressed: _quickMeeting,
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<Meeting>>(
          future: _future,
          builder: (ctx, s) {
            if (s.hasError) {
              final err = s.error;
              if (err is DioException && err.response?.statusCode == 401) {
                WidgetsBinding.instance.addPostFrameCallback((_) async {
                  await TokenStorage.instance.clear();
                  if (mounted) context.go('/login');
                });
                return const Center(child: CircularProgressIndicator());
              }
              return _ErrorState(
                error: s.error.toString(),
                onRetry: _refresh,
              );
            }
            if (!s.hasData) return const Center(child: CircularProgressIndicator());
            final list = s.data!;
            if (list.isEmpty) return _EmptyState(onCreate: _quickMeeting);

            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
              itemCount: list.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (ctx, i) {
                final m = list[i];
                final style = MeetingStatusStyle.of(m.status);
                final df = DateFormat("EEEE, d 'de' MMMM · HH:mm", 'es');

                return Card(
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    onTap: () => context.push('/meetings/${m.id}'),
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  m.title,
                                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(
                                  color: style.bg,
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text(style.label,
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                    color: style.fg,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          Row(
                            children: [
                              Icon(Icons.schedule_rounded, size: 15, color: scheme.onSurfaceVariant),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  _safeFormat(df, m.scheduledAt),
                                  style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
                                ),
                              ),
                            ],
                          ),
                          if (m.location != null) ...[
                            const SizedBox(height: 4),
                            Row(
                              children: [
                                Icon(Icons.place_outlined, size: 15, color: scheme.onSurfaceVariant),
                                const SizedBox(width: 6),
                                Text(m.location!,
                                  style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant)),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }

  String _safeFormat(DateFormat df, DateTime dt) {
    try { return df.format(dt); }
    catch (_) { return DateFormat('yyyy-MM-dd HH:mm').format(dt); }
  }
}

class _EmptyState extends StatelessWidget {
  final VoidCallback onCreate;
  const _EmptyState({required this.onCreate});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListView(
      children: [
        const SizedBox(height: 120),
        Icon(Icons.event_note_rounded, size: 64, color: scheme.onSurfaceVariant),
        const SizedBox(height: 16),
        const Center(
          child: Text('Aún no hay reuniones',
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
        ),
        const SizedBox(height: 6),
        Center(
          child: Text('Crea una reunión rápida para empezar a grabar.',
            style: TextStyle(color: scheme.onSurfaceVariant)),
        ),
        const SizedBox(height: 24),
        Center(
          child: FilledButton.icon(
            icon: const Icon(Icons.add),
            label: const Text('Nueva reunión'),
            onPressed: onCreate,
          ),
        ),
      ],
    );
  }
}

class _ErrorState extends StatelessWidget {
  final String error;
  final VoidCallback onRetry;
  const _ErrorState({required this.error, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const SizedBox(height: 100),
        Icon(Icons.cloud_off_rounded, size: 52, color: scheme.error),
        const SizedBox(height: 12),
        const Center(
          child: Text('No pudimos cargar tus reuniones',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
        ),
        const SizedBox(height: 6),
        Center(
          child: Text(error, textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
        ),
        const SizedBox(height: 20),
        Center(
          child: OutlinedButton.icon(
            icon: const Icon(Icons.refresh),
            label: const Text('Reintentar'),
            onPressed: onRetry,
          ),
        ),
      ],
    );
  }
}
