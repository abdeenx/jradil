# jradil · جرادل

A daily word game in the spirit of Wordle, for Sudanese Arabic. Five letters, six
guesses, one word per day, and the whole interface in Modern Standard Arabic
(`dir="rtl"`).

The operator can pin the word of the day from an admin dashboard. If they have not
pinned one by midnight, the app picks one for them.

## The rules the app enforces

- **All words are five letters**, measured after folding Arabic spelling
  variants, so `مدرسة` and `مدرسه` count the same.
- **The clock is Sudan time** — UTC+2, fixed, no daylight saving. A "day" is the
  Sudan calendar day, stored as `YYYY-MM-DD`.
- **One word per day, fixed once the day begins.** A unique index on the day
  record guarantees every player sees the same word and that a second request
  cannot assign a different one.
- **If the operator pins a word before midnight, that word is used.**
- **Otherwise, the first request after midnight picks a random word from the
  candidate pool** — the operator's shortlist of Sudanese words.
- **An automatic pick is never repeated.** Once a word has been served it is
  retired from the pool permanently. The operator can still choose it by hand.
- Words are tracked for when they were served: each day record keeps the word and
  who chose it, and the word keeps its first and last served dates.
- **A word may carry a link** — a dictionary entry or article — which the player
  is offered once the puzzle is over.

Two deliberate edge cases:

- If the candidate pool runs dry, the day has no word. The dashboard says so
  loudly rather than repeating a word.
- A day nobody played is **not** back-filled, so a quiet week does not silently
  consume the pool.

## Data model

Everything lives in **one MongoDB collection, `jradil`**. Three record shapes
share it, told apart by a `kind` field (Mongoose discriminators, with the
discriminator key renamed from `__t` to `kind`):

| `kind`     | What it is                         | Key fields                                                                                                                            |
| ---------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `word`     | One valid five-letter word         | `text`, `normalized`, `dialect`, `pool`, `link`, `notes`, `assignedDateKey`, `firstServedDateKey`, `lastServedDateKey`, `timesServed` |
| `day`      | The puzzle served on one Sudan day | `dateKey`, `wordId`, `wordText`, `source` (`admin` \| `auto`), `revisions[]`                                                          |
| `settings` | The operator settings singleton    | `key`, `poolSize`, `enforceDictionary`                                                                                                |

Uniqueness is scoped per shape with partial indexes:

- `word_normalized_unique` — one document per folded spelling
- `day_datekey_unique` — one puzzle per day, ever
- `settings_key_unique` — one settings document
- `unknown_normalized_unique` — one queue row per folded spelling
- `subscription_endpoint_unique` — one row per browser subscription

The two word flags mean different things and are worth keeping apart:

- **`dialect`** — a Sudanese word, and therefore eligible to be the word of the
  day. Everything else in the collection is the guess list: valid words players
  can type but never be given.
- **`pool`** — shortlisted for the automatic pick. A subset of `dialect`; setting
  it implies the dialect flag, and clearing the dialect flag clears it too.

## Getting started

```bash
vp install
cp .env.example .env      # then fill it in
vp dev
```

### Environment

