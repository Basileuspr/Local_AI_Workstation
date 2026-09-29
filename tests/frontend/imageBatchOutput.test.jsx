import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ImageBatchOutput from "../../src/components/ImageBatchOutput";
const queue=vi.hoisted(()=>({jobs:[]}));
vi.mock('../../src/components/PromptQueue',()=>({usePromptQueue:()=>queue}));
beforeEach(()=>{queue.jobs=[];});

describe("batch output layout", () => {
  it('makes completed images viewable while later batch slots are still pending', () => {
    const batch = {slots:[{id:'done',status:'complete',image:{url:'/saved.png',seed:0}},{id:'pending',status:'pending'}]};
    const html = renderToStaticMarkup(<ImageBatchOutput batch={batch} onOpen={() => {}} />);
    expect(html).toContain('1 / 2');
    expect(html).toMatch(/<button[^>]*aria-label="View Batch image 1"/);
    expect(html).not.toContain('aria-label="View Batch image 2"');
    expect(html).toContain('Waiting for image');
  });
  it.each([1, 2, 4, 9, 32])("renders all %i images in separate ordered slots", count => {
    const batch = { slots: Array.from({ length: count }, (_, i) => ({ id: `request-${i}`, status: "complete", image: { url: `/image-${i}.png`, seed: i } })) };
    const html = renderToStaticMarkup(<ImageBatchOutput batch={batch} />);
    expect((html.match(/class="image-batch-output-tile"/g) || []).length).toBe(count);
    expect((html.match(/aria-label="Batch image \d+\. Hover or focus to zoom/g) || []).length).toBe(count);
    expect(html).toContain(`--batch-columns:${Math.min(4, Math.ceil(Math.sqrt(count)))}`);
    expect(html).toContain("Seed: <code>0</code>");
    expect((html.match(/>Copy Seed</g) || []).length).toBe(count);
    expect((html.match(/>Edit Image</g) || []).length).toBe(count);
    expect((html.match(/>Copy Image</g) || []).length).toBe(count);
  });
  it("shows pending, failed and stopped slots without inventing images", () => {
    const batch = { slots: [{ id: "a", status: "pending" }, { id: "b", status: "failed", error: "Out of memory" }, { id: "c", status: "stopped" }] };
    const html = renderToStaticMarkup(<ImageBatchOutput batch={batch} />);
    expect(html).toContain("Waiting for image");
    expect(html).toContain("Out of memory");
    expect(html).toContain("Stopped");
    expect(html).not.toContain("generated-image-preview");
  });
  it('keeps original image numbers and attaches live progress by request ID',()=>{
    queue.jobs=[{kind:'image',request_id:'third',status:'running',progress:{phase:'Denoising',step:12,total_steps:24}},
      {kind:'image',request_id:'second',status:'queued',position:2}];
    const batch={slots:[{id:'first',status:'stopped'},{id:'second',status:'pending'},{id:'third',status:'pending'}]};
    const html=renderToStaticMarkup(<ImageBatchOutput batch={batch}/>);
    for(let i=1;i<=3;i++)expect(html).toContain(`Image ${i} of 3`);
    expect(html).toContain('aria-label="Image 3 of 3 generation progress" max="24" value="12"');
    expect(html).toContain('12 / 24 steps · 50%');expect(html).toContain('Queued · waiting position 2');
    expect(html).not.toContain('aria-label="Image 2 of 3 generation progress"');
  });
});
