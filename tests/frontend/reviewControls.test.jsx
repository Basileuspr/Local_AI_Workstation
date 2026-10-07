import React from 'react';
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import BulkActions from '../../src/components/BulkActions';
import ReviewWorkflow from '../../src/components/ReviewWorkflow';
import ReviewFieldsEditor from '../../src/components/ReviewFieldsEditor';

it('shows selection tools without action walls until something is selected',()=>{
  const actions=[{label:'Like',primary:true,onClick:vi.fn()},{label:'Add to favorites',onClick:vi.fn()}];
  const selection={enabled:true,items:[],clear:vi.fn(),end:vi.fn(),selectAll:vi.fn()};
  const empty=renderToStaticMarkup(<BulkActions compact selection={selection} items={[{id:'a'}]} label="images" actions={actions}/>);
  expect(empty).toContain('Select all');
  expect(empty).not.toContain('More actions');
  expect(empty).not.toContain('Add to favorites');
  const selected=renderToStaticMarkup(<BulkActions compact selection={{...selection,items:[{id:'a'}]}} items={[{id:'a'}]} label="images" actions={actions}/>);
  expect(selected).toContain('>Like</button>');
  expect(selected).toContain('>Add to favorites</option>');
  expect(selected).not.toContain('>Add to favorites</button>');
});

it('keeps saved API states but uses familiar review labels',()=>{
  const html=renderToStaticMarkup(<ReviewFieldsEditor value={{review_status:'accepted',favorite:true}} onChange={()=>{}}/>);
  expect(html).toContain('value="accepted" selected="">Liked</option>');
  expect(html).toContain('value="rejected">Disliked</option>');
  expect(html).toContain('Reviewed (no rating)');
  expect(html).not.toContain('>Accepted<');
});

it('omits bulk actions and empty pagination in the organization view',()=>{
  const html=renderToStaticMarkup(<ReviewWorkflow embedded active={false}/>);
  expect(html).not.toContain('Batch review action');
  expect(html).not.toContain('Favorite selected');
  expect(html).not.toContain('Previous page');
  expect(html).toContain('Copy or move files');
});
