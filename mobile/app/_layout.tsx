import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { StoreProvider, useStore } from '../src/store';
import { LoginScreen } from '../src/components/LoginScreen';
import { SnackbarProvider } from '../src/components/Snackbar';
import { colors } from '../src/theme';

// Tapping a reminder notification jumps to the Tasks tab.
function useNotificationTaps() {
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      router.navigate('/(tabs)/tasks');
    });
    return () => sub.remove();
  }, []);
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { needsAuth } = useStore();
  // The navigator stays mounted underneath so expo-router routing is always
  // available; the login screen is an absolute-fill overlay when unauthenticated.
  return (
    <>
      {children}
      {needsAuth ? <LoginScreen /> : null}
    </>
  );
}

export default function RootLayout() {
  useNotificationTaps();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <StoreProvider>
          <SnackbarProvider>
            <StatusBar style="light" />
            <AuthGate>
              <Stack
                screenOptions={{
                  headerStyle: { backgroundColor: colors.bgSoft },
                  headerTintColor: colors.text,
                  headerTitleStyle: { color: colors.text },
                  contentStyle: { backgroundColor: colors.bg },
                }}
              >
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="project/[id]" options={{ title: 'Project' }} />
              </Stack>
            </AuthGate>
          </SnackbarProvider>
        </StoreProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
