# Crowd Rush

A 3D crowd runner for [dingn](https://dingn.com): grow your squad through
number gates, blast crates and monsters, and take down the boss at the end of
every level. Play it at <https://dingn.com/play/crowdrush/>.

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

1. In a pull request, raise `version` in `game.json`. Every release needs a
   new version.
2. Merge it. The **Build and publish** Action tests the game, builds
   `release/crowdrush-<version>.zip` and uploads it to dingn with the
   `DINGN_UPLOAD_KEY` secret.
3. The new version waits in dingn's review queue and goes live once it is
   approved.

A merge that doesn't raise the version builds and tests but uploads nothing.
Every run also keeps the zip as a workflow artifact.

To upload by hand instead: `npm run pack`, then upload the zip on
<https://dingn.com/developers/games/>, or run
`DINGN_UPLOAD_KEY=... npm run upload`.

### The upload key

Create a key on <https://dingn.com/developers/games/> (signed in as the
account that owns the game), then add it to this repository under
**Settings → Secrets and variables → Actions** as `DINGN_UPLOAD_KEY`. dingn
shows the key once; if it is lost, revoke it and create another.

## The dingn SDK

`sdk/` is a copy of the dingn game SDK (`https://dingn.com/sdk/v1/`), bundled
into the game. Run `npm run update-sdk` to refresh it. The full guide is at
<https://dingn.com/developers/>.

## Credits

The 3D models are from [Polyfork](https://polyfork.dev), used under CC BY 4.0.
See [public/models/CREDITS.md](public/models/CREDITS.md).
