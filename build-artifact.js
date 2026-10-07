// Builds dist/artifact.html: the claude.ai prototype, everything inlined,
// using store-artifact.js instead of Supabase. Run: node build-artifact.js
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const body = html.split('<!-- app:start -->')[1].split('<!-- app:end -->')[0];
const out = [
  '<title>Cabin Haul</title>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;1,400&family=Sacramento&display=swap">',
  '<style>', fs.readFileSync('styles.css', 'utf8').trim(), '</style>',
  body.trim(),
  '<script>', fs.readFileSync('store-artifact.js', 'utf8').trim(), '</script>',
  '<script>', fs.readFileSync('app.js', 'utf8').trim(), '</script>', ''
].join('\n');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/artifact.html', out);
console.log('dist/artifact.html', out.length, 'bytes');
