import { defaultImageSettings } from "../preferences";
import { MAX_IMAGE_STEPS, MAX_IMAGE_GUIDANCE } from "../imageGenerationLimits";
import "./ImageGenerationHelp.css";

const scales = [
  {
    title: "Reference image · likeness and emulation",
    description: "Upload, drop, paste, or choose Use as Generate reference from image actions across the app. Actual reference pixels guide image-to-image generation. Read reference details with an installed vision model, review the separate appearance/style/composition/lighting fields, then explicitly add selected fields to your prompt.",
    rows: [
      ["5–35% · Small changes", "A starting range for keeping composition and appearance close. Compare a few settings; likeness is not guaranteed."],
      ["40–75% · Larger changes", "More freedom to alter shapes and details. Subject identity may change."],
      ["80–100% · Most change", "Strong regeneration; at 100% the source has little influence."],
      ["Fit whole image / Crop to fill", "Fit preserves the whole picture with white padding when needed. Crop fills the output using a center crop. Neither stretches the source."],
      ["Remove reference", "Return to text-only generation for future requests. Already queued images keep the reference they were submitted with."],
      ["Keep appearance / Balanced emulation / Reinterpret style", "Presets adjust change amount, steps and guidance. Keep appearance uses 25% change with 80 scheduled steps for 20 actual denoising steps. This provides more refinement than the default seven steps at 30% of 24; output quality and identity still need comparison."],
      ["Extend edges", "Fits the complete source and fills spare space using border pixels. It avoids white bars, but wide padding can still produce repeated edge details. Match source proportions to reduce padding."],
      ["Compare change amounts", "Queues up to three nearby strengths with the same seed, prompt, model, LoRA and matched denoising budget. Each result keeps its source and settings in its saved recipe. This is a visual comparison, not a likeness score."],
      ["Style without the original composition", "Read reference details, select only style and lighting, add them to your prompt, then Remove reference. Your new subject and composition come from the prompt without using the original pixels."],
      ["Character LoRA", "Choose a compatible trained identity LoRA and explicitly add its trigger to the prompt. Reference pixels and text guidance do not guarantee identity across large pose changes."],
    ],
  },
  {
    title: "Guidance · prompt influence",
    description: "Higher guidance increases pressure to follow the prompt; it is not a quality score. These are illustrative tendencies, not measured previews or guarantees. The model, prompt and adapter change the outcome.",
    rows: [
      ["1 · Lowest", "Classifier-free guidance is off; the negative prompt has no effect in the standard SDXL pipeline."],
      ["2–4 · Low", "Gentler prompt influence; some requested details may be missed."],
      ["5–7 · Moderate", "A middle range for comparing prompt adherence with a less forced appearance."],
      ["8–12 · Strong", "More pressure toward the wording; check for exaggerated details."],
      ["13–20 · Very strong", "Very strong pressure; image quality can worsen. Watch for harsh contrast, excessive color or distorted details."],
      [`21–${MAX_IMAGE_GUIDANCE} · Highest`, "Extreme prompt influence for experimentation. Increasing this further can worsen color, contrast and detail; compare against a lower setting."],
    ],
  },
  {
    title: "Steps · refinement time",
    description: "Steps count denoising passes. More passes take longer and can improve refinement, with diminishing returns; they do not increase prompt strength.",
    rows: [
      ["1–10 · Fewest", "A quick experiment; standard SDXL may leave shapes or textures unresolved."],
      ["11–30 · Middle", "More refinement. The app starts at 24 steps."],
      ["31–60 · More", "Longer generation; compare whether extra passes actually help your model."],
      [`61–${MAX_IMAGE_STEPS} · Most`, "Many more denoising passes and longer generation. Extra refinement can be small; compare results using the same prompt and seed."],
    ],
  },
  {
    title: "LoRA strength · adapter influence",
    description: "Applies only when a compatible adapter is selected. Character and style adapters respond differently.",
    rows: [
      ["0 · None", "No adapter contribution; useful for comparing against the base model."],
      ["0.25–0.5 · Subtle", "Example: a style adapter may add a light painted texture."],
      ["0.75–1 · Fuller", "Example: the learned brushwork or character features may become more recognizable. Default: 1."],
      ["1.25–2 · Strongest", "Example: the learned style may dominate the scene or exaggerate features."],
    ],
  },
  {
    title: "Width & height · canvas size",
    description: "Choose an aspect ratio and resolution, or enter dimensions in multiples of 8. Hardware determines the upper limit. Allow longer waits unlocks larger sizes with slower memory-saving offload; it cannot guarantee that every request fits.",
    rows: [
      ["256–512 · Draft", "Small canvases are faster but may lose detail or composition quality."],
      ["1024 × 1024 · Default", "A square canvas at the app's default size."],
      ["Larger images", "On an 8 GB GPU, normal selections reach 1536 pixels per side and longer-wait mode reaches 2048. More pixels require more memory and time, and do not guarantee better detail."],
    ],
  },
];

