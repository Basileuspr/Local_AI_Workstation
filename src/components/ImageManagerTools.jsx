import { useEffect, useRef, useState } from 'react';
import * as images from '../imageManagerApi';
import ImageThumbnail from './ImageThumbnail';

const defaults = { format: 'png', standardize: false, width: 1024, height: 1024, fit: 'contain', background: '#ffffff', layout: 'none', columns: 1, gap: 0, frame_delay: 100, loop: 0, reverse: false };
const ratios = { '1:1': [1, 1], '4:3': [4, 3], '3:4': [3, 4], '16:9': [16, 9], '9:16': [9, 16] };

export default function ImageManagerTools({ Dialog, folders, selected, folderId, outputId, job, disabled, chooseOutput, start, onClose }) {
  const [scope, setScope] = useState(selected.length ? 'selected' : folderId || folders.find(folder => folder.purpose === 'source')?.id || '');
  const [rows, setRows] = useState([]), [total, setTotal] = useState(0), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [options, setOptions] = useState(defaults), [ratio, setRatio] = useState('1:1'), [destination, setDestination] = useState(folders.some(folder => folder.id === outputId && folder.purpose === 'output') ? outputId : '');
  const [submitted, setSubmitted] = useState('');
  const lock = useRef(false);
  const result = submitted && job?.id === submitted ? job.result?.image_tools : null;
  const working = submitted && job?.id === submitted && job.status === 'running';
  const bounded = total > 1000;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setRows([]);
    const load = scope === 'selected' ? images.request('/image-tools/sources', 'POST', { ids: selected }, controller.signal)
      : scope ? images.request(`/images?${new URLSearchParams({ folder_id: scope, sort: 'name', limit: 1000 })}`, 'GET', undefined, controller.signal) : Promise.resolve({ images: [], total: 0 });
    load.then(page => { if (!controller.signal.aborted) { setRows(page.images); setTotal(page.total); } }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [scope, selected]);
  const ordered = [...rows];
  if (options.reverse) ordered.reverse();
  const columns = Array.from({ length: rows.length }, (_, index) => index + 1).filter(n => rows.length % n === 0);
  const change = (key, value) => setOptions(current => ({ ...current, [key]: value }));
  function width(value) { setOptions(current => ({ ...current, width: value, ...(ratio !== 'custom' ? { height: Math.max(1, Math.round(value * ratios[ratio][1] / ratios[ratio][0])) } : {}) })); }
  const running = disabled || working;
  return <Dialog title="Image tools" onClose={() => { if (!lock.current) onClose(); }}>

    <label>Images to process<select aria-label="Image tools source" disabled={running} value={scope} onChange={event => { setScope(event.target.value); setSubmitted(''); }}><option value="">Choose a catalog folder</option>{selected.length > 0 && <option value="selected">Selected images ({selected.length})</option>}{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label>
    <p role="status">{loading ? 'Reading catalog images…' : `${rows.length} images · ${new Set(rows.map(row => `${row.width}x${row.height}`)).size} source sizes`}</p>
    {bounded && <p role="alert" className="im-error">This folder has {total} images. Choose up to 1,000 images in the library and use Selected images.</p>}
    <details><summary>Source images & processing order ({rows.length})</summary><ol className="im-tools-sources">{ordered.map(image => <li key={image.id}><ImageThumbnail src={images.imageUrl(image)} alt={image.relative}/><span>{image.relative}<small>{image.width} × {image.height} · {image.format}</small></span></li>)}</ol></details>
    <fieldset disabled={running}><legend>Conversion and size</legend><div className="im-controls">
      <label>Convert to<select aria-label="Image tools format" value={options.format} onChange={event => change('format', event.target.value)}><option value="png">PNG · lossless</option><option value="jpg">JPEG · high quality</option><option value="webp">WebP · lossless</option></select></label>
      <label>Background color<input aria-label="Image tools background" type="color" value={options.background} onChange={event => change('background', event.target.value)}/></label>
    </div><label className="im-check"><input type="checkbox" checked={options.standardize} onChange={event => setOptions(current => ({ ...current, standardize: event.target.checked, ...(!event.target.checked ? { layout: 'none' } : {}) }))}/>Standardize aspect ratio and size</label>
    <fieldset disabled={!options.standardize}><legend>Common dimensions</legend><label>Aspect ratio preset<select value={ratio} onChange={event => { const value = event.target.value; setRatio(value); if (value !== 'custom') change('height', Math.max(1, Math.round(options.width * ratios[value][1] / ratios[value][0]))); }}>{Object.keys(ratios).map(ratio => <option key={ratio}>{ratio}</option>)}<option value="custom">Custom width & height</option></select></label>
      <div className="im-controls"><label>Width (pixels)<input aria-label="Image tools width" type="number" min="1" max="16384" value={options.width} onChange={event => width(Number(event.target.value))}/></label><label>Height (pixels)<input aria-label="Image tools height" type="number" min="1" max="16384" value={options.height} onChange={event => { setRatio('custom'); change('height', Number(event.target.value)); }}/></label></div>
      <label>Fit images<select value={options.fit} onChange={event => change('fit', event.target.value)}><option value="contain">Pad · preserve the whole image</option><option value="cover">Crop · fill the size</option><option value="stretch">Stretch · may distort proportions</option></select></label>
    </fieldset></fieldset>
    <fieldset disabled={running}><legend>Stitching and animation</legend><div className="im-controls">
      <label>Layout<select aria-label="Image tools layout" value={options.layout} onChange={event => setOptions(current => ({ ...current, layout: event.target.value, ...(event.target.value !== 'none' ? { standardize: true } : {}) }))}><option value="none">Individual images only</option><option value="vertical">Vertical strip</option><option value="horizontal">Horizontal strip</option><option value="grid">Grid</option><option value="gif">Animated GIF</option></select></label>
      <label>Grid size<select aria-label="Image tools columns" disabled={options.layout !== 'grid'} value={columns.includes(options.columns) ? options.columns : 1} onChange={event => change('columns', Number(event.target.value))}>{columns.map(n => <option key={n} value={n}>{n} columns × {rows.length / n} rows</option>)}</select></label>
      <label>Gap (pixels)<input disabled={['none', 'gif'].includes(options.layout)} type="number" min="0" max="256" value={options.gap} onChange={event => change('gap', Number(event.target.value))}/></label>
      <label>Order<select value={options.reverse ? 'reverse' : 'forward'} onChange={event => change('reverse', event.target.value === 'reverse')}><option value="forward">Filename · A–Z</option><option value="reverse">Filename · Z–A</option></select></label>
    </div>{options.layout === 'gif' && <div className="im-controls"><label>Time per image (milliseconds)<input type="number" min="20" max="10000" value={options.frame_delay} onChange={event => change('frame_delay', Number(event.target.value))}/></label><label>Loop animation<select value={options.loop} onChange={event => change('loop', Number(event.target.value))}><option value="0">Forever</option><option value="-1">Play once</option><option value="1">Repeat once</option><option value="2">Repeat twice</option></select></label></div>}</fieldset>
    <label>Output folder<select aria-label="Image tools output" disabled={running} value={destination} onChange={event => setDestination(event.target.value)}><option value="">Choose an output folder</option>{folders.filter(folder => folder.purpose === 'output').map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label>
    <button disabled={running} onClick={async () => { try { const folder = await chooseOutput(); if (folder) setDestination(folder.id); } catch (error) { setError(error.message); } }}>Choose output folder</button>

    {error && <p role="alert" className="im-error">{error}</p>}
    {submitted && job?.id === submitted && <p role="status">{job.message}</p>}
    {result && <div><p>{result.images.length} image copies{result.stitched ? ' and a stitched image' : result.animated ? ' and an animated GIF' : ''} created.</p><p className="im-path">{result.output}</p><button onClick={async () => { try { const response = await window.workstationDesktop.revealManagedImage(result.images[0].id); if (response.error) throw Error(response.error); } catch (error) { setError(error.message); } }}>Show output in folder</button></div>}
    <footer><button disabled={lock.current} onClick={onClose}>Close</button>{working && <button onClick={() => images.request(`/tasks/${submitted}/stop`, 'POST', {}).catch(error => setError(error.message))}>Stop processing</button>}<button disabled={running || loading || !rows.length || bounded || !destination} onClick={async () => {
      if (lock.current) return; lock.current = true; setError('');
      try { const value = await start({ ids: rows.map(row => row.id), output_id: destination, image_options: { ...options, columns: columns.includes(options.columns) ? options.columns : 1 } }); setSubmitted(value.job_id); }
      catch (error) { setError(error.message); } finally { lock.current = false; }
    }}>Create image copies</button></footer>
  </Dialog>;
}
