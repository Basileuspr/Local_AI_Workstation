import limits from '../backend/services/image_manager_tools_limits.json';

export {limits as imageToolsLimits};
const integer = (value, min, max=Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
export function imageToolsOrder(records, options) {
  const result = [...records];
  if (options.order === 'shuffle') {
    let seed=options.shuffle_seed ?? 1;
    for(let index=result.length-1;index>0;index--){
      seed=(Math.imul(1664525,seed)+1013904223)>>>0;
      const other=seed%(index+1);[result[index],result[other]]=[result[other],result[index]];
    }
  } else if(options.order==='reverse'||options.reverse) result.reverse();
  return result;
}
const median = values => { const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2; };
const side = options => ({webp:16383,jpg:65500}[options.format]??limits.max_stitched_side);
const fits = (w,h,options) => Math.max(w,h)<=side(options)&&((options.size_mode||'exact')==='exact'||(Math.max(w,h)<=limits.fit_canvas_side&&w*h<=limits.fit_canvas_pixels));
const columnsFor = (count,options) => options.layout==='horizontal'?count:options.layout==='vertical'?1:Math.min(count,options.columns||Math.max(1,Math.ceil(Math.sqrt(count*options.height/options.width))));
function regular(count,options){
  const columns=columnsFor(count,options),rows=Math.ceil(count/columns),{width,height,gap}=options;
  const geometry=scale=>{const w=Math.max(1,Math.floor(width*scale)),h=Math.max(1,Math.floor(height*scale));return {width:columns*w+(columns-1)*gap,height:rows*h+(rows-1)*gap,tile_width:w,tile_height:h,columns,rows,count};};
  let sheet=geometry(1);
  if(!fits(sheet.width,sheet.height,options)){
    if((options.size_mode||'exact')==='exact')return {...sheet,pixels:sheet.width*sheet.height,error:'The stitched image exceeds '+side(options).toLocaleString('en-US')+' pixels per side for this format. Choose PNG, Fit into one image or Multiple sheets.'};
    const minimum=geometry(0);
    if(!fits(minimum.width,minimum.height,options))return {error:'The spacing alone exceeds the output size. Reduce the gap or choose Multiple sheets.'};
    let low=0,high=1;
    for(let i=0;i<48;i++){const mid=(low+high)/2,trial=geometry(mid);if(fits(trial.width,trial.height,options))low=mid;else high=mid;}
    sheet=geometry(low);
  }
  return {...sheet,reduced:sheet.tile_width<width||sheet.tile_height<height,pixels:sheet.width*sheet.height};
}
function balanced(records,options){
  let columns=columnsFor(records.length,options);const groups=[[],[],[]];let rows=[];
  for(const item of records){const ratio=item.width/item.height;groups[ratio>1.05?0:ratio<1/1.05?1:2].push(item);}
  while(true){
    rows=[];
    for(const group of groups){
      if(!group.length)continue;
      const ratio=median(group.map(item=>item.width/item.height)),capacity=Math.max(1,Math.floor(columns/Math.sqrt(ratio)+.5));
      let rowCount=Math.max(1,Math.ceil(group.length/capacity));if(capacity>=2)rowCount=Math.min(rowCount,Math.max(1,Math.floor(group.length/2)));
      const base=Math.floor(group.length/rowCount),extra=group.length%rowCount;let offset=0;
      for(let index=0;index<rowCount;index++){const length=base+Number(index<extra);rows.push(group.slice(offset,offset+length));offset+=length;}
    }
    const areas=rows.flatMap(row=>{const sum=row.reduce((n,item)=>n+item.width/item.height,0);return row.map(item=>item.width/item.height/(sum*sum));});
    if(areas.reduce((a,b)=>Math.max(a,b),0)<=3*median(areas)||columns===1)break;
    columns=Math.max(1,Math.floor(columns*.75));
  }
  const minimum=rows.reduce((n,row)=>Math.max(n,row.length),0),requested=Math.max(minimum,columns*options.width);
  const heights=width=>rows.map(row=>Math.max(1,Math.floor(width/row.reduce((sum,item)=>sum+item.width/item.height,0)+.5)));
  const height=width=>heights(width).reduce((sum,h)=>sum+h,0);
  let width=requested;
  if(!fits(width,height(width),options)){
    if((options.size_mode||'exact')==='exact')return {error:'The full-fill canvas exceeds this format\'s edge limit. Choose PNG, Fit into one image or Multiple sheets.'};
    if(!fits(minimum,height(minimum),options))return {error:'This layout cannot fit at one pixel per image. Choose Multiple sheets.'};
    let low=minimum,high=requested;
    while(low<high){const mid=Math.floor((low+high+1)/2);if(fits(mid,height(mid),options))low=mid;else high=mid-1;}
    width=low;
  }
  const h=height(width);
  return {width,height:h,pixels:width*h,columns,rows:rows.length,count:records.length,reduced:width<requested};
}

// Preview the same geometry used by the worker before allocating a canvas.
export function imageToolsSize(count, options, records=[]) {
  const {width,height,layout,gap}=options;
  if(!integer(count,1))return {error:'Choose available catalog images.'};
  if(!integer(width,1,limits.max_image_side)||!integer(height,1,limits.max_image_side))return {error:'Use positive whole-number dimensions within the PNG format limit.'};
  if((options.standardize||layout!=='none')&&Math.max(width,height)>side(options))return {error:'Requested dimensions exceed this format\'s edge limit. Choose PNG or smaller dimensions.'};
  if(!integer(gap,0,limits.max_gap))return {error:'Use a whole-number gap from 0 to 256 pixels.'};
  if(['grid','balanced'].includes(layout)&&!integer(options.columns??0,0,Math.min(count,limits.max_stitched_side)))return {error:'Use a whole-number column count from 0 (Auto) to the image count.'};
  if(layout==='none')return {error:options.save_copies===false?'Enable individual copies or choose a compilation layout.':''};
  if(layout!=='balanced'&&!options.standardize)return {error:'Enable a common image size for stitching or GIF creation.'};
  if(options.orientation_size)return {error:'Orientation-based 1080p sizing is for individual copies.'};
  if(layout==='gif'){
    const gifBytes=count*width*height*4;
    if(!integer(options.frame_delay,20,10000))return {error:'Use a whole-number frame delay from 20 to 10,000 milliseconds.'};
    return {gifBytes,error:gifBytes>limits.max_gif_bytes?'GIF frames exceed 128 MiB. Use fewer images or smaller dimensions.':''};
  }
  if(layout==='balanced'&&(gap||options.fit&&options.fit!=='contain'))return {error:'Full fill preserves whole images and uses no gaps. Choose Pad and a zero gap.'};
  if(layout==='balanced'&&records.length!==count)return {error:'Reading source dimensions for full fill…'};
  const build=(length,offset,opts)=>layout==='balanced'?balanced(records.slice(offset,offset+length),opts):regular(length,opts);
  let sheets=[];
  if((options.size_mode||'exact')==='pages'){
    if(!integer(options.images_per_sheet,1))return {error:'Choose a positive whole-number sheet size.'};
    let perSheet=options.images_per_sheet,pageOptions={...options};
    if(layout!=='balanced'){
      let columns=columnsFor(Math.min(count,perSheet),options);
      const pageSide=Math.min(side(options),limits.fit_canvas_side);
      if(layout==='horizontal'||(!options.columns&&layout!=='vertical'))columns=Math.min(columns,Math.max(1,Math.floor((pageSide+gap)/(width+gap))),Math.max(1,Math.floor((limits.fit_canvas_pixels/height+gap)/(width+gap))));
      const cw=columns*width+(columns-1)*gap,maxRows=Math.min(Math.floor((pageSide+gap)/(height+gap)),Math.floor((limits.fit_canvas_pixels/cw+gap)/(height+gap)));
      if(cw>pageSide||maxRows<1)return {error:'A sheet cannot fit these tile dimensions and columns. Reduce dimensions or columns.'};
      perSheet=Math.min(perSheet,columns*maxRows);
      if(layout==='horizontal')perSheet=Math.min(perSheet,columns);
      pageOptions={...pageOptions,columns,size_mode:'exact'};
    } else pageOptions.size_mode='fit';
    for(let offset=0;offset<count;offset+=perSheet)sheets.push(build(Math.min(perSheet,count-offset),offset,pageOptions));
  }else sheets=[build(count,0,options)];
  const failed=sheets.find(sheet=>sheet.error);
  if(failed)return {...failed,stitched:failed.width?failed:undefined};
  return {error:'',sheets,stitched:sheets[0],sheetCount:sheets.length,reduced:sheets.some(sheet=>sheet.reduced)};
}

export function imageToolsGridSizes(count,options,records=[]){
  const candidates=new Set([0,1,2,3,4,5,8,10,12,16,24,32,48,64,columnsFor(count,{...options,columns:0}),options.columns??0]);
  for(let n=1;n*n<=count;n++){if(count%n===0){candidates.add(n);candidates.add(count/n);}}
  return [...candidates].filter(n=>n<=count).sort((a,b)=>a-b).map(columns=>({...imageToolsSize(count,{...options,layout:'grid',standardize:true,columns},records),columns,rows:Math.ceil(count/(columns||columnsFor(count,{...options,columns:0})))}));
}
export function preferredImageGrid(sizes){
  const available=sizes.filter(size=>!size.error);
  available.sort((a,b)=>Math.abs(Math.log(a.stitched.width/a.stitched.height))-Math.abs(Math.log(b.stitched.width/b.stitched.height)));
  return available[0]?.columns??0;
}
