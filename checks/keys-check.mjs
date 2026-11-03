#!/usr/bin/env node
// node checks/keys-check.mjs
// The shortcuts on the keyboards of the app's ten languages (US and UK QWERTY, German, Czech and Hungarian QWERTZ, French AZERTY), as
// the events each layout's keys give ({ key, code } as Chromium reports them):
//  - a shortcut named by its character fires on the key that types it (Ctrl+Z is the key printed Z), and on the key in its US place
//    only where the layout's key there types none of the app's characters (0 is à on AZERTY, é on Czech; + a dead key on German);
//  - W, E and R are the three keys in a row wherever they are printed (Z E R on AZERTY);
//  - Ctrl+\ is the key by Enter (# on German, ű on Hungarian) or the one that types \;
//  - a key that writes a character is never a shortcut: AltGr (Ctrl+Alt on Windows, AltGraph on Linux), Mac's Option, a dead key, an IME
//    at work; in a field or a line being written only Save, Open, Find and the sidebar's fold, as real Ctrl/Cmd presses;
//  - the help and the tips name a place key as the layout prints it, where the browser tells it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };

// a layout map as navigator.keyboard.getLayoutMap gives it, set before help.js is loaded (it asks once)
async function helpWith(map){
  Object.defineProperty(globalThis.navigator, 'keyboard', { configurable: true, value: map && { getLayoutMap: async () => new Map(Object.entries(map)) } });
  const m = await import(`../src/ui/help.js?${Math.random()}`);
  await new Promise(r => setTimeout(r));
  return m;
}
const { isKey, writes } = await helpWith(null);

// the actions in the order their handlers ask (shell.js key(), then dock.js onKey)
const mod = e => e.ctrlKey || e.metaKey;
function act(e, typing = false){
  if (typing && mod(e) && isKey(e, 'z', 'y')) return null;
  if (mod(e) && !e.altKey && isKey(e, 'z')) return e.shiftKey ? 'redo' : 'undo';
  if (mod(e) && isKey(e, 'y')) return 'redo';
  if (mod(e) && !e.altKey && isKey(e, 's')) return 'save';
  if (mod(e) && isKey(e, 'o')) return 'open';
  if (mod(e) && !e.altKey && isKey(e, '\\')) return 'side';
  if (mod(e) && !e.altKey && !e.shiftKey && isKey(e, 'f')) return 'find';
  if (typing || e.isComposing || e.keyCode === 229) return null;
  if (mod(e)) return null;
  if (!writes(e) && !e.shiftKey && { KeyW: 'library', KeyE: 'editor', KeyR: 'career' }[e.code]) return { KeyW: 'library', KeyE: 'editor', KeyR: 'career' }[e.code];
  if (e.key === '?' && !writes(e)) return 'help';
  if (e.key === '/' && !writes(e)) return 'find';
  if (isKey(e, '-', '_')) return 'out';
  if (isKey(e, '+', '=')) return 'in';
  if (isKey(e, '0')) return 'fit';
  return null;
}
const press = (code, key, m = {}) => ({ code, key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, keyCode: 0, isComposing: false, getModifierState: k => k === 'AltGraph' && !!m.altGraph, ...m });
const C = { ctrlKey: true }, M = { metaKey: true }, S = { shiftKey: true };
const WIN_ALTGR = { ctrlKey: true, altKey: true, altGraph: true }, LINUX_ALTGR = { altGraph: true }, OPT = { altKey: true };

