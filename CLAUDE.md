# Cabin Haul — working notes for Claude

- Iterate on the `wip` branch; commit and push `wip` after every change.
- Never merge or push `main` unless Mitch says "push it live".
- Prototype lives in the claude.ai artifact https://claude.ai/artifact/JiW8YZTxixgH29K1zrYQvv
  (capabilities db/user/assets). Publish `dist/artifact.html` after each change.
- Don't touch Supabase SQL while prototyping. Go-live should need one SQL run.
- Everyone is on iPhone: send phone-width screenshots for visual changes, keep 60fps.

## Go-live reminder

When Mitch asks to go live, remind him he wanted to run that pass under
**ultracode** (put "ultracode" in the message) so independent agents audit the
Supabase SQL, the store adapters, and every tab against the artifact behavior
before `wip` is merged to `main`.
