import test from 'node:test';
import assert from 'node:assert/strict';
import { availableRecords, timelineGroups, dateKey, duplicateGroups, durationLabel, filterRecords, yearKey, needsReview } from '../frontend/library.js';

test('missing files are excluded before duplicate grouping, filters and library counts', () => {
  const missing = { RecordId:'missing', Available:false, SHA256:'a'.repeat(64), DuplicatePrimary:'yes', OriginalFilename:'gone.mp4' };
  const present = { ...missing, RecordId:'present', Available:true, DuplicatePrimary:'no', OriginalFilename:'here.mp4' };
  const records = [missing,present];
  assert.deepEqual(availableRecords(records),[present]);
  for (const showDuplicates of [false,true]) assert.deepEqual(filterRecords(records,{showDuplicates}),[present]);
  assert.deepEqual(duplicateGroups(records),[]);
  assert.deepEqual(filterRecords(records,{query:'gone.mp4'}),[]);
  assert.deepEqual(filterRecords([{...missing,Trashed:true}],{status:'trash'}),[]);
  missing.Available = true;
  assert.equal(filterRecords(records,{showDuplicates:true}).length,2);
  assert.equal(duplicateGroups(records).length,1);
});

test('normal library hides extra verified copies while retaining primary, unique and unhashed files', () => {
  const primary = { RecordId:'primary', OriginalFilename:'original.mp4', CurrentPath:'Z:/original.mp4', SHA256:'a'.repeat(64), DuplicatePrimary:'yes' };
  const extra = { ...primary, RecordId:'extra', OriginalFilename:'copy.mp4', CurrentPath:'A:/copy.mp4', DuplicatePrimary:'no', SHA256:'A'.repeat(64) };
  const unique = { RecordId:'unique', OriginalFilename:'other.mp4', SHA256:'b'.repeat(64) };
  const unknown = { RecordId:'unknown', OriginalFilename:'unhashed.mp4', SHA256:'' };
  const records = [extra,primary,unique,unknown];
  const hidden = filterRecords(records,{showDuplicates:false});
  assert.equal(hidden.length,3);
  assert.ok(hidden.includes(primary));
  assert.ok(!hidden.includes(extra));
  assert.equal(filterRecords(records,{showDuplicates:true}).length,4);
  assert.equal(records.length,4);
  assert.equal(duplicateGroups(records)[0].copies.length,2);
  assert.deepEqual(filterRecords(records,{showDuplicates:false,query:'copy.mp4'}),[extra]);
});

test('hidden duplicate view keeps a surviving copy and never conceals recoverable Trash', () => {
  const primary = { OriginalFilename:'first.mp4', CurrentPath:'a', SHA256:'a'.repeat(64), DuplicatePrimary:'yes', Trashed:true };
  const extra = { ...primary, OriginalFilename:'second.mp4', CurrentPath:'b', DuplicatePrimary:'no', Trashed:false };
  assert.deepEqual(filterRecords([primary,extra],{showDuplicates:false}),[extra]);
  assert.equal(filterRecords([primary,{...extra,Trashed:true}],{showDuplicates:false,status:'trash'}).length,2);
});

const rows = [
  { OriginalFilename: 'camera.mp4', ResolvedDate: '2024-01-01T23:30:00-07:00', Classification: 'Camera Recording', Approved: 'yes', DateConfidence: 'High', ClassificationConfidence: 'High' },
  { OriginalFilename: 'download.mp4', ResolvedDate: '2020-05-03', Classification: 'Downloaded Video', Approved: 'yes', DateConfidence: 'Low' },
  { OriginalFilename: 'undated.mp4', ResolvedYear: '2019', Classification: 'Camera Recording', Approved: 'no' },
  { OriginalFilename: 'unknown.mp4', Classification: 'Unknown', Approved: 'no' },
];
const filters = { query: '', year: '', category: '', review: false, order: 'newest' };
test('duration labels handle seconds, minutes, hours, and missing estimates', () => {
  assert.equal(durationLabel(0), '0s');
  assert.equal(durationLabel(72), '1m 12s');
  assert.equal(durationLabel(3660), '1h 1m');
  assert.equal(durationLabel(null), '0s');
});
test('groups by recorded calendar date without timezone shifting', () => {
  assert.equal(dateKey(rows[0]), '2024-01-01');
  assert.equal(yearKey(rows[2]), '2019');
  assert.equal(yearKey(rows[3]), 'Unknown');
});
test('all categories share one date ordering and unknown dates remain reachable', () => {
  assert.deepEqual(filterRecords(rows, filters).map(r => r.OriginalFilename), ['camera.mp4', 'download.mp4', 'undated.mp4', 'unknown.mp4']);
  assert.equal(filterRecords(rows, { ...filters, order: 'oldest' })[0].OriginalFilename, 'download.mp4');
  assert.deepEqual(filterRecords(rows, { ...filters, year: 'Unknown' }), [rows[3]]);
});
test('filters compose without removing unknown or low-confidence records globally', () => {
  assert.deepEqual(filterRecords(rows, { ...filters, query: 'DOWNLOAD', review: true }), [rows[1]]);
  assert.deepEqual(filterRecords(rows, { ...filters, category: 'Camera Recording', year: '2019' }), [rows[2]]);
  assert.equal(needsReview(rows[0]), false);
  assert.equal(needsReview({ ...rows[0], DateConflict: 'Metadata disagrees' }), true);
  assert.deepEqual(filterRecords([{ ...rows[0], Classification: '', OriginalFilename: 'TikTok.mp4' }], { ...filters, category: 'TikTok / Social Media' }), []);
  assert.equal(filterRecords([{ ...rows[0], Classification: '' }], { ...filters, category: 'Unknown' }).length, 1);
  const assigned = { ...rows[0], CustomFolderId: 'favorites' };
  assert.deepEqual(filterRecords([assigned, rows[1]], { ...filters, folder: 'favorites' }), [assigned]);
  assert.deepEqual(filterRecords([assigned], { ...filters, folder: 'favorites', year: '2020' }), []);
});

