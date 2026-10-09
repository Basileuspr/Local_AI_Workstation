import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import BrowserAccountStatus from '../../src/components/BrowserAccountStatus';
const {pageOperation}=createRequire(import.meta.url)('../../electron/browserPageTools');
function fixture(html,url='https://www.youtube.com/watch?v=fixture') {
  const {document,Element}=parseHTML('<html><body>'+html+'</body></html>');
  Element.prototype.getClientRects=function(){return [{}];};
  document.readyState='complete';
  const context=vm.createContext({document,location:new URL(url),crypto:webcrypto,NodeFilter:{SHOW_TEXT:4},getComputedStyle:()=>({visibility:'visible'})});
  return request=>vm.runInContext(`(${pageOperation.toString()})(${JSON.stringify({action:'read',deadline:Date.now()+10000,...request})})`,context);
}
describe('Account identity uses account evidence, not arbitrary controls',()=>{
  it.each(['Mute (m)','Full screen (f)','Search','Account menu'])('never binds %s as an account',name=>{
    const read=fixture(`<button aria-label="${name}"></button><a href="/@creator">Creator channel</a>`);
    const page=read();expect(page.account).toBe('');expect(page.accountStatus.status).toBe('unavailable');
    expect(read({accountTarget:{role:'button',name}}).error).toBe('unsupported_account_control');
  });
  it('requires a real identifier beyond a generic current-account label or avatar',()=>{
    const read=fixture('<button aria-label="Current account menu"><img alt="Avatar image"></button><button aria-label="Current account">Account<img alt="Avatar image"></button>');
    expect(read().accountStatus.status).toBe('unavailable');
  });
  it('recognizes an unambiguous explicitly labelled identity and detects changes',()=>{
    const read=fixture('<button aria-label="Current account">Owned user</button>');
    const page=read();expect(page.account).toContain('Owned user');expect(page.accountStatus.status).toBe('identified');
    expect(read({account:'different account'}).error).toBe('account_changed');
  });
  it('refuses conflicting visible identities rather than guessing which account is active',()=>{
    const page=fixture('<button aria-label="Current account">First user</button><button aria-label="Current account">Second user</button>')();
    expect(page.account).toBe('');expect(page.accountStatus.status).toBe('ambiguous');
  });
  it('accepts only the visible active-account header on YouTube and excludes its email from page text',()=>{
    const html='<button aria-label="Account menu"></button><a href="/@creator">Creator channel</a><ytd-active-account-header-renderer><span id="account-name">Owned user</span><span id="channel-handle">@owned-user</span><span id="email">PRIVATE_EMAIL@example.com</span></ytd-active-account-header-renderer>';
    const page=fixture(html)();expect(page.accountStatus.status).toBe('identified');expect(page.account).toContain('@owned-user');
    expect(page.account).not.toContain('@creator');expect(page.account).not.toContain('PRIVATE_EMAIL');expect(page.text).not.toContain('PRIVATE_EMAIL');
    expect(JSON.stringify(page.accountStatus)).not.toContain('@owned-user');
    expect(fixture(html,'https://unrelated.example.com')().account).toBe('');
    expect(fixture(html.replace('<ytd-active-account-header-renderer>','<ytd-active-account-header-renderer hidden>'))().account).toBe('');
  });
  it('does not identify YouTube from a creator link or a missing/hidden handle',()=>{
    for(const html of ['<a href="/@creator">Creator channel</a>','<ytd-active-account-header-renderer><span id="account-name">Owned user</span></ytd-active-account-header-renderer>','<ytd-active-account-header-renderer><span id="channel-handle" hidden>@owned-user</span></ytd-active-account-header-renderer>'])expect(fixture(html)().account).toBe('');
  });
  it('keeps login challenges ahead of account checks',()=>{
    const read=fixture('<input type="password"><button aria-label="Account menu"></button>');
    expect(read({accountTarget:{role:'button',name:'Account menu'}}).challenge).toBe(true);
  });
  it('renders a plain account status and check button without an element or role picker',()=>{
    const html=renderToStaticMarkup(<BrowserAccountStatus/>);
    expect(html).toContain('Check account');expect(html).toContain('Open the website');expect(html).not.toContain('<select');
    expect(renderToStaticMarkup(<BrowserAccountStatus identified/>)).toContain('Signed-in account identified.');
  });
});
