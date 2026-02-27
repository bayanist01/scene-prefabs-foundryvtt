## Scene Prefabs (Foundry VTT Module)

Module for Foundry VTT **v13.351+** that lets you treat any scene as a prefab:
- copy all scene content (tiles, tokens, walls, lights, sounds, notes, templates) into another scene;
- place prefabs by clicking on the canvas with a live tile preview;
- move and edit a prefab as a single logical group.

---

### Installation

1. Put the module folder into `Data/modules/scene-prefabs` in your Foundry VTT data directory.
2. Restart Foundry VTT.
3. In **Settings → Manage Modules**, enable **Scene Prefabs**.

---

### Features

- **Drag & Drop from the Scenes sidebar**
  - Drag a scene from the right-hand *Scenes* sidebar onto the active scene canvas.
  - The module will create a prefab: it copies all placeables from the source scene into the active one, centered at the drop point.
  - All created documents get `flags["scene-prefabs"]` with:
    - a shared `prefabInstanceId` (the prefab instance id),
    - `sourceSceneId` and `sourceSceneUuid`.

- **Tile tool for manual placement**
  - In the left toolbar, under **Tiles**, you get a `Scene Prefabs: Spawn` tool.
  - When activated:
    1. A dialog opens where you choose a source scene (scenes are sorted by name).
    2. After choosing, a live tile preview of that scene appears under your cursor (using `canvas.tiles.preview`).
    3. **Left-click** on the canvas places a prefab at that point (you can click multiple times to place several copies).
    4. **Right-click** on the canvas cancels placement mode (the preview disappears).

- **Prefab group control and movement**
  - Clicking any prefab object (token, tile, light, sound, note, measured template) automatically selects all other objects on the same layer with the same `prefabInstanceId`.
  - Moving any one prefab object:
    - synchronously moves all other objects of that prefab across all layers (via `preUpdate*` hooks per document type).

---

### Localization

The module ships with two languages:
- **English** (`lang/en.json`)
- **Русский** (`lang/ru.json`)

The active language is chosen via Foundry VTT’s UI language setting. All user-facing strings (tool label, dialogs, notifications) are localized through `game.i18n`.