test('duplicate searches keep every copy together and exclude unique files', () => {
  const first = { ...rows[0], DuplicateGroup: 'A', SHA256: 'a'.repeat(64), DuplicatePrimary: 'yes', CurrentPath: '/camera/original.mp4' };
  const second = { ...first, DuplicatePrimary: 'no', CurrentPath: '/backup/special-copy.mp4' };
  const groups = duplicateGroups([rows[1], second, first], { query: 'special-copy' });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].copies, [first, second]);
  assert.deepEqual(duplicateGroups([{ ...first, DuplicateCount: 2 }]), []);
});

test('duplicate groups sort by date and preserve unknown-date access', () => {
  const duplicateRows = [rows[0], rows[1], rows[3]].flatMap((row, index) => [
    { ...row, DuplicateGroup: String(index), SHA256: String(index).repeat(64), DuplicatePrimary: 'yes' },
    { ...row, DuplicateGroup: String(index), SHA256: String(index).repeat(64), DuplicatePrimary: 'no' },
  ]);
  assert.deepEqual(duplicateGroups(duplicateRows).map(g => g.id), ['0', '1', '2']);
  assert.deepEqual(duplicateGroups(duplicateRows, { order: 'oldest' }).map(g => g.id), ['1', '0', '2']);
  assert.deepEqual(duplicateGroups(duplicateRows, { year: 'Unknown' }).map(g => g.id), ['2']);
});


test('hash identity, never names or duplicate labels, decides membership',()=>{
 const sameName=[{OriginalFilename:'same.mp4',DuplicateGroup:'fake',SHA256:'a'.repeat(64)},{OriginalFilename:'same.mp4',DuplicateGroup:'fake',SHA256:'b'.repeat(64)}];
 assert.equal(duplicateGroups(sameName).length,0);
 const sameBytes=[sameName[0],{...sameName[1],OriginalFilename:'different.mp4',SHA256:'a'.repeat(64)}];
 assert.equal(duplicateGroups(sameBytes).length,1);
 assert.equal(duplicateGroups([sameBytes[0],{...sameBytes[1],Trashed:true}]).length,0);
});
test('numeric sorting crosses dates, keeps unknown values last and composes with custom filters',()=>{
 const clips=[{OriginalFilename:'a.mp4',Duration:60,FileSize:1048576,FrameRate:30,Width:640,Height:480,VideoCodec:'h264',TagIds:['t'],Tags:['Travel'],AudioCodec:'none',ResolvedDate:'2024-01-01'},
 {OriginalFilename:'b.mp4',Duration:5,FileSize:2097152,FrameRate:60,Width:1280,Height:720,VideoCodec:'hevc',ResolvedDate:'2020-01-01'},
 {OriginalFilename:'unknown.mp4',Duration:null,Trashed:false}];
 assert.deepEqual(filterRecords(clips,{...filters,order:'duration-asc'}).map(x=>x.OriginalFilename),['b.mp4','a.mp4','unknown.mp4']);
 for(const key of ['size','fps','resolution'])assert.equal(filterRecords(clips,{...filters,order:key+'-desc'})[0].OriginalFilename,'b.mp4');
 assert.deepEqual(filterRecords(clips,{...filters,tag:'t',query:'travel',minDuration:'30',maxSize:'1.1',type:'MP4 · h264',audio:'silent'}),[clips[0]]);
 assert.deepEqual(filterRecords([{...clips[0],Trashed:true}],filters),[]);
 assert.equal(filterRecords([{...clips[0],Trashed:true}],{...filters,status:'trash'}).length,1);
});


test('date sections retain unknown dates and within-section order; no groups keeps global ordering',()=>{
 const sameMonth={...rows[0],OriginalFilename:'second.mp4',ResolvedDate:'2024-01-12'};
 const input=[sameMonth,...rows];
 assert.deepEqual(timelineGroups(input,'month').map(g=>g.key),['2024-01','2020-05','unknown-2019','unknown-Unknown']);
 assert.deepEqual(timelineGroups(input,'month')[0].rows,[sameMonth,rows[0]]);
 assert.deepEqual(timelineGroups(input,'year','oldest').map(g=>g.key),['2019','2020','2024','Unknown']);
 assert.equal(timelineGroups(input,'day').length,5);
 assert.deepEqual(timelineGroups(input,'none')[0].rows,input);
});
