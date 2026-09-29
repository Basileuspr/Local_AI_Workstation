import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {calculateQueueTiming, recordQueueTiming, queueAverages, loadQueueTiming, saveQueueTiming, formatQueueTime} from '../../src/queueTiming';
import {QueueTimingReport} from '../../src/components/PromptQueue';

const date = seconds => new Date(Date.UTC(2026,8,26)+seconds*1000).toISOString();
const job = (id, status='queued', extra={}) => ({id,kind:'image',status,created_at:date(0),requires_gpu:true,...extra});
const sample = (runSeconds, extra={}) => ({kind:'image',status:'completed',runSeconds,gpu:true,...extra});
const snapshot = jobs => ({jobs,reported_at:date(100)});

describe('queue timing calculations',()=>{
  it('estimates a cold batch after its first step using matching settings only',()=>{
    const first=job('a','running',{timing_profile:'same',started_at:date(80),progress:{step:1,total_steps:4,elapsed_seconds:20,estimated_remaining_seconds:30}});
    const result=calculateQueueTiming(snapshot([first,job('b','queued',{timing_profile:'same'}),job('c','queued',{timing_profile:'same'})]),[]);
    expect(result.jobs.b.duration).toBe(50);
    expect(result.jobs.b.wait).toBe(30);
    expect(result.remaining).toBe(130);
    expect(result.averages.count).toBe(0);
    expect(result.jobs.b.basis).toContain('Live steps');
    expect(calculateQueueTiming(snapshot([first,job('different','queued',{timing_profile:'other'})]),[]).jobs.different.duration).toBeNull();
  });
  it('retains inference timing history after PNG saving releases the GPU',()=>{
    const saving=job('a','running',{stage:'saving',requires_gpu:false,started_at:date(80)});
    const result=calculateQueueTiming(snapshot([saving,job('b')]),[sample(60)]);
    expect(result.jobs.b.wait).toBe(0);
    expect(result.jobs.a.duration).toBe(60);
    const rows=recordQueueTiming([],snapshot([{...saving,status:'completed',finished_at:date(100)}]));
    expect(rows[0].gpu).toBe(true);
    expect(calculateQueueTiming(snapshot([job('b')]),rows).jobs.b.duration).toBe(20);
  });
  it('sums only remaining GPU work and preserves distinct batch requests',()=>{
    const result=calculateQueueTiming(snapshot([job('a','running',{started_at:date(80)}),job('b'),job('c'),job('d')]),[sample(60)]);
    expect(result.jobs.a.remaining).toBe(40);
    expect(result.jobs.b.wait).toBe(40);
    expect(result.jobs.d.wait).toBe(160);
    expect(result.remaining).toBe(220);
  });
  it('prefers matching settings then kind then explicitly rough overall fallback',()=>{
    const samples=[sample(100,{profile:'large'}),sample(20,{profile:'small'}),sample(30,{kind:'chat'})];
    const result=calculateQueueTiming(snapshot([job('a','queued',{timing_profile:'large'}),job('b'),job('c','queued',{kind:'training'})]),samples);
    expect(result.jobs.a.duration).toBe(100);
    expect(result.jobs.b.duration).toBe(60);
    expect(result.jobs.c.duration).toBe(50);
    expect(result.jobs.c.basis).toContain('rough fallback');
  });
  it('uses live steps before history and avoids zero-time promises after overruns',()=>{
    const running=job('a','running',{started_at:date(0),progress:{estimated_remaining_seconds:25}});
    expect(calculateQueueTiming(snapshot([running,job('b')]),[sample(60)]).jobs.b.wait).toBe(25);
    expect(calculateQueueTiming(snapshot([running]),[]).remaining).toBe(25);
    running.progress=null;
    const result=calculateQueueTiming(snapshot([running,job('b')]),[sample(60)]);
    expect(result.remaining).toBeNull();
    expect(result.jobs.a.reason).toContain('Longer');
    expect(result.jobs.b.wait).toBeNull();
  });
  it('does not claim known waits for pause, external GPU ownership, cancellation or cold history',()=>{
    for(const extra of [{paused:true},{gpu_owner:'external'}]) {
      expect(calculateQueueTiming({...snapshot([job('a')]),...extra},[sample(60)]).jobs.a.wait).toBeNull();
    }
    expect(calculateQueueTiming(snapshot([job('a','cancelling',{started_at:date(90)}),job('b')]),[sample(60)]).remaining).toBeNull();
    expect(calculateQueueTiming(snapshot([job('a'),job('b')]),[]).jobs.b.wait).toBeNull();
    expect(calculateQueueTiming(snapshot([job('a','cancelled'),job('b')]),[sample(60)]).jobs.b.wait).toBe(0);
  });
  it('CPU work runs in parallel and never adds to the GPU FIFO',()=>{
    const jobs=[job('cpu','running',{requires_gpu:false,kind:'faces',started_at:date(90)}),job('a'),job('b')];
    const result=calculateQueueTiming(snapshot(jobs),[sample(60),sample(200,{gpu:false,kind:'faces'})]);
    expect(result.jobs.a.wait).toBe(0);
    expect(result.jobs.b.wait).toBe(60);
    expect(result.remaining).toBe(190);
  });
  it('serializes GIF estimates in their CPU lane alongside the GPU queue',()=>{
    const jobs=[job('gif1','running',{requires_gpu:false,cpu_lane:'gif',kind:'gif',started_at:date(90)}),job('gif2','queued',{requires_gpu:false,cpu_lane:'gif',kind:'gif'}),job('gpu')];
    const result=calculateQueueTiming(snapshot(jobs),[sample(30,{gpu:false,kind:'gif'}),sample(40)]);
    expect(result.jobs.gif2.wait).toBe(20);
    expect(result.jobs.gif2.finish).toBe(50);
    expect(result.jobs.gpu.wait).toBe(0);
    expect(result.remaining).toBe(50);
  });
  it('failed, cancelled, missing and invalid durations never train averages',()=>{
    const result=queueAverages([sample(60),sample(20,{kind:'chat'}),sample(500,{status:'failed'}),sample(1,{status:'cancelled'}),sample(null),sample(NaN),sample(-1),sample(0)]);
    expect(result.overall).toBe(40); expect(result.count).toBe(2); expect(result.image).toBe(60);
  });
});

