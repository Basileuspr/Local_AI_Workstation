import { describe, expect, it } from 'vitest';
import { imagePromptIndexEntry, imagePromptIndexTitle } from '../../src/imagePromptIndex';

describe('saving Generate prompt pairs', () => {
  it('keeps multiline positive and negative prompts separately labeled', () => {
    const settings = {prompt:'A forest\n(mist:1.2)',negativePrompt:'text, watermark\nblurry'};
    expect(imagePromptIndexEntry(settings, ' Forest variation ')).toEqual({
      title:'Forest variation',content:'Positive prompt:\nA forest\n(mist:1.2)\n\nNegative prompt:\ntext, watermark\nblurry',source:'Generate',tags:['image-generation','prompts'],
    });
  });
  it('allows blank negative prompts and changes only the variation content', () => {
    const settings = {prompt:'Forest',negativePrompt:''};
    const original = imagePromptIndexEntry(settings, 'Favorite');
    const variant = imagePromptIndexEntry({...settings,prompt:'Forest at dusk'}, 'Favorite');
    expect(original.content).toContain('Positive prompt:\nForest\n\nNegative prompt:\n');
    expect(variant.content).toContain('Forest at dusk');
    expect(original).not.toHaveProperty('id');
    expect(variant).not.toHaveProperty('id');
    expect(settings.prompt).toBe('Forest');
  });
  it('rejects empty pairs and missing names', () => {
    expect(() => imagePromptIndexEntry({prompt:' ',negativePrompt:'\n'},'Empty')).toThrow('prompt first');
    expect(() => imagePromptIndexEntry({prompt:'Forest'},' ')).toThrow('name');
    expect(imagePromptIndexEntry({negativePrompt:'watermark'},'Negative only').content).toContain('watermark');
  });
  it('suggests a bounded single-line title without truncating the saved prompts', () => {
    const settings = {prompt:'Detailed\n'+'forest '.repeat(1500),negativePrompt:'blurry'};
    const title = imagePromptIndexTitle(settings);
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title).not.toContain('\n');
    expect(imagePromptIndexEntry(settings,title).content).toContain(settings.prompt);
  });
});
