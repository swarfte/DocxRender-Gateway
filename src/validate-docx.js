'use strict';

const PizZip = require('pizzip');
const { errors } = require('./errors');

const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const MSG = 'The templater field must contain a valid DOCX file.';

// Returns a PizZip instance so the package is only parsed once.
function loadDocx(buffer) {
  if (buffer.length < 4 || !buffer.subarray(0, 4).equals(ZIP_SIGNATURE)) {
    throw errors.unsupported(MSG);
  }
  let zip;
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

module.exports = { loadDocx };
