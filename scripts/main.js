Hooks.once("init", () => {
  console.log("Scene Prefabs | Initialized (v0.1.0)");
});

// Автовыделение всего префаба при контроле одного объекта
function scenePrefabsHandleControl(object, controlled) {
  if (!controlled) return;
  if (!object?.document) return;

  const flags = object.document.flags?.["scene-prefabs"];
  const prefabInstanceId = flags?.prefabInstanceId;
  if (!prefabInstanceId) return;

  const layer = object.layer;
  if (!layer?.placeables) return;

  for (const other of layer.placeables) {
    if (other === object) continue;
    const otherFlags = other.document?.flags?.["scene-prefabs"];
    if (otherFlags?.prefabInstanceId !== prefabInstanceId) continue;

    // Выделяем остальные элементы префаба, не снимая другие выделения
    other.control({ releaseOthers: false });
  }
}

// Generic control hooks по типам placeables
Hooks.on("controlToken", scenePrefabsHandleControl);
Hooks.on("controlTile", scenePrefabsHandleControl);
Hooks.on("controlDrawing", scenePrefabsHandleControl);
Hooks.on("controlAmbientLight", scenePrefabsHandleControl);
Hooks.on("controlAmbientSound", scenePrefabsHandleControl);
Hooks.on("controlNote", scenePrefabsHandleControl);
Hooks.on("controlMeasuredTemplate", scenePrefabsHandleControl);

// Добавляем отдельный инструмент в контролы тайлов (левое меню)
Hooks.on("getSceneControlButtons", (controls) => {
  const tilesControl = controls.tiles;
  if (!tilesControl) return;

  tilesControl.tools = tilesControl.tools || {};

  tilesControl.tools["scene-prefabs-spawn"] = {
    name: "scene-prefabs-spawn",
    title: game.i18n.localize("SCENEPREFABS.Tool.Spawn"),
    icon: "fas fa-object-group",
    order: Object.keys(tilesControl.tools).length,
    button: true,
    visible: game.user.isGM,
    onChange: async (active) => {
      if (!active) {
        ScenePrefabsPlacement.disable();
        return;
      }
      await ScenePrefabsPlacement.activate();
    }
  };
});

// -----------------------
// Режим ручного спавна префаба через тулз в Tiles
// -----------------------

