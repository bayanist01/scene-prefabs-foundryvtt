Hooks.once("init", () => {
  console.log("Scene Prefabs | Initialized (v0.1.0)");
});

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

