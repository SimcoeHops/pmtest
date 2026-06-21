import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useStore } from '../store';
import { colors, radius } from '../theme';
import { API_BASE } from '../api';

// Full-screen unlock gate, mirroring the web app's "Sign in to continue" card.
export function LoginScreen() {
  const { login, authBusy } = useStore();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!password || authBusy) return;
    setError(null);
    try {
      await login(password);
      setPassword('');
    } catch (e: any) {
      setError(e?.message ?? 'Incorrect password');
      setPassword('');
    }
  }

  return (
    <View style={styles.fill}>
      <KeyboardAvoidingView
        style={styles.center}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.logo}>⎈</Text>
          <Text style={styles.title}>Helm</Text>
          <Text style={styles.sub}>Sign in to continue</Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.textFaint}
            secureTextEntry
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={submit}
            editable={!authBusy}
          />

          <Pressable
            style={[styles.button, (!password || authBusy) && styles.buttonDisabled]}
            onPress={submit}
            disabled={!password || authBusy}
          >
            {authBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Unlock ⎈</Text>
            )}
          </Pressable>

          <Text style={styles.host}>{API_BASE.replace(/^https?:\/\//, '')}</Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bg, zIndex: 100 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.bgSoft,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 26,
    alignItems: 'center',
  },
  logo: { fontSize: 40, color: colors.text, marginBottom: 6 },
  title: { fontSize: 30, fontWeight: '800', color: colors.accent },
  sub: { fontSize: 15, color: colors.textDim, marginTop: 4, marginBottom: 22 },
  error: {
    color: colors.red,
    fontSize: 13.5,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 14,
  },
  input: {
    width: '100%',
    backgroundColor: colors.bg,
    borderColor: colors.accent,
    borderWidth: 1.5,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 15,
    paddingVertical: 14,
    marginBottom: 14,
  },
  button: {
    width: '100%',
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  host: { color: colors.textFaint, fontSize: 12, marginTop: 18 },
});
