import { StyleSheet, View } from 'react-native';

import { CameraRollReader } from '@/components/camera-roll-reader';
import { Colors } from '@/constants/theme';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <CameraRollReader />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
});
