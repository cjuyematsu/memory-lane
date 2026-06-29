import { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DisplayFont, Ink, Paper } from '@/constants/theme';

type Props = {
  children: ReactNode;
  // Render a custom (e.g. compact, in-card) fallback instead of the default
  // full-screen one. Receives a `reset` that clears the error and remounts the
  // wrapped subtree.
  fallback?: (reset: () => void) => ReactNode;
  // Notified when an error is caught (logging / telemetry).
  onError?: (error: Error) => void;
};

type State = { error: Error | null };

// The app had zero error boundaries: any render-time throw (a corrupt asset, a
// bad date, a thrown hook) tore down the whole tree into a hard crash. This
// catches that and degrades to a recoverable fallback instead. When `reset`
// runs, render returns `children` again (a different element than the fallback
// at this position), so React mounts the subtree fresh — clearing whatever
// transient state caused the throw.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
    if (__DEV__) console.error('[ErrorBoundary]', error);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.reset);
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Pressable style={styles.button} onPress={this.reset} hitSlop={12}>
            <Text style={styles.buttonLabel}>Reload</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Paper,
    paddingHorizontal: 32,
  },
  title: {
    fontFamily: DisplayFont,
    fontSize: 22,
    color: Ink,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  button: {
    marginTop: 24,
    borderWidth: 2,
    borderColor: Ink,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  buttonLabel: {
    fontFamily: DisplayFont,
    fontSize: 14,
    color: Ink,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
