import {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import CodeViewer from '../../src/components/CodeViewer';
const {browserUrl,publicAddress,allowedBrowserRequest}=createRequire(import.meta.url)('../../electron/browserPolicy');

describe('viewer browser boundary',()=>{
  it('accepts public web addresses and normalizes the address bar without app credentials',()=>{
    expect(browserUrl('example.com/path',{input:true})).toBe('https://example.com/path');
    expect(browserUrl('https://example.com/?search=hello')).toBe('https://example.com/?search=hello');
    for(const value of ['file:///C:/secret','app://local','javascript:alert(1)','data:text/html,hi','http://localhost:8000',
      'http://127.0.0.1','http://2130706433','http://0x7f000001','http://[::1]','http://[::ffff:127.0.0.1]',
      'http://10.1.2.3','http://192.168.1.1','http://169.254.169.254','http://172.16.0.1','http://printer.local',
      'https://user:pass@example.com','https://example.com/?law_token=secret','https://example.com/?apiToken=secret'])expect(browserUrl(value)).toBeNull();
  });
  it('checks resolved addresses, including mixed public/private DNS answers',async()=>{
    expect(publicAddress('93.184.216.34')).toBe(true);expect(publicAddress('2606:4700:4700::1111')).toBe(true);
    for(const address of ['127.0.0.1','10.0.0.1','169.254.1.1','100.64.0.1','198.18.0.1','192.0.0.1','224.0.0.1','fc00::1','fe80::1','::ffff:8.8.8.8'])expect(publicAddress(address)).toBe(false);
    expect(await allowedBrowserRequest('https://example.com',async()=>({endpoints:[{address:'93.184.216.34'}]}))).toBe(true);
    expect(await allowedBrowserRequest('https://example.com',async()=>({endpoints:[{address:'93.184.216.34'},{address:'127.0.0.1'}]}))).toBe(false);
    expect(await allowedBrowserRequest('https://example.com',async()=>{throw new Error('DNS');})).toBe(false);
  });
  it('opens JavaScript as text with save/copy and no executable preview',()=>{
    const markup=renderToStaticMarkup(<CodeViewer kind="js"/>);
    expect(markup).toContain('JavaScript Viewer');expect(markup).toContain('JavaScript source');
    expect(markup).toContain('Copy source');expect(markup).toContain('Save source');
    expect(markup).not.toContain('<iframe');expect(markup).not.toContain('>Preview</button>');
  });
});
