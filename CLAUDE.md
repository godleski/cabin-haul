# Cabin Haul — working notes for Claude

- Iterate on the `wip` branch; commit and push `wip` after every change.
- Mitch said (2026-10-25) "Go live with all commands as soon as typed": after every change, push `wip` to `main`
  right away without waiting for a separate "push it live".
- Prototype lives in the claude.ai artifact https://claude.ai/artifact/JiW8YZTxixgH29K1zrYQvv
  (capabilities db/user/assets). Publish `dist/artifact.html` after each change.
- Terry’s Casino also has its own artifact, for sending to Terry: https://claude.ai/artifact/61QHukFsikeAGRZkZgDx2B
  (built to `dist/casino-artifact.html`, same capabilities, its own database). Publish both artifacts after each change.
  It is the same app.js with `window.CASINO_ONLY` set. The live site gets no casino-only page (Mitch, 2026-10-26).
- Don't touch Supabase SQL while prototyping. Go-live should need one SQL run.
- Door codes live encrypted in `secrets.js` (sealed from the gitignored `secrets.json` by
  `node tools/seal-secrets.js "<trip password>"`). The link sent to the group carries the password
  after a hash, `<site url>#k=<trip password>`, so the page unlocks itself; the password form on the
  FAQ page is only the fallback. Re-sealing with a new password means re-sending the link.
  The artifact build stamps the password in from the gitignored `trip-password.txt` so the prototype
  unlocks itself; keep that file in step with the sealed password.
- The casino stays live indefinitely (Mitch, 2026-10-25): never retire it, date-gate it, or ring the closing bell
  for him. It never closes.
- Everyone is on iPhone: send phone-width screenshots for visual changes, keep 60fps.

## Go-live reminder

When Mitch asks to go live, remind him he wanted to run that pass under
**ultracode** (put "ultracode" in the message) so independent agents audit the
Supabase SQL, the store adapters, and every tab against the artifact behavior
before `wip` is merged to `main`.
