---
name: voice-system
description: >
  Nick Sawyer's language system. A design system for prose: measured idiolect tokens at the
  core, register themes on top. Use for ANY writing that has to sound like Nick — YouTube VO
  and scripts, sponsor midroll integrations, sawyerdesign.io portfolio/blog/product copy,
  Thoughtmarks marketing and app copy, commission replies, client and brand pitch email,
  Instagram and social captions, YouTube titles and descriptions. Also use when reviewing or
  rewriting copy meant to sound like Nick, when a draft "doesn't sound like me," when scoping
  or framing a YouTube build, or when any other skill is about to generate customer-facing
  copy for Sawyer Design or Thoughtmarks.
---

# Nick Sawyer Voice System

A design system for prose. Measured tokens at the core, register themes on top. Built from 26,227 words of Nick's written scripts, 12,748 words of delivered transcripts, a raw dictation-to-camera pair on the same build, peer text messages, and sent mail. Validated over three rounds of blind draft review until every register shipped.

## Why the old skills produced slop

They described his voice with adjectives: "irreverent, design-literate, hands-dirty authentic." A model handed a vibe request produces the population mean of everyone ever described that way. His own `SCRIPTING TONES` file contained three prompts, all adjectives, and all three described *other creators*. That is the documented root cause.

**Never write from adjectives. Write from the mechanics, the devices, and the exemplars.**

---

## Architecture

```text
LAYER 0  CORE          invariant, never overridden        <- this file
LAYER 1  MODALITY      spoken vs written diverge hard
LAYER 2  REGISTER      six surfaces, each a delta on core
LAYER 3  STRUCTURE     per-register skeletons
LAYER 4  GATE          mechanical reject before human review
```

---

## LAW 1: THE HEDGE LAW

The largest single signal in the dataset.

| | hedges per 1k |
|---|---|
| Nick spoken | 9.9 |
| Nick raw dictation | 10.6 |
| Nick written | 3.2 |
| Machine drafts written as Nick | **0.2** |

A fifty-fold gap. "I think," "kind of," "a little," "probably," "sort of," "I guess," "honestly" are not filler. They are the epistemic posture that makes him sound like a man solving a problem on camera instead of a narrator reciting a solved one. Every style guide calls them weak, so every AI pass deletes them, and that deletion is what makes output a stranger.

Same content, two authors:

> **Nick:** "I think we should tackle this in the same order as a bucket of fried chicken, legs first."
> **Machine:** "We're starting this the same way you'd start a bucket of fried chicken. Legs first."

The joke survives. The only two words identifying the speaker do not.

**Rule: 9-11 per 1k spoken, 3-4 written. Never zero. Never inside the joke.** The highest-performing comparable channel in the genre hedges at 14.9 per 1k. Hedging is the register, not a weakness.

## LAW 2: THE TWO-PASS LAW

He drafts in one direction and delivers in the opposite one.

| | Draft | Delivered |
|---|---|---|
| sentence mean | 24 words | 13-15 |
| burstiness | 0.55 | 0.62-0.85 |
| revision direction | escalates, grows, filthier | compresses, cuts, warmer |

His `Stul` taxonomy bit exists twice; the revision is 1.6x longer and every change escalates. His ash bookend went 300 drafted words to 55 delivered, every statistic dumped, thesis kept, and "pretty damn cool" added at the mic appearing in no draft.

A machine wrote "The answer I landed on is this: Corners!" He said "The answer is corner." Singular, no exclamation, deposition register. And he *added back* rambling connective tissue on the approach.

**His mouth compresses punchlines and expands setups. Machines do the exact inverse.**

**Rule: two passes, never blended.** Pass 1 long, flat, over-explained, filthier than shippable. Pass 2 cuts to 55-60%, shortens every punchline, lengthens every approach, adds one warm word that was in no draft. A single-pass draft lands in the dead middle: too clean to be funny, too long to be tight.

## LAW 3: PREMISE OUTRANKS PROSE

Nick's own ranking: **premise > title > thumbnail > intro > script.**

This system governs the bottom two rungs. Its job is to stop good premises being wasted, not to grow anything on its own. For YouTube work, read `references/youtube-premise.md` **before** writing a word.

---

## CORE MECHANICS

| Metric | Spoken | Written | Machine (reject) |
|---|---|---|---|
| Sentence mean | 13-15 | 17.6 | 19.2 |
| Burstiness (sd/mean) | 0.85 | 0.55-0.86 | **0.56** |
| Sentences <= 7 words | 32% | 30% | **10%** |
| Conjunction-initial | **27%** | 5.7% | 3.0% |
| Sentence-initial "And" | **17.3%** | 2.0% | 1.5% |
| Questions | 5.0% | 6.5% | 1.8% |
| Profanity | 1.5/1k | 1.3/1k | 0.9/1k |
| Em dashes | 0.0/1k | 1.4/1k | **3.0/1k** |
| Digits and specifics | 10.3/1k | high | low |

Questions are addressed to himself or the object ("So, where are we headed?"), never to the audience ("Ever think about how to protect what matters most?").

**Locked sign-off — YouTube voiceover ONLY**, 17 occurrences unchanged over four years: `I'm Nick, and I'll catch you on the next one. Peace.` It closes spoken video scripts and nothing else. Never append it to blog, portfolio, product, in-app, email, App Store, correspondence, or social copy. Governed by `references/03-youtube-vo.md`; nothing else may emit it.

Scoping matters here, and it is why the rule carries its own surface list: this section states core rules that apply to every register, but the sign-off is a creator-video convention. Unscoped, it licenses appending "catch you on the next one" to a commission reply, an App Store description or in-app copy — surfaces this skill also routes.

