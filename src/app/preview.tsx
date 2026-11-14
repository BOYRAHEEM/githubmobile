import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView as RNWebView, type WebViewNavigation, type WebViewProps } from 'react-native-webview';
import { Button } from '../ui/components';
import { colors, mono, space } from '../ui/theme';

// react-native-webview's class typings don't line up with React 19.3's yet;
// this narrows them to what we use.
type WebViewHandle = { reload(): void };
const WebView = RNWebView as unknown as React.ComponentType<WebViewProps & { ref?: React.Ref<WebViewHandle> }>;

/** Shows the running app in an in-app browser pointed at localhost. */
export default function Preview() {
  const { url = 'http://127.0.0.1:3000', title = 'Preview' } = useLocalSearchParams<{ url?: string; title?: string }>();
  const ref = useRef<WebViewHandle>(null);
  const [current, setCurrent] = useState(url);
  const [failed, setFailed] = useState(false);
  const [key, setKey] = useState(0); // bump to force a fresh load

  const retry = () => {
    setFailed(false);
    setKey((k) => k + 1);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title }} />
      <View style={styles.bar}>
        <Text style={styles.url} numberOfLines={1}>{current}</Text>
        <Pressable onPress={() => ref.current?.reload()} style={{ padding: space(2) }}>
          <Text style={{ color: colors.accent, fontWeight: '600' }}>Reload</Text>
        </Pressable>
      </View>

      {failed ? (
        <View style={styles.center}>
          <Text style={styles.msg}>Nothing is answering at {url} yet. Dev servers can take a minute on a phone.</Text>
          <Button title="Try again" onPress={retry} />
        </View>
      ) : (
        <WebView
          key={key}
          ref={ref}
          source={{ uri: url }}
          style={{ flex: 1 }}
          onNavigationStateChange={(s: WebViewNavigation) => setCurrent(s.url)}
          onError={() => setFailed(true)}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={['*']}
          mixedContentMode="always"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space(3),
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  url: { flex: 1, color: colors.muted, fontFamily: mono, fontSize: 12 },
  center: { flex: 1, justifyContent: 'center', padding: space(6), gap: space(4) },
  msg: { color: colors.muted, textAlign: 'center', fontSize: 14, lineHeight: 20 },
});
