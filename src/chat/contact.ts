import type { Storage } from '../storage/store';
/** Persisted interaction boundary, independent of persona tone or input keywords. */
export async function setContactMode(
  store: Storage,
  characterId: string,
  quiet: boolean,
): Promise<void> {
  const character = await store.get('characters', characterId);
  if (character)
    await store.put('characters', {
      ...character,
      state: { ...character.state, contactMode: quiet ? 'quiet' : 'open' },
    });
  if (quiet)
    for (const task of await store.list('intentions', characterId, 10000))
      if (task.status === 'pending')
        await store.put('intentions', { ...task, status: 'cancelled' });
}
