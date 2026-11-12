import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import MediaGenerationProgress from '../../src/components/MediaGenerationProgress';
import {runtimeIndicator} from '../../src/runtimeStatus';
import {queueDestination} from '../../src/queueNavigation';
import {calculateQueueTiming} from '../../src/queueTiming';

const job = {id:'video',status:'running',phase:'Generating',progress:{phase:'Generating',step:21,total_steps:40,elapsed_seconds:300,estimated_remaining_seconds:190,last_activity_seconds:1}};
describe('media progress and runtime status', () => {
  it('renders elapsed time, cumulative expert steps and a qualified estimate', () => {
    const html = renderToStaticMarkup(<MediaGenerationProgress job={job} age={2}/>);
    expect(html).toContain('5m 2s elapsed');
    expect(html).toContain('max="40" value="21"');
    expect(html).toContain('21/40 generation steps (53%)');
    expect(html).toContain('Estimated 3m 10s');
    expect(html).toContain('decoding and saving add time');
  });
  it('shows an indeterminate preparation bar instead of inventing a percentage', () => {
    const html = renderToStaticMarkup(<MediaGenerationProgress job={{...job,progress:{phase:'Encoding prompt',elapsed_seconds:40,step:0,total_steps:40}}}/>);
    expect(html).toContain('<progress aria-label="Media generation steps" max="40"></progress>');
    expect(html).toContain('Estimating after the first generation step');
    expect(html).toContain('40s elapsed');
  });
  it('freezes the elapsed clock and removes estimates during disconnection', () => {
    const html = renderToStaticMarkup(<MediaGenerationProgress job={job} age={60} unavailable/>);
    expect(html).toContain('5m 0s at last update');
    expect(html).toContain('Time estimate unavailable');
    expect(html).not.toContain('Estimated 3m');
  });
  it('distinguishes queue waiting, cancellation and final output work', () => {
    expect(renderToStaticMarkup(<MediaGenerationProgress job={{...job,status:'queued',position:2}}/>)).toContain('Waiting in Prompt Queue · #2');
    expect(renderToStaticMarkup(<MediaGenerationProgress job={{...job,status:'cancelling'}}/>)).toContain('release the GPU');
    expect(renderToStaticMarkup(<MediaGenerationProgress job={{...job,progress:{...job.progress,phase:'Decoding output'}}}/>)).toContain('Finishing output');
  });
  it('never reports a held GPU lease as idle, including providers unknown to the UI', () => {
    for (const owner of ['media-generation:one','image:one','audio:one','future-provider:one']) {
      const view = runtimeIndicator({gpu_owner:owner});
      expect(view.busy).toBe(true); expect(view.label).not.toContain('idle');
    }
    expect(runtimeIndicator(null).label).toContain('Checking');
  });
  it('uses queue stage and safe-stop state, and clears busy after completion', () => {
    const active = {kind:'media-generation',status:'running',stage:'Encoding prompt',label:'Wan video'};
    expect(runtimeIndicator({gpu_owner:'media-generation:one'},{jobs:[active]}).label).toBe('Encoding prompt · Wan video');
    expect(runtimeIndicator({}, {jobs:[{...active,status:'cancelling'}]}).label).toContain('Stopping safely');
    expect(runtimeIndicator({}, {jobs:[{...active,status:'completed'}]}).busy).toBe(false);
    expect(runtimeIndicator({unavailable:true}, {error:'disconnected',jobs:[active]}).unavailable).toBe(true);
    expect(runtimeIndicator({}, {jobs:[{...active,status:'queued'}],paused:true}).label).toContain('Queue paused');
  });
  it('opens the media tab from a video queue card', () => {
    expect(queueDestination({kind:'media-generation',request_id:'video'})).toEqual({tab:'generate',generationMode:'media',requestId:'video'});
  });
  it('does not estimate video from unrelated chat, image or other video settings', () => {
    const queued = {id:'one',kind:'media-generation',timing_profile:'large-video',status:'queued',requires_gpu:true};
    const records = [{kind:'image',gpu:true,status:'completed',runSeconds:5}, {kind:'media-generation',profile:'small-video',gpu:true,status:'completed',runSeconds:20}];
    expect(calculateQueueTiming({jobs:[queued]},records).jobs.one.duration).toBeNull();
    records.push({...records[1],profile:'large-video',runSeconds:300});
    expect(calculateQueueTiming({jobs:[queued]},records).jobs.one.duration).toBe(300);
  });
});
