import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AccessibilityInfo, AppState, StyleSheet, View, useWindowDimensions } from 'react-native';
import { captureRef, releaseCapture } from 'react-native-view-shot';
import Svg, { ClipPath, Defs, Path, Image as SvgImage } from 'react-native-svg';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { defaultPalette, generatePalette } from './generator';
import type { Palette, ThemeRecord } from './model';
import { remainingPolygon } from './reveal';
import { safeSnapshot } from './capture';
function releaseSnapshot(uri: string) {
  try {
    releaseCapture(uri);
  } catch {
    /* Already released by native lifecycle cleanup. */
  }
}
const AnimatedPath = Animated.createAnimatedComponent(Path);
interface ThemeContextValue {
  palette: Palette;
  record?: ThemeRecord;
  transitioning: boolean;
  reducedMotion: boolean;
  hydrate(record?: ThemeRecord): void;
  apply(record: ThemeRecord, persist: () => Promise<void>): Promise<void>;
}
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
export function ThemeProvider({ children }: PropsWithChildren) {
  const [record, setRecord] = useState<ThemeRecord>();
  const [snapshot, setSnapshot] = useState<{ uri: string; width: number; height: number }>();
  const [transitioning, setTransitioning] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const root = useRef<View>(null);
  const dimensions = useWindowDimensions();
  const progress = useSharedValue(0);
  const job = useRef<
    { record: ThemeRecord; uri?: string; resolve(): void; started: boolean } | undefined
  >(undefined);
  const watchdog = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const locked = useRef(false);
  const mounted = useRef(true);
  const palette = useMemo(
    () =>
      record && record.source !== 'default' ? generatePalette(record.preference) : defaultPalette,
    [record],
  );
  const hydrate = useCallback((saved?: ThemeRecord) => {
    if (!locked.current) setRecord(saved);
  }, []);
  const finish = useCallback(() => {
    const active = job.current;
    job.current = undefined;
    if (watchdog.current) clearTimeout(watchdog.current);
    cancelAnimation(progress);
    if (active?.uri) releaseSnapshot(active.uri);
    if (mounted.current) {
      if (active) setRecord(active.record);
      setSnapshot(undefined);
      setTransitioning(false);
    }
    locked.current = false;
    active?.resolve();
  }, [progress]);
  useEffect(() => {
    mounted.current = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(setReducedMotion)
      .catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      setReducedMotion(value);
      if (value) finish();
    });
    const lifecycle = AppState.addEventListener('change', (state) => {
      if (state !== 'active') finish();
    });
    return () => {
      mounted.current = false;
      motion.remove();
      lifecycle.remove();
      finish();
    };
  }, [finish]);
  useEffect(() => {
    finish();
  }, [dimensions.width, dimensions.height, finish]);
  const apply = useCallback(
    async (next: ThemeRecord, persist: () => Promise<void>) => {
      if (locked.current) throw new Error('颜色还在慢慢铺开，稍等一下');
      locked.current = true;
      let uri: string | undefined;
      try {
        const reduce = await AccessibilityInfo.isReduceMotionEnabled().catch(() => true);
        if (!reduce && root.current) {
          uri = await safeSnapshot(
            () => captureRef(root, { format: 'png', result: 'tmpfile' }),
            releaseSnapshot,
          );
        }
        await persist();
        if (!mounted.current) {
          if (uri) releaseSnapshot(uri);
          return;
        }
        if (!uri || reduce || AppState.currentState !== 'active') {
          setRecord(next);
          if (uri) releaseSnapshot(uri);
          return;
        }
        const captured = uri;
        progress.value = 0;
        setTransitioning(true);
        await new Promise<void>((resolve) => {
          job.current = { record: next, uri: captured, resolve, started: false };
          setSnapshot({ uri: captured, width: dimensions.width, height: dimensions.height });
          // A missing image-load event or interrupted native animation must never freeze the app.
          watchdog.current = setTimeout(finish, 2500);
        });
      } catch (error) {
        if (uri) releaseSnapshot(uri);
        throw error;
      } finally {
        locked.current = false;
      }
    },
    [dimensions.width, dimensions.height, progress, finish],
  );
  const startReveal = () => {
    const active = job.current;
    if (!active || active.started) return;
    active.started = true;
    setRecord(active.record);
    progress.value = withTiming(1, { duration: 1050, easing: Easing.inOut(Easing.cubic) }, () => {
      runOnJS(finish)();
    });
  };
  const animatedProps = useAnimatedProps(() => ({
    d: `M${remainingPolygon(snapshot?.width ?? 1, snapshot?.height ?? 1, progress.value)}Z`,
  }));
  return (
    <ThemeContext.Provider
      value={{ palette, record, hydrate, apply, transitioning, reducedMotion }}
    >
      <View ref={root} collapsable={false} style={{ flex: 1, backgroundColor: palette.background }}>
        {children}
      </View>
      {snapshot ? (
        <View
          style={StyleSheet.absoluteFill}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Svg width={snapshot.width} height={snapshot.height}>
            <Defs>
              <ClipPath id="old-theme">
                <AnimatedPath animatedProps={animatedProps} />
              </ClipPath>
            </Defs>
            <SvgImage
              href={snapshot.uri}
              width={snapshot.width}
              height={snapshot.height}
              preserveAspectRatio="none"
              clipPath="url(#old-theme)"
              onLoad={startReveal}
            />
          </Svg>
        </View>
      ) : null}
    </ThemeContext.Provider>
  );
}
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('ThemeProvider is missing');
  return value;
}
export const usePalette = (): Palette => useTheme().palette;
