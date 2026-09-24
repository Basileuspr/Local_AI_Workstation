import { useRef } from "react";

const sections = [
  ["Project & models", [
    ["LoRA", "A small adapter trained to add a character or visual style to a compatible image model. It does not replace the base model."],
    ["Training goal", "Character identity / likeness learns consistent character features. Visual style learns recurring appearance and artistic treatment."],
    ["Trigger token", "A unique word associated with your character. Include it in captions and later in generation prompts. Identity training requires one."],
    ["Image base model", "The installed SDXL model used for training. Use the finished adapter with its matching base model in Generate."],
    ["Vision analysis model", "A separate local Ollama vision model that suggests image descriptions. It does not train the adapter."],
    ["Name, description & adapter folder", "The name identifies your project; the description holds optional notes. Adapter folder names the output folder within the app's completed LoRA storage."],
    ["Save project settings", "Persists the project and training settings. Starting training also saves your current settings."],
  ]],
  ["Dataset & analysis", [
    ["Browse / drop images", "Adds project-owned copies of PNG, JPG or WebP images. Your original files stay untouched. Use varied angles, expressions and scenes for identity training."],
    ["Captions", "Text paired with each training image. Describe its visible content and include the character trigger when appropriate. Caption edits save when you leave the field."],
    ["Analyze current dataset", "Asks the selected vision model for descriptions and consistency suggestions. Review them before using a suggestion or applying all suggested captions. Analysis does not verify a person's identity."],
    ["Stop analysis", "Cancels the active dataset analysis request."],
    ["Remove / clear copied images", "Removes an image or the dataset copies from this project. Source images are preserved. Dataset changes are locked while training is active."],
  ]],
  ["Training settings", [
    ["Resolution", "The square training image size in pixels. Higher resolution uses more memory and computation. Pad or crop determines how each image fits."],
    ["Epochs", "Passes through the dataset. More passes give the model more exposure, but too many can overfit the training images."],
    ["Batch size", "Images processed together in one training step. Larger batches require more GPU memory."],
    ["Learning rate", "How strongly each optimizer update changes the adapter. Larger values can learn faster but can also make training unstable."],
    ["Network rank", "The adapter's capacity. Higher rank adds trainable parameters and increases memory and file size."],
    ["Network alpha", "Scales the LoRA contribution relative to its rank. It is separate from the adapter strength used later during generation."],
    ["Precision", "FP16 and BF16 use reduced-precision computation; FP32 uses more memory. The trainer keeps trainable adapter weights and image encoding in FP32 for stability."],
    ["Aspect handling", "Crop fills the square and trims edges. Pad preserves the whole image and fills the remaining area with black."],
    ["Max steps", "A nonzero value overrides the epoch-based step count. Zero uses the configured epochs. This app counts image batches as steps."],
    ["Gradient accumulation", "Combines gradients from several batch steps before updating weights. It increases the effective batch size without processing all those images together."],
    ["Save interval", "Writes an intermediate adapter checkpoint every specified number of batch steps. Checkpoints are weights, not full resumable optimizer snapshots."],
    ["Seed", "Initializes training randomness to help reproduce a run. Matching it alone does not guarantee identical results across hardware or software versions."],
    ["Caption prefix", "Text prepended to captions when new images are added. It does not rewrite existing captions."],
  ]],
  ["Memory, progress & results", [
    ["RAM offload", "The trainer prepares image and caption encodings first, caches them on disk, then releases the encoders. During UNet training, saved backward-pass tensors move through system RAM to reduce GPU memory use. Transfers can add overhead; large settings can still exhaust memory."],
    ["VRAM / GiB", "VRAM is GPU memory; RAM is system memory. GiB is a binary memory unit, equal to 1,024 cubed bytes."],
    ["Free at pane load", "A GPU memory snapshot from when the pane loaded. It is not a live reading."],
    ["Last worker sample", "Measured after an image is prepared or a training step completes. Allocated is memory held by the worker's PyTorch tensors; peak is its highest allocation during this run. GPU free is device-wide available memory, including the effect of other apps. These figures do not include system RAM usage."],
    ["Preparing / running / failed", "Preparing builds cached inputs. Running updates the adapter. Failed means the run stopped; the error and logs explain why."],
    ["Loss", "The training prediction error. It helps track learning, but a lower number alone does not prove better likeness or image quality."],
    ["Cancel safely", "Stops the training process. Existing completed adapters and saved checkpoints are preserved; unfinished work is not published as a completed adapter."],
    ["Complete LoRA", "The completed package includes the adapter model, checkpoints, copied training images, captions and manifests. Select the adapter in Generate with its matching base model."],
  ]],
];

