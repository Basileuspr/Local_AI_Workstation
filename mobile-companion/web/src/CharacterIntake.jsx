import React, { useEffect, useState } from 'react';
import useFreshResource from './useFreshResource';
import { mediaUrl, request } from './api';
import FullImage from './ImageViewer';

const empty = () => ({ name: '', bio: '', notes: '', tags: [] });
const fields = profile => ({ name: profile.name || '', bio: profile.bio || '', notes: profile.notes || '', tags: [...(profile.tags || [])] });

export default function CharacterIntake({ active, online, onDraftChange }) {
  const [selected, setSelected] = useState(''), [creating, setCreating] = useState(false);
  const [search, setSearch] = useState(''), [page, setPage] = useState(0);
  const [imageSearch, setImageSearch] = useState(''), [imagePage, setImagePage] = useState(0);
  const [draft, setDraft] = useState(empty), [baseline, setBaseline] = useState(empty);
  const [savedRevision, setSavedRevision] = useState(''), [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [epoch, setEpoch] = useState(0), [view, setView] = useState(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline) || !!tag.trim();
  const enabled = active && online;
  const list = useFreshResource(`/api/characters?search=${encodeURIComponent(search)}&offset=${page * 24}&limit=24`, { enabled, refreshKey: epoch, delay: 200 });
  const profile = useFreshResource(`/api/characters/${selected}`, { enabled: enabled && !!selected, refreshKey: epoch });
  const catalog = useFreshResource(`/api/characters/images?search=${encodeURIComponent(imageSearch)}&offset=${imagePage * 24}&limit=24`,
    { enabled: enabled && !!selected && !dirty, refreshKey: epoch, delay: 200 });
  const profiles = list.value?.characters || [], images = profile.value?.images || [];
  useEffect(() => { onDraftChange(dirty); }, [dirty, onDraftChange]);
  useEffect(() => {
    if (profile.value && !dirty) apply(profile.value);
  }, [profile.value]);
  useEffect(() => {
    if (!active || !online || !images.some(image => image.available && image.image_id === view?.id)) setView(null);
  }, [active, online, profile.value]);
  function apply(value) { const next = fields(value); setDraft(next); setBaseline(next); setSavedRevision(value.revision); setTag(''); }
  function change(key, value) { setDraft(current => ({ ...current, [key]: value })); setNotice(''); }
  function select(value) {
    setSelected(value); setCreating(false); setDraft(empty()); setBaseline(empty()); setSavedRevision(''); setTag(''); setError(''); setNotice(''); setView(null);
  }
  function start() { select(''); setCreating(true); }
  function discard() { setDraft(baseline); setTag(''); setError(''); setNotice(''); setEpoch(value => value + 1); if (creating) setCreating(false); }
  function addTag() {
    const value = tag.trim();
    if (!value || draft.tags.length >= 40) return;
    if (!draft.tags.some(item => item.toLocaleLowerCase() === value.toLocaleLowerCase())) change('tags', [...draft.tags, value]);
    setTag('');
  }
  async function save(event) {
    event.preventDefault();
    if (!online || busy || !draft.name.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const tags = tag.trim() ? [...draft.tags, tag.trim()] : draft.tags;
      const saved = await request(creating ? '/api/characters' : `/api/characters/${selected}`, {
        method: creating ? 'POST' : 'PATCH', body: { ...draft, tags, ...(!creating ? { expected_revision: savedRevision } : {}) } });
      apply(saved); setSelected(saved.id); setCreating(false); setNotice('Character saved.'); setEpoch(value => value + 1);
    } catch (failure) {
      setError(creating && (!failure.status || failure.status >= 500) ? 'Save is unconfirmed. Your draft is kept; check the saved profiles before retrying with a different name.' : failure.message);
    } finally { setBusy(false); }
  }
  async function reference(image, remove = false) {
    if (!online || busy || dirty) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await request(`/api/characters/${selected}/images${remove ? '/' + image.id : ''}`, {
        method: remove ? 'DELETE' : 'POST', ...(remove ? {} : { body: { image_id: image.id } }) });
      apply(saved); setNotice(remove ? 'Reference unlinked. Original image kept.' : 'Image linked.'); setEpoch(value => value + 1);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <section className="character-intake" aria-label="Character intake">
    <div className="section-heading"><div><span className="eyebrow">BUILD YOUR CHARACTER</span><h2>Character profiles</h2></div></div>
    <p className="muted">Save biographies, notes, tags and image references to the same profiles used on your desktop. Saving a profile does not generate or train anything.</p>
    <div className="panel character-picker">
      <label>Find characters<input aria-label="Find characters" type="search" maxLength={200} value={search} disabled={busy || dirty} onChange={event => { setSearch(event.target.value); setPage(0); }} /></label>
      <label>Saved character<select aria-label="Saved character" value={selected} disabled={!online || busy || dirty} onChange={event => select(event.target.value)}>
        <option value="">Choose a character</option>{profiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        {selected && !profiles.some(item => item.id === selected) && profile.value && <option value={selected}>{profile.value.name}</option>}
      </select></label>
      <div className="row"><button type="button" disabled={!online || busy || dirty} onClick={start}>New character</button>
        {(page > 0 || list.value?.total > 24) && <>
        <button type="button" aria-label="Previous characters" disabled={!online || busy || dirty || page === 0} onClick={() => setPage(value => value - 1)}>Previous</button>
        <button type="button" aria-label="Next characters" disabled={!online || busy || dirty || (page + 1) * 24 >= (list.value?.total || 0)} onClick={() => setPage(value => value + 1)}>Next</button></>}</div>
      {dirty && <p className="muted">Save or discard edits before choosing another profile or changing references.</p>}
    </div>
    {!online && <p role="status" className="muted">Reconnect to load and save profiles. Unsaved edits stay in this page until it closes.</p>}
    {(error || list.error || profile.error || catalog.error) && <p role="alert" className="error">{error || list.error?.message || profile.error?.message || catalog.error?.message}</p>}
    {notice && <p role="status">{notice}</p>}
    {(creating || profile.value || dirty) && <form className="panel character-form" onSubmit={save}>
      <h3>{creating ? 'New character' : 'Edit profile'}</h3>
      <label>Name<input aria-label="Character name" required maxLength={120} value={draft.name} disabled={busy} onChange={event => change('name', event.target.value)} /></label>
      <label>Biography<textarea aria-label="Character biography" rows={6} maxLength={20000} value={draft.bio} disabled={busy} onChange={event => change('bio', event.target.value)} /></label>
      <label>Notes<textarea aria-label="Character notes" rows={4} maxLength={10000} value={draft.notes} disabled={busy} onChange={event => change('notes', event.target.value)} /></label>
      <div className="character-tags" aria-label="Character tags">{draft.tags.map((value, index) => <button type="button" key={index} disabled={busy} aria-label={`Remove tag ${value}`} onClick={() => change('tags', draft.tags.filter((_tag, position) => position !== index))}>{value} ×</button>)}</div>
      <div className="row"><label>New tag<input aria-label="Character tag" maxLength={60} value={tag} disabled={busy || draft.tags.length >= 40} onChange={event => setTag(event.target.value)} /></label><button type="button" disabled={busy || !tag.trim() || draft.tags.length >= 40} onClick={addTag}>Add tag</button></div>
      <div className="row"><button className="primary" disabled={!online || busy || !draft.name.trim() || (!creating && (!dirty || !savedRevision || !!profile.error))}>Save character</button>
        <button type="button" disabled={busy || !dirty} onClick={discard}>Discard edits and reload</button></div>
    </form>}
    {!!selected && profile.value && <div className="panel character-references">
      <h3>Image references</h3>
      {!images.length && <p className="muted">No linked images yet.</p>}
      {images.map(image => <article key={image.id} className="character-reference"><div className="row"><span>{image.name}</span>
        <button type="button" disabled={!online || busy || dirty} onClick={() => reference(image, true)}>Unlink reference</button></div>
        {image.available && <button type="button" className="image-preview" onClick={() => setView({ id: image.image_id, name: image.name, url: image.url })} aria-label={`View ${image.name}`}><img src={mediaUrl(image.url) + '?thumbnail=true'} alt={image.name} /></button>}
        {image.note && <p className="muted">{image.note}</p>}
        {!image.available && <p className="muted">The saved association is kept. This image is hidden, locked, missing or unavailable to the phone.</p>}
      </article>)}
      <details><summary>Link an existing image</summary>
        <p className="muted">Choose from visible Saved Images in the desktop library. Linking and unlinking preserve the original file.</p>
        <label>Find reference images<input aria-label="Find reference images" type="search" maxLength={200} value={imageSearch} disabled={busy || dirty} onChange={event => { setImageSearch(event.target.value); setImagePage(0); }} /></label>
        <div className="character-image-choices">{(catalog.value?.images || []).map(image => <div key={image.id}><button type="button" disabled={busy || dirty || images.some(link => link.image_id === image.id)} onClick={() => reference(image)} aria-label={`Link ${image.name}`}>
          <img src={mediaUrl(image.url) + '?thumbnail=true'} alt="" loading="lazy" /><span>{image.name}</span></button></div>)}</div>
        {catalog.value && !catalog.value.images.length && <p className="muted">No matching visible Saved Images. Add a reference to the desktop image library first.</p>}
        {(imagePage > 0 || catalog.value?.total > 24) && <div className="row"><button type="button" disabled={busy || dirty || imagePage === 0} onClick={() => setImagePage(value => value - 1)}>Previous images</button>
          <button type="button" disabled={busy || dirty || (imagePage + 1) * 24 >= (catalog.value?.total || 0)} onClick={() => setImagePage(value => value + 1)}>Next images</button></div>}
      </details>
    </div>}
    {view && <FullImage item={view} onClose={() => setView(null)} />}
  </section>;
}
