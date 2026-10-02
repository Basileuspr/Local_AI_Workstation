export const MAX_FILE_BYTES = 512 * 1024 * 1024;
export const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
export const MAX_TRIANGLES = 8_000_000;
export const WARN_TRIANGLES = 1_000_000;
export const WARN_FILE_BYTES = 50 * 1024 * 1024;
export function modelType(name) {return String(name).split('.').pop().toLowerCase();}
export function validateFile(file) {
  if(!['stl','3mf'].includes(modelType(file.name)))throw Error('Choose an STL or 3MF file.');
  if(!file.size)throw Error('This file is empty.');
  if(file.size>MAX_FILE_BYTES)throw Error('This file exceeds the 512 MB safety limit. Export a smaller preview first.');
}
export function checkTriangles(count) {
  if(!Number.isSafeInteger(count) || count<1)throw Error('No model triangles were found.');
  if(count>MAX_TRIANGLES)throw Error('This model exceeds the 8 million triangle safety limit. Export a reduced-detail preview first.');
}
// ZIP64 is an archive encoding, not necessarily a large file. Read its 64-bit
// fields first, then apply the same allocation limits as ordinary ZIP archives.
export function readZipDirectory(buffer) {
  const v=new DataView(buffer);let end=-1;
  const requireRange=(start,size,limit=buffer.byteLength)=>{
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(size)||start<0||size<0||start>limit-size)throw Error('Invalid or truncated 3MF ZIP archive.');
  };
  const u64=offset=>{requireRange(offset,8);const n=v.getBigUint64(offset,true);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('ZIP64 value exceeds the supported archive size.');return Number(n);};
  for(let p=buffer.byteLength-22;p>=Math.max(0,buffer.byteLength-65557);p--)
    if(v.getUint32(p,true)===0x06054b50 && p+22+v.getUint16(p+20,true)===buffer.byteLength){end=p;break;}
  if(end<0)throw Error('Invalid 3MF ZIP archive.');
  let count=v.getUint16(end+10,true),size=v.getUint32(end+12,true),offset=v.getUint32(end+16,true),footer=end,total=0;
  const diskCount=v.getUint16(end+8,true);
  const zip64=end>=20 && v.getUint32(end-20,true)===0x07064b50;
  if([v.getUint16(end+4,true),v.getUint16(end+6,true)].some(d=>d!==0&&!(zip64&&d===65535)) || (count!==diskCount && !(zip64&&(count===65535||diskCount===65535))))throw Error('Split archives are not supported. Open a single-file 3MF export.');
  if(zip64) {
    const locator=end-20;
    if(v.getUint32(locator+4,true)!==0||v.getUint32(locator+16,true)!==1)throw Error('Split ZIP64 archives are not supported.');
    footer=u64(locator+8);requireRange(footer,56,locator);
    if(v.getUint32(footer,true)!==0x06064b50)throw Error('Invalid ZIP64 directory record.');
    const recordSize=u64(footer+4);requireRange(footer+12,recordSize,locator);
    if(recordSize<44||footer+12+recordSize!==locator)throw Error('Invalid ZIP64 directory size.');
    if(v.getUint32(footer+16,true)||v.getUint32(footer+20,true)||u64(footer+24)!==u64(footer+32))throw Error('Split ZIP64 archives are not supported.');
    const actualCount=u64(footer+32),actualSize=u64(footer+40),actualOffset=u64(footer+48);
    if((count!==65535&&count!==actualCount)||(diskCount!==65535&&diskCount!==actualCount)||(size!==0xffffffff&&size!==actualSize)||(offset!==0xffffffff&&offset!==actualOffset))throw Error('Inconsistent ZIP64 directory fields.');
    count=actualCount;size=actualSize;offset=actualOffset;
  } else if(count===65535||size===0xffffffff||offset===0xffffffff)throw Error('The ZIP64 directory record is missing.');
  if(count>4096)throw Error(`This archive contains ${count.toLocaleString()} entries, exceeding the 4,096-entry preview limit.`);
  requireRange(offset,size,footer);const directoryEnd=offset+size,directoryStart=offset;
  const signatureEnd=(start,limit)=>{requireRange(start,6,limit);if(v.getUint32(start,true)!==0x05054b50)throw Error('Invalid archive directory layout.');const stop=start+6+v.getUint16(start+4,true);if(stop!==limit)throw Error('Invalid archive directory signature.');};
  if(directoryEnd!==footer)signatureEnd(directoryEnd,footer);
  const names=new Set(),files=[];
  for(let i=0;i<count;i++) {
    requireRange(offset,46,directoryEnd);
    if(v.getUint32(offset,true)!==0x02014b50)throw Error('Invalid archive directory.');
    let unpacked=v.getUint32(offset+24,true),packed=v.getUint32(offset+20,true),local=v.getUint32(offset+42,true),disk=v.getUint16(offset+34,true);
    const n=v.getUint16(offset+28,true),extra=v.getUint16(offset+30,true),comment=v.getUint16(offset+32,true);
    requireRange(offset+46,n+extra+comment,directoryEnd);
    const name=new TextDecoder().decode(new Uint8Array(buffer,offset+46,n));
    let extended=null;
    for(let p=offset+46+n,stop=p+extra;p<stop;) {
      requireRange(p,4,stop);const length=v.getUint16(p+2,true);requireRange(p+4,length,stop);
      if(v.getUint16(p,true)===1){if(extended)throw Error('Duplicate ZIP64 extra field.');extended={start:p+4,end:p+4+length};}p+=4+length;
    }
    const next64=()=>{if(!extended)throw Error('Missing ZIP64 entry sizes.');requireRange(extended.start,8,extended.end);const result=u64(extended.start);extended.start+=8;return result;};
    if(unpacked===0xffffffff)unpacked=next64();
    if(packed===0xffffffff)packed=next64();
    if(local===0xffffffff)local=next64();
    if(disk===65535){if(!extended)throw Error('Missing ZIP64 disk field.');requireRange(extended.start,4,extended.end);disk=v.getUint32(extended.start,true);}
    if(disk)throw Error('Split archive entries are not supported.');
    const flags=v.getUint16(offset+8,true),method=v.getUint16(offset+10,true);
    if(flags & (1|64))throw Error('Encrypted 3MF archives are not supported.');
    if(names.has(name) || /(^|[\\/])\.\.([\\/]|$)/.test(name) || name.startsWith('/') || name.includes('\\') || name.includes('\0'))throw Error('Unsupported or unsafe archive entry.');
    names.add(name);total+=unpacked;
    if(total>MAX_EXPANDED_BYTES)throw Error('Expanded 3MF exceeds the 256 MB safety limit.');
    if(/\.model$/i.test(name) && unpacked>128*1024*1024)throw Error('A 3MF XML model exceeds the 128 MB safety limit.');
    requireRange(local,30,directoryStart);
    if(v.getUint32(local,true)!==0x04034b50||v.getUint16(local+8,true)!==method||v.getUint16(local+6,true)!==flags)throw Error('Invalid ZIP local entry header.');
    const localName=v.getUint16(local+26,true),localExtra=v.getUint16(local+28,true);
    requireRange(local+30,localName+localExtra,directoryStart);
    if(localName!==n || new Uint8Array(buffer,local+30,n).some((byte,index)=>byte!==v.getUint8(offset+46+index)))throw Error('ZIP entry names do not match.');
    const dataOffset=local+30+localName+localExtra;requireRange(dataOffset,packed,directoryStart);
    if(method===0&&packed!==unpacked)throw Error('Invalid stored ZIP entry size.');
    files.push({name,method,packed,unpacked,dataOffset,crc:v.getUint32(offset+16,true)});
    offset+=46+n+extra+comment;
  }
  if(offset!==directoryEnd)signatureEnd(offset,directoryEnd);
  return {expandedBytes:total,entries:count,files,zip64};
}
export function inspectZip(buffer) {
  const {expandedBytes,entries}=readZipDirectory(buffer);return {expandedBytes,entries};
}
