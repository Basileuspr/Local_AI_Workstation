export const QUEUE_TIMING_KEY = 'queue-timing-v1';
const terminal = status => ['completed', 'failed', 'cancelled'].includes(status);
const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const seconds = (start, end) => {
  const value = (Date.parse(end) - Date.parse(start)) / 1000;
  return valid(value) ? value : null;
};
const identity = job => `${job.id}:${job.created_at}`;
// Saving is a CPU tail of an image job; its duration still belongs to the
// same inference history after it releases the GPU queue slot.
const usedGpu = job => job.stage === 'saving' || job.requires_gpu !== false;
const mean = records => records.length ? records.reduce((sum, row) => sum + row.runSeconds, 0) / records.length : null;

export function loadQueueTiming(storage) {
  try {
    storage ??= globalThis.localStorage;
    const rows = JSON.parse(storage?.getItem(QUEUE_TIMING_KEY) || '[]');
    return Array.isArray(rows) ? rows.filter(row => row && typeof row.key === 'string' && typeof row.id === 'string' && typeof row.kind === 'string'
      && (row.runSeconds === null || valid(row.runSeconds))).slice(-200) : [];
  } catch { return []; }
}

export function saveQueueTiming(rows, storage) {
  try { storage ??= globalThis.localStorage; storage?.setItem(QUEUE_TIMING_KEY, JSON.stringify(rows)); return !!storage; }
  catch { return false; }
}

// Only numeric timing and opaque identifiers are retained, never prompts or paths.
export function recordQueueTiming(previous, snapshot) {
  const rows = new Map(previous.map(row => [row.key, row]));
  const current = new Set((snapshot.jobs || []).map(identity));
  for (const [key, row] of rows) {
    if (!current.has(key) && ['queued', 'running', 'cancelling'].includes(row.status)) {
      rows.set(key, {...row, status: 'interrupted', runSeconds: null});
    }
  }
  for (const job of snapshot.jobs || []) {
    const key = identity(job), old = rows.get(key);
    rows.set(key, {...old, key, id: job.id, kind: job.kind, profile: job.timing_profile || null,
      gpu: usedGpu(job), status: job.status, createdAt: job.created_at,
      startedAt: job.started_at, finishedAt: job.finished_at,
      waitSeconds: seconds(job.created_at, job.started_at || job.finished_at),
      runSeconds: seconds(job.started_at, job.finished_at),
    });
  }
  // Learn completed work first so the same snapshot can inform new arrivals.
  const timing = calculateQueueTiming(snapshot, [...rows.values()]);
  for (const job of snapshot.jobs || []) {
    const row = rows.get(identity(job)), estimate = timing.jobs[job.id];
    if (!terminal(job.status) && !row.estimatedAt) {
      row.estimatedAt = snapshot.reported_at || new Date().toISOString();
      const alreadyWaiting = seconds(job.created_at, snapshot.reported_at || row.estimatedAt);
      row.estimatedWait = job.status === 'queued' && valid(estimate?.wait) && valid(alreadyWaiting) ? alreadyWaiting + estimate.wait : null;
      row.estimatedRun = estimate?.duration ?? null;
      row.basis = estimate?.basis || 'No completed samples';
    }
    if (job.status === 'running' && !row.startEstimateAt) {
      row.startEstimateAt = snapshot.reported_at || new Date().toISOString();
      row.startEstimate = estimate?.duration ?? null;
    }
  }
  return [...rows.values()].slice(-200);
}

export function queueAverages(records) {
  const completed = records.filter(row => row.status === 'completed' && valid(row.runSeconds) && row.runSeconds > 0);
  const images = completed.filter(row => row.kind === 'image');
  return {completed, overall: mean(completed), count: completed.length, image: mean(images), imageCount: images.length};
}

