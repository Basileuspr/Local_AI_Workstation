import { useCallback, useEffect, useMemo, useState } from "react";
import * as faces from "../faceApi";
import CharacterNameDialog from "./CharacterNameDialog";

function Distribution({ values }) {
  if (values.length < 2) return null;
  // Ten buckets across the observed range: enough to see a second lump, which
  // is what identity drift usually looks like.
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const buckets = Array(10).fill(0);
  for (const value of values) buckets[Math.min(9, Math.floor(((value - low) / span) * 10))] += 1;
  const tallest = Math.max(...buckets);
  return <div className="bank-distribution">
    <span className="face-meta">Similarity spread {low.toFixed(2)} → {high.toFixed(2)}</span>
    <div className="bank-bars" role="img" aria-label={`Similarity distribution across ${values.length} accepted faces`}>
      {buckets.map((count, index) => <i key={index} style={{ height: `${(count / tallest) * 100}%` }} title={`${count} face(s)`} />)}
    </div>
  </div>;
}

function FaceTile({ member, datasetId, selected, onToggle, badge }) {
  return <figure className={`face-card bank-tile ${selected ? "selected" : ""} ${member.drift ? "drifting" : ""}`}>
    <button type="button" className="face-thumb" onClick={() => onToggle(member.face_id)} aria-pressed={selected}>
      <img src={faces.cropUrl(datasetId || member.dataset_id, member.face_id)} alt="" loading="lazy" />
    </button>
    <figcaption>
      {badge && <span className="bank-badge">{badge}</span>}
      <span className="face-meta">
        {member.similarity === null
          ? "not scored — its face is gone from the dataset"
          : `similarity ${member.similarity.toFixed(3)}`}
      </span>
      {member.drift && <span className="face-flag">possible drift</span>}
    </figcaption>
  </figure>;
}

