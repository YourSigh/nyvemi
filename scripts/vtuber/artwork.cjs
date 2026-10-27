const fs = require('node:fs');
const path = require('node:path');
const { root, env, b64, request, download } = require('./ark.cjs');
const { rigPortrait, completeLayers } = require('./prompts.cjs');
const constraints =
  'Simplified animation-ready chibi VTuber character reference. Straight front view, upright head, neutral standing pose, entire character visible with padding, arms relaxed away from torso, hands do not cover face or body, legs naturally apart. Clearly separated simple hair masses, reduce fine strands, dangling charms and crossed structures. Flat clean colors with soft shading, plain background, no text, no layout sheet, no multiple views. Both eyes fully open, small open mouth with visible dark mouth interior. Preserve requested identity and palette.';
async function main() {
  const op = process.argv[2],
    input = process.argv[3];
  if (op === 'source') {
    const description = fs.readFileSync(input, 'utf8');
    const reference = process.argv[4];
    const response = await request('rig-portrait', {
      model: env.NYVEMI_ARK_LAYER_MODEL,
      prompt: `${rigPortrait}\nCharacter identity: ${description}`,
      size: '2K',
      response_format: 'url',
      watermark: false,
      ...(reference ? { image: b64(reference) } : {}),
    });
    if (response.data?.length !== 1 || !response.data[0].url) throw Error('Expected one portrait');
    await download(response.data[0], path.join(root, 'portrait.png'));
    console.log('One animation-ready portrait saved');
  } else if (op === 'candidates') {
    const description = fs.readFileSync(input, 'utf8');
    const reference = process.argv[4];
    for (let i = 0; i < 3; i++) {
      const response = await request(`candidate-${i + 1}`, {
        model: env.NYVEMI_ARK_LAYER_MODEL,
        prompt: `${constraints}\nCharacter description: ${description}\nAlternative outfit design ${i + 1}; retain every identifying feature.`,
        size: '2K',
        response_format: 'url',
        watermark: false,
        ...(reference ? { image: b64(reference) } : {}),
      });
      if (response.data?.length !== 1 || !response.data[0].url)
        throw Error('Expected one candidate image');
      await download(response.data[0], path.join(root, `candidate-${i + 1}.png`));
      console.log(`Candidate ${i + 1}/3 saved`);
    }
  } else if (op === 'split' || op === 'split-complete') {
    const prompt =
      'Decompose this character into animation-ready transparent PNG layers. Separate: body (the complete original fully clothed body including jacket, shirt, skirt, legs and shoes, no gaps), head (clean face plane with eyes and mouth separately removed), hair (complete hairstyle), arms (original sleeves and hands), eyes (both existing open eyes in their original colors), mouth (original mouth interior). English layer names: body, head, hair, arm, eyes, mouth. Keep all original clothing, pose and alignment unchanged. Do not change costume or add anatomy. Preserve identity. Background only in base layer, not repeated character. Each layer contains only the named part.';
    const response = await request(
      op === 'split-complete' ? 'layers-complete' : 'layers-standard',
      {
        model: env.NYVEMI_ARK_LAYER_MODEL,
        prompt: op === 'split-complete' ? completeLayers : prompt,
        image: b64(input),
        layer_decomposition: true,
        size: '2K',
        response_format: 'url',
        watermark: false,
      },
    );
    const layers = [];
    for (const [i, item] of response.data.entries())
      if (item.bounding_box) {
        const file = path.join(root, `layer-${i}.png`);
        await download(item, file);
        layers.push({ ...item, url: undefined, file: path.basename(file) });
      }
    const base = response.data.find((i) => !i.bounding_box);
    if (!base?.size || !layers.length) throw Error('No aligned layers returned');
    fs.writeFileSync(
      path.join(root, 'layers.json'),
      JSON.stringify(
        {
          size: base.size,
          ...(op === 'split-complete' ? { preparation: 'occlusion-v2' } : {}),
          layers,
        },
        null,
        2,
      ),
    );
    console.log(`Saved ${layers.length} transparent rig layers`);
  } else
    throw Error(
      'Usage: artwork.cjs source|candidates description.txt [reference] | split|split-complete selected.png',
    );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
