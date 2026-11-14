import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getPlugin } from '../../runtimes/registry';
import { runStateFor, useRunner } from '../../state/RunnerContext';
import { Button, Card, Chip, isBusy, Label, LogView, PhaseBadge } from '../../ui/components';
import { colors, space } from '../../ui/theme';

/** One project: what it runs on, Run/Stop, live logs, preview + terminal. */
export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { projects, runs, detect, setPlugin, run, stop, clearLogs, removeProject } = useRunner();
  const project = projects.find((p) => p.id === id);
  const state = runStateFor(runs, id);

  // Detect runtimes the first time this project is opened in a session.
  useEffect(() => {
    if (project && state.detections.length === 0) detect(project).catch(() => {});
  }, [project, state.detections.length, detect]);

  if (!project) {
    return <Text style={{ color: colors.muted, padding: space(4) }}>Project not found.</Text>;
  }

  const busy = isBusy(state.phase);
  const chosen = state.detections.find((d) => d.pluginId === project.pluginId) ?? state.detections[0];
  const previewPort = state.port ?? project.port;

  const openPreview = () =>
    router.push({ pathname: '/preview', params: { url: `http://127.0.0.1:${previewPort}`, title: project.name } });

  const confirmDelete = () =>
    Alert.alert('Delete project?', `This removes ${project.name} and its files from the phone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeProject(project.id).then(() => router.back()) },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: project.name }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        {/* Runtime */}
        <Card style={{ gap: space(3) }}>
          <View style={styles.rowBetween}>
            <Label>Runs with</Label>
            <PhaseBadge phase={state.phase} />
          </View>
          {chosen ? (
            <>
              <Text style={styles.big}>{chosen.label}</Text>
              <Text style={styles.muted}>{chosen.reason}</Text>
            </>
          ) : (
            <Text style={styles.muted}>Looking at the repo…</Text>
          )}

          {/* Let the user override detection when several runtimes match. */}
          {state.detections.length > 1 && (
            <View style={styles.chips}>
              {state.detections.map((d) => (
                <Chip
                  key={d.pluginId}
                  label={getPlugin(d.pluginId)?.name ?? d.pluginId}
                  active={d.pluginId === chosen?.pluginId}
                  onPress={() => !busy && setPlugin(project, d.pluginId)}
                />
              ))}
            </View>
          )}

          <View style={styles.actions}>
            {busy ? (
              <Button title="Stop" variant="danger" onPress={() => stop(project)} style={{ flex: 1 }} />
            ) : (
              <Button title="Run" onPress={() => run(project)} disabled={!chosen} style={{ flex: 1 }} />
            )}
            <Button
              title="Preview"
              variant="secondary"
              onPress={openPreview}
              disabled={state.phase !== 'running' && state.phase !== 'starting'}
              style={{ flex: 1 }}
            />
          </View>
          {state.port && <Text style={styles.muted}>Serving on http://127.0.0.1:{state.port}</Text>}
        </Card>

        {/* Output */}
        <View style={styles.rowBetween}>
          <Label>Output</Label>
          <Text style={styles.link} onPress={() => clearLogs(project)}>Clear</Text>
        </View>
        <LogView text={state.logs} placeholder="Press Run to install and start this project." style={{ height: 360 }} />

        {/* More */}
        <View style={styles.actions}>
          <Button
            title="Terminal"
            variant="secondary"
            onPress={() => router.push({ pathname: '/terminal', params: { cwd: project.dir } })}
            style={{ flex: 1 }}
          />
          <Button
            title="Reinstall"
            variant="secondary"
            disabled={busy}
            onPress={() => run(project, { reinstall: true })}
            style={{ flex: 1 }}
          />
        </View>
        <Button title="Delete project" variant="ghost" onPress={confirmDelete} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  big: { color: colors.text, fontSize: 18, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  actions: { flexDirection: 'row', gap: space(2) },
  link: { color: colors.accent, fontWeight: '600' },
});
