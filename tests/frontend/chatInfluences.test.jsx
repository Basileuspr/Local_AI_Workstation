import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {chatInfluences} from '../../src/chatInfluences';
import {defaultRoleplayConfig,roleplayFromCharacter,buildRoleplaySystemPrompt} from '../../src/roleplayPrompt';
import {mergeSystemPrompt} from '../../src/responseStyle';
import {reducer} from '../../src/useStore';
import {buildContextMessages} from '../../src/contextMemory';
import {ReplyInfluences} from '../../src/components/ChatInfluences';

const state={selectedModel:'local',systemPrompt:'Use a formal assistant voice.',responseStyle:'structured',roleplay:defaultRoleplayConfig,
  useKnowledgeBase:true,knowledgeDocIds:null,conversationHistory:[],knowledgeScopes:{},customProfiles:[]};
const character={id:'character-1',name:'Nova',bio:'An explorer.',notes:'Speaks briefly.',resources:[{note:'Never include this asset note'}],centroid:[1,2]};

describe('chat influence contract',()=>{
  it('preserves the existing manual prompt until the user opts out of overlays',()=>{
    const roleplay={...defaultRoleplayConfig,enabled:true,characterName:'Manual',scenario:'Coastal town'};
    const plan=chatInfluences({...state,roleplay});
    expect(plan.systemPrompt).toBe(mergeSystemPrompt({basePrompt:state.systemPrompt,responseStyle:state.responseStyle,roleplayPrompt:buildRoleplaySystemPrompt('',roleplay)}));
    expect(plan.warnings).toHaveLength(4);
    expect(plan.useDurableMemory).toBe(true);
  });
  it('loads a fresh saved profile without another character or global overlays leaking in',()=>{
    const loaded=reducer({...state,activeCustomProfileId:'old-preset',roleplay:{...defaultRoleplayConfig,characterName:'Old',scenario:'Old scenario',characterSystemPrompt:'Old instructions',userName:'Player'}},{type:'LOAD_ROLEPLAY_CHARACTER',payload:character});
    const plan=chatInfluences(loaded);
    expect(loaded.activeCustomProfileId).toBe('');
    expect(loaded.roleplay.userName).toBe('Player');
    expect(plan.systemPrompt).toContain('An explorer.');
    expect(plan.systemPrompt).toContain('Speaks briefly.');
    for(const text of ['Old scenario','Old instructions','formal assistant','Never include this asset note'])expect(plan.systemPrompt).not.toContain(text);
    expect(plan.parts.map(part=>part.name)).toEqual(['Roleplay']);
    expect(plan.useDurableMemory).toBe(false);
    expect(loaded.roleplay.source).toMatchObject({id:'character-1',name:'Nova',edited:false});
    expect(JSON.stringify(loaded.roleplay)).not.toContain('centroid');
    expect(plan.warnings).toHaveLength(1); // Existing all-document scope remains visible.
    expect(loaded.knowledgeDocIds).toBeNull();
  });
  it('tracks local edits and restores normal chat instructions when roleplay is disabled',()=>{
    let loaded={...state,roleplay:roleplayFromCharacter(character)};
    loaded=reducer(loaded,{type:'SET_ROLEPLAY_FIELD',key:'description',value:'An edited biography.'});
    expect(loaded.roleplay.source.edited).toBe(true);
    loaded=reducer(loaded,{type:'SET_ROLEPLAY_FIELD',key:'enabled',value:false});
    expect(chatInfluences(loaded).summary.roleplay).toBeNull();
    expect(chatInfluences(loaded).systemPrompt).toContain(state.systemPrompt);
    expect(chatInfluences(loaded).systemPrompt).not.toContain('An edited biography.');
    expect(chatInfluences(loaded).useDurableMemory).toBe(true);
  });
  it('never re-injects receipt contents into chat history',()=>{
    const context=buildContextMessages([{role:'assistant',content:'Hello',influence_receipt:{messages:[{text:'Secret prior instructions'}]},influence_settings:{model:'old'}}],'',0);
    expect(JSON.stringify(context)).not.toContain('Secret prior instructions');
    expect(JSON.stringify(context)).not.toContain('influence_');
    expect(JSON.stringify(context)).toContain('Hello');
  });
  it('renders historical records and distinguishes unknown records from current settings',()=>{
    const html=renderToStaticMarkup(<ReplyInfluences message={{influence_settings:{roleplay:{name:'Earlier character'},generalPrompt:false},influence_receipt:{model:'earlier-model',prepared_at:'2026-01-01T00:00:00Z',mode:'chat',message_count:2,image_count:0,messages:[],durable_memory:{status:'off'},knowledge:{status:'included',mode:'selected',sources:[{filename:'Scene.md',chunk_index:0,characters:42}]}}}}/>);
    expect(html).toContain('Earlier character');expect(html).toContain('earlier-model');expect(html).toContain('Scene.md');
    expect(html).toContain('not proof');
    const old=renderToStaticMarkup(<ReplyInfluences message={{content:'Old answer'}}/>);
    expect(old).toContain('not recorded');expect(old).toContain('Current chat settings cannot');
  });
  it('identifies the actual OCR reader without attributing transcription to configured roleplay',()=>{
    const html=renderToStaticMarkup(<ReplyInfluences message={{influence_settings:{roleplay:{name:'Unrelated character'},generalPrompt:true},influence_receipt:{model:'local-ocr',prepared_at:'2026-01-01T00:00:00Z',mode:'image_transcription',message_count:1,image_count:1,messages:[],durable_memory:{status:'off'},knowledge:{status:'off',mode:'off'}}}}/>);
    expect(html).toContain('image transcription · local-ocr');
    expect(html).toContain('latest image request in the batch');
    expect(html).not.toContain('Unrelated character');
    expect(html).not.toContain('At Send');
  });
});
