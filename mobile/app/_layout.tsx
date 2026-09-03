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
  //
  // Guarded because this is the ROOT layout: anything that throws here takes
  // the entire app down to a red screen. A background sync that cannot start
  // should cost the outbox, not the app — drafts are still written to disk and
  // the Send now button still works.
  useEffect(() => {
    try {
      startOutboxSync();
    } catch (e) {
      console.warn('[outbox] background sync unavailable:', e);
      return;
    }
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
          <Stack.Screen name="index" options={{ title: 'AwardHome', headerShown: false }} />
          <Stack.Screen name="search" options={{ title: 'Find a dancer' }} />
          <Stack.Screen name="dancer/[id]" options={{ title: 'Trophy case' }} />
          <Stack.Screen name="claim/[id]" options={{ title: 'Is this your dancer?' }} />
          <Stack.Screen name="studio/[id]" options={{ title: 'Studio' }} />
          <Stack.Screen name="sign-in" options={{ title: 'Sign in', presentation: 'modal' }} />
          <Stack.Screen name="household" options={{ title: 'My dancers' }} />
          <Stack.Screen name="add" options={{ title: 'Add an award' }} />
          <Stack.Screen name="keep" options={{ title: 'Keep it forever' }} />
          <Stack.Screen name="outbox" options={{ title: 'Waiting to send' }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
