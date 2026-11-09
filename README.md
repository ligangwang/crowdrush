# Crowd Rush

A 3D crowd runner for [dingn](https://dingn.com): grow your squad through
number gates, blast crates and monsters, and take down the boss at the end of
every level. Play it at <https://dingn.com/crowd/>.

Crowd Rush is published on dingn the same way as any outside developer's game:
a zip uploaded on [My games](https://dingn.com/developers/games/) and approved
in dingn's review queue.

## Develop

```sh
npm install
npm run dev     # http://localhost:5173/
npm test        # typecheck, unit tests and component tests
```

To play it inside dingn while developing, open the
[playground](https://dingn.com/developers/playground/) and load
`http://localhost:5173/` (the dev server allows other origins, as the
playground needs).

## Release a new version

1. Bump `version` in `game.json`. Every upload needs a new version.
2. Run `npm run pack`. It builds the game and writes
   `release/crowd-<version>.zip`.
3. Upload the zip on <https://dingn.com/developers/games/>. It becomes the
   game's beta, then goes live once it is approved.

You can also let GitHub build it: every push to `main` keeps the zip as a
workflow artifact of **Build release zip**, and pushing a tag `v<version>`
attaches it to a GitHub release.

## The dingn SDK

`sdk/` is a copy of the dingn game SDK (`https://dingn.com/sdk/v1/`), bundled
into the game. Run `npm run update-sdk` to refresh it. The full guide is at
<https://dingn.com/developers/>.

## Credits

The 3D models are from [Polyfork](https://polyfork.dev), used under CC BY 4.0.
See [public/models/CREDITS.md](public/models/CREDITS.md).
