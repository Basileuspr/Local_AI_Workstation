import { useState } from "react";
import { useDispatch, useStore } from "../useStore.jsx";
import BulkActions, { SelectionCheckbox } from "./BulkActions";
import { useSelection } from "../useSelection";

export default function CustomProfileControls() {
  const { customProfiles, activeCustomProfileId } = useStore();
  const dispatch = useDispatch();
  const [mode, setMode] = useState("");
  const selectedProfile = customProfiles.find((profile) => profile.id === activeCustomProfileId);
  const [nameDraft, setNameDraft] = useState("");
  const selection = useSelection(customProfiles);

  function showToast(message, type) {
    dispatch({ type: "SHOW_TOAST", payload: { message, type } });
  }

  function startCreate() {
    setNameDraft("");
    setMode("create");
  }

  function startEdit() {
    if (!selectedProfile) return;
    setNameDraft(selectedProfile.name);
    setMode("edit");
  }

  function saveProfile() {
    const name = nameDraft.trim();
    if (!name) {
      showToast("Enter a profile name", "error");
      return;
    }
    const duplicate = customProfiles.some(
      (profile) => profile.id !== selectedProfile?.id && profile.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      showToast("A custom profile already uses that name", "error");
      return;
    }

    if (mode === "create") {
      dispatch({
        type: "CREATE_CUSTOM_PROFILE",
        payload: { id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name },
      });
      showToast("Custom profile created", "success");
    } else if (selectedProfile) {
      dispatch({ type: "RENAME_CUSTOM_PROFILE", payload: { id: selectedProfile.id, name } });
      showToast("Custom profile renamed", "success");
    }
    setMode("");
  }

  function deleteProfile() {
    if (!selectedProfile) return;
    if (!window.confirm(`Delete custom profile "${selectedProfile.name}"?`)) return;
    dispatch({ type: "DELETE_CUSTOM_PROFILE", payload: selectedProfile.id });
    setMode("");
    showToast("Custom profile deleted", "success");
  }

  return (
    <section className="custom-profile-control">
      <div className="custom-profile-label">Custom Profile</div>
      <div className="custom-profile-toolbar">
        <select
          aria-label="Custom Profile"
          value={activeCustomProfileId}
          onChange={(event) => dispatch({ type: "APPLY_CUSTOM_PROFILE", payload: event.target.value })}
        >
          <option value="">No custom profiles</option>
          {customProfiles.map((profile) => (
            <option value={profile.id} key={profile.id}>{profile.name}</option>
          ))}
        </select>
        <button type="button" onClick={startCreate}>+ Add</button>
        <button type="button" onClick={startEdit} disabled={!selectedProfile}>Edit</button>
      </div>
      <BulkActions selection={selection} items={customProfiles} label="profiles" disabled={!!mode}
        actions={[{label:"Delete selected profiles", danger:true, onClick:items => {
          if (!window.confirm(`Delete ${items.length} selected custom profile(s)? This cannot be undone. Current chat and image settings will be kept.`)) return;
          dispatch({type:"DELETE_CUSTOM_PROFILES", payload:items.map(item => item.id)});
          selection.forget(items); showToast(`Deleted ${items.length} profiles`, "success");
        }}]} />
      {selection.enabled && <div className="selection-profile-list">{customProfiles.map(profile => <label key={profile.id}>
        <SelectionCheckbox selection={selection} item={profile} label={`profile ${profile.name}`} disabled={!!mode} />{profile.name}
      </label>)}</div>}
      {mode && (
        <div className="custom-profile-editor">
          <label>
            <span>{mode === "create" ? "Profile Name" : "Rename Profile"}</span>
            <input autoFocus value={nameDraft} maxLength={80} onChange={(event) => setNameDraft(event.target.value)} />
          </label>
          <div className="custom-profile-actions">
            {mode === "edit" && <button type="button" className="danger" onClick={deleteProfile}>Delete</button>}
            <button type="button" onClick={() => setMode("")}>Cancel</button>
            <button type="button" onClick={saveProfile}>{mode === "create" ? "Create" : "Rename"}</button>
          </div>
        </div>
      )}
    </section>
  );
}
