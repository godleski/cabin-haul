// Builds dist/artifact.html (the claude.ai prototype, everything inlined, using store-artifact.js instead of Supabase)
// and dist/casino-artifact.html (the same app in casino-only mode, the casino's own artifact; the live site has no such
// page, by Mitch's call). Run: node build-artifact.js
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const body = html.split('<!-- app:start -->')[1].split('<!-- app:end -->')[0];
function artifact(title, flag) {
  return [
    '<title>' + title + '</title>',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;1,400&family=Yellowtail&display=swap">',
    '<style>', fs.readFileSync('styles.css', 'utf8').trim(), '</style>',
    body.trim(),
    '<script>', fs.readFileSync('secrets.js', 'utf8').trim(), '</script>',
    // The prototype can't be opened from the group-text link, so the artifact carries the trip password itself.
    // trip-password.txt is gitignored; the live site gets the password from the link instead.
    '<script>' + (fs.existsSync('trip-password.txt') ? 'window.TRIP_LINK_KEY = ' + JSON.stringify(fs.readFileSync('trip-password.txt', 'utf8').trim()) + ';' : '') + (flag ? ' window.CASINO_ONLY = true;' : '') + '</script>',
    '<script>', fs.readFileSync('store-artifact.js', 'utf8').trim(), '</script>',
    '<script>', fs.readFileSync('liv-questions.js', 'utf8').trim(), '</script>',
    '<script>', fs.readFileSync('app.js', 'utf8').trim(), '</script>', ''
  ].join('\n');
}
fs.mkdirSync('dist', { recursive: true });
const main = artifact('Cabin Haul', false), cas = artifact('Terry’s Casino', true);
fs.writeFileSync('dist/artifact.html', main);
fs.writeFileSync('dist/casino-artifact.html', cas);
console.log('dist/artifact.html', main.length, 'bytes;', 'dist/casino-artifact.html', cas.length, 'bytes');