const ScenePrefabsPlacement = {
  active: false,
  sourceSceneUuid: null,
  sourceSceneName: null,
  bbox: null, // { width, height }
  tilePreviewData: null, // [{ img, width, height, rotation, alpha, dx, dy }]
  _pointerMoveHandler: null,
  _clickHandler: null,
  _contextMenuHandler: null,

  async activate() {
    if (!canvas?.ready) return;

    const sourceScene = await this._chooseSourceScene();
    if (!sourceScene) {
      ui.notifications.warn(game.i18n.localize("SCENEPREFABS.SpawnMode.SceneNotSelected"));
      this.disable();
      return;
    }

    const { bbox, tiles } = this._computeTilePreviewData(sourceScene);

    this.active = true;
    this.sourceSceneUuid = sourceScene.uuid;
    this.sourceSceneName = sourceScene.name;
    this.bbox = bbox;
    this.tilePreviewData = tiles;

    this._attachHandlers();
    ui.notifications.info(
      game.i18n.format("SCENEPREFABS.SpawnMode.Start", { name: sourceScene.name })
    );
  },

  disable() {
    this.active = false;
    this.sourceSceneUuid = null;
    this.sourceSceneName = null;
    this.bbox = null;
    this.tilePreviewData = null;
    this._detachHandlers();
    this._clearPreview();
  },

  async _chooseSourceScene() {
    const scenes = (game.scenes?.contents ?? []).slice().sort((a, b) => {
      return String(a.name).localeCompare(String(b.name), game.i18n.lang || undefined, {
        sensitivity: "base"
      });
    });
    if (!scenes.length) return null;

    return new Promise((resolve) => {
      const options = scenes
        .map((s) => `<option value="${s.uuid}">${foundry.utils.escapeHTML(s.name)}</option>`)
        .join("");

      const label = game.i18n.localize("SCENEPREFABS.Dialog.SelectScene.Label");
      const content = `
        <form>
          <div class="form-group">
            <label>${label}</label>
            <select name="scene-prefab" style="width:100%;">
              ${options}
            </select>
          </div>
        </form>`;

      const { DialogV2 } = foundry.applications.api;

      new DialogV2({
        window: { title: game.i18n.localize("SCENEPREFABS.Dialog.SelectScene.Title") },
        content,
        buttons: [
          {
            action: "ok",
            label: game.i18n.localize("SCENEPREFABS.Dialog.SelectScene.Choose"),
            default: true,
            callback: (event, button, dialog) => {
              const form = button.form;
              const uuid = form?.elements?.["scene-prefab"]?.value;
              const scene = scenes.find((s) => s.uuid === uuid);
              resolve(scene ?? null);
            }
          },
          {
            action: "cancel",
            label: game.i18n.localize("SCENEPREFABS.Dialog.Common.Cancel"),
            callback: () => resolve(null)
          }
        ],
        close: () => resolve(null)
      }).render({ force: true });
    });
  },

  _computeTilePreviewData(sourceScene) {
    const tiles = sourceScene.tiles?.contents ?? [];
    if (!tiles.length) {
      return {
        bbox: { width: canvas.grid.size, height: canvas.grid.size },
        tiles: []
      };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const t of tiles) {
      const x0 = t.x;
      const y0 = t.y;
      const x1 = t.x + (t.width ?? 0);
      const y1 = t.y + (t.height ?? 0);
      minX = Math.min(minX, x0, x1);
      minY = Math.min(minY, y0, y1);
      maxX = Math.max(maxX, x0, x1);
      maxY = Math.max(maxY, y0, y1);
    }

    const bbox = {
      width: maxX - minX || canvas.grid.size,
      height: maxY - minY || canvas.grid.size
    };

    const tilesData = tiles.map((t) => ({
      img: t.texture?.src ?? t.document?.texture?.src ?? t.document?.img ?? t.img,
      width: t.width ?? t.document?.width ?? canvas.grid.size,
      height: t.height ?? t.document?.height ?? canvas.grid.size,
      rotation: t.rotation ?? 0,
      alpha: t.alpha ?? 1,
      dx: (t.x + (t.width ?? 0) / 2) - (minX + bbox.width / 2),
      dy: (t.y + (t.height ?? 0) / 2) - (minY + bbox.height / 2)
    }));

    return { bbox, tiles: tilesData };
  },

  _attachHandlers() {
    const view = canvas.app.view;
    if (!view) return;

    this._pointerMoveHandler = this._pointerMoveHandler || this._onPointerMove.bind(this);
    this._clickHandler = this._clickHandler || this._onClick.bind(this);
    this._contextMenuHandler = this._contextMenuHandler || this._onContextMenu.bind(this);

    view.addEventListener("pointermove", this._pointerMoveHandler);
    view.addEventListener("click", this._clickHandler);
    view.addEventListener("contextmenu", this._contextMenuHandler);
  },

  _detachHandlers() {
    const view = canvas?.app?.view;
    if (!view) return;
    if (this._pointerMoveHandler) view.removeEventListener("pointermove", this._pointerMoveHandler);
    if (this._clickHandler) view.removeEventListener("click", this._clickHandler);
    if (this._contextMenuHandler) view.removeEventListener("contextmenu", this._contextMenuHandler);
  },

  _clearPreview() {
    const tilesLayer = canvas.tiles;
    if (!tilesLayer) return;
    const container = tilesLayer.preview;
    if (!container) return;
    container.removeChildren();
  },

  _renderPreviewAt(worldX, worldY) {
    const tilesLayer = canvas.tiles;
    if (!tilesLayer) return;

    let container = tilesLayer.preview;
    if (!container) {
      container = tilesLayer.preview = new PIXI.Container();
      tilesLayer.addChild(container);
    }

    container.removeChildren();

    const w = this.bbox?.width ?? canvas.grid.size;
    const h = this.bbox?.height ?? canvas.grid.size;

    const tiles = this.tilePreviewData ?? [];
    // Если нет тайлов — fallback-прямоугольник
    if (!tiles.length) {
      const g = new PIXI.Graphics();
      g.lineStyle(2, 0x00ff00, 0.9);
      g.beginFill(0x00ff00, 0.2);
      g.drawRect(worldX - w / 2, worldY - h / 2, w, h);
      g.endFill();
      container.addChild(g);
      return;
    }

    for (const tile of tiles) {
      if (!tile.img) continue;
      const tex = PIXI.Texture.from(tile.img);
      const sprite = new PIXI.Sprite(tex);
      sprite.width = tile.width;
      sprite.height = tile.height;
      sprite.alpha = tile.alpha;
      // Вращаем вокруг центра, как обычный Tile
      sprite.anchor.set(0.5, 0.5);
      sprite.rotation = (tile.rotation * Math.PI) / 180;

      const cx = worldX + tile.dx;
      const cy = worldY + tile.dy;
      sprite.x = cx;
      sprite.y = cy;

      container.addChild(sprite);
    }
  },

  _onPointerMove(ev) {
    if (!this.active) return;
    if (!canvas?.ready) return;

    const view = canvas.app.view;
    const rect = view.getBoundingClientRect();
    const localX = ev.clientX - rect.left;
    const localY = ev.clientY - rect.top;

    const worldPos = canvas.stage.toLocal(new PIXI.Point(localX, localY));
    this._renderPreviewAt(worldPos.x, worldPos.y);
  },

  async _onClick(ev) {
    if (!this.active) return;
    if (!canvas?.ready) return;
    if (!this.sourceSceneUuid) return;

    // Только левая кнопка мыши размещает префаб
    if (ev.button !== 0) return;

    const view = canvas.app.view;
    const rect = view.getBoundingClientRect();
    const localX = ev.clientX - rect.left;
    const localY = ev.clientY - rect.top;
    const worldPos = canvas.stage.toLocal(new PIXI.Point(localX, localY));

    const sourceScene = await fromUuid(this.sourceSceneUuid);
    if (!sourceScene) {
      ui.notifications.error(
        game.i18n.localize("SCENEPREFABS.SpawnMode.SourceLoadError")
      );
      this.disable();
      return;
    }

    await scenePrefabsSpawnFromSceneAt(sourceScene, canvas.scene, worldPos.x, worldPos.y);
  },

  _onContextMenu(ev) {
    if (!this.active) return;
    // Правая кнопка — отменить режим размещения
    ev.preventDefault();
    ev.stopPropagation();
    ui.notifications.info(
      game.i18n.localize("SCENEPREFABS.SpawnMode.Cancelled")
    );
    this.disable();
  }
};

