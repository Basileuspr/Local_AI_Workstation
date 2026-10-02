// Convert a small standard ZIP into a forced ZIP64 fixture without recompressing
// its file data. Tests cover optional footer and independent sentinel fields.
export function asZip64(buffer,{fields=['unpacked','packed','offset'],footer=true,sentinels=true}={}) {
  const source=new Uint8Array(buffer),view=new DataView(buffer),end=buffer.byteLength-22;
  const count=view.getUint16(end+10,true),start=view.getUint32(end+16,true),chunks=[];let position=start;
  for(let i=0;i<count;i++) {
    const name=view.getUint16(position+28,true),extra=view.getUint16(position+30,true),comment=view.getUint16(position+32,true);
    const header=source.slice(position,position+46),h=new DataView(header.buffer),field=new Uint8Array(4+8*fields.length),f=new DataView(field.buffer);
    f.setUint16(0,1,true);f.setUint16(2,8*fields.length,true);let cursor=4;
    for(const [key,offset] of [['unpacked',24],['packed',20],['offset',42]])if(fields.includes(key)){f.setBigUint64(cursor,BigInt(h.getUint32(offset,true)),true);cursor+=8;h.setUint32(offset,0xffffffff,true);}
    h.setUint16(6,45,true);h.setUint16(30,extra+field.length,true);
    chunks.push(header,source.slice(position+46,position+46+name+extra),field,source.slice(position+46+name+extra,position+46+name+extra+comment));
    position+=46+name+extra+comment;
  }
  const size=chunks.reduce((sum,chunk)=>sum+chunk.length,0),footerOffset=start+size;
  const result=new Uint8Array(footerOffset+(footer?76:0)+22),out=new DataView(result.buffer);result.set(source.subarray(0,start));
  let cursor=start;for(const chunk of chunks){result.set(chunk,cursor);cursor+=chunk.length;}
  if(footer) {
    out.setUint32(cursor,0x06064b50,true);out.setBigUint64(cursor+4,44n,true);out.setUint16(cursor+12,45,true);out.setUint16(cursor+14,45,true);
    out.setBigUint64(cursor+24,BigInt(count),true);out.setBigUint64(cursor+32,BigInt(count),true);out.setBigUint64(cursor+40,BigInt(size),true);out.setBigUint64(cursor+48,BigInt(start),true);cursor+=56;
    out.setUint32(cursor,0x07064b50,true);out.setBigUint64(cursor+8,BigInt(footerOffset),true);out.setUint32(cursor+16,1,true);cursor+=20;
  }
  result.set(source.subarray(end),cursor);out.setUint32(cursor+12,size,true);
  if(footer&&sentinels){out.setUint16(cursor+8,65535,true);out.setUint16(cursor+10,65535,true);out.setUint32(cursor+12,0xffffffff,true);out.setUint32(cursor+16,0xffffffff,true);}
  return result.buffer;
}