export default function ImageGenerationHelp() {
  return <div className="workspace-help-guide">
        {scales.map(({ title, description, rows }) => (
          <section key={title}>
            <h3>{title}</h3>
            <dl className="workspace-control-help"><div><dt>What it controls</dt><dd>{description}</dd></div></dl>
            <table className="image-help-scale">
              <caption>{title}: lowest to highest</caption>
              <thead><tr><th scope="col">Value / degree</th><th scope="col">What you may see</th></tr></thead>
              <tbody>{rows.map(([value, effect]) => <tr key={value}><th scope="row">{value}</th><td>{effect}</td></tr>)}</tbody>
            </table>
            {title.startsWith("Guidance") && <div className="image-guidance-example">
              <h4>Same prompt · guidance 5 vs 20</h4>
              <dl>
                <div><dt>Example prompt</dt><dd>A red ceramic teapot on a wooden table, soft morning window light, watercolor.</dd></div>
                <div><dt>5 · Moderate influence</dt><dd>Might resemble a loose watercolor wash, with gentle lighting and softly suggested wood grain; some requested details may be less exact.</dd></div>
                <div><dt>20 · Very strong influence</dt><dd>Might emphasize the red color and table texture more forcefully, but could produce hard edges, harsh shadows or a less convincing watercolor treatment.</dd></div>
              </dl>
              <dl><div><dt>Compare your model</dt><dd>Keep the model, prompts, adapter, dimensions, steps and seed fixed; change only Guidance. These written examples are illustrative, not measured outputs.</dd></div></dl>
            </div>}
          </section>
        ))}
        <section>
          <h3>Options without a low-to-high scale</h3>
          <dl>
            <div><dt>Seed</dt><dd>Blank picks a random seed. A fixed number helps repeat a comparison with the same settings and environment. Seed 20 is not stronger than seed 5.</dd></div>
            <div><dt>Image model & LoRA adapter</dt><dd>The model supplies the base visual behavior; an adapter adds learned features. Choose a model first, then an adapter trained for it. Names are not a potency ranking.</dd></div>
            <div><dt>Prompt & negative prompt</dt><dd>Prompt describes what you want, such as “soft morning light.” Negative prompt describes what to discourage, such as “text, watermark.” More words do not necessarily mean more control.</dd></div>
            <div><dt>Long-prompt encoding</dt><dd>On allows up to four token chunks; off uses the native token window and truncates excess text. This controls prompt capacity, not strength.</dd></div>
            <div><dt>Built-in & custom profiles</dt><dd>Built-in profiles adjust chat behavior. Custom profiles save both image and chat settings; changes autosave while a custom profile is selected.</dd></div>
            <div><dt>Tab options → Reset defaults</dt><dd>Clears both prompts, model, adapter, profile selections, seed and the current preview. Restores {defaultImageSettings.width} × {defaultImageSettings.height}, {defaultImageSettings.steps} steps, guidance {defaultImageSettings.guidanceScale}, adapter strength {defaultImageSettings.loraScale}, and long-prompt encoding on. Saved profiles, images and chats remain available. Stop an active generation before resetting.</dd></div>
          </dl>
        </section>
        <dl><div><dt>Parameter reference</dt><dd><a href="https://huggingface.co/docs/diffusers/api/pipelines/stable_diffusion/stable_diffusion_xl" target="_blank" rel="noreferrer">Diffusers SDXL documentation</a></dd></div></dl>
  </div>;
}
