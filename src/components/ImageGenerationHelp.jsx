import { useRef } from "react";
import { defaultImageSettings } from "../preferences";
import "./ImageGenerationHelp.css";

const scales = [
  {
    title: "Guidance · prompt influence",
    description: "Higher guidance increases pressure to follow the prompt; it is not a quality score. These are illustrative tendencies, not measured previews or guarantees. The model, prompt and adapter change the outcome.",
    rows: [
      ["1 · Lowest", "Classifier-free guidance is off; the negative prompt has no effect in the standard SDXL pipeline."],
      ["2–4 · Low", "Gentler prompt influence; some requested details may be missed."],
      ["5–7 · Moderate", "A middle range for comparing prompt adherence with a less forced appearance."],
      ["8–12 · Strong", "More pressure toward the wording; check for exaggerated details."],
      ["13–20 · Highest", "Very strong pressure; image quality can worsen. Watch for harsh contrast, excessive color or distorted details."],
    ],
  },
  {
    title: "Steps · refinement time",
    description: "Steps count denoising passes. More passes take longer and can improve refinement, with diminishing returns; they do not increase prompt strength.",
    rows: [
      ["1–10 · Fewest", "A quick experiment; standard SDXL may leave shapes or textures unresolved."],
      ["11–30 · Middle", "More refinement. The app starts at 24 steps."],
      ["31–60 · Most", "Longer generation; compare whether extra passes actually help your model."],
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
    description: "Each dimension ranges from 512 to 1536 pixels in increments of 8. Size changes framing and memory use, not potency.",
    rows: [
      ["512 × 512 · Small", "A smaller square canvas; a model trained for larger images may struggle here."],
      ["1024 × 1024 · Default", "A square canvas at the app's default size."],
      ["1536 × 1536 · Largest", "More pixels and memory demand; more pixels alone do not guarantee better detail."],
    ],
  },
];

export default function ImageGenerationHelp() {
  const dialogRef = useRef(null);
  return (
    <div className="image-generation-help">
      <button className="image-info-button" type="button" aria-label="Generate information: settings and examples" title="Settings and examples" aria-haspopup="dialog" onClick={() => dialogRef.current?.showModal()}>
        <span aria-hidden="true">ⓘ</span>
      </button>
      <dialog ref={dialogRef} className="lora-help-dialog image-help-dialog" aria-labelledby="image-help-title">
        <header className="lora-help-heading">
          <h2 id="image-help-title">Generate · settings & examples</h2>
          <button type="button" autoFocus onClick={() => dialogRef.current?.close()} aria-label="Close Generate information">Close</button>
        </header>
        <p>Read each scale from lowest to highest. Change one setting at a time to learn its effect. Higher is not always better.</p>
        {scales.map(({ title, description, rows }) => (
          <section key={title}>
            <h3>{title}</h3>
            <p>{description}</p>
            <table className="image-help-scale">
              <caption>{title}: lowest to highest</caption>
              <thead><tr><th scope="col">Value / degree</th><th scope="col">What you may see</th></tr></thead>
              <tbody>{rows.map(([value, effect]) => <tr key={value}><th scope="row">{value}</th><td>{effect}</td></tr>)}</tbody>
            </table>
            {title.startsWith("Guidance") && <div className="image-guidance-example">
              <h4>Same prompt · guidance 5 vs 20</h4>
              <p>Prompt: “A red ceramic teapot on a wooden table, soft morning window light, watercolor.”</p>
              <dl>
                <div><dt>5 · Moderate influence</dt><dd>Might resemble a loose watercolor wash, with gentle lighting and softly suggested wood grain; some requested details may be less exact.</dd></div>
                <div><dt>20 · Very strong influence</dt><dd>Might emphasize the red color and table texture more forcefully, but could produce hard edges, harsh shadows or a less convincing watercolor treatment.</dd></div>
              </dl>
              <p>These are written examples, not results from your model. To compare actual images, keep the same model, prompt, negative prompt, adapter, dimensions, steps and a fixed seed (for example 42), then change only Guidance.</p>
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
            <div><dt>RESET DEFAULT</dt><dd>Clears both prompts, model, adapter, profile selections, seed and the current preview. Restores {defaultImageSettings.width} × {defaultImageSettings.height}, {defaultImageSettings.steps} steps, guidance {defaultImageSettings.guidanceScale}, adapter strength {defaultImageSettings.loraScale}, and long-prompt encoding on. Saved profiles, images and chats remain available. Stop an active generation before resetting.</dd></div>
          </dl>
        </section>
        <p>Parameter reference: <a href="https://huggingface.co/docs/diffusers/api/pipelines/stable_diffusion/stable_diffusion_xl" target="_blank" rel="noreferrer">Diffusers SDXL documentation</a>. Follow your model's own guidance for specific settings.</p>
      </dialog>
    </div>
  );
}