// [layout, what the key is, event, the action it must be (null: none)]
const cases = [
  ['US', 'Ctrl+Z', press('KeyZ', 'z', C), 'undo'], ['US', 'Cmd+Shift+Z', press('KeyZ', 'Z', { ...M, ...S }), 'redo'], ['US', 'Ctrl+Y', press('KeyY', 'y', C), 'redo'],
  ['US', 'Ctrl+S', press('KeyS', 's', C), 'save'], ['US', 'Ctrl+O', press('KeyO', 'o', C), 'open'], ['US', 'Ctrl+F', press('KeyF', 'f', C), 'find'],
  ['US', 'Ctrl+\\', press('Backslash', '\\', C), 'side'], ['US', 'W', press('KeyW', 'w'), 'library'], ['US', 'E', press('KeyE', 'e'), 'editor'], ['US', 'R', press('KeyR', 'r'), 'career'],
  ['US', '-', press('Minus', '-'), 'out'], ['US', 'Shift+- (_)', press('Minus', '_', S), 'out'], ['US', '=', press('Equal', '='), 'in'], ['US', 'Shift+= (+)', press('Equal', '+', S), 'in'],
  ['US', '0', press('Digit0', '0'), 'fit'], ['US', 'numpad +', press('NumpadAdd', '+'), 'in'], ['US', 'numpad -', press('NumpadSubtract', '-'), 'out'], ['US', 'numpad 0', press('Numpad0', '0'), 'fit'],
  ['US', 'Shift+/ (?)', press('Slash', '?', S), 'help'], ['US', '/', press('Slash', '/'), 'find'], ['US', 'Q', press('KeyQ', 'q'), null], ['US', 'Ctrl+Q', press('KeyQ', 'q', C), null],
  ['UK', 'Ctrl+\\ (left of Z)', press('IntlBackslash', '\\', C), 'side'], ['UK', 'Ctrl+# (by Enter)', press('Backslash', '#', C), 'side'],
  ['DE', 'Strg+Z (KeyY)', press('KeyY', 'z', C), 'undo'], ['DE', 'Strg+Y (KeyZ)', press('KeyZ', 'y', C), 'redo'], ['DE', 'Strg+S', press('KeyS', 's', C), 'save'],
  ['DE', 'Strg+# (by Enter)', press('Backslash', '#', C), 'side'], ['DE', 'Strg+< (left of Y)', press('IntlBackslash', '<', C), 'side'],
  ['DE', 'W', press('KeyW', 'w'), 'library'], ['DE', 'Z (KeyY)', press('KeyY', 'z'), null],
  ['DE', '- (Slash)', press('Slash', '-'), 'out'], ['DE', 'ß (Minus)', press('Minus', 'ß'), 'out'], ['DE', 'Shift+ß (?)', press('Minus', '?', S), 'help'],
  ['DE', '+ (BracketRight)', press('BracketRight', '+'), 'in'], ['DE', '´ (Equal, dead)', press('Equal', 'Dead'), null], ['DE', '0', press('Digit0', '0'), 'fit'], ['DE', 'Shift+7 (/)', press('Digit7', '/', S), 'find'],
  ['FR', 'Ctrl+Z (KeyW)', press('KeyW', 'z', C), 'undo'], ['FR', 'Ctrl+W (KeyZ)', press('KeyZ', 'w', C), null], ['FR', 'Ctrl+A (KeyQ)', press('KeyQ', 'a', C), null],
  ['FR', 'Ctrl+S', press('KeyS', 's', C), 'save'], ['FR', 'Ctrl+F', press('KeyF', 'f', C), 'find'], ['FR', 'Ctrl+* (by Enter)', press('Backslash', '*', C), 'side'],
  ['FR', 'Z (KeyW): Library', press('KeyW', 'z'), 'library'], ['FR', 'E', press('KeyE', 'e'), 'editor'], ['FR', 'R', press('KeyR', 'r'), 'career'], ['FR', 'W (KeyZ)', press('KeyZ', 'w'), null],
  ['FR', 'à (Digit0)', press('Digit0', 'à'), 'fit'], ['FR', 'Shift+à (0)', press('Digit0', '0', S), 'fit'], ['FR', '= (Equal)', press('Equal', '='), 'in'],
  ['FR', '- (Digit6)', press('Digit6', '-'), 'out'], ['FR', '_ (Digit8)', press('Digit8', '_'), 'out'], ['FR', 'é (Digit2)', press('Digit2', 'é'), null], ['FR', 'Shift+, (?)', press('KeyM', '?', S), 'help'],
  ['CZ', 'Ctrl+Z (KeyY)', press('KeyY', 'z', C), 'undo'], ['CZ', 'Ctrl+¨ (by Enter, dead)', press('Backslash', 'Dead', C), null], ['CZ', 'Ctrl+\\ (left of Y)', press('IntlBackslash', '\\', C), 'side'],
  ['CZ', 'é (Digit0)', press('Digit0', 'é'), 'fit'], ['CZ', '= (Minus): the = key, not minus', press('Minus', '='), 'in'], ['CZ', '+ (Digit1)', press('Digit1', '+'), 'in'],
  ['CZ', '´ (Equal, dead)', press('Equal', 'Dead'), null], ['CZ', '- (Slash)', press('Slash', '-'), 'out'], ['CZ', 'ě (Digit2)', press('Digit2', 'ě'), null],
  ['HU', 'Ctrl+Z (KeyY)', press('KeyY', 'z', C), 'undo'], ['HU', 'Ctrl+ű (by Enter)', press('Backslash', 'ű', C), 'side'], ['HU', 'Ctrl+í (left of Y)', press('IntlBackslash', 'í', C), 'side'],
  ['HU', '0 (left of 1)', press('Backquote', '0'), 'fit'], ['HU', 'ö (Digit0, the US 0 place)', press('Digit0', 'ö'), 'fit'], ['HU', 'Shift+3 (+)', press('Digit3', '+', S), 'in'],
  ['HU', 'ó (Equal)', press('Equal', 'ó'), 'in'], ['HU', 'ü (Minus)', press('Minus', 'ü'), 'out'], ['HU', '- (Slash)', press('Slash', '-'), 'out'], ['HU', 'Shift+, (?)', press('Comma', '?', S), 'help'],
  ['HU', 'é (Semicolon)', press('Semicolon', 'é'), null], ['HU', 'W', press('KeyW', 'w'), 'library'],
  ['RU', 'Ctrl+Я (KeyZ)', press('KeyZ', 'я', C), 'undo'], ['RU', 'Ctrl+Ы (KeyS)', press('KeyS', 'ы', C), 'save'], ['RU', 'Ц (KeyW)', press('KeyW', 'ц'), 'library'],
  // a key that writes a character
  ['PL', 'AltGr+S (ś), Windows', press('KeyS', 'ś', WIN_ALTGR), null], ['PL', 'AltGr+O (ó), Windows', press('KeyO', 'ó', WIN_ALTGR), null],
  ['PL', 'AltGr+Z (ż), Windows', press('KeyZ', 'ż', WIN_ALTGR), null], ['PL', 'AltGr+X (ź), Windows', press('KeyX', 'ź', WIN_ALTGR), null],
  ['PL', 'AltGr+S (ś), Linux', press('KeyS', 'ś', LINUX_ALTGR), null], ['PL', 'AltGr+E (ę), Linux: not the Editor', press('KeyE', 'ę', LINUX_ALTGR), null],
  ['DE', 'AltGr+ß (\\): not the fold', press('Minus', '\\', WIN_ALTGR), null], ['DE', 'AltGr+Q (@)', press('KeyQ', '@', WIN_ALTGR), null],
  ['DE', 'AltGr+0 (})', press('Digit0', '}', WIN_ALTGR), null], ['DE', 'AltGr+E (€), Linux', press('KeyE', '€', LINUX_ALTGR), null],
  ['HU', 'AltGr+V (@)', press('KeyV', '@', WIN_ALTGR), null], ['HU', 'AltGr+Q (\\)', press('KeyQ', '\\', WIN_ALTGR), null], ['CZ', 'AltGr+E (€)', press('KeyE', '€', WIN_ALTGR), null],
  ['Mac', 'Option+E (dead ´)', press('KeyE', 'Dead', OPT), null], ['Mac', 'Option+S (ß)', press('KeyS', 'ß', OPT), null], ['Mac', 'Option+2 (€)', press('Digit2', '€', OPT), null],
  ['Mac', 'Option+- (–)', press('Minus', '–', OPT), null], ['Mac', 'Option+0 (º)', press('Digit0', 'º', OPT), null], ['Mac', 'Option+W (∑)', press('KeyW', '∑', OPT), null],
  ['any', 'a dead key alone', press('BracketLeft', 'Dead'), null], ['any', 'Ctrl+a dead key', press('Equal', 'Dead', C), null],
  ['any', 'an IME composing (W)', press('KeyW', 'Process', { keyCode: 229 }), null], ['any', 'an IME composing (0)', press('Digit0', '0', { isComposing: true }), null],
];
for (const [lay, what, e, want] of cases){ const got = act(e); ok(`${lay} ${what}: ${want ?? 'nothing'}`, got === want, `got ${got}`); }

