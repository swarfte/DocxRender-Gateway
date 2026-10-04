import PizZip from 'pizzip';
import { errors } from './errors';

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const MSG = 'The templater field must contain a valid DOCX file.';

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, i) => bytes[i] === byte);
}

// Returns a PizZip instance so the package is only parsed once.
export function loadDocx(buffer: Uint8Array): PizZip {
  if (!startsWith(buffer, ZIP_SIGNATURE)) {
    throw errors.unsupported(MSG);
  }
  let zip: PizZip;
  try {
    zip = new PizZip(buffer);
  } catch {
    throw errors.unsupported(MSG);
  }
  if (!zip.file('[Content_Types].xml') || !zip.file('word/document.xml')) {
    throw errors.unsupported(MSG);
  }
  return zip;
}
