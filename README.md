# Cabin Haul (shared cabin list)

A one-page shared list your friends open from an iMessage link. Anyone adds
things we should bring (food, drinks, booze, snacks, supplies) and taps +1 on what
they want. Everyone sees everyone's entries live. By trip day you have a ranked,
copy-ready shopping list. No accounts needed.

Two free services do the work:

- **Supabase** stores the options and votes (free tier, no credit card).
- **Netlify** hosts the page (free tier). Any static host works: GitHub Pages,
  Cloudflare Pages, Vercel.

## Setup (about 10 minutes)

### 1. Create the database

1. Go to https://supabase.com, sign up, and click **New project**. Any name and
   region. Save the database password it asks for, though you won't need it again.
2. Wait for the project to finish provisioning (a minute or two).
3. In the left sidebar open **SQL Editor** > **New query**. Paste the whole
   contents of `schema.sql` and click **Run**. You should see "Success".
   The bottom of `schema.sql` adds nine starter items. Delete those lines
   first if you want a blank slate.
4. In the left sidebar open **Project Settings** > **API**. Copy two values:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public** key under "Project API keys" (a long string starting with `eyJ`)

### 2. Connect the page

Make a copy of `config.example.js` named `config.js` and paste in the two
values:

```js
window.CABIN_CONFIG = {
  supabaseUrl: 'https://abcdefgh.supabase.co',
  supabaseAnonKey: 'eyJ...'
};
```

`config.js` is the only file you ever edit. Updates to `index.html` leave it
alone. The anon key is designed to be public, so it is fine to commit.

### 3. Host the page

**Quick way (drag and drop):** go to https://app.netlify.com/drop, drag the
folder (with your `config.js` inside) onto the page, and Netlify gives you a
link like `https://something-random.netlify.app`. Every later change means
dragging the folder again.

**Set-and-forget way (recommended while the page keeps changing):**

1. Put this folder in a GitHub repo, `config.js` included.
2. In Netlify choose **Add new site** > **Import an existing project** >
   GitHub, pick the repo, leave the build settings empty, and deploy.

Now every push to the repo redeploys the site in about a minute. Paste the
site link into the group chat once; it never changes.

## Using it

- Everyone sees the same list, grouped by category and sorted by +1s. Items
  with three or more +1s get a green outline.
- The filter row narrows to one category.
- **Copy list** at the bottom copies a checkbox shopping list grouped by
  category with +1 counts and notes, ready to paste into Notes or Reminders.
- To see or fix the raw data, open Supabase > **Table Editor** > `items` or
  `plus_ones`. Delete or rename anything there and every phone updates within
  seconds.

## Good to know

- People are identified by a random id saved in their browser, so each person
  can change their +1s later from the same phone, and can remove an item they
  added as long as nobody else has +1'd it. A second device counts as a second
  person.
- The anon key is meant to be public. The rules in `schema.sql` only allow
  reading, adding and removing items, and giving or taking +1s. Nobody can
  touch anything else in your project with it.
- Anyone with the link could remove items or +1s through the browser console.
  For a friend group this is fine. If that matters, say so and the delete
  rules can be tightened.
- Free Supabase projects pause after a week with no activity. Open the
  dashboard and click **Restore** if that happens.
