import { Stack, router } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RunnerProvider } from '../state/RunnerContext';
import { colors } from '../ui/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <RunnerProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerTitleStyle: { fontWeight: '600' },
            contentStyle: { backgroundColor: colors.bg },
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen
            name="index"
            options={{
              title: 'Repo Runner',
              headerRight: () => (
                <Pressable onPress={() => router.push('/github')} hitSlop={12}>
                  <Text style={{ color: colors.muted, fontWeight: '600' }}>GitHub</Text>
                </Pressable>
              ),
            }}
          />
          <Stack.Screen name="project/[id]" options={{ title: 'Project' }} />
          <Stack.Screen name="terminal" options={{ title: 'Terminal' }} />
          <Stack.Screen name="preview" options={{ title: 'Preview' }} />
          <Stack.Screen name="github" options={{ title: 'GitHub' }} />
          <Stack.Screen name="repos" options={{ title: 'Your repos' }} />
        </Stack>
      </RunnerProvider>
    </SafeAreaProvider>
  );
}
