import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius } from '../theme';

interface SnackState {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface SnackbarApi {
  show: (message: string, opts?: { actionLabel?: string; onAction?: () => void }) => void;
}

const SnackbarContext = createContext<SnackbarApi | null>(null);

const DURATION = 4500;

export function SnackbarProvider({ children }: { children: React.ReactNode }) {
  const [snack, setSnack] = useState<SnackState | null>(null);
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }).start(() =>
      setSnack(null),
    );
  }, [opacity]);

  const show = useCallback<SnackbarApi['show']>(
    (message, opts) => {
      if (timer.current) clearTimeout(timer.current);
      setSnack({ message, actionLabel: opts?.actionLabel, onAction: opts?.onAction });
      opacity.setValue(0);
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      timer.current = setTimeout(hide, DURATION);
    },
    [opacity, hide],
  );

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <SnackbarContext.Provider value={{ show }}>
      {children}
      {snack ? (
        <View style={[styles.wrap, { bottom: insets.bottom + 70 }]} pointerEvents="box-none">
          <Animated.View style={[styles.bar, { opacity }]}>
            <Text style={styles.message} numberOfLines={2}>
              {snack.message}
            </Text>
            {snack.actionLabel ? (
              <Pressable
                hitSlop={10}
                onPress={() => {
                  snack.onAction?.();
                  hide();
                }}
              >
                <Text style={styles.action}>{snack.actionLabel}</Text>
              </Pressable>
            ) : null}
          </Animated.View>
        </View>
      ) : null}
    </SnackbarContext.Provider>
  );
}

export function useSnackbar(): SnackbarApi {
  const ctx = useContext(SnackbarContext);
  if (!ctx) throw new Error('useSnackbar must be used within SnackbarProvider');
  return ctx;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 90, paddingHorizontal: 16 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: colors.card2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: 13,
    paddingHorizontal: 16,
    maxWidth: 480,
    width: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  message: { color: colors.text, fontSize: 14, flex: 1 },
  action: { color: colors.accent, fontSize: 14, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
});
