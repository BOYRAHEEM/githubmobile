import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { DeviceCode, githubClientId, pollDeviceFlow, startDeviceFlow } from '../core/github';
import { useRunner } from '../state/RunnerContext';
import { Button, Card, Label } from '../ui/components';
import { colors, mono, radius, space } from '../ui/theme';

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo,read:user&description=Repo%20Runner';

/** GitHub account: sign in (device code or token) or sign out. */
export default function GitHubScreen() {
  const { github, signOut } = useRunner();

  if (github.token) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Card style={{ gap: space(3), alignItems: 'center' }}>
          {github.user?.avatar_url && <Image source={{ uri: github.user.avatar_url }} style={styles.avatar} />}
          <Text style={styles.title}>{github.user?.name ?? github.user?.login ?? 'Signed in'}</Text>
          {github.user && <Text style={styles.muted}>@{github.user.login}</Text>}
          <Text style={[styles.muted, { textAlign: 'center' }]}>
            Private repos you can access will clone and pull normally, including from the terminal.
          </Text>
          <Button title="Browse your repos" onPress={() => router.replace('/repos')} style={{ alignSelf: 'stretch' }} />
          <Button title="Sign out" variant="danger" onPress={signOut} style={{ alignSelf: 'stretch' }} />
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      {githubClientId() && <DeviceSignIn />}
      <TokenSignIn />
    </ScrollView>
  );
}

// ------------------------------------------------------------ device flow

function DeviceSignIn() {
  const { signIn } = useRunner();
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abort = useRef({ aborted: false });

  useEffect(() => () => void (abort.current.aborted = true), []);

  const begin = async () => {
    const clientId = githubClientId()!;
    setError(null);
    abort.current = { aborted: false };
    try {
      const c = await startDeviceFlow(clientId);
      setCode(c);
      await Clipboard.setStringAsync(c.user_code);
      setCopied(true);
      WebBrowser.openBrowserAsync(c.verification_uri);
      const token = await pollDeviceFlow(clientId, c, abort.current);
      await signIn(token);
      router.back();
    } catch (e: any) {
      if (!abort.current.aborted) setError(String(e?.message ?? e));
      setCode(null);
    }
  };

  return (
    <Card style={{ gap: space(3) }}>
      <Label>Recommended</Label>
      <Text style={styles.title}>Sign in with GitHub</Text>
      {code ? (
        <>
          <Text style={styles.muted}>Enter this code on GitHub{copied ? ' (already copied)' : ''}:</Text>
          <Text selectable style={styles.code}>{code.user_code}</Text>
          <View style={styles.row}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.muted}>Waiting for you to approve…</Text>
          </View>
          <Button title="Open GitHub again" variant="secondary" onPress={() => WebBrowser.openBrowserAsync(code.verification_uri)} />
        </>
      ) : (
        <>
          <Text style={styles.muted}>
            {"You'll get a short code to enter on github.com. No password goes through this app."}
          </Text>
          <Button title="Sign in with GitHub" onPress={begin} />
        </>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </Card>
  );
}

// ------------------------------------------------------------ token paste

function TokenSignIn() {
  const { signIn } = useRunner();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(token);
      router.back();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: space(3) }}>
      <Text style={styles.title}>{githubClientId() ? 'Or use a token' : 'Connect GitHub'}</Text>
      <Text style={styles.muted}>
        {'Create a personal access token with the \u201crepo\u201d scope, then paste it here. It\u2019s stored encrypted on this phone.'}
      </Text>
      <Button title="Create a token on GitHub" variant="secondary" onPress={() => WebBrowser.openBrowserAsync(TOKEN_URL)} />
      <TextInput
        value={token}
        onChangeText={setToken}
        placeholder="ghp_… or github_pat_…"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        style={styles.input}
      />
      <Button title="Save token" loading={busy} disabled={!token.trim()} onPress={save} />
      {error && <Text style={styles.error}>{error}</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { padding: space(4), gap: space(4) },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  code: { color: colors.accent, fontFamily: mono, fontSize: 30, fontWeight: '700', letterSpacing: 4, textAlign: 'center' },
  avatar: { width: 72, height: 72, borderRadius: 36 },
  input: {
    color: colors.text,
    fontFamily: mono,
    fontSize: 14,
    padding: space(3),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
});
