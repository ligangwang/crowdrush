# Crowd Rush models

## Characters

The soldiers and their guns, the brutes and the bosses are Crowd Rush's own:
they are built from code in `src/crowd-figures.ts` (and the Horned Titan in
`src/crowd-scene.ts`), with no model files, so they carry no outside
licence and need no credit.

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