**Spoken-only scaffolding** — invisible in VO, padding on a page. Strip in written registers: `a little bit`, `go ahead and`, `a lot of`, `I'm going to`, `kind of`, `sort of`.

---

## LAYER 4: MECHANICAL GATE

Run before any draft reaches Nick. Reject and regenerate on failure.

Every routed register maps to exactly one base gate. Do not infer one — look it up:

| Register sheet | Base gate | Also applies |
|---|---|---|
| `03-youtube-vo.md` | Spoken | — |
| `04-sponsor-midroll.md` | Spoken | Selling |
| `06-social-and-peer.md` | **Written, rhythm gate suspended** | — |
| `02-sawyer-design.md` | Written | — |
| `05-correspondence.md` | Written | — |
| `01-thoughtmarks.md` | Written | Selling **on selling surfaces only** (App Store, ads, pricing, CTAs). Non-selling Thoughtmarks copy — changelogs, docs, support, in-app microcopy — is Written alone. |

- **Spoken** (delivered aloud): burstiness 0.70-1.10, sentences <=7w at 20-45%, hedges >=5/1k, sentence-initial "And" >=8%
- **Written** (read on a page): burstiness >=0.55, hedges >=2/1k
- **Selling** (a specific ask): **I:you <= 0.5 AND you-words >= 45/1k**
- **Captions and peer text** (`06-social-and-peer.md`): the **rhythm** half of the Written gate — burstiness — is suspended. That sheet says so in as many words: "Rhythm gate suspended. Captions fragment harder than VO and that is correct." The hedge floor still applies and is not the binding constraint; the sheet sets hedges around 20/1k, an order above the Written floor. Anti-corpus, banned phrasebook and device density apply unchanged.

- **All**: em dashes <=2/1k, zero anti-corpus patterns (A1-A22 are validated)
- **Banned phrasebook**: a hit BLOCKS the draft, it does not auto-reject the phrase. The list is
  explicitly provisional (`humor-and-hooks.md:107` — "measured on a partial corpus and he has
  already removed eight entries from it. If a banned phrase is actually his, it comes off. Ask
  rather than assume"). Treating every hit as a confirmed ban rejects his own phrasing before a
  human ever sees it, which is the failure the provisional note exists to prevent. Rewrite if the
  phrase is generic; surface it for a decision if it might be his.
- **Device density**: max 1 signature device per 400 words spoken / 600 written, never the same device twice in a passage
- **Joke test**: apply `humor-and-hooks.md` in its stated order — the **observed vs constructed** test first, then load-bearing as a **tiebreaker**. That file is explicit ("Use load-bearing as a *tiebreaker*, not a gate") and names a confirmed exception: body self-deprecation (D19) is never load-bearing and is always his. Used as a universal gate, the deletion test cuts exactly the jokes Nick confirmed are most his. So: if removing a joke costs no information it is decorative, **and decorative is not automatically cut** — a decorative joke survives when it *costs him something* (being fat, lazy, broke, wrong four times about one hole). Cut the decorative joke that costs him nothing, or that costs the audience something.

Two routing subtleties the table cannot express:

**Social is not Spoken**, whatever the platform. Captions, Reddit, and DMs are typed text;
holding them to spoken burstiness and an 8% sentence-initial "And" produces a transcript
impression of someone talking, which is not what those surfaces look like. The exception is
social that is *performed* — Reels/TikTok/Shorts voiceover is delivered aloud and takes the
**Spoken** gate even though its copy routes through a social sheet. Gate by how it is
delivered, not by where it is posted.

**`02-sawyer-design.md` COMMERCIAL** is the one register where near-zero hedging is correct
and the Written hedge floor does not apply — that sheet says so explicitly and it wins.

Known interaction: broadening a sponsor read's use cases pushes I:you *up* unless the broadening stays in second person. "your keyboard, your car vents," not "the keyboard, the car vents."

---

## ROUTER

Always read `references/devices.md`, `references/anti-corpus.md`, and **`references/humor-and-hooks.md`** (mandatory before any joke, hook, pun, or wordplay). Then the register sheet:

| Surface | Read |
|---|---|
| Thoughtmarks site, **in-app copy**, email, brand-account social, App Store, ads | `references/01-thoughtmarks.md` |
| sawyerdesign.io portfolio, services, blog, product copy | `references/02-sawyer-design.md` |
| YouTube voiceover and scripts | `references/youtube-premise.md` **first**, then `references/03-youtube-vo.md` (LAW 3: premise outranks prose — prose cannot save a package-less build) |
| Sponsor midroll integrations | `references/04-sponsor-midroll.md` |
| Commission replies, client mail, brand pitches | `references/05-correspondence.md` |
| Instagram, Reddit, captions, DMs — personal account and community replies | `references/06-social-and-peer.md` |
| Scoping or titling a build, or diagnosing a flop | `references/youtube-premise.md` |

`social` appears on two rows on purpose, and the split is by ACCOUNT, not by platform: copy
published as Thoughtmarks routes to `01`, copy published as Nick routes to `06`. Without that
distinction a request for "social copy" could select either sheet.

Every register sheet carries at least one **approved exemplar** — a passage Nick marked SHIP in blind review. Imitate the exemplar before inventing.

Two things this contract deliberately does NOT claim, because the sheets do not do them: the exemplar is not always the LAST thing on the sheet (`02-sawyer-design.md`, `03-youtube-vo.md`, `05-correspondence.md` and `06-social-and-peer.md` all continue with guidance after theirs), and not every exemplar carries its own measured numbers — several sheets state the register's targets once at the top instead of per-passage. Read the sheet whole rather than jumping to the bottom.

---

## HOUSEKEEPING

Nick's YouTube scripts directory contains full transcripts from three other creators. Any tool that reads it wholesale ingests strangers and calls the result Nick. Never sample or draw exemplars from files not verified as his.
