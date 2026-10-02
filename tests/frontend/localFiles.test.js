import {describe,it,expect,vi} from 'vitest';
import {resultCsv} from '../../src/localFiles';
import native from '../../electron/localFiles';
import shutdown from '../../electron/appShutdown';
import {appTabs,appTabLabels} from '../../src/navigation';
import {workspaceHelp} from '../../src/workspaceHelp';

describe('Local file safeguards',()=>{
  it('escapes CSV cells and spreadsheet formulas',()=>{
    expect(resultCsv({columns:['text'],rows:[['=SUM(A1)'],['a,"b"\nline'],[null]]})).toBe('"text"\r\n"\'=SUM(A1)"\r\n"a,""b""\nline"\r\n""');
  });
  it('registers the workspace and help',()=>{
    expect(appTabs).toContain('local-files');expect(appTabLabels['local-files']).toBe('Local Files');expect(workspaceHelp['local-files'].purpose).toContain('SQLite');
  });
  it('does not submit a cancelled picker or an ungranted save path',async()=>{
    const request=vi.fn(async()=>[{available:true,extensions:['.docx']}]);
    const handler=native.createLocalFiles({request,openDialog:async()=>({canceled:true}),home:'C:/',confirm:async()=>false});
    expect(await handler.open()).toEqual({canceled:true});expect(request).toHaveBeenCalledTimes(1);
    await expect(handler.save({id:'unknown',target:'C:/bad.docx'})).rejects.toThrow('Reopen');
  });
  it('requires explicit confirmation to discard unsaved changes',async()=>{
    const confirm=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const handler=native.createLocalFiles({confirm});handler.setDirty(true);
    expect(await handler.canLeave()).toBe(false);expect(await handler.canLeave()).toBe(true);
    handler.setDirty(false);expect(await handler.canLeave()).toBe(true);expect(confirm).toHaveBeenCalledTimes(2);
  });
  it('vetoes native shutdown before disposing backend or unsaved editor',async()=>{
    const app={exit:vi.fn()},stopBackend=vi.fn(),cleanup=vi.fn(),canShutdown=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const host=shutdown.createAppShutdown({app,stopBackend,dispose:[cleanup],canShutdown});
    expect(await host.request()).toBe(false);expect(stopBackend).not.toHaveBeenCalled();expect(cleanup).not.toHaveBeenCalled();
    expect(await host.request()).toBe(true);expect(app.exit).toHaveBeenCalledOnce();
  });
});
