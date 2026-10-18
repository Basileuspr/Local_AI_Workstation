const labels = {
  queue_wait: 'Queue wait', runtime_preparation: 'Runtime preparation',
  reference_preparation: 'Reference preparation', model_loading: 'Model loading / reuse',
  pipeline_setup: 'Pipeline setup', prompt_encoding: 'Prompt encoding / reuse',
  reference_encoding: 'Reference encoding', denoising: 'Denoising', decoding: 'Image decoding',
  offload_cleanup: 'GPU cleanup', png_save: 'PNG saving', output_read: 'Output reading',
  output_registration: 'Gallery registration', output_copy: 'Output folder copy', inline_encoding: 'Inline encoding',
  chat_persistence: 'Chat saving',
};

export default function ImageGenerationTimings({ result }) {
  const stages = Object.entries(result?.stage_seconds || {}).filter(([, value]) => Number.isFinite(value) && value >= 0);
  if (!stages.length) return null;
  return <details className="image-generation-timings"><summary>Generation timing{Number.isFinite(result.request_seconds) ? ` · ${result.request_seconds.toFixed(1)}s total` : ''}</summary>
    <dl>{stages.map(([key, value]) => <div key={key}><dt>{labels[key] || key.replaceAll('_', ' ')}</dt><dd>{value.toFixed(2)}s</dd></div>)}</dl>
    <small>Measured stages include transfers at their boundaries. Total also includes orchestration between stages; older images may have no breakdown.</small>
  </details>;
}
