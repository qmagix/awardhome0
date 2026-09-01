import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import { SessionProvider } from '@/ui/Session';
import { startOutboxSync, stopOutboxSync } from '@/outbox';
import { theme } from '@/ui/theme';

export default function RootLayout() {
  // The queue drains itself in the background: at a venue the family is
  // between routines, not watching a sync screen.
  useEffect(() => {
    startOutboxSync();
    return stopOutboxSync;
  }, []);

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.bg },
            headerTintColor: theme.text,
            headerTitleStyle: { color: theme.text },
            contentStyle: { backgroundColor: theme.bg },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'AwardHome' }} />
          <Stack.Screen name="dancer/[id]" options={{ title: 'Trophy case' }} />
          <Stack.Screen name="claim/[id]" options={{ title: 'Is this your dancer?' }} />
          <Stack.Screen name="sign-in" options={{ title: 'Sign in', presentation: 'modal' }} />
          <Stack.Screen name="household" options={{ title: 'My dancers' }} />
          <Stack.Screen name="add" options={{ title: 'Add an award' }} />
          <Stack.Screen name="outbox" options={{ title: 'Waiting to send' }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
