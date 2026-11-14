import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { fetchRepos, GitHubRepo } from '../core/github';
import { stripAnsi } from '../core/ports';
import { useRunner } from '../state/RunnerContext';
import { Card } from '../ui/components';
import { colors, mono, radius, space } from '../ui/theme';

/** The signed-in user's repos (public and private). Tap one to clone it. */
export default function ReposScreen() {
  const { github, addProject } = useRunner();
  const [repos, setRepos] = useState<GitHubRepo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [cloning, setCloning] = useState<string | null>(null);
  const [progress, setProgress] = useState('');

  useEffect(() => {
    if (!github.token) {
      router.replace('/github');
      return;
    }
    fetchRepos(github.token).then(setRepos).catch((e) => setError(String(e?.message ?? e)));
  }, [github.token]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (repos ?? []).filter((r) => !q || r.full_name.toLowerCase().includes(q));
  }, [repos, query]);

  const clone = async (repo: GitHubRepo) => {
    if (cloning) return;
    setCloning(repo.full_name);
    setProgress('');
    setError(null);
    try {
      const project = await addProject(repo.clone_url, (s) => setProgress(stripAnsi(s).trim().split('\n').pop() ?? ''));
      router.replace({ pathname: '/project/[id]', params: { id: project.id } });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setCloning(null);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search your repos"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.search}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      {!repos && !error ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: space(8) }} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(r) => String(r.id)}
          contentContainerStyle={{ padding: space(4), paddingTop: 0, gap: space(2) }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const busy = cloning === item.full_name;
            return (
              <Pressable onPress={() => clone(item)} disabled={!!cloning}>
                <Card style={{ gap: space(1), opacity: cloning && !busy ? 0.5 : 1 }}>
                  <View style={styles.row}>
                    <Text style={styles.name} numberOfLines={1}>{item.full_name}</Text>
                    {item.private && <Text style={styles.badge}>Private</Text>}
                  </View>
                  {item.description ? <Text style={styles.muted} numberOfLines={2}>{item.description}</Text> : null}
                  {busy ? (
                    <View style={styles.row}>
                      <ActivityIndicator size="small" color={colors.accent} />
                      <Text style={styles.progress} numberOfLines={1}>{progress || 'Cloning…'}</Text>
                    </View>
                  ) : item.language ? (
                    <Text style={styles.muted}>{item.language}</Text>
                  ) : null}
                </Card>
              </Pressable>
            );
          }}
          ListEmptyComponent={<Text style={[styles.muted, { textAlign: 'center' }]}>No repos match.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    margin: space(4),
    color: colors.text,
    fontSize: 15,
    padding: space(3),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  name: { color: colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  badge: {
    color: colors.warn,
    fontSize: 11,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: colors.warn,
    borderRadius: 999,
    paddingHorizontal: space(2),
    paddingVertical: 1,
  },
  muted: { color: colors.muted, fontSize: 13 },
  progress: { color: colors.muted, fontFamily: mono, fontSize: 12, flex: 1 },
  error: { color: colors.danger, marginHorizontal: space(4) },
});
