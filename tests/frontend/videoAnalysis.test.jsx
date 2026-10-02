import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import LocalVideo from '../../src/components/LocalVideo';

const file={id:'fixture',name:'video.mp4',data:{metadata:{duration:3,width:640,height:360,fps:10,codec:'h264',audio:false},frames:[]}};
describe('Video analysis presentation',()=>{
  it('defaults to analysis and explains that frame extraction alone does not analyze content',()=>{
    const html=renderToStaticMarkup(<LocalVideo file={file} run={()=>{}} onSaved={()=>{}} busy={false} active/>);
    expect(html).toContain('value="vision" selected=""');
    expect(html).toContain('No content analysis yet');
    expect(html).toContain('Extract frames only (no AI)');
    expect(html).toContain('What should the analysis focus on?');
    expect(html.indexOf('aria-label="Video controls"')).toBeLessThan(html.indexOf('<video'));
    expect(html.indexOf('>Analyze video</button>')).toBeLessThan(html.indexOf('<video'));
    expect(html).not.toContain('Keyframes only');
  });
  it('presents a report and timestamped observations, rendering model text inertly',()=>{
    const analyzed={...file,data:{...file.data,analysis:{status:'complete',model:'test',summary:'An object moves across sampled positions.',observations:[{id:'a',time:1.5,text:'<script>do not execute</script>'}],note:'Sampled evidence.'}}};
    const html=renderToStaticMarkup(<LocalVideo file={analyzed} run={()=>{}} onSaved={()=>{}} busy={false} active/>);
    expect(html).toContain('Observed timeline');expect(html).toContain('An object moves');expect(html).toContain('00:00:01');
    expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>do not execute');
  });
});
