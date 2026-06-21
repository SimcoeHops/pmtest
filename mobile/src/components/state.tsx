import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Pressable } from 'react-native';
import { colors, radius } from '../theme';
import { API_BASE } from '../api';

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.dim}>Loading Helm…</Text>
    </View>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>Can't reach Helm — {message}</Text>
      <Text style={styles.bannerSub}>{API_BASE}</Text>
      <Pressable style={styles.retry} onPress={onRetry}>
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  dim: { color: colors.textFaint, fontSize: 14 },
  banner: {
    backgroundColor: 'rgba(248, 113, 113, 0.13)',
    borderColor: colors.red,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 12,
    gap: 4,
    marginBottom: 14,
  },
  bannerText: { color: colors.red, fontWeight: '700', fontSize: 14 },
  bannerSub: { color: colors.textFaint, fontSize: 12 },
  retry: {
    alignSelf: 'flex-start',
    marginTop: 6,
    backgroundColor: colors.card2,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  retryText: { color: colors.text, fontWeight: '600', fontSize: 13 },
});
