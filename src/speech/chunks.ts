/** Keep long unpunctuated messages below Kokoro's phoneme window. */
export function speechChunks(text: string): string[] {
  const chunks: string[] = [];
  let chunk = '';
  for (const sentence of text.match(/[^。！？!?；;\n]+[。！？!?；;\n]*|[。！？!?；;\n]+/gu) ?? []) {
    for (const part of sentence.match(/.{1,80}/gsu) ?? []) {
      if (chunk.length + part.length > 160) {
        if (chunk.trim()) chunks.push(chunk.trim());
        chunk = '';
      }
      chunk += part;
      if (Array.from(part).length === 80 || chunk.length > 76) {
        if (chunk.trim()) chunks.push(chunk.trim());
        chunk = '';
      }
    }
  }
  if (chunk.trim()) chunks.push(chunk.trim());
  return chunks;
}
