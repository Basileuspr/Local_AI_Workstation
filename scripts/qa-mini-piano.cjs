'use strict';
// Isolated Electron window, real Web Audio graph, system speakers muted for QA.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'artifacts/mini-piano');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'law-piano-qa-')));
let win;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error('Piano QA timed out'); app.exit(1); }, 55000);
app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, width: 1080, height: 950, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  win.webContents.setFrameRate(60);
  win.webContents.setAudioMuted(true);
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  await win.loadFile(path.join(output, 'fixture-build/tests/fixtures/miniPiano.html'));
  // Chromium focus emulation lets the hidden QA window emit normal focus events.
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  const js = code => win.webContents.executeJavaScript(code, true);
  async function until(test, label) {
    const end = Date.now() + 5000;
    while (Date.now() < end) { if (await test()) return; await pause(40); }
    throw Error('Timed out: ' + label + ' ' + JSON.stringify(await js("({focus:document.activeElement.outerHTML.slice(0,250),documentFocus:document.hasFocus(),pressed:[...document.querySelectorAll('.piano-key[aria-pressed=true]')].map(n=>n.getAttribute('aria-label'))})")));
  }
  const playing = () => js("document.querySelectorAll('.piano-key[aria-pressed=true]').length");
  const key = (type, value, code) => js(`document.activeElement.dispatchEvent(new KeyboardEvent('${type}', {key:${JSON.stringify(value)},code:${JSON.stringify(code)},bubbles:true,cancelable:true}))`);
  const focus = () => js("document.querySelector('.mini-piano').focus()");
  const click = text => js(`{const button=[...document.querySelectorAll('.mini-piano button')].find(node=>node.textContent.trim()===${JSON.stringify(text)} && !node.disabled);if(!button)throw Error('Missing action: '+${JSON.stringify(text)});button.click();}`);
  const fill = (selector, value) => js(`{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));}`);
  const choose = id => js(`{const input=document.querySelector('[aria-label="Piano lesson or template"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,${JSON.stringify(id)});input.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await until(() => js("Boolean(document.querySelector('.piano-key'))"), 'piano mounts');
  await until(() => js("Boolean(document.querySelector('.piano-roll'))"), 'live guide mounts above keys');
  assert.equal(await js("document.querySelectorAll('.piano-key').length"), 24);
  assert.equal(await js("document.querySelectorAll('.match-card').length"), 16);
  await focus(); await key('keydown', 'a', 'KeyA'); await key('keydown', 'd', 'KeyD'); await key('keydown', 'g', 'KeyG');
  await until(async () => await playing() === 3, 'chord highlights');
  await until(() => js('window.pianoQA.levels().channels.audio.rms > .02'), 'actual PCM chord');
  const chord = await js('window.pianoQA.levels().channels.audio');
  await key('keyup', 'a', 'KeyA'); await until(async () => await playing() === 2, 'independent release');
  await js('window.pianoQA.master({volume:1,muted:true})');
  await until(() => js('window.pianoQA.levels().channels.audio.rms < .0001'), 'shared mute');
  await js('window.pianoQA.master({volume:1,muted:false})');
  await until(() => js('window.pianoQA.levels().channels.audio.rms > .01'), 'shared unmute');
  await js("document.querySelector('[aria-label=\"Outside piano\"]').focus()");
  await until(async () => await playing() === 0, 'focus clears highlights');
  await until(() => js('window.pianoQA.levels().channels.audio.rms < .0001'), 'focus release');
  await key('keydown', 'a', 'KeyA'); assert.equal(await playing(), 0);
  await focus(); await key('keydown', 'a', 'KeyA'); await until(async () => await playing() === 1, 'held before octave');
  await js("document.querySelector('[aria-label=\"Higher octave\"]').click()");
  await until(async () => await playing() === 0, 'octave clears highlights');
  await until(() => js("document.querySelector('[aria-label=\"Piano range\"]').textContent === 'C5–B6'"), 'octave label');
  await js("document.querySelector('[aria-label=\"Lower octave\"]').click()");
  // Native pointer input exercises capture and pointer release handlers.
  const position = await js("(()=>{const r=document.querySelector('.piano-key.white').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.bottom-30)};})()");
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position });
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...position });
  await until(async () => await playing() === 1, 'native pointer starts');
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: 5, y: 5 });
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, x: 5, y: 5 });
  await until(async () => await playing() === 0, 'captured pointer releases outside');
  const touches = await js("[0,4].map((note,id)=>{const r=document.querySelector('[data-piano-note=\"'+note+'\"]').getBoundingClientRect();return {id,x:r.x+r.width/2,y:r.bottom-25,radiusX:2,radiusY:2,force:1};})");
  await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches });
  await until(async () => await playing() === 2, 'multitouch chord');
  await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await until(async () => await playing() === 0, 'touch cancellation');
  await js("document.querySelector('.piano-key.white').focus()");
  await key('keydown', ' ', 'Space'); await until(async () => await playing() === 1, 'focused Space');
  await key('keyup', ' ', 'Space'); await pause(50); assert.equal(await playing(), 0);
  await focus(); await key('keydown', 'a', 'KeyA'); await until(async () => await playing() === 1, 'held before navigation');
  await js("document.querySelector('nav button').click()"); await until(async () => await playing() === 0, 'tab clears highlights');
  await until(() => js('window.pianoQA.levels().channels.audio.rms < .0001'), 'navigation silence');
  await js("document.querySelector('nav button').click()");
  await focus(); await key('keydown', 'a', 'KeyA'); await until(async () => await playing() === 1, 'held before blur');
  await js("window.dispatchEvent(new Event('blur'))"); await until(async () => await playing() === 0, 'blur clears highlights');
  assert.equal(await js("document.querySelectorAll('[aria-label=\"Piano lesson or template\"] optgroup:not([label=\"My templates\"]) option').length"), 29);
  assert.equal(await js("document.querySelector('[data-piano-note=\"1\"]').textContent.includes('D♭')"), true);
  assert.equal(await js("document.querySelector('[data-piano-note=\"0\"]').title.includes('B♯3')"), true);
  await click('Listen'); await until(async () => await playing() > 0, 'lesson demonstration');
  await until(() => js('window.pianoQA.levels().channels.audio.rms > .01'), 'real lesson PCM');
  await js("document.querySelector('nav button').click()");
  await pause(900); assert.equal(await playing(), 0);
  assert.equal(await js("Boolean(document.querySelector('.piano-practice-status'))"), false);
  await js("document.querySelector('nav button').click()");
  await choose('twinkle'); await until(() => js("document.querySelector('.piano-lesson-description').textContent.includes('Repeated notes')"), 'lesson selection');
  await click('Practice'); await focus(); await key('keydown', 'a', 'KeyA');
  await until(() => js("document.querySelector('.piano-practice-status').textContent.startsWith('2 /')"), 'practice first repeated note');
  await pause(100); assert.equal(await js("document.querySelector('.piano-practice-status').textContent.startsWith('2 /')"), true);
  await key('keyup', 'a', 'KeyA'); await pause(30); await key('keydown', 'a', 'KeyA');
  await until(() => js("document.querySelector('.piano-practice-status').textContent.startsWith('3 /')"), 'practice second repeated note');
  await key('keyup', 'a', 'KeyA'); await click('Stop');
  await choose('enharmonics'); await click('Practice');
  await pause(200);
  const frozen = await js("Number(document.querySelector('.piano-roll').dataset.beat)");
  await pause(150); assert.equal(await js("Number(document.querySelector('.piano-roll').dataset.beat)"), frozen);
  assert.equal(await js("document.querySelector('.piano-roll-prompt').textContent.includes('W')"), true);
  assert.equal(await js("document.querySelector('[data-piano-note=\"1\"]').classList.contains('expected')"), true);
  const guideWidths = [1080, 620, 380];
  for (const width of guideWidths) {
    win.setSize(width, 950); await pause(140);
    await js("document.querySelector('.piano-roll-guide').scrollIntoView({block:'start'})");
    const aligned = await js("(()=>{const r=document.querySelector('.piano-roll').getBoundingClientRect(),k=document.querySelector('.piano-keyboard').getBoundingClientRect(),n=document.querySelector('[data-guide-step=\"0\"][data-guide-midi=\"61\"]').getBoundingClientRect(),b=document.querySelector('[data-piano-note=\"1\"]').getBoundingClientRect();return Math.abs(r.left-k.left)<1&&Math.abs(r.right-k.right)<1&&Math.abs(n.x+n.width/2-b.x-b.width/2)<1&&document.querySelector('.mini-piano').scrollWidth<=document.querySelector('.mini-piano').clientWidth+1;})()");
    assert(aligned, 'Live guide lanes and controls fit ' + width);
    await pause(100);
    fs.writeFileSync(path.join(output, `piano-guide-${width}.png`), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
  }
  win.setSize(1080, 950); await click('Stop');
  await click('New template'); await until(() => js("Boolean(document.querySelector('.piano-template-editor'))"), 'rhythm template editor');
  await fill('.piano-template-editor input[maxlength="80"]', 'QA rhythm');
  await fill('.piano-template-editor input[type="number"]', '120');
  await fill('.piano-template-editor .piano-sequence-input', 'C4 C4 [C4 E4 G4]:2 R:.5 D4:.5');
  await click('Save template');
  await until(() => js("document.querySelector('[aria-label=\"Piano lesson or template\"] option:checked').textContent==='QA rhythm'"), 'rhythm template saved');
  await click('Play along'); await until(() => js("document.querySelector('.piano-roll').dataset.mode==='rhythm'"), 'timed mode starts');
  assert.equal(await js("document.querySelector('.piano-count-in').textContent"), '4');
  const beforeFall = await js("parseFloat(document.querySelector('[data-guide-step=\"0\"]').style.bottom)");
  await pause(160);
  const afterFall = await js("parseFloat(document.querySelector('[data-guide-step=\"0\"]').style.bottom)");
  assert(afterFall < beforeFall - 5, `Notes visibly move toward the line: ${beforeFall} -> ${afterFall}`);
  const atBeat = beat => until(() => js(`Number(document.querySelector('.piano-roll').dataset.beat)>=${beat - .04}`), 'reach beat ' + beat);
  const rhythmStrike = async (values, hits) => {
    for (const value of values) await key('keydown', value, `Key${value.toUpperCase()}`);
    await until(() => js(`document.querySelector('.piano-rhythm-feedback').textContent.includes('${hits} hits')`), 'timed hit ' + hits);
    for (const value of values) await key('keyup', value, `Key${value.toUpperCase()}`);
  };
  await atBeat(0); await rhythmStrike(['a'], 1);
  await atBeat(1); await rhythmStrike(['a'], 2);
  await atBeat(2); await rhythmStrike(['a', 'd', 'g'], 3);
  await atBeat(4.5); await rhythmStrike(['s'], 4);
  await until(() => js("document.querySelector('.piano-roll').dataset.mode==='complete'"), 'timed run finishes');
  assert.equal(await js("document.querySelector('.piano-roll-prompt').textContent.includes('4 / 4 hits')"), true);
  await click('Play along');
  await until(() => js("document.querySelector('.piano-roll').dataset.mode==='complete'"), 'unplayed run finishes with misses');
  assert.equal(await js("document.querySelector('.piano-rhythm-feedback').textContent.includes('4 missed')"), true);
  await click('Play along'); await click('Stop'); await pause(200);
  assert.equal(await js("document.querySelector('.piano-roll').dataset.mode"), 'preview');
  await click('Play along'); await js("document.querySelector('nav button').click()"); await pause(250);
  await js("document.querySelector('nav button').click()");
  assert.equal(await js("document.querySelector('.piano-roll').dataset.mode"), 'preview');
  await click('New template');
  await until(() => js("Boolean(document.querySelector('.piano-template-editor'))"), 'template editor');
  await fill('.piano-template-editor input[maxlength="80"]', 'QA aliases');
  await fill('.piano-template-editor .piano-sequence-input', 'Db4 C#4 [C4 E4 G4]:2 R:.5 E#4 F4 F##4 G4');
  await click('Save template');
  await until(() => js("[...document.querySelector('[aria-label=\"Piano lesson or template\"]').options].some(node=>node.textContent==='QA aliases')"), 'save custom template');
  const savedId = await js("document.querySelector('[aria-label=\"Piano lesson or template\"]').value");
  await click('Practice'); await focus(); await key('keydown', 's', 'KeyS'); await pause(50);
  assert.equal(await js("document.querySelector('.piano-practice-status').textContent.startsWith('1 /')"), true);
  await key('keyup', 's', 'KeyS');
  const strike = async (keys, expected) => {
    for (const value of keys) await key('keydown', value, `Key${value.toUpperCase()}`);
    await until(() => js(`document.querySelector('.piano-practice-status').textContent.startsWith(${JSON.stringify(expected)})`), 'practice ' + expected);
    for (const value of keys) await key('keyup', value, `Key${value.toUpperCase()}`);
    await pause(30);
  };
  await strike(['w'], '2 /'); await strike(['w'], '3 /'); await strike(['a', 'd', 'g'], '4 /');
  await click('Next step'); await strike(['f'], '6 /'); await strike(['f'], '7 /'); await strike(['g'], '8 /'); await strike(['g'], 'Practice complete');
  await js('location.reload()');
  await until(() => js("Boolean(document.querySelector('.mini-piano'))"), 'reload mounts');
  await until(() => js(`Boolean(document.querySelector('option[value="${savedId}"]'))`), 'saved template survives reload');
  await choose(savedId); await click('Edit template');
  await until(() => js("document.querySelector('.piano-sequence-input')?.value.startsWith('Db4 C#4')"), 'edit preserves spellings');
  await fill('.piano-template-editor textarea:not(.piano-sequence-input)', 'Edited instructions'); await click('Save template');
  await until(() => js("document.querySelector('.piano-lesson-description').textContent==='Edited instructions'"), 'edit saves existing template');
  assert.equal(await js("document.querySelector('[aria-label=\"Piano lesson or template\"]').value"), savedId);
  await click('Delete template');
  await until(() => js(`!document.querySelector('option[value="${savedId}"]')`), 'delete custom template');
  await click('Undo delete'); await until(() => js(`Boolean(document.querySelector('option[value="${savedId}"]'))`), 'undo preserves custom template');
  await click('New template'); await until(() => js("Boolean(document.querySelector('.piano-template-editor'))"), 'new capture editor');
  await fill('.piano-template-editor input[maxlength="80"]', 'Captured template');
  await key('keydown', 'a', 'KeyA'); await pause(50); assert.equal(await playing(), 0); // Typing in the title never plays piano.
  await focus(); await key('keydown', 'a', 'KeyA'); await until(async () => await playing() === 1, 'capture played note');
  await key('keyup', 'a', 'KeyA'); await click('Add played keys'); await click('Add rest');
  await until(() => js("document.querySelector('.piano-sequence-input').value==='C4 R'"), 'capture appends notes and rests');
  await click('Save template'); await until(() => js("!document.querySelector('.piano-template-editor')"), 'save captured template');
  await click('New template'); await fill('.piano-template-editor .piano-sequence-input', '[C4 C#8]');
  await until(() => js("document.querySelector('.piano-template-editor').textContent.includes('outside the piano')"), 'invalid chord explained');
  await js("document.querySelector('.piano-enharmonics').open=true");
  assert.equal(await js("document.querySelector('.piano-equivalent-list').textContent.includes('C♭5')"), true);
  assert.equal(await js("document.querySelector('.piano-equivalent-list').textContent.includes('𝄪')"), true);
  await pause(200);
  const widths = [1080, 620, 380];
  win.setSize(1081, 950);
  for (const width of widths) {
    win.setSize(width, 950); await pause(120);
    const fits = await js("(()=>{const p=document.querySelector('.mini-piano'),k=document.querySelector('.piano-keyboard');return p.scrollWidth<=p.clientWidth+1 && k.getBoundingClientRect().right<=innerWidth && [...k.children].every(n=>n.getBoundingClientRect().width>0);})()");
    assert(fits, 'Piano fits ' + width);
    assert.equal(await playing(), 0);
    fs.writeFileSync(path.join(output, `piano-${width}.png`), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
  }
  await click('Cancel'); await choose('enharmonics');
  win.setSize(1080, 950); await pause(120);
  await js("document.querySelector('.piano-enharmonics').scrollIntoView({block:'end'})");
  await pause(120);
  fs.writeFileSync(path.join(output, 'piano-enharmonics.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());

  // Wider keyboards share horizontal scrolling with the falling-note lanes.
  const setSize = count => js(`{const select=document.querySelector('[aria-label="Keyboard size"]');select.value='${count}';select.dispatchEvent(new Event('change',{bubbles:true}));}`);
  const wideRanges = [];
  for (const count of [36, 48, 88]) {
    await setSize(count); await until(() => js(`document.querySelectorAll('.piano-key').length===${count}`), 'expanded keyboard');
    for (const width of [1080,380]) {
      win.setSize(width,950); await pause(120);
      await js("document.querySelector('.piano-key-scroll').scrollLeft=400"); await pause(80);
      const geometry = await js(`(()=>{
        const p=document.querySelector('.mini-piano'),a=document.querySelector('.piano-key-scroll'),b=document.querySelector('.piano-roll-scroll');
        const keys=[...document.querySelectorAll('.piano-key')],lanes=[...document.querySelectorAll('.piano-roll-lane')];
        return {fits:p.scrollWidth<=p.clientWidth+1,scroll:a.scrollLeft,guideScroll:b.scrollLeft,aligned:keys.every((key,index)=>Math.abs(key.getBoundingClientRect().left-lanes[index].getBoundingClientRect().left)<1.2)};
      })()`);
      assert(geometry.fits && geometry.aligned, `Wide keyboard aligns ${count}/${width}`);
      assert(Math.abs(geometry.scroll-geometry.guideScroll)<1.2,'Shared horizontal scrolling');
      wideRanges.push({count,width,...geometry});
    }
  }
  await choose('full-range'); await click('Practice');
  await until(() => js("document.querySelector('.piano-roll-prompt').textContent.includes('A0')"), 'lowest piano note guide');
  await focus(); await key('keydown','a','KeyA');
  await until(() => js("document.querySelector('.piano-practice-status').textContent.startsWith('2 /')"), 'A0 practice pitch');
  await key('keyup','a','KeyA'); await click('Stop');
  win.setSize(1080,950); await choose('three-octave'); await setSize(48);
  await js("document.querySelector('.piano-effects').open=true"); await click('Dreamy');
  assert.equal(await js("document.querySelector('[aria-label=\"Piano reverb\"]').value"),'45');
  await focus(); await key('keydown','a','KeyA'); await until(() => js('window.pianoQA.levels().channels.audio.rms>.01'),'effect PCM');
  await key('keyup','a','KeyA'); await pause(80);
  assert(await js('window.pianoQA.levels().channels.audio.rms>.0001'),'sustain and effect tail');
  await js("document.querySelector('nav button').click()");
  await until(() => js('window.pianoQA.levels().channels.audio.rms<.0001'),'effects stop on navigation');
  await js("document.querySelector('nav button').click()");
  await js("document.querySelector('.mini-piano').scrollIntoView({block:'start'})"); await pause(150);
  fs.writeFileSync(path.join(output,'piano-expanded.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await click('Reset effects');
  assert.equal(await js("document.querySelector('[aria-label=\"Piano reverb\"]').value"),'0');
  const effectsAudio = await js(`(async()=>{
    const render=window.pianoQA.renderSound;
    return {clean:await render({}),echo:await render({echo:100}),reverb:await render({reverb:100}),sustain:await render({sustain:100}),
      stopped:await render({echo:100,reverb:100,sustain:100},true),
      plain:await render({waveform:'square'},false,true),dark:await render({waveform:'square',tone:0},false,true),tremolo:await render({waveform:'square',tremolo:100},false,true)};
  })()`);
  assert(effectsAudio.clean.onset>.001 && effectsAudio.clean.tail===0,'Clean audio ends');
  for (const effect of ['echo','reverb','sustain']) assert(effectsAudio[effect].tail>.00001,`${effect} produces audible tail`);
  assert(effectsAudio.stopped.onset===0 && effectsAudio.stopped.tail===0,'Stop clears effects');
  assert(effectsAudio.dark.harmonicRatio < effectsAudio.plain.harmonicRatio*.4,'Tone filter reduces high harmonics');
  assert(effectsAudio.tremolo.tail < effectsAudio.plain.tail*.8,'Tremolo changes amplitude');
  for (const value of Object.values(effectsAudio)) delete value.samples;
  await setSize(24);
  // Unreadable saved data is never replaced by a new template.
  const library = await js("localStorage.getItem('local-ai-workstation-piano-templates-v1')");
  await js("localStorage.setItem('local-ai-workstation-piano-templates-v1','original-unreadable-library');location.reload()");
  await until(() => js("document.querySelector('.piano-lessons')?.textContent.includes('existing library will be preserved')"), 'unreadable library explained');
  await click('New template'); await fill('.piano-template-editor input[maxlength="80"]', 'Session template');
  await fill('.piano-template-editor .piano-sequence-input', 'C4 D4'); await click('Save template');
  await until(() => js("[...document.querySelector('[aria-label=\"Piano lesson or template\"]').options].some(node=>node.textContent==='Session template')"), 'session-only template stays usable');
  assert.equal(await js("localStorage.getItem('local-ai-workstation-piano-templates-v1')"), 'original-unreadable-library');
  await js(`localStorage.setItem('local-ai-workstation-piano-templates-v1',${JSON.stringify(library)})`);
  assert.deepEqual(errors, []);
  const report = { passed: true, keys: 24, lessons: 29, memoryCards: 16, chord, guideWidths, wideRanges, effectsAudio, checks: ['real audio PCM', 'chords', 'independent key release', 'master mute/unmute', 'focus scope', 'octave release', 'native pointer capture', 'multitouch and cancellation', 'Space accessibility', 'tab release', 'window blur', 'lesson playback and cancellation', 'repeated-note practice', 'enharmonic and chord practice', 'template save and reload', 'edit/delete/undo', 'capture played notes and rests', 'typing isolation', 'validation errors', 'enharmonic reference', 'responsive editor and reference', 'unreadable storage preservation', 'guide waits during practice', 'guide lanes align with keys', 'continuous falling notes', 'count-in', 'timed repeated-note and chord hits', 'timed misses and completion', 'timed cancellation', '36/48/88-key layouts', 'synchronized guide scrolling', 'A0 practice', 'real effect PCM tails', 'tone filter and tremolo', 'effect cancellation and reset'], widths };
  fs.writeFileSync(path.join(output, 'qa-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); clearTimeout(timeout); win.destroy(); app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
