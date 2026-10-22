import type {
  Character,
  Experience,
  ExperienceAppraisal,
  Interest,
  Memory,
} from '../domain/models';
import { overlap } from '../memory/retrieval';
export function appraiseExperience(
  experience: Experience,
  character: Character,
  memories: Memory[],
): ExperienceAppraisal {
  if (experience.source === 'local-time')
    return {
      selfInterest: 0.1,
      userRelevance: 0,
      novelty: 0.1,
      emotionalValue: 0.1,
      shareImpulse: 0.02,
    };
  const text = `${experience.title} ${experience.content}`;
  const own = [
    ...character.persona.likes,
    ...character.interests.filter((i) => i.score > 0.25).map((i) => i.topic),
  ];
  const selfInterest = Math.min(1, 0.15 + Math.max(0, ...own.map((t) => overlap(text, t))) * 1.3);
  const ranked = memories
    .map((memory) => ({ memory, score: overlap(text, memory.content) }))
    .sort((a, b) => b.score - a.score);
  const association = ranked[0];
  const userRelevance = Math.min(1, (association?.score ?? 0) * 1.7);
  const novelty = experience.source === 'conversation' ? 0.25 : 0.85;
  const emotionalValue = Math.min(1, 0.2 + userRelevance * 0.45);
  const shareImpulse = Math.min(
    1,
    userRelevance * 0.52 + selfInterest * 0.2 + novelty * 0.18 + emotionalValue * 0.1,
  );
  return {
    selfInterest,
    userRelevance,
    novelty,
    emotionalValue,
    memoryAssociation:
      association && association.score > 0.1 ? association.memory.content : undefined,
    shareImpulse,
  };
}
export function updateInterests(
  interests: Interest[],
  experience: Experience,
  now: number,
): Interest[] {
  const appraisal = experience.appraisal;
  if (!appraisal || appraisal.selfInterest < 0.5) return interests;
  // A user's relevance alone never creates an identical character preference.
  const updated = interests.map((interest) => {
    if (overlap(`${experience.title} ${experience.content}`, interest.topic) < 0.05)
      return interest;
    const elapsed = Math.max(0, now - interest.updatedAt) / 3600000;
    const delta = Math.min(0.02, elapsed * 0.002) * appraisal.selfInterest;
    return delta > 0
      ? {
          ...interest,
          score: Math.min(0.95, interest.score + delta),
          source: 'experience' as const,
          updatedAt: now,
        }
      : interest;
  });
  const emerging = experience.topics.find(
    (topic) =>
      topic.length >= 4 &&
      topic.length <= 40 &&
      !updated.some((i) => i.topic.toLowerCase() === topic.toLowerCase()),
  );
  if (emerging && updated.length < 16)
    updated.push({ topic: emerging, score: 0.15, source: 'experience', updatedAt: now });
  return updated;
}
