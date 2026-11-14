import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';
import { newSessionId, resizeTerminal, startTerminal, stopProcess, writeToProcess } from '../core/sessions';
import { buildTerminalHtml } from '../terminal/terminalHtml';
import { colors, mono, radius, space } from '../ui/theme';

// See preview.tsx: narrows react-native-webview's class typings for React 19.3.
type WebViewHandle = { injectJavaScript(js: string): void };
const WebView = RNWebView as unknown as React.ComponentType<WebViewProps & { ref?: React.Ref<WebViewHandle> }>;

/**
 * A real terminal: xterm.js in a WebView, wired to a login shell on a PTY.
 * vim, htop, nano, prompts and colours all work.
 */

/** Keys phone keyboards lack. `ctrl` is sticky: it applies to the next key typed. */
const KEYS: { label: string; seq?: string; ctrl?: true }[] = [
  { label: 'Esc', seq: '\x1b' },
  { label: 'Ctrl', ctrl: true },
  { label: 'Tab', seq: '\t' },
  { label: '↑', seq: '\x1b[A' },
  { label: '↓', seq: '\x1b[B' },
  { label: '←', seq: '\x1b[D' },
  { label: '→', seq: '\x1b[C' },
  { label: '^C', seq: '\x03' },
  { label: '|', seq: '|' },
  { label: '~', seq: '~' },
  { label: '/', seq: '/' },
  { label: '-', seq: '-' },
];

/** Ctrl+letter → control character (Ctrl+C = \x03, Ctrl+D = \x04, …). */
function applyCtrl(data: string): string {
  if (data.length !== 1) return data;
  const c = data.toUpperCase().charCodeAt(0);
  return c >= 64 && c <= 95 ? String.fromCharCode(c - 64) : data;
}

export default function Terminal() {
  const { cwd = '/root' } = useLocalSearchParams<{ cwd?: string }>();
  const web = useRef<WebViewHandle>(null);
  const idRef = useRef(newSessionId('term'));
  const [ended, setEnded] = useState<number | null>(null);
  const [ctrl, setCtrl] = useState(false);

  const html = useMemo(() => buildTerminalHtml(13), []);

  // Output arrives in many small chunks; batch them into one injection per frame.
  const pending = useRef('');
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeToScreen = useCallback((text: string) => {
    pending.current += text;
    if (flushTimer.current) return;
    flushTimer.current = setTimeout(() => {
      const chunk = pending.current;
      pending.current = '';
      flushTimer.current = null;
      web.current?.injectJavaScript(`window.termWrite(${JSON.stringify(chunk)});true;`);
    }, 16);
  }, []);

  // Stop the shell when leaving the screen.
  // Stop the shell when leaving the screen. Read the ref at cleanup time: a
  // restarted shell has a new id.
  useEffect(() => {
    const ids = idRef;
    return () => {
      stopProcess(ids.current);
    };
  }, []);

  /** Starts the shell once xterm knows its size. */
  const start = useCallback(
    (rows: number, cols: number) => {
      setEnded(null);
      startTerminal({
        id: idRef.current,
        cwd,
        rows,
        cols,
        onOutput: writeToScreen,
        onExit: (code) => {
          setEnded(code);
          writeToScreen(`\r\n\x1b[90m[shell exited with code ${code}]\x1b[0m\r\n`);
        },
      }).catch((e) => writeToScreen(`\r\n\x1b[31m${String(e?.message ?? e)}\x1b[0m\r\n`));
    },
    [cwd, writeToScreen],
  );

  const send = (data: string) => {
    if (ended !== null) return;
    if (ctrl) {
      data = applyCtrl(data);
      setCtrl(false);
    }
    writeToProcess(idRef.current, data).catch(() => {});
  };

  const onMessage = (e: WebViewMessageEvent) => {
    const msg = JSON.parse(e.nativeEvent.data);
    if (msg.type === 'ready') start(msg.rows, msg.cols);
    else if (msg.type === 'resize') resizeTerminal(idRef.current, msg.rows, msg.cols).catch(() => {});
    else if (msg.type === 'input') send(msg.data);
  };

  // The page answers termReset() with a new 'ready' message, which starts a shell.
  const restart = () => {
    stopProcess(idRef.current).catch(() => {});
    idRef.current = newSessionId('term');
    web.current?.injectJavaScript('window.termReset();true;');
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="height">
      <WebView
        ref={web}
        source={{ html }}
        originWhitelist={['*']}
        onMessage={onMessage}
        javaScriptEnabled
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView
        style={{ flex: 1, backgroundColor: colors.bg }}
      />

      {ended !== null && (
        <Pressable onPress={restart} style={styles.restart}>
          <Text style={{ color: colors.accent, fontWeight: '600' }}>Start a new shell</Text>
        </Pressable>
      )}

      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.keys}
        style={styles.keyBar}
      >
        {KEYS.map((k) => {
          const active = k.ctrl && ctrl;
          return (
            <Pressable
              key={k.label}
              onPress={() => (k.ctrl ? setCtrl((c) => !c) : send(k.seq!))}
              style={[styles.key, active && styles.keyActive]}
            >
              <Text style={[styles.keyText, active && { color: colors.accentInk }]}>{k.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  keyBar: { flexGrow: 0, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  keys: { gap: space(1.5), paddingHorizontal: space(2), paddingVertical: space(2) },
  key: {
    minWidth: 44,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
  },
  keyActive: { backgroundColor: colors.accent },
  keyText: { color: colors.text, fontFamily: mono, fontSize: 14, fontWeight: '600' },
  restart: { alignItems: 'center', padding: space(3), backgroundColor: colors.surface },
});