// Синхронное движение всего префаба по дельте одного объекта (межслойно)
function scenePrefabsPreUpdate(doc, change, options, userId) {
  // Не зацикливаем собственные апдейты
  if (options?.["scene-prefabs-sync"]) return;

  const scene = doc.parent;
  if (!scene?.updateEmbeddedDocuments) return;

  const flags = doc.flags?.["scene-prefabs"];
  const prefabInstanceId = flags?.prefabInstanceId;
  if (!prefabInstanceId) return;

  let dx = 0;
  let dy = 0;

  if (typeof change.x === "number" || typeof change.y === "number") {
    const newX = typeof change.x === "number" ? change.x : doc.x;
    const newY = typeof change.y === "number" ? change.y : doc.y;
    dx = newX - doc.x;
    dy = newY - doc.y;
  } else if (Array.isArray(change.c) && Array.isArray(doc.c)) {
    const [nx0, ny0] = change.c;
    const [ox0, oy0] = doc.c;
    dx = nx0 - ox0;
    dy = ny0 - oy0;
  }

  if (!dx && !dy) return;

  // Все коллекции, которые хотим двигать вместе
  const collections = {
    Token: scene.tokens,
    Tile: scene.tiles,
    Drawing: scene.drawings,
    AmbientLight: scene.lights,
    AmbientSound: scene.sounds,
    Note: scene.notes,
    MeasuredTemplate: scene.templates,
    Wall: scene.walls
  };

  /** @type<Record<string, any[]>> */
  const updatesByType = {};

  for (const [type, coll] of Object.entries(collections)) {
    const docs = coll?.contents ?? [];
    for (const d of docs) {
      if (d.id === doc.id) continue;
      const f = d.flags?.["scene-prefabs"];
      if (!f || f.prefabInstanceId !== prefabInstanceId) continue;

      const update = { _id: d.id };

      if (type === "Wall" && Array.isArray(d.c)) {
        const [x0, y0, x1, y1] = d.c;
        update.c = [x0 + dx, y0 + dy, x1 + dx, y1 + dy];
      } else if (typeof d.x === "number" && typeof d.y === "number") {
        update.x = d.x + dx;
        update.y = d.y + dy;
      } else {
        continue;
      }

      if (!updatesByType[type]) updatesByType[type] = [];
      updatesByType[type].push(update);
    }
  }

  for (const [type, updates] of Object.entries(updatesByType)) {
    if (!updates.length) continue;
    scene.updateEmbeddedDocuments(type, updates, { "scene-prefabs-sync": true });
  }
}

