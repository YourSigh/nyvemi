import type { Persona } from '../domain/models';
/** Format example only: no authored character, identity or interests to copy. */
export const personaShape = (id: string, name: string): Persona => ({
  id,
  name,
  identity: '',
  portrait: '',
  dialogueExamples: [],
  corePersonality: [],
  speechStyle: [],
  relationshipStyle: [],
  humorStyle: [],
  initiativeStyle: [],
  likes: [],
  dislikes: [],
  responsePreferences: [],
  avoidPatterns: [],
  boundaries: [],
});
