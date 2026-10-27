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
import { AccessibilityInfo, AppState, BackHandler, View } from 'react-native';
import { closeKeyboard } from '../ui/keyboard';
import { bridge } from '../native/android';
import { defaultPalette, generatePalette } from './generator';
import type { Palette, ThemeRecord } from './model';
import { runThemeTransition } from './transition';
interface ThemeContextValue {
  palette: Palette;
  record?: ThemeRecord;
  transitioning: boolean;
  reducedMotion: boolean;
  hydrate(record?: ThemeRecord): void;
  apply(record: ThemeRecord, persist: () => Promise<void>): Promise<void>;
}
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 150);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      }),
    );
  });
}
export function ThemeProvider({ children }: PropsWithChildren) {
  const [record, setRecord] = useState<ThemeRecord>();
  const [transitioning, setTransitioning] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
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
  useEffect(() => {
    mounted.current = true;
    const release = () => {
      void bridge()
        .finishThemeTransition()
        .catch(() => {});
    };
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(setReducedMotion)
      .catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      setReducedMotion(value);
      if (value) release();
    });
    const lifecycle = AppState.addEventListener('change', (state) => {
      if (state !== 'active') release();
    });
    return () => {
      mounted.current = false;
      motion.remove();
      lifecycle.remove();
      release();
    };
  }, []);
  useEffect(() => {
    if (!transitioning) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => back.remove();
  }, [transitioning]);
  const apply = useCallback(async (next: ThemeRecord, persist: () => Promise<void>) => {
    if (locked.current) throw new Error('颜色正在慢慢铺开，稍等一下');
    locked.current = true;
    setTransitioning(true);
    try {
      const reduce = await AccessibilityInfo.isReduceMotionEnabled().catch(() => false);
      await runThemeTransition(
        {
          settleInput: async () => {
            await closeKeyboard();
            await nextPaint();
          },
          prepare: () => bridge().prepareThemeTransition(),
          persist,
          commit: () => {
            if (mounted.current) setRecord(next);
          },
          paint: nextPaint,
          reveal: (duration) => bridge().revealThemeTransition(duration),
          release: () => bridge().finishThemeTransition(),
        },
        !reduce && AppState.currentState === 'active',
      );
    } finally {
      locked.current = false;
      if (mounted.current) setTransitioning(false);
    }
  }, []);
  return (
    <ThemeContext.Provider
      value={{ palette, record, hydrate, apply, transitioning, reducedMotion }}
    >
      <View style={{ flex: 1, backgroundColor: palette.background }}>
        <View
          style={{ flex: 1 }}
          pointerEvents={transitioning ? 'none' : 'auto'}
          importantForAccessibility={transitioning ? 'no-hide-descendants' : 'auto'}
        >
          {children}
        </View>
        {transitioning ? (
          <View
            testID="theme-interaction-lock"
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            accessibilityViewIsModal
          />
        ) : null}
      </View>
    </ThemeContext.Provider>
  );
}
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('ThemeProvider is missing');
  return value;
}
export const usePalette = (): Palette => useTheme().palette;
