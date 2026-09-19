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

export default function LoraHelp() {
  const dialogRef = useRef(null);
  return (
    <div className="lora-help">
      <button className="lora-info-button" type="button" aria-label="LoRA help: functions and definitions" title="Functions and definitions" aria-haspopup="dialog" onClick={() => dialogRef.current?.showModal()}>
        <span aria-hidden="true">ⓘ</span>
      </button>
      <dialog ref={dialogRef} className="lora-help-dialog" aria-labelledby="lora-help-title">
        <header className="lora-help-heading">
          <h2 id="lora-help-title">LoRA functions & definitions</h2>
          <button type="button" autoFocus onClick={() => dialogRef.current?.close()} aria-label="Close LoRA help">Close</button>
        </header>
        <p>Prepare images, review captions, choose training settings, then start local training. Help can stay available while a run is active.</p>
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