| Variable               | Required     | Purpose                                                                                                         |
| ---------------------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`          | yes          | Connection string. Add a database name to it — a URI without one makes MongoDB use its default `test` database. |
| `MONGODB_DB`           | no           | Pins the database name, overriding the URI.                                                                     |
| `ADMIN_PASSWORD`       | for `/admin` | The operator's password. Without it the dashboard refuses to open rather than falling back to a default.        |
| `ADMIN_SESSION_SECRET` | no           | Signing key for the session cookie. Defaults to `ADMIN_PASSWORD`.                                               |

Nothing else. The database needs no manual setup: the collection and its indexes
are created on first use, so the whole product can be operated without opening
Atlas.

## Admin dashboard

`/admin`, protected by `ADMIN_PASSWORD`. The session is a signed, `httpOnly`
cookie lasting twelve hours, and repeated wrong passwords are throttled.

The dashboard is built around one question — **is tomorrow covered?** — and it
answers it in a single line. Everything else is either secondary or folded away.

- **كلمة الغد** — the day's job. Either the pinned word, or a note that the app
  will pick automatically at midnight along with how many candidates are left.
  The picker opens on demand.
- **الاختيار التلقائي** — how much runway the automatic pick has, expressed in
  days rather than rows. One button refills the pool to its target from unused
  Sudanese words. The target is editable here, next to the thing it controls.
- **كلمة اليوم** — read-only, with the escape hatch folded behind a disclosure,
  because changing it affects players who are already playing.

Read-only detail lives in collapsed sections: the last eight served days, and the
dictionary totals.

### `/admin/words`

The dictionary, which is loaded in bulk and then left alone.

- **إضافة كلمات** — one box for everything: a single word, a pasted list, CSV or
  JSON. Two switches describe the phase being loaded.
- Search and filter (all / Sudanese / in the pool / served / unserved).
- Bulk marking for a whole selection: make Sudanese, add to the pool, or strip
  both flags.
- Per-row **بيانات** opens the metadata editor: the learn-more link the player
  will see, and a private note.
- The dictionary-validation switch, next to the count of words it applies to.

## Daily reminder

Players can ask to be reminded when the new word lands. The card sits below the
board — never a modal, so it does not interrupt a game — and is only shown while
the answer is still open:

| State                       | What the player sees                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| Supported, not yet asked    | **ذكّرني بكلمة اليوم** with an enable button and a **لاحقًا** dismissal                          |
| Subscribed                  | A line confirming it, with **إيقاف**                                                          |
| Declined, or dismissed      | Nothing, until the dismissal lapses after a week                                              |
| iOS, not installed          | A note to add the site to the home screen first — iOS only delivers push to an installed site |
| No VAPID keys on the server | A note that reminders are not set up                                                          |

**The reminder goes out at 15:00 Khartoum (13:00 UTC)**, for whoever subscribed.
Nothing is stored about who a subscriber is: a subscription is an endpoint and two
keys, so there is no account and no personal data.

### How it fires

A ticker inside the server process asks once a minute whether the reminder is due,
and the claim is recorded in the database before anything is sent. Three
consequences worth knowing:

- **It self-heals.** The check is "is it past 15:00 and has today not been sent",
  not "sleep until 15:00" — so a restart, a paused container or a clock change
  still sends the day's reminder. A day nobody was up for is not back-filled.
- **It cannot double-send.** The daily claim is a single conditional write, so two
  ticks — or two containers — cannot both decide to send.
- **It needs no external scheduler.** The ticker starts on the first request the
  server handles, which includes a container healthcheck, so a platform that
  probes the app arms it immediately.

If you would rather drive it from a scheduler you control:

```bash
curl -X POST "https://your-host/api/cron/reminder?secret=$CRON_SECRET"
```

The endpoint is safe to call at any time; it decides for itself whether there is
anything to do.

### Setting it up

Generate a key pair per deployment, and keep the private key on the server:

```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

Changing the keys invalidates every existing subscription — browsers will simply
re-subscribe when the player next visits, but they will miss a reminder until then.

## Words the dictionary refuses

When a player types a word the game does not know, the guess is rejected — and the word is
recorded. Players are the best source of what the dictionary is missing, and they also
mistype, so the result is a **review queue** rather than a list that only grows.

`/admin/words` shows it at the top, most-tried first, with a count per word:

- **أضف** — adds that one word to the dictionary
- **تجاهل** — drops it, for the mistypes
- **أضف الكل إلى القاموس** / **تجاهل الكل** — empties the whole queue either way
- **علّمها كلمات سودانية** — a switch that applies to whichever add you use. Off by
  default: a word a player reached for is a valid _guess_, which is not the same as a word
  worth serving as the answer.

The dashboard shows a count next to the dictionary totals whenever the queue is not empty,
so it is visible without going looking.

Two deliberate decisions:

- **The same word counts up rather than repeating.** Keyed on the folded spelling, so `زقزقه`
  and `زقزقة` are one row and repeated attempts raise its position instead of filling the
  queue with duplicates.
- **Recording never changes the outcome of a guess.** It is wrapped so a failure to write
  the queue cannot turn an accepted guess into an error, and words are collected whether or
  not dictionary enforcement is on — so the gap in the dictionary shows up either way.

For a step-by-step check of this on a live site, see
[docs/unknown-words.md](docs/unknown-words.md).

## Loading the dictionary in phases

Imports are idempotent: words match on their folded spelling and flags are only
overwritten when the payload states them explicitly, so re-running a file never
undoes marking work.

The phase switches are the two steps a dictionary is actually built in:

1. **General Arabic** — switch _كلمات سودانية_ off. The words become the guess
   list: typeable, never served.