// typing in a field or the line being written on the page: only Save, Open, Find and the fold, as real Ctrl/Cmd presses
const typed = [['US', '0', press('Digit0', '0')], ['FR', 'à', press('Digit0', 'à')], ['US', 'w', press('KeyW', 'w')], ['FR', 'z (KeyW)', press('KeyW', 'z')], ['US', '+', press('Equal', '+', S)],
  ['US', '?', press('Slash', '?', S)], ['US', '/', press('Slash', '/')], ['US', '-', press('Minus', '-')], ['US', 'Shift+F', press('KeyF', 'F', S)], ['US', 'Ctrl+Z (the field\'s own undo)', press('KeyZ', 'z', C)],
  ['PL', 'AltGr+S (ś)', press('KeyS', 'ś', WIN_ALTGR)], ['DE', 'AltGr+ß (\\)', press('Minus', '\\', WIN_ALTGR)], ['DE', 'AltGr+Q (@)', press('KeyQ', '@', WIN_ALTGR)]];
for (const [lay, what, e] of typed) ok(`${lay} ${what} typed in a field: nothing`, act(e, true) === null, `got ${act(e, true)}`);
const kept = [['Ctrl+S', press('KeyS', 's', C), 'save'], ['Cmd+O', press('KeyO', 'o', M), 'open'], ['Ctrl+F', press('KeyF', 'f', C), 'find'], ['DE Strg+#', press('Backslash', '#', C), 'side']];
for (const [what, e, want] of kept) ok(`${what} in a field: ${want}`, act(e, true) === want, `got ${act(e, true)}`);
const sel = read('src/ui/select.js').match(/isTyping = el => [^\n]+/)?.[0] ?? '';
ok('a field is an input, a textarea, a select, any contenteditable (the page\'s line in its frame too) or a textbox', ['input', 'textarea', 'select', '[contenteditable]:not([contenteditable=false])', '[role=textbox]'].every(x => sel.includes(x)));
ok('the page\'s frame hands its keys to the same handler', /onKey: key\b/.test(read('src/ui/shell.js')) && /doc\.addEventListener\('keydown', e => hooks\.onKey\?\.\(e\)\)/.test(read('src/ui/sheet.js')));

