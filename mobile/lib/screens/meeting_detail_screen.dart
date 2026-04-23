import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../core/api/meetings_api.dart';
import '../core/theme.dart';
import '../models/meeting.dart';

class MeetingDetailScreen extends StatefulWidget {
  final int meetingId;
  const MeetingDetailScreen({super.key, required this.meetingId});
  @override
  State<MeetingDetailScreen> createState() => _MeetingDetailScreenState();
}

class _MeetingDetailScreenState extends State<MeetingDetailScreen> {
  final _api = MeetingsApi();
  late Future<Meeting> _future;

  @override
  void initState() {
    super.initState();
    _future = _api.findOne(widget.meetingId);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Detalle de reunión')),
      body: FutureBuilder<Meeting>(
        future: _future,
        builder: (ctx, s) {
          if (s.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text('Error: ${s.error}', textAlign: TextAlign.center),
              ),
            );
          }
          if (!s.hasData) return const Center(child: CircularProgressIndicator());
          final m = s.data!;
          final style = MeetingStatusStyle.of(m.status);

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(
                          color: style.bg,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(style.label,
                          style: TextStyle(
                            fontSize: 11, fontWeight: FontWeight.w600, color: style.fg,
                          ),
                        ),
                      ),
                      const SizedBox(height: 14),
                      Text(m.title,
                        style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
                      if (m.description != null) ...[
                        const SizedBox(height: 8),
                        Text(m.description!,
                          style: TextStyle(color: scheme.onSurfaceVariant)),
                      ],
                      const SizedBox(height: 20),
                      _InfoRow(
                        icon: Icons.schedule_rounded,
                        label: 'Programada',
                        value: _safeFormat(m.scheduledAt),
                      ),
                      if (m.location != null) ...[
                        const SizedBox(height: 10),
                        _InfoRow(
                          icon: Icons.place_outlined,
                          label: 'Lugar',
                          value: m.location!,
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              _ActionTile(
                icon: Icons.mic_rounded,
                iconBg: KuboColors.brandSurface,
                iconFg: scheme.primary,
                title: 'Grabar audio',
                subtitle: 'Inicia la grabación de esta reunión',
                onTap: () => context.push('/meetings/${m.id}/record'),
              ),
              const SizedBox(height: 10),
              _ActionTile(
                icon: Icons.text_snippet_outlined,
                iconBg: const Color(0xFFDCFCE7),
                iconFg: const Color(0xFF166534),
                title: 'Ver transcripción',
                subtitle: 'Consulta el estado y texto transcrito',
                onTap: () => context.push('/meetings/${m.id}/transcription'),
              ),
            ],
          );
        },
      ),
    );
  }

  String _safeFormat(DateTime dt) {
    try {
      return DateFormat("EEEE, d 'de' MMMM y · HH:mm", 'es').format(dt);
    } catch (_) {
      return DateFormat('yyyy-MM-dd HH:mm').format(dt);
    }
  }
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  const _InfoRow({required this.icon, required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 18, color: scheme.onSurfaceVariant),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label,
                style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant,
                  letterSpacing: 0.2, fontWeight: FontWeight.w600)),
              const SizedBox(height: 2),
              Text(value, style: const TextStyle(fontSize: 14)),
            ],
          ),
        ),
      ],
    );
  }
}

class _ActionTile extends StatelessWidget {
  final IconData icon;
  final Color iconBg;
  final Color iconFg;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _ActionTile({
    required this.icon,
    required this.iconBg,
    required this.iconFg,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                width: 44, height: 44,
                decoration: BoxDecoration(
                  color: iconBg,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: iconFg),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 2),
                    Text(subtitle,
                      style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: scheme.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }
}
