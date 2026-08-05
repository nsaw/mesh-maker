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

```
LAYER 0  CORE          invariant, never overridden        <- this file
LAYER 1  MODALITY      spoken vs written diverge hard
LAYER 2  REGISTER      five surfaces, each a delta on core
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

**Locked sign-off — YouTube VO only**, 17 occurrences unchanged over four years: `I'm Nick, and I'll catch you on the next one. Peace.` It closes spoken video scripts and nothing else. Never append it to blog, portfolio, product, email, App Store, correspondence, or social copy. Governed by `references/03-youtube-vo.md`.

**Spoken-only scaffolding** — invisible in VO, padding on a page. Strip in written registers: `a little bit`, `go ahead and`, `a lot of`, `I'm going to`, `kind of`, `sort of`.

---

## LAYER 4: MECHANICAL GATE

Run before any draft reaches Nick. Reject and regenerate on failure.

Every routed register maps to exactly one base gate. Do not infer one — look it up:

| Register sheet | Base gate | Also applies |
|---|---|---|
| `03-youtube-vo.md` | Spoken | — |
| `04-sponsor-midroll.md` | Spoken | Selling |
| `06-social-and-peer.md` | **Written** | — |
| `02-sawyer-design.md` | Written | — |
| `05-correspondence.md` | Written | — |
| `01-thoughtmarks.md` | Written | Selling **on selling surfaces only** (App Store, ads, pricing, CTAs). Non-selling Thoughtmarks copy — changelogs, docs, support, in-app microcopy — is Written alone. |

- **Spoken** (delivered aloud): burstiness 0.70-1.10, sentences <=7w at 20-45%, hedges >=5/1k, sentence-initial "And" >=8%
- **Written** (read on a page): burstiness >=0.55, hedges >=2/1k
- **Selling** (a specific ask): **I:you <= 0.5 AND you-words >= 45/1k**

Social is **Written**, not Spoken. Captions, Reddit, and DMs are typed text; holding them to
spoken burstiness and an 8% sentence-initial "And" produces a transcript impression of
someone talking, which is not what those surfaces look like. `02-sawyer-design.md` COMMERCIAL
is the one register where near-zero hedging is correct and the Written hedge floor does not
apply — that sheet says so explicitly and it wins.
- **All**: em dashes <=2/1k, zero anti-corpus patterns (A1-A22 are validated), zero hits on the banned phrasebook. **The phrasebook is provisional** — `humor-and-hooks.md` measured it on a partial corpus and Nick has already struck eight entries. A hit is a stop-and-ask, not an automatic reject: if the phrase turns out to be his, it comes off the list.
- **Device density**: max 1 signature device per 400 words spoken / 600 written, never the same device twice in a passage
- **Joke test**: every joke must survive the deletion test in `humor-and-hooks.md`. If removing it costs no information it is decorative — **and decorative is not automatically cut**. Per that file, a decorative joke survives when it *costs him something* (being fat, lazy, broke, wrong four times about one hole). Cut the decorative joke that costs him nothing, or that costs the audience something. Load-bearing is a tiebreaker, not a gate.

Known interaction: broadening a sponsor read's use cases pushes I:you *up* unless the broadening stays in second person. "your keyboard, your car vents," not "the keyboard, the car vents."

---

## ROUTER

Always read `references/devices.md`, `references/anti-corpus.md`, and **`references/humor-and-hooks.md`** (mandatory before any joke, hook, pun, or wordplay). Then the register sheet:

| Surface | Read |
|---|---|
| Thoughtmarks site, email, social, App Store, ads | `references/01-thoughtmarks.md` |
| sawyerdesign.io portfolio, services, blog, product copy | `references/02-sawyer-design.md` |
| YouTube voiceover and scripts | `references/youtube-premise.md` **first**, then `references/03-youtube-vo.md` (LAW 3: premise outranks prose — prose cannot save a package-less build) |
| Sponsor midroll integrations | `references/04-sponsor-midroll.md` |
| Commission replies, client mail, brand pitches | `references/05-correspondence.md` |
| Instagram, Reddit, captions, DMs | `references/06-social-and-peer.md` |
| Scoping or titling a build, or diagnosing a flop | `references/youtube-premise.md` |

Every register sheet ends with at least one **approved exemplar** — a passage Nick marked SHIP in blind review, with its measured numbers. Imitate the exemplar before inventing.

---

## HOUSEKEEPING

Nick's YouTube scripts directory contains full transcripts from three other creators. Any tool that reads it wholesale ingests strangers and calls the result Nick. Never sample or draw exemplars from files not verified as his.
