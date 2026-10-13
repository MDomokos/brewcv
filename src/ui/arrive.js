// The two arrivals (UX-4): the start screen turns into the editor, and the quiet onboarding editor opens up to the whole one.
// Both are told after the fact (the editor is already what it is); shell.js calls them when it sees the screen change.
//   fromStart:   the grey skeleton lines of the start screen become the page's text, line by line (src/ui/pagemotion.js reveal), and
//                the intro parts become the editor's controls: the header, the panel and the footer come in from where they were.
//   fromQuiet:   the header, the footer, the tabs and the zoom bar fade and slide in around the page (the question panel stays).
import { play } from './motion.js';

const $ = s => document.querySelector(s);
const rise = (el, dx, dy, name, delay = 0) => el && play(el, [{ opacity: 0, transform: `translate(${dx}px, ${dy}px)` }, { opacity: 1, transform: 'none' }], { name, key: name, delay, fill: 'backwards' });

export function fromStart({ sheet }){
  sheet.reveal();
  rise($('#head'), 0, -12, 'start:head');
  rise($('#body'), 0, 10, 'start:body', 60);
  rise($('#foot'), 0, 12, 'start:foot', 120);
  rise($('#tabs'), 14, 0, 'start:tabs', 120);
}
export function fromQuiet(){
  rise($('#head'), 0, -14, 'quiet:head');
  rise($('#foot'), 0, 14, 'quiet:foot', 60);
  const tabs = $('#tabs');
  if (tabs && !tabs.hidden) rise(tabs, 14, 0, 'quiet:rail', 120);       // (named for the rail it replaced)
}