export default function FaceBank({ onOpenExtractor }) {
  const [characters, setCharacters] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [character, setCharacter] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [draft, setDraft] = useState({ notes: "", tags: "" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [renaming, setRenaming] = useState(null);

  const refresh = useCallback(async () => {
    const data = await faces.listCharacters();
    setCharacters(data.characters);
    return data.characters;
  }, []);

  const load = useCallback(async (id) => {
    if (!id) return setCharacter(null);
    const data = await faces.getCharacter(id);
    setCharacter(data);
    setDraft({ notes: data.notes || "", tags: (data.tags || []).join(", ") });
    setSelected(new Set());
    return data;
  }, []);

  useEffect(() => {
    refresh().then((list) => { if (!activeId && list.length) setActiveId(list[0].id); })
      .catch((failure) => setError(failure.message));
  }, [refresh]);

  useEffect(() => { load(activeId).catch((failure) => setError(failure.message)); }, [activeId, load]);

  async function guard(label, action) {
    setBusy(label); setError(""); setNotice("");
    try { return await action(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(""); }
  }

  const groups = useMemo(() => faces.curationGroups(character), [character]);

  const act = (label, run, message) => guard(label, async () => {
    await run();
    await load(activeId);
    await refresh();
    if (message) setNotice(message);
  });

  const decide = (state) => act("state",
    () => faces.setMemberState(activeId, [...selected], state),
    `${selected.size} face(s) ${state}. The centroid and representative face were recalculated.`);

  const mark = (role) => act("reference",
    () => faces.setReference(activeId, [...selected][0], role),
    role === "none" ? "Reference cleared." : `Marked as ${role} reference.`);

  const move = (targetId) => act("move",
    () => faces.moveMembers(activeId, targetId, [...selected]),
    "Faces moved. Both characters were recalculated.");

  const drop = () => act("remove", async () => {
    if (!window.confirm(`Remove ${selected.size} face(s) from this character? The crops stay in their dataset.`)) return;
    await faces.removeMembers(activeId, [...selected]);
  }, "Removed from this character. The dataset crops are untouched.");

  const saveDetails = () => act("details",
    () => faces.editCharacter(activeId, {
      notes: draft.notes,
      tags: draft.tags.split(",").map((value) => value.trim()).filter(Boolean),
    }), "Details saved.");

  async function rename(name) {
    if (name === renaming.name) return;
    const updated = await faces.editCharacter(renaming.id, { name });
    setCharacter(current => current?.id === updated.id ? { ...current, name: updated.name } : current);
    setCharacters(current => current.map(item => item.id === updated.id ? { ...item, name: updated.name } : item));
    setNotice("Character renamed.");
  }

  const removeCharacter = () => guard("delete", async () => {
    if (!window.confirm(`Delete "${character.name}"? Its faces stay in their datasets.`)) return;
    await faces.deleteCharacter(activeId);
    const list = await refresh();
    setActiveId(list[0]?.id || "");
  });

  function toggle(faceId) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(faceId) ? next.delete(faceId) : next.add(faceId);
      return next;
    });
  }

  const centroid = character?.centroid;
  const representative = character?.members?.find((m) => m.face_id === character.representative_face_id);
  const primary = character?.members?.find((m) => m.face_id === character.primary_reference);

  return <div className="face-bank">
    <aside className="bank-list">
      <h2>Characters</h2>
      {!characters.length && <p className="face-note">
        No characters yet. Curate faces in the Extractor, select the good ones, and save them as a character.
        {onOpenExtractor && <> <button type="button" className="face-link" onClick={onOpenExtractor}>Open the Extractor</button></>}
      </p>}
      <ul>
        {characters.map((item) => <li key={item.id}>
          <button type="button" className={item.id === activeId ? "active" : ""} onClick={() => setActiveId(item.id)}>
            {item.representative_face_id
              ? <img src={faces.cropUrl(item.representative_dataset_id, item.representative_face_id)} alt="" loading="lazy" />
              : <span className="bank-empty-thumb" aria-hidden="true" />}
            <span>
              <strong>{item.name}</strong>
              <span className="face-meta">{item.reference_count} reference{item.reference_count === 1 ? "" : "s"}
                {item.rejected_count ? ` · ${item.rejected_count} rejected` : ""}</span>
            </span>
          </button>
        </li>)}
      </ul>
    </aside>

    <section className="bank-detail">
      {error && <p className="face-alert" role="alert">{error}</p>}
      {notice && <p className="face-notice" role="status">{notice}</p>}
      {!character && <p className="face-note">Select a character to see its references.</p>}

      {character && <>
        <header className="bank-head">
          <div>
            <h2>{character.name}</h2>
            <p className="face-meta">
              {groups.accepted.length} accepted · {groups.rejected.length} rejected
              {groups.drifting.length ? ` · ${groups.drifting.length} possible drift` : ""}
              {character.missing_members?.length ? ` · ${character.missing_members.length} missing from dataset` : ""}
            </p>
          </div>
          <div className="face-row">
            <button type="button" onClick={() => { setError(""); setNotice(""); setRenaming({ id: character.id, name: character.name }); }} disabled={Boolean(busy)}>Rename</button>
            <button type="button" onClick={() => act("recompute", () => faces.recompute(activeId), "Recalculated.")}
                    disabled={Boolean(busy)}>Recalculate</button>
            <button type="button" onClick={removeCharacter} disabled={Boolean(busy)}>Delete</button>
          </div>
        </header>

        <div className="bank-summary">
          <div className="bank-hero">
            <h3>Most representative face</h3>
            {representative
              ? <>
                  <img src={faces.cropUrl(representative.dataset_id, representative.face_id)} alt="Most representative face" />
                  <p className="face-meta">similarity {representative.similarity?.toFixed(3)} to the group centroid</p>
                </>
              : <p className="face-note">{centroid && centroid.usable === false ? centroid.detail : "No accepted faces yet."}</p>}
            <p className="face-note">Chosen from the real crops — the centroid only points at which one is most typical. Nothing is averaged into a new image.</p>
          </div>
          <div className="bank-hero">
            <h3>Primary reference</h3>
            {primary
              ? <img src={faces.cropUrl(primary.dataset_id, primary.face_id)} alt="Primary reference" />
              : <p className="face-note">None chosen. Select a face below and mark it as the primary reference.</p>}
            {character.additional_references?.length > 0 && <p className="face-meta">
              + {character.additional_references.length} additional reference(s)
            </p>}
            <p className="face-note">Your explicit pick, kept separate from the computed representative face.</p>
          </div>
          <div className="bank-hero">
            <h3>Profile</h3>
            {centroid?.usable && <p className="face-meta">
              coherence {centroid.coherence} · spread {centroid.spread} · {centroid.source_count} embeddings
            </p>}
            <Distribution values={groups.distribution} />
            <label className="bank-field">Notes
              <textarea rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
            </label>
            <label className="bank-field">Tags (comma separated)
              <input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} />
            </label>
            <button type="button" onClick={saveDetails} disabled={busy === "details"}>Save details</button>
          </div>
        </div>

        <div className="face-row face-actions">
          <span>{selected.size} selected</span>
          <button type="button" onClick={() => decide("accepted")} disabled={!selected.size}>Accept / restore</button>
          <button type="button" onClick={() => decide("rejected")} disabled={!selected.size}>Reject</button>
          <button type="button" onClick={() => mark("primary")} disabled={selected.size !== 1}>Set primary reference</button>
          <button type="button" onClick={() => mark("additional")} disabled={selected.size !== 1}>Add as reference</button>
          <button type="button" onClick={() => mark("none")} disabled={selected.size !== 1}>Clear reference</button>
          <button type="button" onClick={drop} disabled={!selected.size}>Remove from character</button>
          <label>Move to
            <select value="" disabled={!selected.size} onChange={(event) => event.target.value && move(event.target.value)}>
              <option value="">Choose character…</option>
              {characters.filter((item) => item.id !== activeId).map((item) =>
                <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        </div>

        <h3>Accepted — most representative first</h3>
        <div className="face-grid">
          {groups.accepted.map((member) => <FaceTile key={member.face_id} member={member}
            selected={selected.has(member.face_id)} onToggle={toggle}
            badge={member.face_id === character.primary_reference ? "primary"
              : character.additional_references?.includes(member.face_id) ? "reference"
              : member.face_id === character.representative_face_id ? "representative" : null} />)}
        </div>
        {!groups.accepted.length && <p className="face-note">No accepted faces in this character.</p>}

        {groups.rejected.length > 0 && <>
          <h3>Rejected — kept so they can be restored</h3>
          <div className="face-grid">
            {groups.rejected.map((member) => <FaceTile key={member.face_id} member={member}
              selected={selected.has(member.face_id)} onToggle={toggle} />)}
          </div>
        </>}
      </>}
    </section>
    {renaming && <CharacterNameDialog title="Rename character" initialName={renaming.name}
      onSave={rename} onClose={() => setRenaming(null)} />}
  </div>;
}
