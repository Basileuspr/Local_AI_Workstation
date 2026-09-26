import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCSV, csvContext, compareCSVValues } from "../../src/csv";

describe("CSV parsing and context", () => {
  it("preserves escaped quotes, newlines, empty fields, Unicode and formula text", () => {
    const csv=parseCSV('\uFEFFName,Note,Value\r\nZoë,"a, b\nsaid ""hello""",=1+2\r\nNext,,0\r\n');
    expect(csv.rows[0].values).toEqual(['Zoë','a, b\nsaid "hello"','=1+2']);
    expect(csv.rows[1].values).toEqual(['Next','','0']);
    expect(csv.rows).toHaveLength(2);
  });
  it("rejects malformed input instead of silently joining records",()=>{
    expect(()=>parseCSV('a,b\n"unfinished')).toThrow("closing quote");
    expect(()=>parseCSV('a,b\n"one"bad,two')).toThrow("Malformed");
  });
  it("only supplies selected columns/rows and clearly discloses truncation",()=>{
    const data=parseCSV('Name,Secret\nOne,private\nTwo,hidden');
    const result=csvContext('test.csv',data.headers,data.rows,100,[0],12);
    expect(result).not.toContain('private');expect(result).not.toContain('hidden');
    expect(result).toContain('File has 100');expect(result).toContain('truncated sample');
  });
  it("accepts tab and semicolon separators",()=>{
    expect(parseCSV('a\tb\n1\t2','\t').rows[0].values).toEqual(['1','2']);
    expect(parseCSV('a;b\n1;2',';').headers).toEqual(['a','b']);
  });
  it("sorts signed decimal values numerically",()=>{
    expect(['12','-3','-20','2.5'].sort(compareCSVValues)).toEqual(['-20','-3','2.5','12']);
  });
  it("bounds headers even in files without data rows",()=>{
    expect(()=>csvContext('headers.csv',['x'.repeat(14001)],[],0,[0])).toThrow('headers are too large');
  });
});

describe("canvas edits",()=>{
  let canvas;
  beforeEach(async()=>{vi.resetModules();const values=new Map();vi.stubGlobal('localStorage',{getItem:key=>values.get(key)||null,setItem:(key,v)=>values.set(key,v)});canvas=await import('../../src/canvasStore');});
  const object={id:'one',type:'rect',x:30,y:40,width:100,height:80,text:'',color:'#234878'};
  it("supports undo/redo for manual and chat changes",()=>{
    canvas.commitCanvas([object]);const context=canvas.canvasContext();
    canvas.applyCanvasEdit({revision:context.revision,operations:[{op:'update',id:'one',item:{...object,x:200}}]});
    expect(canvas.getCanvas().objects[0].x).toBe(200);
    canvas.undoCanvas();expect(canvas.getCanvas().objects[0].x).toBe(30);
    canvas.redoCanvas();expect(canvas.getCanvas().objects[0].x).toBe(200);
  });
  it("preserves concurrent edits and rejects out-of-selection mutations atomically",()=>{
    canvas.commitCanvas([object,{...object,id:'two'}]);const context=canvas.canvasContext();
    canvas.commitCanvas([{...object,x:90},{...object,id:'two'}]);
    expect(()=>canvas.applyCanvasEdit({revision:context.revision,operations:[{op:'remove',id:'one'}]})).toThrow('changed while');
    canvas.selectCanvas(['one']);const snapshot=canvas.canvasContext();expect(snapshot.objects.map(o=>o.id)).toEqual(['one']);
    expect(()=>canvas.applyCanvasEdit({revision:snapshot.revision,operations:[{op:'remove',id:'two'}]})).toThrow('outside');
    expect(canvas.getCanvas().objects).toHaveLength(2);
  });
});
