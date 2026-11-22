# Crowd Rush models

These models are from [Polyfork](https://polyfork.dev) and are used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (see
https://polyfork.dev/licensing):

- Infantry Rifleman by Polyfork (https://polyfork.dev/asset/infantry-rifleman-c1c0a5), CC BY 4.0
- Orc Brute by Polyfork (https://polyfork.dev/asset/orc-brute-08c6ca), CC BY 4.0
- Tyrannosaurus Rex by Polyfork (https://polyfork.dev/asset/tyrannosaurus-rex-adf79f), CC BY 4.0
- Rifle by Polyfork (https://polyfork.dev/asset/rifle-df1815), CC BY 4.0
- Rotary Cannon by Polyfork (https://polyfork.dev/asset/rotary-cannon-e2114b), CC BY 4.0
- Rocket Launcher by Polyfork (https://polyfork.dev/asset/rocket-launcher-032299), CC BY 4.0

Changes: the files were quantized with `gltf-transform quantize` to make them
smaller, and the T-Rex's animation keyframes were resampled
(`gltf-transform resample`). At runtime the game recolours the rifleman's jacket and helmet per
team, poses the rifleman and orc with its own run and walk cycles, and scales
all three models. The T-Rex opens its jaw as it lunges. The bosses change every ten levels:
the T-Rex, a code-built titan, the orc scaled up as a warlord, and the T-Rex
repainted in charred red and lava orange. The three weapons (in `weapons/`) are
placed in the rifleman's hand in place of his rifle, one per damage level.

Polyfork does not endorse this game.

## Landscape and surfaces

The sky, ground, trees, road, crates, walls and the boss's square are drawn
from [Poly Haven](https://polyhaven.com/) assets, which are
[CC0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain, no
credit required; listed so the sources stay known). The files are in
`../textures/`. The sky is the top half of the HDRI, tone-compressed to a
JPG; the ground pictures are resized (the planks also brightened, and a grey copy made for painted crates); the trees
are rendered from eight sides into picture sheets, so no tree mesh is shipped.

| Asset                                 | Files                            | Source                                                       |
| ------------------------------------- | -------------------------------- | ------------------------------------------------------------ |
| Kloofendal 48d Partly Cloudy Pure Sky | `sky.jpg`                        | https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky |
| Forrest Ground 01                     | `grass.jpg`, `grass-n.jpg`       | https://polyhaven.com/a/forrest_ground_01                    |
| Gravel Floor                          | `gravel.jpg`                     | https://polyhaven.com/a/gravel_floor                         |
| Asphalt 02                            | `road.jpg`, `road-n.jpg`         | https://polyhaven.com/a/asphalt_02                           |
| Cobblestone Square                    | `cobble.jpg`, `cobble-n.jpg`     | https://polyhaven.com/a/cobblestone_square                   |
| Wood Planks                           | `planks.jpg`, `planks-paint.jpg` | https://polyhaven.com/a/wood_planks                          |
| Medieval Blocks 03                    | `wall.jpg`                       | https://polyhaven.com/a/medieval_blocks_03                   |
| Aerial Rocks 04                       | `rock.jpg`                       | https://polyhaven.com/a/aerial_rocks_04                      |
| Tree Small 02                         | `tree.webp`, `tree-n.webp`       | https://polyhaven.com/a/tree_small_02                        |
| Fir Sapling Medium                    | `fir.webp`, `fir-n.webp`         | https://polyhaven.com/a/fir_sapling_medium                   |

## Roadblocks

The roadblocks are scanned models from [Poly Haven](https://polyhaven.com/),
[CC0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain, no
credit required; listed so the sources stay known). The files are in
`props/`: each was simplified, its pictures cut to 512 pixels as WebP, and
quantized with `gltf-transform optimize`. The game sizes them to each block.

| Asset                 | File          | Used as                          | Source                                        |
| --------------------- | ------------- | -------------------------------- | --------------------------------------------- |
| Concrete Road Barrier | `barrier.glb` | Walls, a little taller than life | https://polyhaven.com/a/concrete_road_barrier |
| Old Military Crate    | `crate.glb`   | Reward crates, two stacked       | https://polyhaven.com/a/old_military_crate    |
| Ammo Box              | `ammo.glb`    | Weapon crates                    | https://polyhaven.com/a/ammo_box              |
