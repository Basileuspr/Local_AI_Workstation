import ImageResolutionControls from "./ImageResolutionControls";
import { imageSizeLimits } from "../imageGenerationLimits";
import { fitDimensions } from "../imageDimensions";

export default function ImageGenerationSizing({ width, height, allowLongWait = false, waitKey = "allowLongWait", limits, onChange, ...props }) {
  const bounds = imageSizeLimits(allowLongWait, limits);
  function toggle(enabled) {
    const nextBounds = imageSizeLimits(enabled, limits);
    const size = fitDimensions(Number(width), Number(height), nextBounds) || { width: 1024, height: 1024 };
    onChange({ ...size, [waitKey]: enabled });
  }
  return <div className="image-generation-sizing">
    <label className="image-ratio-lock"><input type="checkbox" checked={allowLongWait} onChange={event => toggle(event.target.checked)} />Allow longer waits for larger images</label>
    <ImageResolutionControls {...props} width={width} height={height} onChange={onChange} {...bounds} />

  </div>;
}
