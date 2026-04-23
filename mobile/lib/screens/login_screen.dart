import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../core/api/auth_api.dart';
import '../core/theme.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController(text: 'admin@kubo.pe');
  final _password = TextEditingController();
  final _auth = AuthApi();
  bool _loading = false;
  bool _obscure = true;
  String? _error;

  Future<void> _submit() async {
    setState(() { _loading = true; _error = null; });
    try {
      await _auth.login(_email.text.trim(), _password.text);
      if (mounted) context.go('/meetings');
    } catch (_) {
      setState(() { _error = 'Credenciales inválidas'; });
    } finally {
      if (mounted) setState(() { _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 72,
                    height: 72,
                    decoration: BoxDecoration(
                      color: KuboColors.brandSurface,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Icon(Icons.mic_none_rounded, size: 40, color: scheme.primary),
                  ),
                  const SizedBox(height: 20),
                  const Text('Kubo DevDocs',
                    style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 6),
                  Text('Registra, transcribe, documenta.',
                    style: TextStyle(fontSize: 14, color: scheme.onSurfaceVariant)),
                  const SizedBox(height: 32),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          TextField(
                            controller: _email,
                            decoration: const InputDecoration(
                              labelText: 'Email',
                              prefixIcon: Icon(Icons.alternate_email_rounded),
                            ),
                            keyboardType: TextInputType.emailAddress,
                          ),
                          const SizedBox(height: 14),
                          TextField(
                            controller: _password,
                            decoration: InputDecoration(
                              labelText: 'Contraseña',
                              prefixIcon: const Icon(Icons.lock_outline_rounded),
                              suffixIcon: IconButton(
                                icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility),
                                onPressed: () => setState(() => _obscure = !_obscure),
                              ),
                            ),
                            obscureText: _obscure,
                            onSubmitted: (_) => _submit(),
                          ),
                          if (_error != null) ...[
                            const SizedBox(height: 14),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                              decoration: BoxDecoration(
                                color: scheme.errorContainer,
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Row(children: [
                                Icon(Icons.error_outline, size: 18, color: scheme.onErrorContainer),
                                const SizedBox(width: 8),
                                Expanded(child: Text(_error!,
                                  style: TextStyle(color: scheme.onErrorContainer, fontSize: 13))),
                              ]),
                            ),
                          ],
                          const SizedBox(height: 20),
                          FilledButton(
                            onPressed: _loading ? null : _submit,
                            child: _loading
                                ? const SizedBox(height: 18, width: 18,
                                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                : const Text('Ingresar'),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text('¿No tienes cuenta?',
                        style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant)),
                      TextButton(
                        onPressed: () => context.go('/register'),
                        child: const Text('Regístrate'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text('v0.1.0 · MVP',
                    style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