describe('UI timing report',()=>{
  it('records first estimate and actual wait/run separately, deduplicates polling and persists across reload',()=>{
    const historical=job('old','completed',{started_at:date(1),finished_at:date(61)});
    let rows=recordQueueTiming([],snapshot([historical,job('new','queued',{label:'private prompt'})]));
    expect(rows[1].estimatedRun).toBe(60); expect(rows[1].estimatedWait).toBe(100);
    rows=recordQueueTiming(rows,snapshot([historical,job('new','running',{started_at:date(10)})]));
    rows=recordQueueTiming(rows,snapshot([historical,job('new','completed',{started_at:date(10),finished_at:date(80)})]));
    const again=recordQueueTiming(rows,snapshot([historical,job('new','completed',{started_at:date(10),finished_at:date(80)})]));
    expect(again).toEqual(rows); expect(rows[1].waitSeconds).toBe(10); expect(rows[1].runSeconds).toBe(70);
    expect(rows[1].estimatedRun).toBe(60); expect(JSON.stringify(rows)).not.toContain('private prompt');
    let stored; const storage={setItem:(_,value)=>{stored=value;},getItem:()=>stored};
    expect(saveQueueTiming(rows,storage)).toBe(true); expect(loadQueueTiming(storage)).toEqual(rows);
    const html=renderToStaticMarkup(<QueueTimingReport reports={rows}/>);
    expect(html).toContain('Estimated wait / run'); expect(html).toContain('Actual wait / run');
    expect(html).toContain('Same task type average'); expect(html).toContain('Save timing report');
  });
  it('bounds records and tolerates unavailable or corrupt local storage',()=>{
    const rows=recordQueueTiming([],snapshot(Array.from({length:250},(_,i)=>job(String(i),'completed',{started_at:date(0),finished_at:date(i+1)}))));
    expect(rows).toHaveLength(200);
    expect(loadQueueTiming({getItem:()=>'{bad'})).toEqual([]);
    expect(saveQueueTiming(rows,{setItem:()=>{throw new Error('Quota');}})).toBe(false);
    expect(formatQueueTime(null)).toBe('Unknown'); expect(formatQueueTime(3661)).toBe('1h 1m');
  });
  it('marks unobserved endings as interrupted after a backend restart, without inventing runtime',()=>{
    const before=recordQueueTiming([],snapshot([job('a','running',{started_at:date(10)})]));
    const after=recordQueueTiming(before,snapshot([]));
    expect(after[0].status).toBe('interrupted'); expect(after[0].runSeconds).toBeNull();
    expect(queueAverages(after).count).toBe(0);
  });
});
