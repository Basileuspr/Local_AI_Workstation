import {inflateSync} from 'three/addons/libs/fflate.module.js';
import {readZipDirectory} from './limits';

const crcTable=new Uint32Array(256);
for(let i=0;i<256;i++){let c=i;for(let bit=0;bit<8;bit++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;crcTable[i]=c;}
function crc32(bytes){let value=0xffffffff;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;}

// Decode only model and relationship parts from the validated directory. This
// handles per-entry ZIP64 sentinel fields independently (unlike unzipSync), and
// never allocates based on unchecked archive metadata or writes extracted files.
export function readModelParts(buffer) {
  const {files}=readZipDirectory(buffer),parts=Object.create(null);
  for(const entry of files) {
    if(!/\.model$|\.rels$/i.test(entry.name))continue;
    const source=new Uint8Array(buffer,entry.dataOffset,entry.packed);
    if(![0,8].includes(entry.method))throw Error(`Unsupported compression method ${entry.method} in a 3MF model part.`);
    const data=entry.method===0?source:inflateSync(source,{out:new Uint8Array(entry.unpacked)});
    if(data.length!==entry.unpacked||crc32(data)!==entry.crc)throw Error('A 3MF model part is corrupt or truncated (size/checksum mismatch).');
    parts[entry.name]=data;
  }
  return parts;
}