2. **Sudanese** — switch it on, and optionally _أضفها إلى قائمة الاختيار
   التلقائي_ to also shortlist them for the automatic pick.

A row can override the switches by stating its own flags, so one file can carry
both kinds:

```csv
word,dialect,pool,link
طنجره,1,1,https://ar.wiktionary.org/wiki/طنجرة
عربيه,1,0,
مدرسه,0,0,
```

```json
[
  {
    "text": "طنجره",
    "dialect": true,
    "pool": true,
    "link": "https://ar.wiktionary.org/wiki/طنجرة"
  },
  { "text": "مدرسه", "dialect": false }
]
```

From the shell, for large files:

```bash
vp run db:import -- words.csv
node scripts/import-words.ts words.json
cat words.txt | node scripts/import-words.ts -
```

Rows that are not exactly five Arabic letters are skipped and reported, not
silently dropped.

## The learn-more link

A word can point at a page about itself — a Wiktionary entry, an article. When the
puzzle ends, won or lost, the result panel offers the player _اقرأ معناها في قاموس اللهجة السودانية_.

Only `http` and `https` are accepted; anything else is stored as no link, because
the value goes straight into an `href`. The link is read at reveal time rather
than copied onto the day, so adding one to a word that was served yesterday still
reaches today's players.

## Scheduled resolution

None is needed. `resolveDay` runs lazily, so the first request after midnight
fixes the day's word, and the unique day index keeps it stable for everyone
after. The dashboard resolves today on load, so a day is materialised the first
time the operator looks at it.

## Checks

```bash
vp check    # format, lint, type check
vp test     # unit tests, plus MongoDB integration tests when MONGODB_URI is set
vp build
```

The integration tests create their own scratch database and drop it afterwards,
so the configured database is never touched. They skip themselves when
`MONGODB_URI` is absent.

## Social preview card

Sharing the link anywhere that unfurls previews shows a 1200×630 card: the app's own
wordmark — one bucket per letter of `جرادل`, all filled — over the tagline.

`public/og-image.png` is generated, not drawn by hand. Regenerate it after changing the
name, the tagline or the bucket artwork:

```bash
vp run og-image
```

The script builds the card from the geometry in `src/lib/bucket.ts` — the same constants
the board draws from — and rasterises it with librsvg, which brings pango and harfbuzz so
the Arabic shapes properly. It reads its output size from `src/lib/social.ts`, which is
also where the `og:image:width` and `og:image:height` tags come from, so the declaration
and the file cannot disagree; a test reads the size back out of the PNG.

`APP_URL` has to be set for previews to work: platforms will not resolve a relative
`og:image`, so the tags use it to build an absolute address. Without it the image is
emitted as a path, which some clients still resolve and the rest ignore.

## Sharing a result

The end-of-game panel copies a summary to the clipboard:

```
جرادل — الثلاثاء، 13 أكتوبر
3/6
‏🫗🟨🫗🫗🫗
‏🫗🟨🪣🫗🟨
‏🪣🪣🪣🪣🪣

الكلمة القادمة بعد 07:04:09
‎https://jradil.example.com
```

One emoji per letter state, echoing the bucket the board draws: 🪣 for a letter in its
right place, 🟨 for one that is in the word but elsewhere, and 🫗 for one that is not
in the word at all — the water it could not keep. Each row carries a right-to-left
mark so it lays out the way the board does, and the address carries a
left-to-right mark so clients do not reorder its tail.

The countdown is read from the clock when the player taps share, not from the page
load, so a message sent late in the evening is still accurate.

## Notes on Arabic

`src/lib/arabic.ts` folds the spelling differences an Arabic reader ignores —
`أ إ آ ا`, `ة ه`, `ى ي`, `ؤ و` — and the letters Sudanese dialect uses for /g/
and /v/ (`ڨ گ ڤ پ چ`). Diacritics, tatweel and zero-width marks are removed.

Both the guess and the answer are folded before comparison, so typing `ا` where
the stored word has `أ` counts as correct. Letter marking runs on the folded
letters, so a repeated letter is only marked as often as it truly occurs in the
answer.

The tiles and the on-screen keypad show only the 28 base letters, which is why
the keypad has three rows of ten, nine and nine rather than the full Arabic
keyboard.

## Deployment

Nitro builds a self-contained Node server:

```bash
vp build
node dist/server/index.mjs
```

Push `dist/` to any Node host and set the environment variables there. See
<https://v3.nitro.build/deploy> for host-specific presets.
