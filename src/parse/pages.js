// Not from OpenResume. A Pages file holds a PDF of its first pages (QuickLook/Preview.pdf): this returns those bytes for the PDF reader.
// A modern Pages file holds a picture of its first page, not a PDF: that is refused with the code 'pages-preview', so the caller can ask for a .docx or a PDF.
// shortcut: the preview is a picture of the pages as Pages drew them, and may be only the first page.
import { unzip } from './unzip.js';

export async function readPages(bytes){
  const pdf = await unzip(bytes).read('QuickLook/Preview.pdf');
  if (!pdf) throw Object.assign(new Error('This Pages file has only a picture of its first page'), { code: 'pages-preview' });
  return pdf;
}
