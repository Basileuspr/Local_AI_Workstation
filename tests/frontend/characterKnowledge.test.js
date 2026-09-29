import {expect,it} from 'vitest';
import {characterDocumentName,characterIdFromDocument,characterNoteFile} from '../../src/characterKnowledge';
const id = 'a'.repeat(32), profile = {id,name:'Mara',notes:'Explorer\nLoves tea.',tags:['lead'],members:[{state:'accepted',dataset_id:'dataset',face_id:'face'},{state:'rejected',dataset_id:'private',face_id:'rejected'}],centroid:{vector:[12345]}};
it('creates a readable document with a bounded filename and validated character pointer',() => {
  const filename = characterDocumentName(id,'Mara/[[lead]]');
  expect(filename).toContain('Mara');expect(filename).not.toMatch(/[\/\[\]]/);
  expect(characterIdFromDocument(filename)).toBe(id);
  for (const name of ['../Character-'+id+'.md','Character-../arbitrary.md','ordinary.md']) expect(characterIdFromDocument(name)).toBe('');
  expect(() => characterDocumentName('../bad')).toThrow();
});
it('indexes saved notes and reference IDs without embeddings or rejected faces',async() => {
  const file = characterNoteFile(profile), text = await file.text();
  expect(text).toContain('# Mara');expect(text).toContain('Explorer\nLoves tea.');expect(text).toContain('face_bank/'+id+'.json');expect(text).toContain('Dataset dataset; face face');
  expect(text).not.toContain('12345');expect(text).not.toContain('rejected');
});
it('keeps the original document identity and graph links when a character is renamed',async() => {
  const original = characterNoteFile(profile);
  const updated = characterNoteFile({...profile,name:'Mara Renamed'},original.name);
  expect(updated.name).toBe(original.name);expect(await updated.text()).toContain('# Mara Renamed');
  expect(() => characterNoteFile(profile,characterDocumentName('b'.repeat(32)))).toThrow('does not match');
});
it('includes biography and resource descriptions without serializing binary metadata or paths',async()=>{
  const text=await characterNoteFile({...profile,bio:'A patient explorer.',resources:[{kind:'lora_project',target_id:'project-id',note:'Identity adapter',available:true,resource:{name:'Explorer',path:'private-path'}},{kind:'file',target_id:'file-id',available:false}]}).text();
  expect(text).toContain('A patient explorer.');expect(text).toContain('Identity adapter');expect(text).toContain('project-id');expect(text).toContain('(unavailable)');expect(text).not.toContain('private-path');
});
it('connects explicitly linked Knowledge documents through the existing wiki-link graph',async()=>{
  const text=await characterNoteFile({...profile,resources:[{kind:'knowledge',target_id:'doc-id',available:true,resource:{name:'Background.md'}}]}).text();
  expect(text).toContain('[[Background.md]]');
});
