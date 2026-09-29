import { useState } from "react";
import { useDispatch } from "../useStore";
import { hasImageSeed } from "../imageSeed";
import "./ImageSeedControls.css";

export default function ImageSeedControls({ seed, onReuse, showMissing = false }) {
  const dispatch = useDispatch();
  const [error, setError] = useState("");
  if (!hasImageSeed(seed)) return showMissing ? <p>Seed not recorded for this image.</p> : null;
  return <div className="image-seed-controls" aria-label="Generated image seed">
    <span>Seed: <code>{seed}</code></span>
    <button type="button" onClick={async () => {
      setError("");
      try {
        await navigator.clipboard.writeText(String(seed));
        dispatch({ type: "SHOW_TOAST", payload: { message: "Seed copied", type: "success" } });
      } catch { setError("Could not copy the seed. Select the number to copy it manually."); }
    }}>Copy Seed</button>
    <button type="button" onClick={() => {
      dispatch({ type: "SET_IMAGE_SETTINGS", payload: { seed: String(seed) } });
      onReuse?.();
      dispatch({ type: "SET_SIDEBAR_TAB", payload: "generate" });
      dispatch({ type: "SHOW_TOAST", payload: { message: `Seed ${seed} set for your next generation`, type: "success" } });
    }}>Use This Seed</button>
    {error && <span role="alert">{error}</span>}
  </div>;
}
