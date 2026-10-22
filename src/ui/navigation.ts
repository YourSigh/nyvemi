import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CharacterAnswers } from '../characters/service';
export type Routes = {
  Welcome: undefined;
  Usage: undefined;
  Provider: { onboarding?: boolean } | undefined;
  Create: undefined;
  Generate: { answers: CharacterAnswers; demo: boolean };
  Chat: { characterId: string; notificationId?: string };
  Settings: { characterId: string };
  Memory: { characterId: string };
  Experiences: { characterId: string };
  Developer: { characterId: string };
  Transfer: { characterId?: string } | undefined;
  Characters: undefined;
};
export type ScreenProps<K extends keyof Routes> = NativeStackScreenProps<Routes, K>;
