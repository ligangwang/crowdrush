# AGENTS.md

Notes for AI coding agents working on Crowd Rush.

- This is a dingn game published like any outside developer's game: the
  dingn website (repo `ligangwang/dingn`) runs it in a sandboxed frame and the
  game talks to it only through the SDK in `sdk/`. Don't import from the
  dingn repo. Refresh `sdk/` with `npm run update-sdk`.
- Run `npm test` before committing. `npm run pack` builds the upload zip.
- Merging to `main` publishes on dingn (`.github/workflows/release.yml`)
  when `version` in `game.json` is new.
- Bump `version` in `game.json` for every release; dingn refuses a version it
  already has.
- Save with `sdk.storage` / `sdk.progress`, never `localStorage` or cookies,
  which the sandbox blocks. Keep every URL relative (`base: "./"`).
- UI strings go through `t()`. English is the source text; every other
  language in game.json's `languages` has a pack in `src/locales/<lang>.json`
  mapping the English text to its translation (`{0}` patterns allowed). Add a
  new string to every pack (a test checks they all have the same keys and
  placeholders). The player can switch language mid-game (`sdk.onLanguage`),
  so read text through `t()` at render time, not once into state.
- The characters (soldiers, guns, brutes, bosses) are built from code in
  `src/crowd-figures.ts` and are the game's own. Keep it that way: add no
  model or picture whose licence asks for credit (CC BY and the like). The
  land and roadblocks are CC0 files from Poly Haven; list any new file in
  `public/models/CREDITS.md` with its licence.
