import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CharacterAnswers } from '../characters/service';
export type Routes = {
  Welcome: undefined;
  Usage: undefined;
  Provider: { onboarding?: boolean; skipTheme?: boolean } | undefined;
  Theme: { onboarding?: boolean; autoGenerate?: boolean } | undefined;
  Create: undefined;
  Generate: { answers: CharacterAnswers; demo: boolean; interview?: boolean };
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
