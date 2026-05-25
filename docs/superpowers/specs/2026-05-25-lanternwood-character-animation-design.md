# Lanternwood Character Animation Design

## Summary

Upgrade The Lanternwood Athenaeum from circular agent tokens to a game-like animated living-library scene.

The new scene should feel like a warm magical athenaeum where each agent is a small character avatar that walks, idles, works, and reacts to task events. This is still a code-native PixiJS implementation for the next iteration, not an AI-generated sprite-sheet pipeline.

## Goals

- Replace circular agent markers with stylized chibi-like character avatars built from PixiJS primitives.
- Give each agent a recognizable silhouette, color, and role-specific prop.
- Add state-based animation for `idle`, `planning`, `moving`, `working`, `reporting`, `reviewing`, `done`, and `failed`.
- Make agents move through the scene when task events happen instead of teleporting or only changing opacity.
- Redesign the background into a richer Lanternwood library environment.
- Keep the existing event-driven architecture: `RunAdapter -> AgentEvent -> reducer -> React panels + PixiJS scene`.
- Preserve deterministic Playwright screenshot/pixel QA.

## Non-Goals

- No external game engine.
- No Spine/Aseprite pipeline yet.
- No AI-generated sprite sheets in this slice.
- No live OpenAI Agents SDK integration.
- No backend persistence or real agent execution.

## Visual Direction

The art direction is "warm storybook sky-library":

- Dark green and midnight teal room base.
- Golden lantern light, glowing desk, book stacks, shelves, balcony shapes, and window/starscape hints.
- Characters should look like small game units, not UI badges.
- Avoid pure marketing-style decoration, blurry backgrounds, or decorative orbs.
- Keep the scene readable at dashboard size.

## Agent Avatar Concepts

Each avatar is constructed from reusable Pixi parts:

- head
- hair/hood/hat
- torso/robe
- arms
- legs/feet
- prop
- shadow
- small status effect layer

Agent-specific styling:

- `Luma`: chief librarian, golden robe, small lantern or book, central coordinator.
- `Orion`: star-map researcher, blue cloak, telescope or star chart.
- `Neria`: archivist, green robe, scroll or ledger.
- `Quill`: scribe, purple robe, feather quill.
- `Argus`: reviewer, rust robe, watch lantern or monocle-like glow.

## Animation States

The implementation should introduce an animation model that maps reducer state to avatar behavior.

- `idle`: breathing bob, subtle blink, small hand sway.
- `planning`: head nod, open book or thought sparkle.
- `moving`: walk cycle with leg swing and slight body bounce.
- `working`: prop motion and glow pulse.
- `reporting`: turn toward central desk and raise prop.
- `reviewing`: Argus-style scanning glow; non-Argus agents use attentive pose.
- `done`: short completion bounce, then calm stance.
- `failed`: dimmed stance with small red warning pulse.

Movement should interpolate between positions over time. Agents should move toward role-specific work spots during active events:

- `Luma`: central desk.
- `Orion`: star-map balcony.
- `Neria`: archive shelf.
- `Quill`: writing desk.
- `Argus`: review/watch corner.

## Scene Background

Replace the simple rounded rectangle with layered Pixi graphics:

- back wall gradient-like bands made from flat shapes
- tall bookshelves on left and right
- arched window with star dots
- central wooden desk with warm lamp glow
- floor ellipse or rug for depth
- small floating page/sparkle details, kept subtle
- labels are not needed in the scene itself; UI panels already carry text

The scene should remain deterministic enough for screenshot comparison.

## Architecture

Add small world modules:

- `src/world/avatarParts.ts`: reusable drawing helpers for body parts and props.
- `src/world/avatarAnimation.ts`: status-to-pose and movement interpolation helpers.
- `src/world/sceneBackground.ts`: background drawing helpers.
- `src/world/AgentSprite.ts`: creates a character container instead of a ring token.
- `src/world/LanternwoodScene.tsx`: owns Pixi stage lifecycle and ticker-driven updates.

The Pixi scene still receives only `RunState` from React. Pixi may keep display-object instances and animation clocks, but must not own business state or mutate reducer state.

## Data Flow

1. Mock adapter emits `AgentEvent`.
2. Reducer updates `RunState`.
3. `AppShell` passes `RunState` to `LanternwoodScene`.
4. `LanternwoodScene` compares current agent statuses and timeline information.
5. Character instances animate toward target scene positions and poses.
6. React panels continue to render the operational truth.

## Testing

Unit tests:

- avatar animation target selection
- status-to-pose mapping
- scene layout target positions

E2E tests:

- canvas is visible
- expected background colors exist
- avatar-specific colors exist before and after a run
- task submission fills ordered timeline
- per-agent statuses are correct
- final screenshot snapshot still matches

The e2e pixel thresholds should be updated from token colors to character/background color buckets.

## Acceptance Criteria

- The scene no longer displays circular token avatars.
- Each agent has a character-like body and role-specific prop.
- At least `idle`, `moving`, `working/reviewing`, and `done` have visible animation differences.
- Agents move or pose differently as events progress.
- Background reads as The Lanternwood Athenaeum, not a plain panel.
- `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`, and `npm run e2e` pass.
- Fresh subagent review pass reports no actionable findings before handoff.

## Risks

- Code-native character art can look simple if shapes are too abstract. Mitigation: use layered silhouettes, props, shadows, and motion.
- Pixi imperative animation can fight React lifecycle. Mitigation: keep business state in reducer, keep Pixi state limited to display objects and animation interpolation.
- Screenshot snapshots can become brittle if animation is nondeterministic. Mitigation: pause or settle animation before snapshot, or assert stable color buckets plus a controlled final frame.
