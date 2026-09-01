import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '@/ui/Session';
import { theme } from '@/ui/theme';

export default function RootLayout() {
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
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
