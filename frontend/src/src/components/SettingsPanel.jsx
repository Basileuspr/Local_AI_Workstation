import { useStore, useDispatch, profiles } from "../useStore";

export default function SettingsPanel() {
  const state = useStore();
  const dispatch = useDispatch();

  const {
    settingsOpen,
    slidersOpen,
    activeProfile,
    temperature,
    topP,
    topK,
    repeatPenalty,
    numPredict,
    systemPrompt,
  } = state;

  function showToast(message, type) {
    dispatch({ type: "SHOW_TOAST", payload: { message, type } });
  }

  function handleApplyProfile(name) {
    dispatch({ type: "APPLY_PROFILE", payload: name });
    showToast("Profile: " + profiles[name].label, "success");
  }

  function setParam(key, value) {
    dispatch({ type: "SET_PARAM", key, value });
  }

  if (!settingsOpen) return null;

  return (
    <div id="settings-panel" className="visible">
      <div id="settings-inner">
        <div className="settings-section-label">Profile</div>
        <div className="profile-row">
          {Object.entries(profiles).map(([key, profile]) => (
            <button
              key={key}
              className={`profile-btn ${activeProfile === key ? "active" : ""}`}
              onClick={() => handleApplyProfile(key)}
            >
              {profile.label}
            </button>
          ))}
        </div>

        <div
          className="sliders-toggle"
          onClick={() => dispatch({ type: "TOGGLE_SLIDERS" })}
        >
          {slidersOpen ? "- Advanced parameters" : "+ Advanced parameters"}
        </div>

        <div className={`sliders-grid ${slidersOpen ? "visible" : ""}`}>
          {/* Temperature */}
          <div className="slider-group">
            <div className="slider-label">
              <span>Temperature</span>
              <span className="slider-value">{temperature}</span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={temperature}
              onChange={(e) => setParam("temperature", parseFloat(e.target.value))}
            />
          </div>

          {/* Top P */}
          <div className="slider-group">
            <div className="slider-label">
              <span>Top P</span>
              <span className="slider-value">{topP}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={topP}
              onChange={(e) => setParam("topP", parseFloat(e.target.value))}
            />
          </div>

          {/* Top K */}
          <div className="slider-group">
            <div className="slider-label">
              <span>Top K</span>
              <span className="slider-value">{topK}</span>
            </div>
            <input
              type="range"
              min="1"
              max="100"
              step="1"
              value={topK}
              onChange={(e) => setParam("topK", parseInt(e.target.value))}
            />
          </div>

          {/* Repeat Penalty */}
          <div className="slider-group">
            <div className="slider-label">
              <span>Repeat Penalty</span>
              <span className="slider-value">{repeatPenalty}</span>
            </div>
            <input
              type="range"
              min="1"
              max="2"
              step="0.05"
              value={repeatPenalty}
              onChange={(e) => setParam("repeatPenalty", parseFloat(e.target.value))}
            />
          </div>

          {/* Max Tokens */}
          <div className="slider-group">
            <div className="slider-label">
              <span>Max Tokens</span>
              <span className="slider-value">{numPredict}</span>
            </div>
            <input
              type="range"
              min="128"
              max="8192"
              step="128"
              value={numPredict}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                setParam("numPredict", val);
                // Sync response length to closest option
                const options = [256, 512, 1024, 2048, 4096];
                const closest = options.reduce((prev, curr) =>
                  Math.abs(curr - val) < Math.abs(prev - val) ? curr : prev
                );
                dispatch({ type: "SET_RESPONSE_LENGTH", payload: closest });
              }}
            />
          </div>

          {/* System Prompt */}
          <div className="system-prompt-area">
            <div className="system-prompt-label">System Prompt</div>
            <textarea
              id="system-prompt"
              placeholder="Optional: instruct the model how to behave..."
              value={systemPrompt}
              onChange={(e) => setParam("systemPrompt", e.target.value)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}