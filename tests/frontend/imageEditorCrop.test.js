import { describe, expect, it } from 'vitest';
import { cropPixelRect, editorOutputSize } from '../../src/imageEditorCrop';
import { cropEditStage, editRecipe, hasCurrentPass, newEditState, repeatEditStage, unlockEditStage } from '../../src/imageEditorStages';

describe('pixel crop geometry', () => {
  it('snaps to original pixels and keeps edge selections inside the image', () => {
    expect(cropPixelRect([.1, .2, .8, .9], 1800, 900)).toEqual({ x: 180, y: 180, width: 1260, height: 630 });
    expect(cropPixelRect([-.1, -.2, 1.2, 1.1], 640, 400)).toEqual({ x: 0, y: 0, width: 640, height: 400 });
    expect(cropPixelRect([639 / 640, 399 / 400, 1, 1], 640, 400)).toEqual({ x: 639, y: 399, width: 1, height: 1 });
  });
  it.each([null, [], [0, 0, 0, 1], [1, 0, 0, 1], [0, NaN, 1, 1], [.1, .1, .10001, .10001]])('rejects empty or invalid crops: %s', box => {
    expect(cropPixelRect(box, 640, 400)).toBeNull();
  });
  it('tracks successive crops and rotations in the current image coordinate frame', () => {
    const recipe = { stages: [{ rotation: 90 }, { crop: [.1, .1, .9, .9] }, { rotation: 270 }, { crop: [.25, 0, .75, 1] }], rotation: 90 };
    expect(editorOutputSize(640, 400, recipe)).toEqual({ width: 320, height: 256 });
  });
});

describe('crop history stages', () => {
  it('locks existing color and rotation edits before cropping and starts a neutral pass', () => {
    const edit = { ...newEditState({ contrast: 20, rotation: 90 }), colorEdits: [{ x: .2, y: .4, color: [100, 80, 60] }] };
    const cropped = cropEditStage(edit, [.1, .2, .8, .9]);
    expect(cropped.stages).toHaveLength(2);
    expect(cropped.stages[0].pass).toMatchObject({ contrast: 20, rotation: 90, colorEdits: edit.colorEdits });
    expect(cropped.stages[1].pass).toEqual({ crop: [.1, .2, .8, .9] });
    expect(hasCurrentPass(cropped)).toBe(false);
    expect(edit.stages).toHaveLength(0);
    expect(unlockEditStage(unlockEditStage(cropped))).toEqual(edit);
    expect(repeatEditStage(cropped)).toBe(cropped);
    expect(editRecipe(cropped).stages).toHaveLength(2);
  });
  it('allows multiple crops without adding empty adjustment stages', () => {
    const first = cropEditStage(newEditState(), [.1, .1, .9, .9]);
    const second = cropEditStage(first, [0, 0, .5, .5]);
    expect(second.stages).toHaveLength(2);
    expect(editorOutputSize(640, 400, editRecipe(second))).toEqual({ width: 256, height: 160 });
    expect(unlockEditStage(second)).toEqual(first);
  });
  it('respects the stage limit including a pending adjustment pass', () => {
    const edit = newEditState();
    edit.stages = Array.from({ length: 15 }, () => ({ pass: {}, markers: edit.settings, beforeAnchor: edit.anchor }));
    expect(cropEditStage(edit, [0, 0, .5, .5]).stages).toHaveLength(16);
    const dirty = { ...edit, settings: { ...edit.settings, contrast: 20 } };
    expect(cropEditStage(dirty, [0, 0, .5, .5])).toBe(dirty);
    const full = { ...edit, stages: [...edit.stages, edit.stages[0]] };
    expect(cropEditStage(full, [0, 0, .5, .5])).toBe(full);
  });
});
