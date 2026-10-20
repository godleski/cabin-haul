// Re-seals secrets.json into secrets.js using the trip password kept in the gitignored trip-password.txt,
// so the password never has to be typed on a command line. Usage: node tools/reseal.js
const fs = require('fs'), path = require('path');
const pass = fs.readFileSync(path.join(__dirname, '..', 'trip-password.txt'), 'utf8').trim();
if (!pass) { console.error('trip-password.txt is empty'); process.exit(1); }
process.argv[2] = pass;
require('./seal-secrets.js');
