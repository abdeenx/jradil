# Testing the review queue in public

A walkthrough for verifying, on a live deployment, that words the dictionary
refuses are collected and can be reviewed. The feature is described in the main
[README](../README.md#words-the-dictionary-refuses); this file is only about
proving it works.

Everything here is done through the public site and the admin dashboard. No
database console is required until the optional last section.

---

## Read this first

**Only well-formed guesses are recorded.** A word has to be **exactly five Arabic
letters**. Anything else — four letters, six letters, anything Latin, anything
with a space — is rejected before the dictionary is consulted, so it is never
queued. This is the single most likely reason to think the feature is broken.

**A word already in your dictionary is never queued.** If you type a real word
from your list and the game accepts it, there is nothing to review.

So to test, you need a string of exactly five Arabic letters that you are
confident is **not** in your dictionary. Invented words are ideal — the examples
below use `زقزقه` and `بربشه`.

If you type one of those and the game **accepts** it, then it happens to be in
your dictionary. Pick another nonsense word.

---

## What you need

|                             |                                                       |
| --------------------------- | ----------------------------------------------------- |
| The public URL              | whatever `APP_URL` is set to                          |
| The admin password          | `ADMIN_PASSWORD`                                      |
| A phone or a private window | so a returning player's saved game does not interfere |

You do not need shell access to the server. Everything except the last section is
verified by looking at the site.

---

## 1. Is the deployed build the one with the feature?

Open the admin dashboard and look at the dictionary line:

1. Go to `https://your-domain/admin`.
2. Sign in.
3. Find the line beginning **القاموس:**.

If the build is current, that line can now show a third item — a count such as
**3 كلمة رفضها القاموس** — but only when the queue is not empty, so its absence
proves nothing yet.

Better check: go to **`/admin/words`**. The top card should read
**كلمات رفضها القاموس**. If it is there, the build is current. If the page has no
such card, the deployment is running an older commit.

---

## 2. Fill the queue

Open the game in a phone browser or a private window, so you start with a fresh
board.

1. Open `https://your-domain/`.
2. Type a nonsense five-letter word, for example **`زقزقه`**.
3. Press **إدخال**.

Expected: a red line reading **هذه الكلمة غير موجودة في القاموس**, and the guess
is not accepted.

4. Now submit the **same** word again.
5. Then submit a **different spelling** of it — swap the `ه` for `ة`, so
   **`زقزقة`**.
6. Finally submit a second nonsense word, for example **`بربشه`**.

That is three attempts across two spellings of one word, plus one attempt at
another.

> **If your deployment has dictionary checking switched off**, unknown words are
> accepted silently and the red line never appears — but they are still recorded.
> The queue fills either way. To turn checking back on, use the
> **التحقق من القاموس** switch at the bottom of `/admin/words`.

---

## 3. Review the queue

Still signed in, go to **`/admin/words`** and look at the top card.

| Check           | Expected                                                                    |
| --------------- | --------------------------------------------------------------------------- |
| Row for `زقزقه` | present, with an attempt count of **3** — two spellings folded into one row |
| Row for `بربشه` | present, count **1**                                                        |
| Order           | most recently tried first, so `بربشه` is above `زقزقه`                      |

The count being 3 rather than two separate rows is the important part: the queue
is keyed on the folded spelling, which is also what the game compares guesses
with.

### Add one word

1. Find the `بربشه` row.
2. Press **أضف**.

Expected: a confirmation that it was added, and **that row disappears**. The
other row stays.

### Add everything

1. Press **أضف الكل إلى القاموس**.

Expected: a summary like _1 كلمة أُضيفت، و0 كانت موجودة أصلًا_, and the card falls
back to **لا توجد كلمات بانتظار المراجعة**.

### Check the dashboard notices

Go back to **`/admin`**. The dictionary line should no longer show a count, because
the queue is empty now.

---

## 4. Prove the added word is really usable

This is the part worth doing, because it is the whole point.

1. Return to the game in the same private window.
2. Submit **`بربشه`** again.

Expected: **no red line**. The word is accepted and marked against today's answer
like any other guess — it is a dictionary word now.

If you are out of attempts from section 2, open a fresh private window and submit
it there.

### The dialect switch

The **علّمها كلمات سودانية** switch affects whichever add you use next.

- **Off (default)** — the word becomes a valid _guess_ only. It can never be the
  answer.
- **On** — it also becomes eligible to be the word of the day.

To confirm: queue a nonsense word, tick the switch, press **أضف الكل**, then look
up that word on `/admin/words` using the search box with the **سودانية** filter.
It should be listed. Note that added words never join the auto-pick pool on their
own — that stays a separate decision.

---

## 5. Prove a mistyped word can be discarded

Players mistype, so the queue needs emptying as well as filling.

1. Submit a third nonsense word, for example **`خرخشه`**.
2. Go to `/admin/words` and confirm its row appears.
3. Press **تجاهل** on that row.

Expected: the row disappears, and the word is **not** added — check by searching
for it on the same page with the filter set to **كل الكلمات**. It should not be
found, and submitting it in the game should still show the red line.

**تجاهل الكل** does the same for the whole queue.

---

## 6. What real players will do for you

On a public site the queue fills by itself. After a day of real play, open
`/admin/words` and read the top of the queue: those are the words people actually
reached for and your dictionary did not have. Whether each one is a real word you
are missing or a typo is the judgement the queue exists to support.

Two things to expect:

- **Counts of 1 are usually typos.** Counts of several mean people are trying to
  play that word.
- **A busy queue is a dictionary gap, not a bug.** The frequency order is the
  signal — work from the top.

---

## Troubleshooting

| Symptom                                                    | Likely cause                                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| No red line when typing a nonsense word                    | Dictionary checking is off — the word was still recorded. Check the queue.                                                                      |
| The queue stays empty after a nonsense word                | The word was not exactly five Arabic letters. Four or six letters, Latin, or a space are rejected before recording.                             |
| The queue stays empty and the word was five Arabic letters | The word is already in your dictionary, so nothing needed reviewing.                                                                            |
| The queue is empty and `/admin/words` has no queue card    | The deployment is running a commit from before this feature.                                                                                    |
| Two spellings of one word appear as two rows               | The unique index on the folded spelling was not built. It is created on first use, so a look at the indexes (below) will say whether it exists. |
| Adding reports words as _موجودة أصلًا_                       | Those words were already in the dictionary; their queue rows are still cleared.                                                                 |

---

## Reading the queue directly (optional)

Only if you want to look behind the dashboard. The whole application state is one
collection, and the queue is the documents tagged `kind: "unknown"`:

```js
// how many words are waiting
db.jradil.countDocuments({ kind: "unknown" });

// the queue, most recently tried first — the order the dashboard shows
db.jradil.find({ kind: "unknown" }).sort({ lastAt: -1 }).limit(20);

// what keeps two spellings of a word from becoming two rows
db.jradil.getIndexes().find((index) => index.name === "unknown_normalized_unique");
```

Do not insert into `kind: "unknown"` by hand — the dashboard's add and ignore
actions keep the queue and the dictionary consistent, and hand-written rows would
not be cleared by either.
