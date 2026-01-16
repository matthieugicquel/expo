import { useEvent } from 'expo';
import { fetch as expoFetch } from 'expo/fetch';
import * as AppleAuthentication from 'expo-apple-authentication';
import { BlurView } from 'expo-blur';
import { CameraView, useCameraPermissions, CameraType } from 'expo-camera';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
  Appearance,
  PlatformColor,
  Image as RNImage,
} from 'react-native';

function randomColor() {
  return '#' + ((Math.random() * 0xffffff) << 0).toString(16).padStart(6, '0');
}

function randomGradientColors() {
  return Array(3).fill(0).map(randomColor) as unknown as readonly [string, string, string];
}

export default function App() {
  const [colorScheme, setColorScheme] = useState(Appearance.getColorScheme());
  const isFabricEnabled = global.nativeFabricUIManager != null;

  useEffect(() => {
    const listener = Appearance.addChangeListener((preferences) => {
      setColorScheme(preferences.colorScheme);
    });

    return listener.remove;
  }, []);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colorScheme === 'light' ? '#fff' : '#161b22' }]}>
      <ScrollView>
        <Text style={[styles.text, { marginVertical: 10 }]}>
          isFabricEnabled: {isFabricEnabled + ''}
        </Text>

        <FetchStreamReproExample />
        <ImageExample />
        <LinearGradientExample />
        {Platform.OS === 'ios' && <BlurExample />}
        <VideoExample />
        <CameraExample />
        <AppleAuthenticationExample />
      </ScrollView>
    </SafeAreaView>
  );
}

const EXPECTED_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const EXPECTED_STR = EXPECTED_ORDER.join(', ');

export function FetchStreamReproExample() {
  const [status, setStatus] = useState<'idle' | 'running'>('idle');
  const [iteration, setIteration] = useState(0);
  const [totalRuns, setTotalRuns] = useState(0);
  const [failures, setFailures] = useState<string[]>([]);
  const [lastOrder, setLastOrder] = useState('');
  const [lastError, setLastError] = useState('');
  const abortRef = useRef(false);

  const runSingleFetch = useCallback(async (): Promise<{ tokens: string[]; error?: string }> => {
    const url = `http://127.0.0.1:9001/stream`;

    try {
      const response = await expoFetch(url);
      if (!response.body) {
        return { tokens: [], error: 'No response.body available' };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const tokens: string[] = [];
      const tokenRegex = /\[\[([A-H])\]\]/g;

      while (tokens.length < 8) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        let match: RegExpExecArray | null;
        while ((match = tokenRegex.exec(buffer)) != null) {
          tokens.push(match[1]);
          if (tokens.length >= 8) {
            break;
          }
        }
        buffer = buffer.slice(Math.max(0, buffer.length - 32));
      }

      try {
        await reader.cancel();
      } catch {
        // Ignore cancel errors (separate issue)
      }
      return { tokens };
    } catch (error: unknown) {
      return { tokens: [], error: error instanceof Error ? error.message : String(error) };
    }
  }, []);

  const runRepro = useCallback(
    async (iterations: number) => {
      setStatus('running');
      setIteration(0);
      setTotalRuns(iterations);
      setFailures([]);
      setLastOrder('');
      setLastError('');
      abortRef.current = false;

      const newFailures: string[] = [];

      for (let i = 0; i < iterations && !abortRef.current; i++) {
        setIteration(i + 1);
        const result = await runSingleFetch();

        if (result.error) {
          setLastError(result.error);
          // Don't count errors as failures for the race condition
          continue;
        }

        const order = result.tokens.join(', ');
        setLastOrder(order);

        if (order !== EXPECTED_STR) {
          const missing = EXPECTED_ORDER.filter((t) => !result.tokens.includes(t));
          const label =
            missing.length > 0
              ? `#${i + 1}: ${order} (LOST: ${missing.join(',')})`
              : `#${i + 1}: ${order} (OUT-OF-ORDER)`;
          newFailures.push(label);
          setFailures([...newFailures]);
        }

        // Small delay between iterations
        await new Promise((r) => setTimeout(r, 50));
      }

      setStatus('idle');
    },
    [runSingleFetch]
  );

  const stopRepro = useCallback(() => {
    abortRef.current = true;
  }, []);

  const hostLabel = Platform.OS === 'android' ? '192.168.1.90 (LAN)' : '127.0.0.1';
  const failureRate = totalRuns > 0 ? ((failures.length / totalRuns) * 100).toFixed(1) : '0';

  return (
    <View style={styles.exampleContainer}>
      <Text style={styles.text}>Fetch stream repro</Text>
      <Text>Server URL: http://{hostLabel}:9001/stream</Text>
      <Text>Expected: {EXPECTED_STR}</Text>
      <View style={styles.buttons}>
        {status === 'idle' ? (
          <>
            <Button title="Run 1x" onPress={() => runRepro(1)} />
            <Button title="Run 10x" onPress={() => runRepro(10)} />
            <Button title="Run 50x" onPress={() => runRepro(50)} />
          </>
        ) : (
          <Button title={`Stop (${iteration}/${totalRuns})`} onPress={stopRepro} />
        )}
      </View>
      <Text>Last result: {lastOrder || '—'}</Text>
      <Text style={{ color: failures.length > 0 ? 'red' : 'green', fontWeight: 'bold' }}>
        Failures: {failures.length}/{totalRuns} ({failureRate}%)
      </Text>
      {failures.length > 0 && (
        <View style={{ marginTop: 8 }}>
          {failures.map((f, i) => (
            <Text key={i} style={{ color: 'red', fontSize: 12 }}>
              {f}
            </Text>
          ))}
        </View>
      )}
      {lastError ? <Text style={{ color: 'orange' }}>Last error: {lastError}</Text> : null}
    </View>
  );
}

