// Not from OpenResume. A Pages file holds a PDF of its first pages (QuickLook/Preview.pdf): this returns those bytes for the PDF reader.
// shortcut: the preview is a picture of the pages as Pages drew them, and may be only the first page; a Pages file with no preview cannot be read.
import { unzip } from './unzip.js';

export async function readPages(bytes){
  const pdf = await unzip(bytes).read('QuickLook/Preview.pdf');
  if (!pdf) throw Object.assign(new Error("BrewCV can't read this type"), { code: 'unreadable' });
  return pdf;
}
