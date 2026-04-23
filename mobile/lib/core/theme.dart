import 'package:flutter/material.dart';

class KuboColors {
  static const brand = Color(0xFF1E40AF);
  static const brandSurface = Color(0xFFEEF2FF);
}

class KuboTheme {
  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: KuboColors.brand,
      brightness: Brightness.light,
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: const Color(0xFFF7F8FC),
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: scheme.onSurface,
          fontSize: 20,
          fontWeight: FontWeight.w600,
        ),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: scheme.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(color: scheme.outlineVariant),
        ),
        margin: EdgeInsets.zero,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: scheme.primary, width: 1.5),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 20),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 20),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
      chipTheme: ChipThemeData(
        labelStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 0),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        side: BorderSide.none,
      ),
    );
  }
}

class MeetingStatusStyle {
  final Color bg;
  final Color fg;
  final String label;
  const MeetingStatusStyle(this.bg, this.fg, this.label);

  static MeetingStatusStyle of(String status) {
    switch (status) {
      case 'SCHEDULED':
        return const MeetingStatusStyle(Color(0xFFEEF2FF), Color(0xFF3730A3), 'Programada');
      case 'IN_PROGRESS':
        return const MeetingStatusStyle(Color(0xFFFEF3C7), Color(0xFF92400E), 'En curso');
      case 'RECORDED':
        return const MeetingStatusStyle(Color(0xFFE0F2FE), Color(0xFF075985), 'Grabada');
      case 'TRANSCRIBING':
        return const MeetingStatusStyle(Color(0xFFFCE7F3), Color(0xFF9D174D), 'Transcribiendo');
      case 'TRANSCRIBED':
        return const MeetingStatusStyle(Color(0xFFDCFCE7), Color(0xFF166534), 'Transcrita');
      case 'ACTA_DRAFT':
        return const MeetingStatusStyle(Color(0xFFF3E8FF), Color(0xFF6B21A8), 'Borrador');
      case 'ACTA_APPROVED':
        return const MeetingStatusStyle(Color(0xFFD1FAE5), Color(0xFF065F46), 'Aprobada');
      case 'CLOSED':
        return const MeetingStatusStyle(Color(0xFFE5E7EB), Color(0xFF374151), 'Cerrada');
      default:
        return const MeetingStatusStyle(Color(0xFFE5E7EB), Color(0xFF374151), 'Desconocido');
    }
  }
}
