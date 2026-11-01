import { thinkingLabel } from '../modelProfiles';

const count = value => Number.isFinite(value) ? Math.round(value).toLocaleString() : 'unknown';
export default function ModelStatus({ model, usage, thinking, messages = [] }) {
  if (!model) return null;
  const last = [...messages].reverse().map(item => item.context_usage || item.influence_receipt?.context_usage).find(item => item?.model === model.name);
  const capabilities = model.capabilities || [];
  return <div className="model-status-text" aria-label="Model and context status">
    <p>Next reply: {count(usage.windowTokens)} context tokens · up to {count(usage.outputReserve)} output tokens, including thinking · Thinking: {thinkingLabel(thinking)} (requested).</p>
    <p>Model limit: {count(model.trained_context_length)} tokens · {capabilities.includes('vision') ? 'Text and images' : 'Text; vision not advertised'} · {capabilities.includes('tools') ? 'Tool calling supported' : 'Tool calling not advertised'}.
      {model.size > 0 ? ` Model file: ${(model.size / 1e9).toFixed(1)} GB${model.parameter_size ? ` · ${model.parameter_size}` : ''}${model.quantization_level ? ` · ${model.quantization_level}` : ''}.` : ''}</p>
    <p>Conversation estimate: {count(usage.promptTokens)} / {count(usage.usableInputTokens)} input tokens · {count(usage.inputBudgetRemaining)} available before retrieval and tools.
      {usage.restoredHistory ? ' Earlier original messages fit and will be included again.' : usage.summarizationOccurred ? ` Using a summary of ${usage.summarizedMessageCount} earlier messages.` : ' No rolling summary in this request.'}</p>
    {last && <p>Last reply with this model: {count(last.prompt_tokens)} prompt tokens ({last.count_kind === 'provider_reported' ? 'provider count' : 'estimate'}) · {count(last.generated_tokens)} generated · request context {count(last.configured_context_limit)}.
      {Number.isFinite(last.generation_tokens_per_second) ? ` Generation: ${last.generation_tokens_per_second.toFixed(1)} tokens/s, including thinking.` : ' Generation speed not recorded.'}
      {last.application_trimming ? ' Context was shortened for that request.' : ''}
      {last.thinking_requested === false && last.thinking_emitted ? ' The provider emitted thinking despite the Off request.' : ''}</p>}
    {last?.adjustments?.length > 0 && <p>{last.adjustments.join(' ')}</p>}
  </div>;
}
