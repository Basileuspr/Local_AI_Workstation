import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import GenerateReference from '../../src/components/GenerateReference';
import WorkflowRunPanel from '../../src/components/WorkflowRunPanel';
import { referenceOptions, readReferenceImage, REFERENCE_PRESETS, refinementSteps, referenceComparison, appendReferencePrompt } from '../../src/generationReference';
import { MAX_IMAGE_STEPS } from '../../src/imageGenerationLimits';

describe('Generate reference images', () => {
  it('shows an upload button before any image or model is selected', () => {
    const html = renderToStaticMarkup(<GenerateReference reference={null} strength={.3} fit="contain" steps={24} />);
    expect(html).toContain('Upload image</button>');
    expect(html).toContain('type="file"');
    expect(html).toContain('image/png,image/jpeg,image/webp');
  });
  it('shows removable full-image preview and explicit change/fit controls', () => {
    const html = renderToStaticMarkup(<GenerateReference reference={{url:'blob:preview',file:{name:'source.png'},width:1200,height:800}} strength={.3} fit="contain" steps={24} />);
    expect(html).toContain('Remove reference');
    expect(html).toContain('1200 × 800');
    expect(html).toContain('30%');
    expect(html).toContain('7 denoising steps');
    expect(html).toContain('white padding');
  });
  it('keeps text-only requests independent of pending reference settings', () => {
    expect(referenceOptions(null, NaN, 'wrong', 0)).toEqual({});
    expect(referenceOptions({}, .3, 'contain', 24)).toEqual({strength:.3,source_fit:'contain'});
    expect(() => referenceOptions({}, .3, 'contain', 1)).toThrow('at least one');
    expect(() => referenceOptions({}, NaN, 'contain', 24)).toThrow('Change amount');
  });
  it('rejects unsupported and oversized files before creating previews or uploads', async () => {
    await expect(readReferenceImage({type:'image/svg+xml',size:10})).rejects.toThrow('PNG');
    await expect(readReferenceImage({type:'image/png',size:21*1024**2})).rejects.toThrow('20 MiB');
  });
  it('releases a failed preview URL', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:failed');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('Image', class { set src(value) { queueMicrotask(() => this.onerror()); } });
    try {
      await expect(readReferenceImage({type:'image/png',size:10})).rejects.toThrow('could not be opened');
      expect(revoke).toHaveBeenCalledWith('blob:failed');
    } finally { create.mockRestore(); revoke.mockRestore(); vi.unstubAllGlobals(); }
  });
  it('presets provide real refinement while keeping the close-variation strength low', () => {
    for (const preset of REFERENCE_PRESETS) expect(Math.floor(preset.steps * preset.strength)).toBeGreaterThanOrEqual(20);
    expect(REFERENCE_PRESETS[0].strength).toBe(.25);
    expect(referenceOptions({}, .25, 'edge', 80)).toEqual({strength:.25, source_fit:'edge'});
    expect(refinementSteps(.05)).toBe(MAX_IMAGE_STEPS);
  });
  it('compares strengths with the same seed, prompt, LoRA and actual denoising budget', () => {
    const settings = {seed:'123', prompt:'original', steps:80, loraId:'identity'};
    const requests = referenceComparison(settings, .25);
    expect(requests.map(item => item.referenceStrength)).toEqual([.15, .25, .35]);
    expect(requests.map(item => Math.floor(item.settings.steps * item.referenceStrength))).toEqual([20,20,20]);
    for (const item of requests) expect(item.settings).toMatchObject({seed:123,prompt:'original',loraId:'identity'});
    expect(settings.steps).toBe(80);
    expect(new Set(referenceComparison({...settings, seed:''}, .3).map(item => item.settings.seed)).size).toBe(1);
  });
  it('keeps comparisons bounded at both ends and respects the shared step limit', () => {
    for (const strength of [.05, .1, .95, 1]) {
      const requests = referenceComparison({seed:7, steps:200}, strength);
      expect(new Set(requests.map(item => item.referenceStrength)).size).toBe(requests.length);
      expect(new Set(requests.map(item => Math.floor(item.settings.steps * item.referenceStrength))).size).toBe(1);
      for (const item of requests) expect(item.settings.steps).toBeLessThanOrEqual(MAX_IMAGE_STEPS);
    }
  });
  it('adds only reviewed selected details, preserves the draft and excludes uncertainties', () => {
    const analysis = {appearance:'curly hair',style:'watercolor',composition:'wide angle',lighting:'soft side light', uncertainties:['eyes obscured']};
    expect(appendReferencePrompt('A cottage', analysis, ['style','lighting'])).toBe('A cottage\nwatercolor, soft side light');
    expect(appendReferencePrompt('A cottage\nwatercolor', analysis, ['style'])).toBe('A cottage\nwatercolor');
    expect(() => appendReferencePrompt('x'.repeat(12000), analysis, ['style'])).toThrow('12,000');
    expect(() => appendReferencePrompt('draft', analysis, [])).toThrow('Select');
  });
  it('keeps saved reference observations usable from the workflow results', () => {
    const html = renderToStaticMarkup(<WorkflowRunPanel record={{id:'run',workflow_id:'workflow',status:'completed',outputs:[],
      stage_results:[{stage_id:'analysis',text:'Reference details ready for review',metadata:{reference_analysis:{appearance:'Curly hair',style:'Watercolor',composition:'Portrait',lighting:'Side light',uncertainties:['Eyes obscured']}}}]}}/>);
    expect(html).toContain('Likeness and emulation details');
    expect(html).toContain('Curly hair');
    expect(html).toContain('Use style and palette as positive prompt');
    expect(html).toContain('Eyes obscured');
    expect(html).not.toContain('Reference details ready for review');
  });
});