function durationEstimate(job, completed) {
  const pool = completed.filter(row => row.gpu === usedGpu(job));
  const matched = job.timing_profile ? pool.filter(row => row.kind === job.kind && row.profile === job.timing_profile) : [];
  const kind = pool.filter(row => row.kind === job.kind);
  const selected = matched.length ? matched : kind.length ? kind : pool;
  return {duration: mean(selected), samples: selected.length,
    basis: matched.length ? job.kind === 'gif' ? 'Matching GIF settings' : 'Matching image settings' : kind.length ? 'Same task type average' : selected.length ? 'Overall average · rough fallback' : 'No completed samples'};
}

function liveImageDuration(job, active) {
  if (job.kind !== 'image' || !job.timing_profile) return null;
  const source = active.find(other => other.kind === 'image' && other.status === 'running'
    && other.stage !== 'saving' && other.timing_profile === job.timing_profile
    && other.progress?.step > 0 && other.progress.total_steps > other.progress.step
    && valid(other.progress.estimated_remaining_seconds) && valid(other.progress.elapsed_seconds));
  return source ? source.progress.elapsed_seconds + source.progress.estimated_remaining_seconds : null;
}

export function calculateQueueTiming(snapshot, records) {
  const averages = queueAverages(records), jobs = {}, active = (snapshot.jobs || []).filter(job => !terminal(job.status));
  const now = snapshot.reported_at || new Date().toISOString();
  const running = active.filter(job => ['running', 'cancelling'].includes(job.status));
  const lanes = new Map();
  const laneFor = job => job.requires_gpu !== false ? 'gpu' : job.cpu_lane ? `cpu:${job.cpu_lane}` : `cpu-job:${job.id}`;
  const estimateFor = job => {
    const estimate = durationEstimate(job, averages.completed);
    const live = liveImageDuration(job, active);
    // A first measured step can estimate every queued image with the same
    // settings, without pretending it is a completed historical sample.
    return live !== null ? {...estimate, duration:live, basis:'Live steps from matching image settings'} : estimate;
  };
  for (const job of running) {
    const estimate = estimateFor(job);
    const elapsed = seconds(job.started_at, now);
    let remaining = valid(estimate.duration) && valid(elapsed) && estimate.duration > elapsed ? estimate.duration - elapsed : null;
    let reason = remaining === null ? estimate.duration !== null ? 'Longer than the average; recalculating' : 'Learning generation times' : '';
    const live = job.progress?.estimated_remaining_seconds;
    if (job.status === 'cancelling') { remaining = null; reason = 'Waiting for the worker to stop'; }
    else if (valid(live) && live > 0) {
      remaining = live;
      estimate.basis = 'Live image steps + available timing history'; reason = '';
    }
    jobs[job.id] = {...estimate, elapsed, remaining, wait: 0, finish: remaining, reason};
    lanes.set(laneFor(job), {remaining, reason});
  }
  if (snapshot.gpu_owner && !running.some(job => job.requires_gpu !== false)) {
    lanes.set('gpu', {remaining:null, reason:'Waiting for an unmeasured GPU task'});
  }
  for (const job of active.filter(job => job.status === 'queued')) {
    const estimate = estimateFor(job);
    const lane = lanes.get(laneFor(job)) || {remaining:0, reason:''};
    const wait = snapshot.paused ? null : lane.remaining;
    const finish = wait === null || estimate.duration === null ? null : wait + estimate.duration;
    const reason = snapshot.paused ? 'Queue paused' : wait === null ? lane.reason || 'Earlier request time is unknown' : estimate.duration === null ? 'Learning generation times' : '';
    jobs[job.id] = {...estimate, wait, finish, remaining: estimate.duration, reason};
    lanes.set(laneFor(job), {remaining:finish, reason});
  }
  const remaining = [...lanes.values()].map(lane=>lane.remaining);
  return {jobs, averages, remaining: remaining.includes(null) ? null : Math.max(0,...remaining), activeCount: active.length};
}

export function formatQueueTime(value) {
  if (!valid(value)) return 'Unknown';
  const total = Math.ceil(value);
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${total % 60}s`;
  return `${Math.floor(total / 3600)}h ${Math.floor(total % 3600 / 60)}m`;
}
