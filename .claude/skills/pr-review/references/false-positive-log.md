# False-positive log — nsaw/mesh-maker

Findings a reviewer raised and then conceded. Recorded so the same argument
is not had twice. Before flagging something here, read why it was withdrawn:
usually the repo has a deliberate policy that a generic rule reads as a defect.

Append to this file whenever a /pr-review finding is rejected in review, with
the reason. It is the skill's only self-correcting surface.

- **grasshopper/components/noise_gen.py** — @nsaw, understood — withdrawing this suggestion. Thanks for pointing out the established convention; I'll stop flagging single-line if x: y guards in these files going forward. ---
  https://github.com/nsaw/mesh-maker/pull/16#discussion_r3592795860

- **src/noise/voronoi-relief.ts** — @nsaw, confirmed — the current voronoi-relief.ts has no controlPointsPhys/density-cut logic left; generateSites only modulates density via the attractor mask and densityNoiseGen, while radialGrow now purely scales focalExpand against the continuous radius field R in Pass 2. The v14 mechanism this comment targeted is gone, so the concern doesn't apply to v16. Thanks for the pointer to d7d5ddd.
  https://github.com/nsaw/mesh-maker/pull/16#discussion_r3592796935

- **cli/voronoi-relief.spec.ts** — @nsaw, agreed—the disc-based sector sampling is the better fit for direction-dependent petal walls. It avoids the square’s diagonal bias without incorrectly requiring every enclosing ridge to occur at one fixed radius. The measured 7-of-8 rises also support the revised threshold. ---
  https://github.com/nsaw/mesh-maker/pull/16#discussion_r3599830595