export default function LoraHelp({learningRate=0.0001}) {
  const dialogRef = useRef(null);
  return (
    <div className="lora-help">
      <button className="lora-info-button" type="button" aria-label="LoRA help: functions and definitions" title="Functions and definitions" aria-haspopup="dialog" onClick={() => dialogRef.current?.showModal()}>
        <span aria-hidden="true">ⓘ</span> Settings guide
      </button>
      <dialog ref={dialogRef} className="lora-help-dialog" aria-labelledby="lora-help-title">
        <header className="lora-help-heading">
          <h2 id="lora-help-title">LoRA settings · strength & functions</h2>
          <button type="button" autoFocus onClick={() => dialogRef.current?.close()} aria-label="Close LoRA help">Close</button>
        </header>
        <p>Prepare images, review captions, choose training settings, then start local training. Help can stay available while a run is active.</p>
        <section><h3>Learning rate · how large each training update is</h3>
          <p>App default: <strong>0.0001 = 1e-4</strong>. Your setting: <strong>{Number(learningRate).toExponential()} · {Number((Number(learningRate)/0.0001).toFixed(3))}× the default</strong>. This multiplier describes the configured learning rate, not a measured multiplier in image quality or training speed.</p>
          <table className="image-help-scale"><caption>Learning-rate comparison for this app's AdamW LoRA trainer</caption><thead><tr><th>Example value</th><th>Relative update scale</th><th>How to interpret it</th></tr></thead><tbody>
            <tr><th>0.00001 · 1e-5</th><td>0.1× default</td><td>Gentler updates; changes may need more training to become visible.</td></tr>
            <tr><th>0.00005 · 5e-5</th><td>0.5× default</td><td>A smaller step to compare if the default changes results too aggressively.</td></tr>
            <tr><th>0.0001 · 1e-4</th><td>1× · app default</td><td>A starting comparison point, not a universally best setting.</td></tr>
            <tr><th>0.0002 · 2e-4</th><td>2× default</td><td>More aggressive updates; watch for instability, repeated poses or loss of flexibility.</td></tr>
            <tr><th>0.001 · 1e-3</th><td>10× default</td><td>A large experimental jump. A permitted value is not a quality recommendation.</td></tr>
          </tbody></table>
          <p>Keep the dataset, captions, seed, rank and training length fixed when comparing learning rates. Compare saved checkpoints with the same generation prompt and seed. If the character barely appears, review captions and training length too; if results become rigid or distorted, compare an earlier checkpoint or a smaller learning rate. Lower training loss alone does not prove better images.</p>
          <p>Learning rate changes training. Generate's LoRA strength changes how much a finished adapter influences an image. They are separate controls. Reference: <a href="https://huggingface.co/docs/diffusers/main/training/lora" target="_blank" rel="noreferrer">Diffusers LoRA training guide</a>.</p>
        </section>
        <section><h3>Other settings · what increasing them changes</h3><table className="image-help-scale"><thead><tr><th>Setting</th><th>App default / comparison</th><th>Increasing it</th></tr></thead><tbody>
          <tr><th>Epochs / max steps</th><td>10 epochs; max steps 0</td><td>More exposure to the dataset and longer training; may overfit. Nonzero max steps replaces the epoch count.</td></tr>
          <tr><th>Rank / alpha</th><td>8 / 8</td><td>Rank increases adapter capacity and size. Alpha scales its contribution relative to rank; alpha/rank is 1 at the default.</td></tr>
          <tr><th>Batch / accumulation</th><td>1 image × 4 steps = 4 images per full update</td><td>Batch uses more VRAM. Accumulation combines more batches per optimizer update; the last update can be smaller.</td></tr>
          <tr><th>Resolution</th><td>512 square; 1024 square has 4× as many pixels</td><td>More input detail and memory/computation. It does not guarantee better identity or style.</td></tr>
          <tr><th>Save interval</th><td>100 batch steps</td><td>Larger intervals save fewer checkpoints. Smaller intervals give more comparison points and use more storage.</td></tr>
        </tbody></table></section>
        {sections.map(([heading, entries]) => (
          <section key={heading}>
            <h3>{heading}</h3>
            <dl>{entries.map(([term, definition]) => <div key={term}><dt>{term}</dt><dd>{definition}</dd></div>)}</dl>
          </section>
        ))}
      </dialog>
    </div>
  );
}
