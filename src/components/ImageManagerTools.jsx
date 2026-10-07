import {useEffect,useRef,useState} from 'react';
import * as images from '../imageManagerApi';
import ImageThumbnail from './ImageThumbnail';
import {imageToolsLimits,imageToolsSize,imageToolsGridSizes,imageToolsOrder} from '../imageToolsSizing';

const defaults={format:'png',standardize:false,width:1024,height:1024,fit:'contain',background:'#ffffff',layout:'none',columns:0,gap:0,frame_delay:100,loop:0,reverse:false,size_mode:'exact',images_per_sheet:60,order:'filename',shuffle_seed:1,trim_white:false,orientation_size:false,save_copies:true,name_prefix:''};
const ratios={'1:1':[1,1],'4:3':[4,3],'3:4':[3,4],'16:9':[16,9],'9:16':[9,16]};

export default function ImageManagerTools({Dialog,folders,selected,folderId,outputId,job,disabled,chooseSource,chooseOutput,scan,start,onClose}){
  const [scope,setScope]=useState(selected.length?'selected':folderId||folders.find(folder=>folder.purpose==='source')?.id||'');
  const [rows,setRows]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const [options,setOptions]=useState(defaults),[ratio,setRatio]=useState('1:1'),[destination,setDestination]=useState(folders.some(folder=>folder.id===outputId&&folder.purpose==='output')?outputId:'');
  const [submitted,setSubmitted]=useState(''),[pending,setPending]=useState(false),[recursive,setRecursive]=useState(true),[revision,setRevision]=useState(0),[shown,setShown]=useState(100);
  const lock=useRef(false),refreshedScan=useRef('');
  const result=submitted&&job?.id===submitted?job.result?.image_tools:null;
  const working=submitted&&job?.id===submitted&&job.status==='running';
  useEffect(()=>{setError('');},[options,destination]);
  useEffect(()=>{
    if(job?.id===submitted&&job.kind==='scan'&&job.status!=='running'&&refreshedScan.current!==submitted){refreshedScan.current=submitted;setRevision(value=>value+1);}
  },[submitted,job?.id,job?.kind,job?.status]);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');setRows([]);setShown(100);
    const load=scope?images.request('/image-tools/sources','POST',scope==='selected'?{ids:selected}:{folder_id:scope,recursive},controller.signal):Promise.resolve({images:[]});
    load.then(page=>{if(!controller.signal.aborted)setRows(page.images);}).catch(error=>{if(!controller.signal.aborted)setError(error.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[scope,selected,revision,recursive]);
  const ordered=imageToolsOrder(rows,options);
  const processingOptions={...options,...(!options.standardize?{width:defaults.width,height:defaults.height}:{}),...(['none','gif','balanced'].includes(options.layout)?{gap:0}:{}),...(['none','gif'].includes(options.layout)?{columns:0}:{}),...(options.layout!=='gif'?{frame_delay:defaults.frame_delay,loop:defaults.loop}:{})};
  const sizing=imageToolsSize(rows.length,processingOptions,ordered);
  const grids=imageToolsGridSizes(rows.length,options,ordered);
  const copySide={webp:16383,jpg:65500}[options.format];
  const sourceError=copySide&&options.save_copies&&!options.standardize&&!options.orientation_size&&rows.some(row=>Math.max(row.width,row.height)>copySide)?'An unscaled copy exceeds this format\'s edge limit. Choose PNG or resize individual copies.':'';
  const nameError=options.name_prefix.length>80||!/^[\p{L}\p{N}_ -]*$/u.test(options.name_prefix)?'Use letters, numbers, spaces, underscores or hyphens for copy names.':'';
  const layoutError=layout=>imageToolsSize(rows.length,{...processingOptions,layout,columns:layout==='grid'?0:processingOptions.columns,standardize:layout!=='none',orientation_size:false,save_copies:layout==='none'?true:options.save_copies,...(layout==='balanced'?{gap:0,fit:'contain'}:{})},ordered).error;
  const running=disabled||working||pending;
  const blocked=running?(working?'An image task is running.':'Wait for the current image task to finish.'):loading?'Reading catalog images…':!scope?'Choose an image folder to get started.':!rows.length?'Click Read image folder to find images in this folder.':sourceError||nameError||sizing.error||(!destination?'Choose an output folder for your images.':'');
  const change=(key,value)=>setOptions(current=>({...current,[key]:value}));
  const seed=()=>Date.now()%2147483647;
  function width(value){setOptions(current=>({...current,width:value,...(ratio!=='custom'?{height:Math.max(1,Math.round(value*ratios[ratio][1]/ratios[ratio][0]))}:{})}));}
  async function perform(action){
    if(lock.current)return;
    lock.current=true;setPending(true);setError('');
    try{await action();}catch(error){setError(error.message);}finally{lock.current=false;setPending(false);}
  }
  const close=()=>{if(!lock.current)onClose();};
  return <Dialog title="Image tools" className="im-tools-dialog" onClose={close}>
    <div className="im-tools-body">
      <p className="im-note">Prepare individual copies or combine your images. Originals are always retained.</p>
      <label>Images to process<select aria-label="Image tools source" disabled={running} value={scope} onChange={event=>{setScope(event.target.value);setSubmitted('');}}><option value="">Choose a catalog folder</option>{selected.length>0&&<option value="selected">Selected images ({selected.length})</option>}{folders.map(folder=><option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label>
      <div className="im-controls">
        <button disabled={running} onClick={()=>perform(async()=>{const folder=await chooseSource();if(folder){setScope(folder.id);setSubmitted('');}})}>Choose image folder</button>
        <label className="im-check"><input type="checkbox" checked={recursive} disabled={running||scope==='selected'} onChange={event=>setRecursive(event.target.checked)}/>Include subfolders</label>
        <button disabled={running||!scope||scope==='selected'} onClick={()=>perform(async()=>{const value=await scan({folder_ids:[scope],recursive});setSubmitted(value.job_id);})}>Read image folder</button>
      </div>
      <p role="status">{loading?'Reading catalog images…':`${rows.length} images · ${new Set(rows.map(row=>`${row.width}x${row.height}`)).size} source sizes`}</p>
      <details><summary>Source images & processing order ({rows.length})</summary>
        {options.order==='shuffle'&&<p className="im-note">Shuffled source order. Full fill also groups images by orientation.</p>}
        <ol className="im-tools-sources">{ordered.slice(0,shown).map(image=><li key={image.id}><ImageThumbnail src={images.imageUrl(image)} alt={image.relative}/><span>{image.relative}<small>{image.width} × {image.height} · {image.format}</small></span></li>)}</ol>
        {shown<rows.length&&<button onClick={()=>setShown(value=>value+100)}>Show next 100 sources</button>}
      </details>
      <fieldset disabled={running}><legend>Conversion and preparation</legend>
        <div className="im-controls"><label>Convert to<select aria-label="Image tools format" value={options.format} onChange={event=>change('format',event.target.value)}><option value="png">PNG · lossless</option><option value="jpg">JPEG · high quality</option><option value="webp">WebP · lossless</option></select></label>
        <label>Background color<input aria-label="Image tools background" type="color" value={options.background} onChange={event=>change('background',event.target.value)}/></label></div>
        <label className="im-check"><input aria-label="Trim white borders" type="checkbox" checked={options.trim_white} onChange={event=>change('trim_white',event.target.checked)}/>Trim near-white outer borders</label>
        {options.trim_white&&<p className="im-note">Trims near-white outer rows and columns in copies only. This can remove intentional white background; entirely white images are kept.</p>}
        <label className="im-check"><input aria-label="Orientation 1080p sizing" type="checkbox" disabled={options.layout!=='none'} checked={options.orientation_size} onChange={event=>{const checked=event.target.checked;setOptions(current=>({...current,orientation_size:checked,standardize:false,fit:'contain'}));}}/>Portrait / landscape 1080p copies</label>
        {options.orientation_size&&<p className="im-note">Portrait: 1080 × 1920. Landscape or square: 1920 × 1080. Whole images fit with the selected background.</p>}
        <label className="im-check"><input type="checkbox" disabled={options.orientation_size||options.layout!=='none'} checked={options.standardize} onChange={event=>change('standardize',event.target.checked)}/>Standardize aspect ratio and size</label>
        {(options.standardize||options.layout!=='none')&&<fieldset><legend>{options.layout==='balanced'?'Compilation scale':'Common dimensions'}</legend>
          <label>Aspect ratio preset<select value={ratio} onChange={event=>{const value=event.target.value;setRatio(value);if(value!=='custom')change('height',Math.max(1,Math.round(options.width*ratios[value][1]/ratios[value][0])));}}>{Object.keys(ratios).map(value=><option key={value}>{value}</option>)}<option value="custom">Custom width & height</option></select></label>
          <div className="im-controls"><label>Width (pixels)<input aria-label="Image tools width" type="number" min="1" max={imageToolsLimits.max_image_side} value={options.width} onChange={event=>width(Number(event.target.value))}/></label><label>Height (pixels)<input aria-label="Image tools height" type="number" min="1" max={imageToolsLimits.max_image_side} value={options.height} onChange={event=>{setRatio('custom');change('height',Number(event.target.value));}}/></label></div>
          <label>Fit images<select aria-label="Image tools fit" disabled={options.layout==='balanced'||options.orientation_size} value={options.fit} onChange={event=>change('fit',event.target.value)}><option value="contain">Pad · preserve the whole image</option><option value="cover">Crop · fill the size</option><option value="stretch">Stretch · may distort proportions</option></select></label>
        </fieldset>}
      </fieldset>
      <fieldset disabled={running}><legend>Compilation and animation</legend>
        <label>Output sizing<select aria-label="Image tools size mode" value={options.size_mode} onChange={event=>change('size_mode',event.target.value)}><option value="fit">Fit into one image · shrink tiles when needed</option><option value="pages">Multiple sheets · keep grid tile dimensions</option><option value="exact">Exact dimensions · report layouts that do not fit</option></select></label>
        <div className="im-controls"><label>Layout<select aria-label="Image tools layout" value={options.layout} onChange={event=>{
          const layout=event.target.value;if(layoutError(layout))return;
          setOptions(current=>({...current,layout,columns:0,standardize:layout!=='none',orientation_size:false,save_copies:['none','gif'].includes(layout)||(current.layout!=='none'&&current.save_copies),...(layout==='balanced'?{gap:0,fit:'contain'}:{})}));
        }}>
          {[['none','Individual images only'],['grid','Regular grid'],['balanced','Balanced full fill · whole images, no gaps'],['vertical','Vertical strip'],['horizontal','Horizontal strip'],['gif','Animated GIF']].map(([layout,label])=><option key={layout} value={layout} disabled={!!layoutError(layout)}>{label}{layoutError(layout)?' · adjust sizing':''}</option>)}
        </select></label>
        <label>Grid size<select aria-label="Image tools columns" disabled={!['grid','balanced'].includes(options.layout)} value={options.columns} onChange={event=>change('columns',Number(event.target.value))}>{grids.map(grid=><option key={grid.columns} value={grid.columns} disabled={options.layout==='grid'&&!!grid.error}>{grid.columns===0?'Auto':`${grid.columns} columns × ${grid.rows} rows`}{options.layout==='grid'&&grid.error?' · exceeds limits':''}</option>)}</select></label></div>
        {['grid','balanced'].includes(options.layout)&&<label>{options.layout==='balanced'?'Requested density (0 = Auto)':'Custom columns (0 = Auto)'}<input aria-label="Image tools custom columns" type="number" min="0" max={Math.min(rows.length,imageToolsLimits.max_stitched_side)} value={options.columns} onChange={event=>change('columns',Number(event.target.value))}/></label>}
        {options.size_mode==='pages'&&!['none','gif'].includes(options.layout)&&<label>Maximum images per sheet<input aria-label="Image tools images per sheet" type="number" min="1" value={options.images_per_sheet} onChange={event=>change('images_per_sheet',Number(event.target.value))}/></label>}
        <div className="im-controls"><label>Gap (pixels)<input aria-label="Image tools gap" disabled={['none','gif','balanced'].includes(options.layout)} type="number" min="0" max={imageToolsLimits.max_gap} value={options.gap} onChange={event=>change('gap',Number(event.target.value))}/></label>
        <label>Order<select aria-label="Image tools order" value={options.order} onChange={event=>setOptions(current=>({...current,order:event.target.value,reverse:false,shuffle_seed:seed()}))}><option value="filename">Filename · A–Z</option><option value="reverse">Filename · Z–A</option><option value="shuffle">Shuffle</option></select></label>
        {options.order==='shuffle'&&<button onClick={()=>change('shuffle_seed',seed())}>Shuffle again</button>}</div>
        {options.layout==='balanced'&&<p className="im-note">Whole images fill rows edge to edge. Portrait, landscape and square images have separate rows, with comparable image areas. Density sets a target; row lengths adapt to aspect ratios. Full-fill sheets can reduce their scale when needed.</p>}
        {sizing.stitched&&<p role="status" aria-label="Stitched output size" className={sizing.error?'im-error':'im-note'}>{sizing.sheetCount>1?`${sizing.sheetCount} sheets · first sheet: `:''}{sizing.stitched.width.toLocaleString()} × {sizing.stitched.height.toLocaleString()} pixels · {(sizing.stitched.pixels/1000000).toFixed(2)} megapixels including gaps{sizing.reduced?' · automatically reduced to fit':''}{sizing.stitched.tile_width?` · tiles ${sizing.stitched.tile_width} × ${sizing.stitched.tile_height}`:''}</p>}
        {options.trim_white&&options.layout==='balanced'&&<p className="im-note">Full-fill dimensions above are estimated before trimming; the final layout uses trimmed image dimensions.</p>}
        <p className="im-note">Exact dimensions keeps your requested size. Large PNG compilations use temporary disk space. Fit mode optionally reduces a compilation to 64 megapixels; Multiple sheets splits the images across smaller outputs.</p>
        {options.layout==='gif'&&<div className="im-controls"><label>Time per image (milliseconds)<input aria-label="Image tools frame delay" type="number" min="20" max="10000" value={options.frame_delay} onChange={event=>change('frame_delay',Number(event.target.value))}/></label><label>Loop animation<select value={options.loop} onChange={event=>change('loop',Number(event.target.value))}><option value="0">Forever</option><option value="-1">Play once</option><option value="1">Repeat once</option><option value="2">Repeat twice</option></select></label><p className="im-note">GIF frames share a 128 MiB memory budget.</p></div>}
      </fieldset>
      <fieldset disabled={running}><legend>Exported copies</legend>
        <label className="im-check"><input aria-label="Save individual copies" type="checkbox" disabled={options.layout==='none'} checked={options.save_copies} onChange={event=>change('save_copies',event.target.checked)}/>Save individual copies as well</label>
        <label>Copy name prefix (optional)<input aria-label="Image tools name prefix" disabled={!options.save_copies} maxLength="80" value={options.name_prefix} onChange={event=>change('name_prefix',event.target.value)} placeholder="Keep source names"/></label>
        <p className="im-note">A prefix produces numbered copies. Every run includes dimensions.csv with source order, sizes and sheet positions.</p>
      </fieldset>
      <label>Output folder<select aria-label="Image tools output" disabled={running} value={destination} onChange={event=>setDestination(event.target.value)}><option value="">Choose an output folder</option>{folders.filter(folder=>folder.purpose==='output').map(folder=><option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label>
      <button disabled={running} onClick={()=>perform(async()=>{const folder=await chooseOutput();if(folder){if(folder.purpose!=='output')throw Error('This folder is registered as a source. Choose a separate output folder.');setDestination(folder.id);}})}>Choose output folder</button>
      <p className="im-note">Choose an output folder outside the source trees. Each run gets a new subfolder and retains every original.</p>
      {result&&<div><p>{result.images.length} individual copies{result.sheets?.length?` · ${result.sheets.length} compilation${result.sheets.length===1?'':'s'}`:result.animated?' · animated GIF':''} created.</p><p className="im-path">{result.output}</p><p>Dimensions report: dimensions.csv</p><button onClick={async()=>{try{const first=result.images[0]||result.sheets?.[0];if(!first)throw Error('Output folder: '+result.output);const response=await window.workstationDesktop.revealManagedImage(first.id);if(response.error)throw Error(response.error);}catch(error){setError(error.message);}}}>Show output in folder</button></div>}
    </div>
    <footer>
      {error&&<p role="alert" className="im-error">{error}</p>}
      {submitted&&job?.id===submitted&&job.kind==='image-tools'&&<p role={job.status==='failed'?'alert':'status'} className={job.status==='failed'?'im-error':'im-note'}>{job.message}</p>}
      <p id="im-tools-ready" className="im-note" role="status">{blocked||`${rows.length} images ready. Create images to start.`}</p>
      <div className="im-tools-actions"><button disabled={pending} onClick={close}>Close</button>{working&&<button onClick={()=>images.request(`/tasks/${submitted}/stop`,'POST',{}).catch(error=>setError(error.message))}>Stop processing</button>}<button aria-describedby="im-tools-ready" disabled={!!blocked} onClick={()=>perform(async()=>{if(blocked)return;const value=await start({ids:rows.map(row=>row.id),output_id:destination,image_options:processingOptions});setSubmitted(value.job_id);})}>Create images</button></div>
    </footer>
  </Dialog>;
}
