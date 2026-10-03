import {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
import {appTabs,appTabLabels,resolveActiveTab} from '../../src/navigation';
import {navigationSections} from '../../src/navigationOrder';
const require=createRequire(import.meta.url);
const {embedUrl}=require('../../electron/linkedContent');
const {grantPlayback,revokePlayback,playbackGranted}=require('../../electron/playbackCapture');
const {allowAudioPermission}=require('../../electron/audioPermissions');

describe('linked applications boundaries',()=>{
  it('offers both workspaces through the actual navigation',()=>{
    for(const id of ['slicer','integrations']){
      expect(appTabs).toContain(id);expect(appTabLabels[id]).toBeTruthy();expect(resolveActiveTab(id)).toBe(id);
      expect(navigationSections.flatMap(section=>section.items).some(item=>item.id===id)).toBe(true);
    }
  });
  it('accepts only fixed embeds in the remote content view',()=>{
    const url='https://open.spotify.com/embed/track/0123456789ABCDEFGHIJKL';
    expect(embedUrl('spotify',url)).toBe(url);
    for(const value of [url+'?law_token=secret',url.replace('open.spotify.com','evil.test'),url.replace('https:','http:'),'file:///C:/private'])expect(embedUrl('spotify',value)).toBeNull();
    expect(embedUrl('discord','https://discord.com/widget?id=123456789012345678&theme=dark')).toBeTruthy();
    expect(embedUrl('discord','https://discord.com/channels/@me')).toBeNull();
  });
  it('requires an explicit, revocable capture grant',()=>{
    const contents={};expect(playbackGranted(contents)).toBe(false);grantPlayback(contents);expect(playbackGranted(contents)).toBe(true);revokePlayback(contents);expect(playbackGranted(contents)).toBe(false);
  });
  it('allows desktop capture media only during the main-frame grant',()=>{
    const contents={getURL:()=> 'app://local/index.html'};
    const details={requestingUrl:'app://local/index.html',isMainFrame:true,mediaTypes:[]};
    expect(allowAudioPermission(contents,'media',details,contents)).toBe(false);
    grantPlayback(contents);expect(allowAudioPermission(contents,'media',details,contents)).toBe(true);
    expect(allowAudioPermission(contents,'media',{...details,isMainFrame:false},contents)).toBe(false);
    expect(allowAudioPermission(contents,'media',{...details,requestingUrl:'https://open.spotify.com'},contents)).toBe(false);
    revokePlayback(contents);expect(allowAudioPermission(contents,'media',details,contents)).toBe(false);
  });
});