export function ImageExample() {
  const [seed] = useState(100 + Math.round(Math.random() * 100));

  const uri = `https://picsum.photos/id/${seed}/1000/1000`;

  return (
    <View style={styles.exampleContainer}>
      <Image style={styles.image} source={{ uri }} />
      <Text>
        Image from RN core to test TurboModuleDelegate on iOS. If you see the first image but not
        the second, that's a bug.
      </Text>
      <RNImage style={styles.image} source={{ uri }} />
    </View>
  );
}

export function LinearGradientExample() {
  const [mounted, setMounted] = useState(true);
  const [colors, setColors] = useState(randomGradientColors());

  const toggleMounted = useCallback(() => setMounted(!mounted), [mounted]);
  const randomizeColors = useCallback(() => setColors(randomGradientColors()), [colors]);

  return (
    <View style={styles.exampleContainer}>
      <View style={styles.gradient}>
        {mounted && <LinearGradient style={{ flex: 1 }} colors={colors} end={{ x: 0.5, y: 1.0 }} />}
      </View>

      <View style={styles.buttons}>
        <Button title={mounted ? 'Unmount view' : 'Mount view'} onPress={toggleMounted} />
        <Button title="Randomize colors" onPress={randomizeColors} disabled={!mounted} />
      </View>
    </View>
  );
}

export function BlurExample() {
  const uri = 'https://source.unsplash.com/random';
  const text = "Hello, I'm blurring contents underneath!";

  return (
    <View style={[styles.exampleContainer, styles.blurExample]}>
      <Image style={styles.blurImage} source={{ uri }} />
      <BlurView intensity={100} style={styles.blurContainer}>
        <Text style={styles.text}>{text}</Text>
      </BlurView>
      <BlurView intensity={80} tint="light" style={styles.blurContainer}>
        <Text style={styles.text}>{text}</Text>
      </BlurView>
      <BlurView intensity={20} tint="dark" style={styles.blurContainer}>
        <Text style={[styles.text, { color: '#fff' }]}>{text}</Text>
      </BlurView>
    </View>
  );
}

export function VideoExample() {
  const videoSource =
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
  const player = useVideoPlayer(videoSource, (player) => {
    player.loop = true;
  });

  const status = useEvent(player, 'playingChange', { isPlaying: player.playing });

  const togglePlaying = useCallback(() => {
    if (status.isPlaying) {
      player.pause();
    } else {
      player.play();
    }
  }, [status.isPlaying]);

  return (
    <View style={[styles.exampleContainer, styles.videoExample]}>
      <VideoView style={styles.video} player={player} allowsPictureInPicture />
      <View style={styles.buttons}>
        <Button title={status.isPlaying ? 'Pause' : 'Play'} onPress={togglePlaying} />
      </View>
    </View>
  );
}

export function CameraExample() {
  const [cameraPermissionStatus, requestCameraPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [cameraType, setCameraType] = useState<CameraType>('back');

  const takePicture = useCallback(async () => {
    const result = await camera.current.takePictureAsync({
      quality: 0.7,
    });
    alert(JSON.stringify(result, null, 2));
  }, []);

  const reverse = useCallback(() => {
    setCameraType(cameraType === 'back' ? 'front' : 'back');
  }, [cameraType]);

  const onCameraReady = useCallback(() => {
    console.log('Camera is ready!');
  }, []);

  if (!cameraPermissionStatus) {
    requestCameraPermission();
    return null;
  }

  return (
    <View style={styles.exampleContainer}>
      <CameraView
        ref={camera}
        style={styles.camera}
        facing={cameraType}
        onCameraReady={onCameraReady}>
        <View style={styles.cameraShutterButtonContainer}>
          <TouchableOpacity style={styles.cameraShutterButton} onPress={takePicture} />
        </View>
      </CameraView>

      <View style={styles.buttons}>
        <Button title="Take picture" onPress={takePicture} />
        <Button
          title={cameraType === 'back' ? 'Switch to front' : 'Switch to back'}
          onPress={reverse}
        />
      </View>
    </View>
  );
}

export function AppleAuthenticationExample() {
  const signIn = useCallback(async () => {
    try {
      await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        state: 'this-is-a-test',
      });
    } catch (error) {
      Alert.alert(error.code, error.message);
    }
  }, []);

  return (
    <View style={styles.exampleContainer}>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <AppleAuthentication.AppleAuthenticationButton
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          cornerRadius={10}
          onPress={signIn}
          style={{ width: 250, height: 44, margin: 15 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: StatusBar.currentHeight,
  },
  exampleContainer: {
    padding: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderStyle: 'solid',
    borderColor: '#242c39',
  },
  image: {
    flex: 1,
    height: 200,
  },
  gradient: {
    height: 200,
  },
  blurExample: {
    height: 200,
  },
  blurImage: {
    ...StyleSheet.absoluteFillObject,
  },
  blurContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  text: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    ...Platform.select({
      ios: { color: PlatformColor('labelColor') },
    }),
  },
  videoExample: {
    justifyContent: 'center',
  },
  video: {
    alignSelf: 'center',
    width: '100%',
    height: 200,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  camera: {
    height: 500,
    backgroundColor: 'red',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  cameraShutterButtonContainer: {
    width: 70,
    height: 70,
    margin: 20,
    padding: 3,
    borderRadius: 35,
    borderWidth: 4,
    borderColor: '#fff9',
  },
  cameraShutterButton: {
    flex: 1,
    borderRadius: 35,
    backgroundColor: '#fff',
  },
});
