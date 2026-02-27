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

// Перехватываем дроп сцены на канву и спавним токены-префабы
Hooks.on("dropCanvasData", async (canvas, data, event) => {
  // Интересуют только сцены
  if (data?.type !== "Scene") return;
  if (!canvas?.scene) return;

  const targetScene = canvas.scene;

  // Получаем документ исходной сцены по UUID
  const sourceScene = await fromUuid(data.uuid);
  if (!sourceScene) return;

  // Координата дропа — точка, относительно которой центрируем префаб
  const dropX = data.x ?? 0;
  const dropY = data.y ?? 0;

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
      }
    }
  }

  if (!allDocs.length) return;

  // Находим общий центр всех placeables в исходной сцене
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

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
      const dx = dropX - centerX;
      const dy = dropY - centerY;
      obj.c = [x0 + dx, y0 + dy, x1 + dx, y1 + dy];
    } else if (typeof obj.x === "number" && typeof obj.y === "number") {
      const w = obj.width;
      const h = obj.height;
      const ox = typeof w === "number" ? obj.x + w / 2 : obj.x;
      const oy = typeof h === "number" ? obj.y + h / 2 : obj.y;
      const dx = dropX - centerX;
      const dy = dropY - centerY;
      // сохраняем относительное смещение центра объекта
      const relX = ox - centerX;
      const relY = oy - centerY;
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
});

