import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach, expect, it, vi} from 'vitest';
import {RESOURCE_KINDS, linkedCharacters} from '../../src/characterResources';
import CharacterLinks from '../../src/components/CharacterLinks';
import {WorkspaceHelpContent} from '../../src/components/WorkspaceInfo';
afterEach(() => vi.unstubAllGlobals());

it('offers face datasets alongside parts datasets and LoRAs in the reference library', () => {
  expect(RESOURCE_KINDS).toMatchObject({face_dataset:'Face dataset',parts:'Character parts dataset',lora_project:'LoRA project',lora_adapter:'Trained LoRA'});
});
it('looks up the characters tied to one workspace item', async () => {
  const fetch = vi.fn(async () => new Response('{"characters":[{"character_id":"c","name":"Ada","link_id":"l","note":""}]}',{headers:{'content-type':'application/json'}}));
  vi.stubGlobal('fetch',fetch);
  const result = await linkedCharacters('face_dataset','abc/def');
  expect(String(fetch.mock.calls[0][0])).toContain('/faces/character-resources/links/face_dataset/abc%2Fdef');
  expect(result.characters[0].name).toBe('Ada');
});
it('describes the tie as optional and non-destructive before anything loads', () => {
  const html = renderToStaticMarkup(<CharacterLinks kind="parts" targetId="d" label="parts dataset"/>);
  expect(html).toContain('Characters tied to this parts dataset');
  const help=renderToStaticMarkup(<WorkspaceHelpContent tab="character-parts"/>);
  expect(help).toContain('Optionally links');
  expect(help).toContain('without copying, moving or training');
  expect(html).not.toContain('Tie to character');
});
