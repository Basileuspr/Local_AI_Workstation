export const mediaBatchSizes = [5, 10, 20, 40, 50, 80, 100, 200, 'ALL'];
export function mediaBatchSize(value) {
  if (value === 'ALL') return Infinity;
  return mediaBatchSizes.includes(Number(value)) ? Number(value) : 50;
}

// Pure view helpers shared by the embeddable component and its tests.
export function dateKey(record) {
  const value = String(record.ResolvedDate || '');
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '';
}
export function yearKey(record) {
  return dateKey(record).slice(0, 4) || (/^\d{4}$/.test(String(record.ResolvedYear)) ? String(record.ResolvedYear) : 'Unknown');
}
export function timelineGroups(records, grouping='month', order='newest') {
  if(grouping==='none')return [{key:'all',label:'All matching videos',rows:records}];
  const groups=new Map();
  for(const row of records){
    const date=dateKey(row),year=yearKey(row);
    const key=grouping==='year'?year:date?date.slice(0,grouping==='day'?10:7):`unknown-${year}`;
    if(!groups.has(key)){
      let label=key;
      if(grouping!=='year'&&date){const [y,m,d]=date.split('-').map(Number);label=new Intl.DateTimeFormat(undefined,grouping==='day'?{year:'numeric',month:'long',day:'numeric'}:{year:'numeric',month:'long'}).format(new Date(y,m-1,d,12));}
      if(key.startsWith('unknown')||key==='Unknown')label=year==='Unknown'?'Unknown date':`${year} · exact date unknown`;
      groups.set(key,{key,label,rows:[]});
    }
    groups.get(key).rows.push(row);
  }
  return [...groups.values()].sort((a,b)=>{
    const missing=k=>k==='Unknown'||k==='unknown-Unknown';
    if(missing(a.key)!==missing(b.key))return missing(a.key)?1:-1;
    const unknown=k=>k.startsWith('unknown')||k==='Unknown';
    if(unknown(a.key)!==unknown(b.key))return unknown(a.key)?1:-1;
    return order==='oldest'?a.key.localeCompare(b.key):b.key.localeCompare(a.key);
  });
}
export function needsReview(record) {
  return record.Approved !== 'yes' || ['Low', 'Unknown'].includes(record.DateConfidence)
    || ['Low', 'Unknown'].includes(record.ClassificationConfidence) || Boolean(record.DateConflict || record.ClassificationConflicts);
}
export function filterRecords(records, filters) {
  const query = (filters.query || '').toLowerCase().trim();
  return records.filter(r => (!filters.year || yearKey(r) === filters.year)
    && (filters.status === 'trash' ? r.Trashed : !r.Trashed)
    && (!filters.tag || (r.TagIds || []).includes(filters.tag))
    && (!filters.type || mediaType(r) === filters.type)
    && (!filters.audio || (filters.audio === 'silent' ? r.AudioCodec === 'none' : r.AudioCodec && r.AudioCodec !== 'none'))
    && (!filters.minDuration || Number(r.Duration) >= Number(filters.minDuration))
    && (!filters.maxDuration || (r.Duration != null && Number(r.Duration) <= Number(filters.maxDuration)))
    && (!filters.minSize || Number(r.FileSize) >= Number(filters.minSize) * 1024 ** 2)
    && (!filters.maxSize || (r.FileSize != null && Number(r.FileSize) <= Number(filters.maxSize) * 1024 ** 2))
    && (!filters.folder || r.CustomFolderId === filters.folder)
    && (!filters.category || (r.Classification || 'Unknown') === filters.category)
    && (!filters.review || needsReview(r))
    && (!query || [r.OriginalFilename, r.CurrentPath, r.ProposedDestination, r.Classification, ...(r.Tags || [])].join(' ').toLowerCase().includes(query)))
    .sort((a, b) => {
      const [field, direction] = (filters.order || 'newest').split('-');
      const keys = { duration:'Duration', size:'FileSize', fps:'FrameRate', bitrate:'BitRate' };
      if (keys[field] || field === 'resolution') {
        const value = r => field === 'resolution' ? (r.Width && r.Height ? r.Width * r.Height : null) : r[keys[field]];
        const av = value(a), bv = value(b);
        if (av == null || av === '') return bv == null || bv === '' ? 0 : 1;
        if (bv == null || bv === '') return -1;
        return (direction === 'asc' ? 1 : -1) * (Number(av) - Number(bv)) || a.OriginalFilename.localeCompare(b.OriginalFilename);
      }
      if (field === 'name' || field === 'type') return (direction === 'desc' ? -1 : 1) * String(field === 'type' ? mediaType(a) : a.OriginalFilename).localeCompare(String(field === 'type' ? mediaType(b) : b.OriginalFilename));
      const ad = dateKey(a), bd = dateKey(b);
      if (!ad && bd) return 1;
      if (ad && !bd) return -1;
      return (filters.order === 'oldest' ? ad.localeCompare(bd) : bd.localeCompare(ad))
        || String(a.OriginalFilename).localeCompare(String(b.OriginalFilename));
    });
}
export function mediaType(record) { return `${(record.Extension || '.mp4').replace('.', '').toUpperCase()} · ${record.VideoCodec || 'Unknown codec'}`; }
export function dateLabel(record) {
  const key = dateKey(record);
  return key ? new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : yearKey(record) !== 'Unknown' ? `${yearKey(record)} · Exact date unknown` : 'Date unknown';
}
export function bytes(value) {
  if (!value) return '0 B';
  const unit = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** unit).toFixed(unit ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}

export function durationLabel(seconds) {
  const rounded = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor(rounded % 3600 / 60);
  const remainder = rounded % 60;
  return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

export function duplicateGroups(records, { query = '', year = '', order = 'newest' } = {}) {
  const byGroup = new Map();
  for (const row of records) {
    if (row.Trashed || !/^[a-f\d]{64}$/i.test(row.SHA256 || '')) continue;
    const key = row.SHA256.toUpperCase();
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(row);
  }
  const search = query.toLowerCase().trim();
  const groups = [...byGroup].filter(([, copies]) => copies.length > 1).map(([id, copies]) => {
    copies.sort((a, b) => Number(b.DuplicatePrimary === 'yes') - Number(a.DuplicatePrimary === 'yes')
      || String(a.CurrentPath || a.OriginalPath).localeCompare(String(b.CurrentPath || b.OriginalPath)));
    return { id: copies[0].DuplicateGroup || id.slice(0, 12), sha256: id, copies, representative: copies[0] };
  }).filter(group => (!year || yearKey(group.representative) === year)
    && (!search || group.copies.some(row => [row.OriginalFilename, row.CurrentPath, row.OriginalPath, group.id].join(' ').toLowerCase().includes(search))));
  const sorted = filterRecords(groups.map(group => group.representative), { query: '', year: '', category: '', review: false, order });
  const byRepresentative = new Map(groups.map(group => [group.representative, group]));
  return sorted.map(row => byRepresentative.get(row));
}
