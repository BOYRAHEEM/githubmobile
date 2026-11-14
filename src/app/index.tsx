import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { stripAnsi } from '../core/ports';
import { getPlugin } from '../runtimes/registry';
import { runStateFor, useRunner } from '../state/RunnerContext';
import { Button, Card, Label, LogView, PhaseBadge } from '../ui/components';
import { colors, mono, radius, space } from '../ui/theme';

/** Home: first-run setup, then "paste a repo link" + the project list. */
export default function Home() {
  const { envStatus } = useRunner();

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="height">
      {envStatus === 'ready' ? <Projects /> : <Setup />}
    </KeyboardAvoidingView>
  );
}

// ------------------------------------------------------------------- setup

function Setup() {
  const { envStatus, envError, setup, startSetup } = useRunner();
  const busy = envStatus === 'setting-up';

  return (
    <View style={{ padding: space(4), gap: space(4), flex: 1 }}>
      <Card style={{ gap: space(3) }}>
        <Text style={styles.title}>Set up the Linux environment</Text>
        <Text style={styles.body}>
          Repo Runner runs projects inside a small Debian system on your phone. This downloads about 30 MB once, then
          installs git. Languages like Node or Python are added automatically when a repo needs them.
        </Text>

        {busy && (
          <View style={{ gap: space(2) }}>
            <Text style={styles.step}>{setup.step}</Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round((setup.fraction ?? 0.05) * 100)}%` }]} />
            </View>
          </View>
        )}

        {envError && <Text style={styles.error}>{envError}</Text>}

        {envStatus !== 'error' && envStatus !== 'checking' && (
          <Button title={busy ? 'Setting up…' : envError ? 'Try again' : 'Set up'} loading={busy} onPress={startSetup} />
        )}
      </Card>

      {busy && setup.log ? <LogView text={setup.log} style={{ flex: 1 }} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------- projects

function Projects() {
  const { projects, runs, addProject, github } = useRunner();
  const [url, setUrl] = useState('');
  const [cloning, setCloning] = useState(false);
  const [cloneLog, setCloneLog] = useState('');
  const [error, setError] = useState<string | null>(null);

  const paste = async () => setUrl((await Clipboard.getStringAsync()).trim());

  const clone = async () => {
    if (!url.trim() || cloning) return; // Enter on the keyboard can fire twice
    setCloning(true);
    setError(null);
    setCloneLog('');
    try {
      const project = await addProject(url, (s) => setCloneLog((l) => (l + stripAnsi(s)).slice(-4000)));
      setUrl('');
      router.push({ pathname: '/project/[id]', params: { id: project.id } });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setCloning(false);
    }
  };

  return (
    <FlatList
      data={projects}
      keyExtractor={(p) => p.id}
      contentContainerStyle={{ padding: space(4), gap: space(3) }}
      ListHeaderComponent={
        <View style={{ gap: space(3), marginBottom: space(3) }}>
          <Card style={{ gap: space(3) }}>
            <Label>Run a GitHub repo</Label>
            <View style={styles.inputRow}>
              <TextInput
                value={url}
                onChangeText={setUrl}
                placeholder="github.com/owner/repo"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={styles.input}
                onSubmitEditing={clone}
              />
              <Pressable onPress={paste} style={styles.pasteBtn}>
                <Text style={{ color: colors.accent, fontWeight: '600' }}>Paste</Text>
              </Pressable>
            </View>
            <Button title={cloning ? 'Cloning…' : 'Clone'} loading={cloning} disabled={!url.trim()} onPress={clone} />
            {cloning && cloneLog ? <Text style={styles.cloneLog} numberOfLines={3}>{cloneLog.trim().split('\n').pop()}</Text> : null}
            {error && <Text style={styles.error}>{error}</Text>}
          </Card>

          {/* GitHub account: private repos + a repo picker */}
          <Pressable onPress={() => router.push(github.token ? '/repos' : '/github')}>
            <Card style={styles.accountRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.accountTitle}>
                  {github.token ? `Your repos${github.user ? ` · @${github.user.login}` : ''}` : 'Connect GitHub'}
                </Text>
                <Text style={styles.meta}>
                  {github.token ? 'Pick one of your repos, private ones included' : 'Sign in to run private repos'}
                </Text>
              </View>
              <Text style={{ color: colors.accent, fontSize: 20 }}>›</Text>
            </Card>
          </Pressable>

          <View style={styles.rowBetween}>
            <Label>Projects</Label>
            <Pressable onPress={() => router.push({ pathname: '/terminal', params: { cwd: '/root' } })}>
              <Text style={{ color: colors.accent, fontWeight: '600' }}>Open terminal</Text>
            </Pressable>
          </View>
        </View>
      }
      ListEmptyComponent={<Text style={styles.body}>No projects yet. Paste a repo link above.</Text>}
      renderItem={({ item }) => {
        const run = runStateFor(runs, item.id);
        const plugin = item.pluginId ? getPlugin(item.pluginId) : undefined;
        return (
          <Pressable onPress={() => router.push({ pathname: '/project/[id]', params: { id: item.id } })}>
            <Card style={{ gap: space(2) }}>
              <View style={styles.rowBetween}>
                <Text style={styles.projectName}>{item.name}</Text>
                <PhaseBadge phase={run.phase} />
              </View>
              <Text style={styles.meta} numberOfLines={1}>
                {plugin?.name ?? 'Unknown runtime'} · {item.repoUrl.replace(/^https?:\/\//, '').replace(/\.git$/, '')}
              </Text>
            </Card>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  body: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  step: { color: colors.text, fontSize: 14 },
  track: { height: 6, backgroundColor: colors.surfaceAlt, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.accent },
  error: { color: colors.danger, fontSize: 14 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: { flex: 1, color: colors.text, fontFamily: mono, fontSize: 14, paddingHorizontal: space(3), paddingVertical: space(3) },
  pasteBtn: { paddingHorizontal: space(3), paddingVertical: space(3) },
  cloneLog: { color: colors.muted, fontFamily: mono, fontSize: 12 },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(3) },
  accountTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  projectName: { color: colors.text, fontSize: 17, fontWeight: '600', flexShrink: 1 },
  meta: { color: colors.muted, fontSize: 13 },
});
