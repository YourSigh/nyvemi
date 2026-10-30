import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CharacterAnswers } from '../characters/service';
export type Routes = {
  Welcome: undefined;
  Plugins: { characterId: string };
  Usage: undefined;
  Provider: { onboarding?: boolean; skipTheme?: boolean } | undefined;
  Theme: undefined;
  Create: undefined;
  Generate: { answers: CharacterAnswers; demo: boolean; interview?: boolean };
  Appearance: { characterId: string; onboarding?: boolean };
  Chat: { characterId: string; notificationId?: string };
  Settings: {
    characterId: string;
    section?: 'notifications' | 'preferences' | 'advanced' | 'reset';
  };
  Memory: { characterId: string };
  Experiences: { characterId: string };
  Developer: { characterId: string };
  Transfer: { characterId?: string } | undefined;
};
export type ScreenProps<K extends keyof Routes> = NativeStackScreenProps<Routes, K>;
