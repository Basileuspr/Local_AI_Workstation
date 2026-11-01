import { useRef, useState } from "react";
import { useDismissiblePopup } from '../useDismissiblePopup';
import { useChatPane } from "../ChatPane";
import { useStore, useDispatch, profiles } from "../useStore.jsx";
import * as api from "../api";
import {
  LEGACY_ROLEPLAY_STORAGE_KEY,
  clearPreferences,
  pickPreferences,
  savePreferences,
} from "../preferences";
import { responseStyles } from "../responseStyle";
import CustomProfileControls from "./CustomProfileControls";
import ChatToolSettings from './ChatToolSettings';
import VoiceOutputSettings from './VoiceOutputSettings';
import SoundOutputSettings from './SoundOutputSettings';
import ResponseLengthControl from './ResponseLengthControl';
import AppearanceSettings from "./AppearanceSettings";

export default function SettingsPanel() {
  const state = useStore();
  const pane = useChatPane();
  const dispatch = useDispatch();
  const panel = useRef(null);
  // This is a working editor: keep it available while using the chat and menus.
  useDismissiblePopup({ open: state.settingsOpen, container: panel, dismissOnOutside: false,
    onDismiss: () => dispatch({ type: 'SET_SETTINGS_OPEN', payload: false }),
    returnFocus: () => document.getElementById(pane.domId('header'))?.querySelector('[aria-label="Chat options"]') });
  const [durableMemoryDraft, setDurableMemoryDraft] = useState("");
  const [savingDurableMemory, setSavingDurableMemory] = useState(false);

  const {
    settingsOpen,
    slidersOpen,
    activeProfile,
    temperature,
    topP,
    topK,
    repeatPenalty,
    responseLength,
    systemPrompt,
    responseStyle,
    models,
    summaryModel,
    roleplayOpen,
    roleplay,
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

  function setRoleplayField(key, value) {
    dispatch({ type: "SET_ROLEPLAY_FIELD", key, value });
  }

  function saveRoleplayPreset() {
    savePreferences(pickPreferences(state));
    showToast("Roleplay preset saved", "success");
  }

  function resetRoleplayPreset() {
    localStorage.removeItem(LEGACY_ROLEPLAY_STORAGE_KEY);
    dispatch({ type: "RESET_ROLEPLAY" });
    showToast("Roleplay preset reset", "success");
  }

  function resetAllPreferences() {
    clearPreferences();
    dispatch({ type: "RESET_PREFERENCES" });
    showToast("Preferences reset", "success");
  }

  async function saveDurableMemory() {
    const memoryText = durableMemoryDraft.trim();
    if (!memoryText) {
      showToast("Enter a durable memory first", "error");
      return;
    }
    try {
      setSavingDurableMemory(true);
      await api.saveDurableMemory({ memoryText });
      window.dispatchEvent(new Event('durable-memory-changed'));
      setDurableMemoryDraft("");
      showToast("Durable memory saved", "success");
    } catch (error) {
      showToast(error.message || "Could not save durable memory", "error");
    } finally {
      setSavingDurableMemory(false);
    }
  }

  if (!settingsOpen) return null;

  return (
    <div id={pane.domId("settings-panel")} className="visible" ref={panel}>
      <div id={pane.domId("settings-inner")}>
        <div className="settings-top-actions">
          <strong>Model / roleplay settings</strong>
          <div className="preferences-actions">
            <button type="button" aria-label="Close model / roleplay settings"
              onClick={() => dispatch({ type: 'SET_SETTINGS_OPEN', payload: false })}>
              Close settings
            </button>
          </div>
        </div>
        <AppearanceSettings />
        <SoundOutputSettings/>
        <VoiceOutputSettings/>
        <div className="roleplay-area">
          <div className="settings-top-actions">
            <div className="roleplay-toolbar">
              <button
                className={`roleplay-toggle ${roleplay.enabled ? "active" : ""}`}
                aria-pressed={roleplay.enabled}
                type="button"
                onClick={() => setRoleplayField("enabled", !roleplay.enabled)}
              >
                Roleplay {roleplay.enabled ? "On" : "Off"}
              </button>
              <button
                className="roleplay-link"
                type="button"
                aria-expanded={roleplayOpen}
                aria-controls={pane.domId("character-fields")}
                onClick={() => dispatch({ type: "TOGGLE_ROLEPLAY_OPEN" })}
              >
                {roleplayOpen ? "- Character fields" : "+ Character fields"}
              </button>
              {roleplay.enabled && (
                <span className="roleplay-active-name">
                  {roleplay.characterName || "Character"}
                </span>
              )}
            </div>
            <div className="preferences-actions">
              <button type="button" onClick={resetAllPreferences}>
                Reset Startup Preferences
              </button>
            </div>
          </div>

          {roleplayOpen && (
            <div id={pane.domId("character-fields")} className="roleplay-grid">

              <label>
                <span>Character</span>
                <input
                  value={roleplay.characterName}
                  onChange={(e) =>
                    setRoleplayField("characterName", e.target.value)
                  }
                  placeholder="Character name"
                />
              </label>
              <label>
                <span>User Name</span>
                <input
                  value={roleplay.userName}
                  onChange={(e) => setRoleplayField("userName", e.target.value)}
                  placeholder="Optional"
                />
              </label>
              <label className="roleplay-wide">
                <span>Greeting</span>
                <textarea
                  value={roleplay.greeting}
                  onChange={(e) => setRoleplayField("greeting", e.target.value)}
                  placeholder="Opening message or setup beat"
                />
              </label>
              <label className="roleplay-wide">
                <span>Description</span>
                <textarea
                  value={roleplay.description}
                  onChange={(e) =>
                    setRoleplayField("description", e.target.value)
                  }
                  placeholder="Character traits, personality, appearance, boundaries, voice"
                />
              </label>
              <label className="roleplay-wide">
                <span>Scenario</span>
                <input
                  value={roleplay.scenario}
                  onChange={(e) => setRoleplayField("scenario", e.target.value)}
                  placeholder="Current scene or situation"
                />
              </label>
              <label className="roleplay-wide">
                <span>Example Dialogs</span>
                <textarea
                  value={roleplay.exampleDialogs}
                  onChange={(e) =>
                    setRoleplayField("exampleDialogs", e.target.value)
                  }
                  placeholder="<START> Character: ..."
                />
              </label>
              <label className="roleplay-wide">
                <span>Pre-History Instructions</span>
                <textarea
                  value={roleplay.preHistoryInstructions}
                  onChange={(e) =>
                    setRoleplayField("preHistoryInstructions", e.target.value)
                  }
                  placeholder="Narration, pacing, style, and GM behavior"
                />
              </label>
              <label className="roleplay-wide">
                <span>Post-History Instructions</span>
                <textarea
                  value={roleplay.postHistoryInstructions}
                  onChange={(e) =>
                    setRoleplayField("postHistoryInstructions", e.target.value)
                  }
                  placeholder="Response style after chat history"
                />
              </label>
              <label className="roleplay-wide">
                <span>Character System Prompt</span>
                <input
                  value={roleplay.characterSystemPrompt}
                  onChange={(e) =>
                    setRoleplayField("characterSystemPrompt", e.target.value)
                  }
                  placeholder="Optional extra system rule"
                />
              </label>
              <label className="roleplay-wide">
                <span>Character Post-History Instruction</span>
                <input
                  value={roleplay.characterPostHistoryInstruction}
                  onChange={(e) =>
                    setRoleplayField(
                      "characterPostHistoryInstruction",
                      e.target.value
                    )
                  }
                  placeholder="Optional final instruction"
                />
              </label>
              <label className="roleplay-wide">
                <span>Character Note</span>
                <input
                  value={roleplay.characterNote}
                  onChange={(e) =>
                    setRoleplayField("characterNote", e.target.value)
                  }
                  placeholder="Short note injected into the prompt"
                />
              </label>

              <div className="roleplay-check-row">
                <label>
                  <input
                    type="checkbox"
                    checked={roleplay.includeNames}
                    onChange={(e) =>
                      setRoleplayField("includeNames", e.target.checked)
                    }
                  />
                  <span>Include names</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={roleplay.banEmojis}
                    onChange={(e) =>
                      setRoleplayField("banEmojis", e.target.checked)
                    }
                  />
                  <span>Ban emojis</span>
                </label>
              </div>

              <div className="roleplay-actions">
                <button type="button" onClick={resetRoleplayPreset}>
                  Reset
                </button>
                <button type="button" onClick={saveRoleplayPreset}>
                  Save roleplay preset
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="settings-section-label">Profile</div>
        <label>On startup
          <select aria-label="On startup" value={state.startupBehavior || "new"}
            onChange={event => dispatch({ type: "SET_STARTUP_BEHAVIOR", payload: event.target.value })}>
            <option value="new">New Chat</option><option value="resume">Resume Last Chat</option>
          </select>
        </label>
        <div className="profile-row">
          {Object.entries(profiles).map(([key, profile]) => (
            <button
              key={key}
              className={`profile-btn ${activeProfile === key ? "active" : ""}`}
              type="button" aria-pressed={activeProfile === key}
              onClick={() => handleApplyProfile(key)}
            >
              {profile.label}
            </button>
          ))}
        </div>

        <ChatToolSettings />
        <CustomProfileControls />

        <button type="button" aria-expanded={slidersOpen} aria-controls={pane.domId("advanced-parameters")}
          className="sliders-toggle"
          onClick={() => dispatch({ type: "TOGGLE_SLIDERS" })}
        >
          {slidersOpen ? "- Advanced parameters" : "+ Advanced parameters"}
        </button>

        <div id={pane.domId("advanced-parameters")} className={`sliders-grid ${slidersOpen ? "visible" : ""}`}>
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
              aria-label="Temperature" value={temperature}
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
              aria-label="Top P" value={topP}
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
              aria-label="Top K" value={topK}
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
              aria-label="Repeat Penalty" value={repeatPenalty}
              onChange={(e) => setParam("repeatPenalty", parseFloat(e.target.value))}
            />
          </div>

          <ResponseLengthControl value={responseLength}
            contextWindow={models.find(model => model.name === state.selectedModel)?.contextLength}
            onChange={value => dispatch({ type: "SET_RESPONSE_LENGTH", payload: value })} />

          {/* System Prompt */}
          <div className="system-prompt-area">
            <div className="system-prompt-label">Response Style</div>
            <select
              className="response-style-select"
              aria-label="Response Style" value={responseStyle}
              onChange={(e) => setParam("responseStyle", e.target.value)}
            >
              {Object.entries(responseStyles).map(([key, style]) => (
                <option key={key} value={key}>
                  {style.label}
                </option>
              ))}
            </select>
            <div className="system-prompt-label">System Prompt</div>

            <textarea
              id={pane.domId("system-prompt")} aria-label="System Prompt"
              placeholder="Optional: instruct the model how to behave..."
              value={systemPrompt}
              onChange={(e) => setParam("systemPrompt", e.target.value)}
            />
            <div className="system-prompt-label">Memory Summary Model</div>
            <select
              className="response-style-select"
              aria-label="Memory Summary Model" value={summaryModel}
              onChange={(e) => setParam("summaryModel", e.target.value)}
            >
              <option value="">Use active model</option>
              {models.map((model) => (
                <option key={model.name} value={model.name}>{model.knownLabel || model.name}</option>
              ))}
            </select>
          </div>

          <div className="durable-memory-area">
            <div className="system-prompt-label">Durable Memory</div>
            <textarea
              aria-label="Durable Memory" value={durableMemoryDraft}
              maxLength={8000}
              onChange={(e) => setDurableMemoryDraft(e.target.value)}
              placeholder="A lasting preference, project fact, or constraint"
            />
            <button type="button" onClick={saveDurableMemory} disabled={savingDurableMemory}>
              {savingDurableMemory ? "Saving..." : "Save durable memory"}
            </button>
            <button type="button" onClick={() => dispatch({ type: 'SET_SIDEBAR_TAB', payload: 'memory' })}>Browse and organize memories</button>
          </div>
        </div>
      </div>
    </div>
  );
}
