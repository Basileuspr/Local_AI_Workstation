import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {File} from 'node:buffer';
import {parseHTML} from 'linkedom';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import FileConverter from '../../src/components/FileConverter';

// Preview loading is independent of accepting a file for conversion.
vi.mock('../../src/components/ImageThumbnail', () => ({
  default: () => null, FileImageThumbnail: () => null, ThumbnailRetryButton: () => null,
}));

let root, document, window, fetch;
beforeEach(async () => {
  ({document, window} = parseHTML('<html><body><main id="root"></main></body></html>'));
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fetch = vi.fn().mockResolvedValue({ok: true, json: async () => ({
    id: 'a'.repeat(32), name: 'large.png', format: 'png', size: 120, width: 3072, height: 3072,
  })});
  vi.stubGlobal('fetch', fetch);
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(<FileConverter />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function dropAndConvert(file) {
  const event = new window.Event('drop', {bubbles: true, cancelable: true});
  event.dataTransfer = {files: [file]};
  await act(async () => document.querySelector('.tools-workspace').dispatchEvent(event));
  const convert = [...document.querySelectorAll('button')].find(button => button.textContent === 'Convert 1 file');
  expect(convert.disabled).toBe(false);
  await act(async () => convert.click());
}

describe('File Converter uploads', () => {
  it('submits files larger than 24 MB and displays the returned conversion', async () => {
    const file = new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'large.bmp', {type: 'image/bmp'});
    await dropAndConvert(file);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, request] = fetch.mock.calls[0];
    expect(url).toContain('/workspaces/convert');
    expect(request.method).toBe('POST');
    expect(request.body.get('file').size).toBe(file.size);
    expect(request.body.get('target')).toBe('png');
    expect(document.querySelector('.document-attachment').textContent).toContain('large.png');
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('.tools-heading').textContent).toContain('100 MB and 24 megapixels');
  });

  it('explains the 100 MB limit before uploading an oversized file', async () => {
    await dropAndConvert({name: 'too-large.bmp', size: 100 * 1024 * 1024 + 1, lastModified: 0});
    expect(fetch).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]').textContent).toContain('100 MB file size limit');
  });

  it('displays the separate pixel limit when the backend rejects the image dimensions', async () => {
    fetch.mockResolvedValue({ok: false, json: async () => ({detail: 'Choose an image up to 24 megapixels.'})});
    await dropAndConvert(new File(['image'], 'too-many-pixels.png', {type: 'image/png'}));
    expect(document.querySelector('[role="alert"]').textContent).toContain('24 megapixels');
  });
});