// the intro's 1 to 4: the digit row where digits need Shift
ok('FR & (Digit1) is the intro\'s step 1', isKey(press('Digit1', '&'), '1'));
ok('US 4 is the intro\'s step 4, and 5 is no step', isKey(press('Digit4', '4'), '4') && !['1', '2', '3', '4'].some(n => isKey(press('Digit5', '5'), n)));

// the handlers ask the matcher the way act() does
const shell = read('src/ui/shell.js'), dock = read('src/ui/dock.js'), story = read('src/ui/story.js');
ok('shell.js asks isKey for Ctrl+Z Y S O \\ and the places by e.code', ["isKey(e, 'z')", "isKey(e, 'y')", "isKey(e, 's')", "isKey(e, 'o')", "isKey(e, '\\\\')"].every(s => shell.includes(s)) && shell.includes("{ KeyW: 'library', KeyE: 'editor', KeyR: 'career' }[e.code]"));
const guard = shell.indexOf('if (typing || e.isComposing || e.keyCode === 229) return;');
ok('in shell.js every plain-character key comes after the typing guard, and none takes a writing key', guard > 0 && ['isDrinkKey(e)){', "{ KeyW: 'library'", "e.key === '?' && !mod && !writes(e)", "e.key === '/' && !mod && !writes(e)", 'dock.onKey(e)'].every(x => shell.indexOf(x) > guard) && shell.includes('!mod && !writes(e) && !e.shiftKey && { KeyW'));
ok('dock.js asks -, then +, then 0', /isKey\(e, '-', '_'\)[\s\S]*isKey\(e, '\+', '='\)[\s\S]*isKey\(e, '0'\)/.test(dock));
ok('find.js, onpage.js, review.js and story.js ask isKey', /isKey\(e, 'f'\)/.test(read('src/ui/find.js')) && /isKey\(e, 'h'\)/.test(read('src/ui/onpage.js')) && /isKey\(e, c\)/.test(read('src/ui/review.js')) && /isKey\(e, c\)/.test(story));

// the labels: a place key as the layout prints it, the others as named; no map, the US key
const us = await helpWith(null);
ok('no layout map: W and Ctrl+\\ as the US keys', us.keyText('W') === 'W' && us.keyText('Ctrl', '\\').endsWith('\\'));
const fr = await helpWith({ KeyW: 'z', KeyE: 'e', KeyR: 'r', Backslash: '*', KeyZ: 'w', Digit0: 'à' });
ok('AZERTY: the places are Z E R, Ctrl+\\ is the * key, Ctrl+Z stays Z', fr.keyText('W') === 'Z' && fr.keyText('E') === 'E' && fr.keyText('Ctrl', '\\').endsWith('*') && fr.keyText('Ctrl', 'Z').endsWith('Z'));
const de = await helpWith({ KeyW: 'w', KeyE: 'e', KeyR: 'r', Backslash: '#' });
ok('German: Ctrl+\\ is the # key', de.keyText('Ctrl', '\\').endsWith('#'));
const hu = await helpWith({ KeyW: 'w', Backslash: 'ű' });
ok('Hungarian: Ctrl+\\ is the Ű key', hu.keyText('Ctrl', '\\').endsWith('Ű'));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
