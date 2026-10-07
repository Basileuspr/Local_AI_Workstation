import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,expect,it,vi} from 'vitest';
import VisualReview from '../../src/components/VisualReview';
import FaceClassification from '../../src/components/FaceClassification';
import ReviewTags,{tagList} from '../../src/components/ReviewTags';
import PersonNameEditor from '../../src/components/PersonNameEditor';
import {reviewRequest,reviewImageUrl} from '../../src/visualReview';
afterEach(()=>vi.unstubAllGlobals());
it('uses saved name tags as person suggestions and lets an unchanged duplicate name be combined',()=>{
  const html=renderToStaticMarkup(<PersonNameEditor personId="p1" name="Alex" label="Person name" names={['Trip','Alex','Alex','Jordan']} canMerge act={()=>{}} onRename={()=>{}}/>);
  expect(html).toContain('<datalist');
  expect(html).toContain('list=');
  expect(html).toContain('<option value="Jordan"');
  expect(html.match(/<datalist[^>]*>(.*?)<\/datalist>/)[1].match(/<option value="Alex"/g)).toHaveLength(1);
  expect(html).toContain('<button type="submit">Save name</button>');
});
it('gives every detected face its own name field without selecting the thumbnail first',()=>{
  const faces=[{id:'f1',person_id:'p1',name:'Person 1'},{id:'f2',person_id:'p2',name:'Person 2'}];
  const html=renderToStaticMarkup(<FaceClassification classification={{faces,faces_done:true}} act={()=>{}} onRename={()=>{}} onCorrect={()=>{}}/>);
  expect(html).toContain('aria-label="Face 1 name"');
  expect(html).toContain('aria-label="Face 2 name"');
  expect(html.match(/>Save name<\/button>/g)).toHaveLength(2);
  expect(html).toContain('aria-label="Edit face 1: Person 1"');
  expect(html).toContain('aria-label="Edit face 2: Person 2"');
});
it('offers named saved tags and normal tag creation without requiring classified faces',()=>{
  const html=renderToStaticMarkup(<ReviewTags value={['Keep']} available={['Trip','Alex','Trip','Last, First']} onChange={()=>{}} onApply={()=>{}}/>);
  expect(html).toContain('aria-label="Existing review tag"');
  expect(html).toContain('<option value="Alex">Alex</option>');
  expect(html).toContain('Create &amp; apply tag');
  expect(html).toContain('<option value="Last, First">Last, First</option>');
  expect(html.indexOf('value="Alex"')).toBeLessThan(html.indexOf('value="Trip"'));
  expect(tagList('Keep, Trip, keep,  New name ,Trip')).toEqual(['Keep','Trip','New name']);
});
it('keeps classification collapsed and never starts inference by opening a manager',()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  const output=renderToStaticMarkup(<VisualReview source="image-manager" ids={['one']}/>);
  expect(output).toContain('People &amp; scenes');expect(output).not.toContain('Classify selection');expect(fetch).not.toHaveBeenCalled();
});
it('uses the authenticated review route for explicit classification',async()=>{
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'job'})});vi.stubGlobal('fetch',fetch);
  await reviewRequest('/classify',{source:'image-manager',ids:['one'],faces:true,model:''});
  expect(fetch.mock.calls[0][0]).toContain('/visual-review/classify');expect(JSON.parse(fetch.mock.calls[0][1].body).ids).toEqual(['one']);
});
it('encodes source IDs and reports model readiness errors',async()=>{
  expect(reviewImageUrl('image-manager','one/two')).toContain('one%2Ftwo/thumbnail');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,json:async()=>({detail:'Install local face models'})}));
  await expect(reviewRequest('/classify',{})).rejects.toThrow('Install local face models');
});
