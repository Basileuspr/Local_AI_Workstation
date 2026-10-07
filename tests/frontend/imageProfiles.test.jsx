import { describe, it, expect } from 'vitest';
import { reducer } from '../../src/useStore';
import { imageProfileFields, imageProfileChanged } from '../../src/imageProfiles';
import { defaultImageSettings } from '../../src/preferences';

const state = {imageSettings: {...defaultImageSettings, prompt:'Forest', seed:'123', modelId:'model', width:768, loraId:'adapter'},
  customProfiles:[], activeCustomProfileId:'', selectedModel:'chat', activeProfile:'precise', temperature:.2, roleplay:{enabled:false}};

describe('deliberate five-field image profiles', () => {
  it('saves only the requested fields and keeps chat controls', () => {
    const saved = reducer(state, {type:'CREATE_CUSTOM_PROFILE',payload:{id:'one',name:'Forest'}});
    expect(Object.keys(saved.customProfiles[0].imageSettings)).toEqual(imageProfileFields);
    expect(saved.customProfiles[0].chatSettings).toBeUndefined();
    expect(saved.activeProfile).toBe('precise');
    const edited = reducer(saved,{type:'SET_IMAGE_SETTINGS',payload:{prompt:'Ocean',modelId:'new',width:512}});
    expect(edited.customProfiles).toBe(saved.customProfiles);
    expect(imageProfileChanged(edited.customProfiles[0],edited.imageSettings)).toBe(true);
    const chatEdited = reducer(edited,{type:'SET_PARAM',key:'temperature',value:.9});
    expect(chatEdited.customProfiles).toBe(saved.customProfiles);
    const updated = reducer(chatEdited,{type:'UPDATE_CUSTOM_PROFILE'});
    expect(updated.customProfiles[0].imageSettings.prompt).toBe('Ocean');
    expect(imageProfileChanged(updated.customProfiles[0],updated.imageSettings)).toBe(false);
  });
  it('applies only those fields and preserves unrelated generation and chat controls', () => {
    const legacy = {id:'old',name:'Old',imageSettings:{...state.imageSettings,prompt:'Legacy',modelId:'old-model'},chatSettings:{selectedModel:'old-chat',temperature:.8}};
    const loaded = reducer({...state,customProfiles:[legacy]}, {type:'APPLY_CUSTOM_PROFILE',payload:'old'});
    expect(loaded.imageSettings.prompt).toBe('Legacy');
    expect(loaded.imageSettings.modelId).toBe('model');
    expect(loaded.selectedModel).toBe('chat');
    expect(loaded.temperature).toBe(.2);
    expect(loaded.activeProfile).toBe('precise');
    const updated = reducer(loaded,{type:'UPDATE_CUSTOM_PROFILE'});
    expect(updated.customProfiles[0].legacySettings.imageSettings.modelId).toBe('old-model');
    expect(updated.customProfiles[0].legacySettings.chatSettings).toEqual(legacy.chatSettings);
    expect(Object.keys(updated.customProfiles[0].imageSettings)).toEqual(imageProfileFields);
  });
});
