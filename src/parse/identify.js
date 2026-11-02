// Not from OpenResume. What a file is, from its bytes and never from its name: pdf | docx | doc | odt | pages | linkedin | html | md | txt | json | image | other.
// The name breaks one tie only: a text with no Markdown in it is md when its name says so, else txt. A type nobody reads here (.afpub, .psd, an .ods,
// other XML, empty or binary bytes) is 'other'; the caller keeps it as a file. A file that starts like a ZIP but cannot be listed (cut short,
// ZIP64) is not 'other': identify throws unzip's error, with its `code`, so the person can be told what is wrong.
// An old binary Word file is `doc`: an OLE file that holds the stream name "WordDocument" (an old .xls or .ppt is `other`), so the caller can ask for a .docx or a PDF.
// A Pages file is told by its preview PDF or its Index/Document.iwa, and a Keynote file (it holds Index/Slide*.iwa) is `other`; a Pages file holds Index/CalculationEngine.iwa and, with a table, Index/Tables/ too, so those
// tell nothing, and a Numbers file reads as Pages (it gets the advice to save a PDF, which is harmless);
// a modern Pages file holds a picture, not a PDF, and readPages says so.
// shortcut: the stream name is looked for anywhere in the file, and the iWork kind is told by the names of the parts (identify is not async, so it cannot read the metadata plists);
// a Keynote or Numbers file from 2009 (index.xml, no .iwa parts) is told from a Pages one only by its preview. Images are PNG,
// JPEG, GIF, WebP, BMP, HEIC, AVIF and SVG; a PDF's header must start a line in its first 1024 bytes; a ZIP is told by the names it holds
// (a PDF inside a Pages file is read by pages.js).
import { unzip } from './unzip.js';
import { decode } from './lines.js';

const starts = (b, s, at = 0) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
const BRANDS = /^(?:heic|heix|hevc|hevx|mif1|msf1|avif|avis)/;

export function identify(bytes, name = ''){
  if (!bytes.length) return 'other';
  if (starts(bytes, '\x89PNG') || starts(bytes, '\xff\xd8\xff') || starts(bytes, 'GIF8') || (starts(bytes, 'RIFF') && starts(bytes, 'WEBP', 8))
    || (starts(bytes, 'BM') && bytes.length > 26 && !bytes.subarray(6, 10).some(Boolean)) || (starts(bytes, 'ftyp', 4) && BRANDS.test(new TextDecoder('latin1').decode(bytes.subarray(8, 12))))) return 'image';
  if (starts(bytes, '\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1')) return new TextDecoder('latin1').decode(bytes).includes('W\0o\0r\0d\0D\0o\0c\0u\0m\0e\0n\0t') ? 'doc' : 'other';
  if (starts(bytes, 'PK\x03\x04') || starts(bytes, 'PK\x05\x06')){
    const z = unzip(bytes), names = z.names;
    if (names.includes('word/document.xml')) return 'docx';
    if (names.includes('content.xml')){      // an .ods or .odp has a content.xml too: its mimetype says what it is
      const mime = z.stored('mimetype');
      return !mime || new TextDecoder().decode(mime).startsWith('application/vnd.oasis.opendocument.text') ? 'odt' : 'other';
    }
    return (names.includes('QuickLook/Preview.pdf') || names.includes('Index/Document.iwa')) && !names.some(n => /^Index\/Slide/.test(n)) ? 'pages' : names.some(n => /(^|\/)positions\.csv$/i.test(n)) ? 'linkedin' : 'other';      // after the ZIP: a Pages file may start with its stored PDF
  }
  if (/(^|[\r\n])%PDF-/.test(new TextDecoder('latin1').decode(bytes.subarray(0, 1024)))) return 'pdf';      // as a PDF reader finds it: at the start of a line near the top
  if (bytes.subarray(0, 8192).includes(0) && !(bytes[0] === 0xff && bytes[1] === 0xfe) && !(bytes[0] === 0xfe && bytes[1] === 0xff)) return 'other';      // binary (UTF-16 has zero bytes too)
  const text = decode(bytes), head = text.slice(0, 4096);
  if (/^\s*[{[]/.test(text)) try { JSON.parse(text); return 'json'; } catch { /* some other text */ }
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!doctype\s+svg|<svg[\s>])/i.test(head)) return 'image';
  if (/^\s*<(?:[a-z][\w-]*(?=[\s/>])|!|\?)/i.test(head)) return /^\s*<\?xml/i.test(head) && !/<(?:html|body)[\s>]/i.test(head) ? 'other' : 'html';
  return /^#{1,6}\s+\S|\*\*\S[^*\n]*\S\*\*|\[[^\]\n]+\]\([^)\n]+\)/m.test(text) || /\.(md|markdown)$/i.test(name) ? 'md' : 'txt';
}
