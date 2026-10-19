// Seals secrets.json (never committed) into secrets.js (committed, ciphertext only).
// Usage: node tools/seal-secrets.js "the trip passphrase"
// The page derives the same key from the passphrase (PBKDF2-SHA256, 300k rounds) and
// decrypts with AES-GCM in the browser, so the passphrase itself is never in the repo.
const fs = require('fs');
const { webcrypto } = require('crypto');
const pass = process.argv[2];
if (!pass) { console.error('usage: node tools/seal-secrets.js "passphrase"'); process.exit(1); }
(async () => {
  const plain = fs.readFileSync('secrets.json', 'utf8');
  JSON.parse(plain);   // must be valid JSON
  const enc = new TextEncoder();
  const salt = webcrypto.getRandomValues(new Uint8Array(16)), iv = webcrypto.getRandomValues(new Uint8Array(12));
  const base = await webcrypto.subtle.importKey('raw', enc.encode(pass.normalize('NFKC').trim().toLowerCase()), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 300000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const data = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
  const b64 = (u) => Buffer.from(u).toString('base64');
  const out = '// Encrypted with tools/seal-secrets.js. Ciphertext only: useless without the trip passphrase.\n' +
    'window.SECRETS = ' + JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), data: b64(data), rounds: 300000 }) + ';\n';
  fs.writeFileSync('secrets.js', out);
  console.log('secrets.js written,', data.length, 'bytes of ciphertext');
})();
