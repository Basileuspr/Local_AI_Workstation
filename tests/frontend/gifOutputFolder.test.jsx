import {afterEach,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import GifOutputFolder from '../../src/components/GifOutputFolder';
import GifSaveActions from '../../src/components/GifSaveActions';

afterEach(()=>vi.unstubAllGlobals());
it('shows compact Point output and Clear controls with the full folder in a tooltip',()=>{
  vi.stubGlobal('window',{workstationDesktop:{chooseGifOutputFolder:()=>{}}});
  const blank=renderToStaticMarkup(<GifOutputFolder onChange={()=>{}}/>);
  expect(blank).toContain('Point output'); expect(blank).toContain('Save manually');
  expect(blank).not.toContain('Clear GIF output folder');
  const chosen=renderToStaticMarkup(<GifOutputFolder value={{id:'folder',folder:'E:\\Animations\\GIFs'}} onChange={()=>{}}/>);
  expect(chosen).toContain('title="E:\\Animations\\GIFs"');
  expect(chosen).toContain('>GIFs</span>'); expect(chosen).toContain('Clear GIF output folder');
});
it('enables file-location access immediately for an automatically saved GIF',()=>{
  vi.stubGlobal('window',{workstationDesktop:{saveGif:()=>{},revealGif:()=>{}}});
  const saved=renderToStaticMarkup(<GifSaveActions blob={new Blob()} url="blob:gif" name="Animation" initialSaved={{id:'saved',path:'E:\\GIFs\\Animation.gif'}}/>);
  expect(saved).toContain('Saved to E:\\GIFs\\Animation.gif');
  expect(saved).not.toContain('disabled=""');
});