// preUpdate* хуки по типам документов
Hooks.on("preUpdateToken", scenePrefabsPreUpdate);
Hooks.on("preUpdateTile", scenePrefabsPreUpdate);
Hooks.on("preUpdateDrawing", scenePrefabsPreUpdate);
Hooks.on("preUpdateAmbientLight", scenePrefabsPreUpdate);
Hooks.on("preUpdateAmbientSound", scenePrefabsPreUpdate);
Hooks.on("preUpdateNote", scenePrefabsPreUpdate);
Hooks.on("preUpdateMeasuredTemplate", scenePrefabsPreUpdate);
Hooks.on("preUpdateWall", scenePrefabsPreUpdate);

async function scenePrefabsSpawnFromSceneAt(sourceScene, targetScene, dropX, dropY) {
  // Собираем все поддерживаемые embedded-документы исходной сцены
  const collections = {
    Token: sourceScene.tokens,
    Tile: sourceScene.tiles,
    Drawing: sourceScene.drawings,
    Wall: sourceScene.walls,
    AmbientLight: sourceScene.lights,
    AmbientSound: sourceScene.sounds,
    Note: sourceScene.notes,
    MeasuredTemplate: sourceScene.templates
  };

  /** @type {{ type: string; doc: any }[]} */
  const allDocs = [];
  const xs = [];
  const ys = [];
  let tileMinX = Infinity;
  let tileMinY = Infinity;
  let tileMaxX = -Infinity;
  let tileMaxY = -Infinity;

  for (const [type, coll] of Object.entries(collections)) {
    const docs = coll?.contents ?? [];
    for (const doc of docs) {
      allDocs.push({ type, doc });

      // Репрезентативные координаты для bbox — стараемся использовать центры
      if (type === "Wall") {
        const [x0, y0, x1, y1] = doc.c;
        xs.push(x0, x1);
        ys.push(y0, y1);
      } else {
        const w = doc.width ?? doc.document?.width;
        const h = doc.height ?? doc.document?.height;
        const cx = typeof w === "number" ? doc.x + w / 2 : doc.x;
        const cy = typeof h === "number" ? doc.y + h / 2 : doc.y;
        xs.push(cx);
        ys.push(cy);

        if (type === "Tile") {
          const tx0 = doc.x;
          const ty0 = doc.y;
          const tx1 = doc.x + (w ?? 0);
          const ty1 = doc.y + (h ?? 0);
          tileMinX = Math.min(tileMinX, tx0, tx1);
          tileMinY = Math.min(tileMinY, ty0, ty1);
          tileMaxX = Math.max(tileMaxX, tx0, tx1);
          tileMaxY = Math.max(tileMaxY, ty0, ty1);
        }
      }
    }
  }

  if (!allDocs.length) return;

  // Находим якорный центр:
  // - если есть тайлы, центрируем по их bbox (как превью)
  // - иначе по bbox всех placeables
  let anchorX;
  let anchorY;
  if (tileMinX !== Infinity && tileMaxX !== -Infinity) {
    anchorX = (tileMinX + tileMaxX) / 2;
    anchorY = (tileMinY + tileMaxY) / 2;
  } else {
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    anchorX = (minX + maxX) / 2;
    anchorY = (minY + maxY) / 2;
  }

  // Уникальный идентификатор инстанса префаба
  const prefabInstanceId = foundry.utils.randomID();

  // Готовим данные для всех типов документов
  /** @type<Record<string, any[]>> */
  const toCreateByType = {};

  for (const { type, doc } of allDocs) {
    const obj = doc.toObject();
    delete obj._id;

    // Смещаем так, чтобы центр общей bbox пришёлся в точку дропа
    if (type === "Wall") {
      const [x0, y0, x1, y1] = obj.c;
      const dx = dropX - anchorX;
      const dy = dropY - anchorY;
      obj.c = [x0 + dx, y0 + dy, x1 + dx, y1 + dy];
    } else if (typeof obj.x === "number" && typeof obj.y === "number") {
      const w = obj.width;
      const h = obj.height;
      const ox = typeof w === "number" ? obj.x + w / 2 : obj.x;
      const oy = typeof h === "number" ? obj.y + h / 2 : obj.y;
      const dx = dropX - anchorX;
      const dy = dropY - anchorY;
      // сохраняем относительное смещение центра объекта
      const relX = ox - anchorX;
      const relY = oy - anchorY;
      const newCenterX = dropX + relX;
      const newCenterY = dropY + relY;
      if (typeof w === "number") {
        obj.x = newCenterX - w / 2;
      } else {
        obj.x = newCenterX;
      }
      if (typeof h === "number") {
        obj.y = newCenterY - h / 2;
      } else {
        obj.y = newCenterY;
      }
    }

    obj.flags = obj.flags || {};
    obj.flags["scene-prefabs"] = {
      prefabInstanceId,
      sourceSceneId: sourceScene.id,
      sourceSceneUuid: sourceScene.uuid,
      sourceDocumentType: type
    };

    if (!toCreateByType[type]) toCreateByType[type] = [];
    toCreateByType[type].push(obj);
  }

  // Создаём документы на активной сцене по типам
  for (const [type, docs] of Object.entries(toCreateByType)) {
    if (!docs.length) continue;
    await targetScene.createEmbeddedDocuments(type, docs);
  }

  console.log("Scene Prefabs | Spawned prefab", {
    prefabInstanceId,
    sourceScene: {
      id: sourceScene.id,
      name: sourceScene.name,
      uuid: sourceScene.uuid
    },
    targetScene: {
      id: targetScene.id,
      name: targetScene.name
    },
    drop: { x: dropX, y: dropY },
    counts: Object.fromEntries(
      Object.entries(toCreateByType).map(([type, docs]) => [type, docs.length])
    )
  });
}

// Перехватываем дроп сцены на канву и спавним префаб
Hooks.on("dropCanvasData", async (canvas, data, event) => {
  if (data?.type !== "Scene") return;
  if (!canvas?.scene) return;

  const targetScene = canvas.scene;
  const sourceScene = await fromUuid(data.uuid);
  if (!sourceScene) return;

  const dropX = data.x ?? 0;
  const dropY = data.y ?? 0;

  await scenePrefabsSpawnFromSceneAt(sourceScene, targetScene, dropX, dropY);
});

