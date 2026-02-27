const ScenePrefabs = {
  preview: {
    active: false,
    uuid: null,
    graphics: null
  }
};

function scenePrefabsHandleDragOver(ev) {
  if (!ScenePrefabs.preview.active) return;
  if (!canvas?.ready) return;

  const gfx = ScenePrefabs.preview.graphics;
  if (!gfx) return;

  // Координаты мыши в окне
  const clientX = ev.clientX;
  const clientY = ev.clientY;
  if (clientX == null || clientY == null) return;

  // Переводим в координаты канвы
  const point = new PIXI.Point();
  canvas.app.renderer.plugins.interaction.mapPositionToPoint(point, clientX, clientY);
  const pos = point;

  const width = 500;
  const height = 500;

  gfx.clear();
  gfx.lineStyle(2, 0x00ff00, 0.9);
  gfx.beginFill(0x00ff00, 0.2);
  gfx.drawRect(pos.x - width / 2, pos.y - height / 2, width, height);
  gfx.endFill();
}

function scenePrefabsStartPreview(uuid) {
  ScenePrefabs.preview.active = true;
  ScenePrefabs.preview.uuid = uuid;
  window.addEventListener("dragover", scenePrefabsHandleDragOver);
}

function scenePrefabsStopPreview() {
  ScenePrefabs.preview.active = false;
  ScenePrefabs.preview.uuid = null;
  if (ScenePrefabs.preview.graphics) {
    ScenePrefabs.preview.graphics.clear();
  }
  window.removeEventListener("dragover", scenePrefabsHandleDragOver);
}

Hooks.once("init", () => {
  console.log("Scene Prefabs | Initialized (v0.1.0)");
});

// Инициализируем слой превью, когда канва готова
Hooks.on("canvasReady", (canvas) => {
  if (!ScenePrefabs.preview.graphics) {
    ScenePrefabs.preview.graphics = new PIXI.Graphics();
  }
  canvas.stage.addChild(ScenePrefabs.preview.graphics);
});

// Вешаемся на директорию сцен, чтобы знать, когда начинается и заканчивается drag
Hooks.on("renderSceneDirectory", (app, html, data) => {
  if (app._scenePrefabsBound) return;
  app._scenePrefabsBound = true;

  const $html = html instanceof jQuery ? html : $(html);

  $html.on("dragstart.scene-prefabs", "li.directory-item", (ev) => {
    const dragEvent = ev.originalEvent ?? ev;
    const dragData = TextEditor.getDragEventData(dragEvent);
    if (!dragData || dragData.type !== "Scene") return;
    scenePrefabsStartPreview(dragData.uuid);
  });

  $html.on("dragend.scene-prefabs", "li.directory-item", () => {
    scenePrefabsStopPreview();
  });
});

// Перехватываем любые дропы на канву
Hooks.on("dropCanvasData", async (canvas, data, event) => {
  // Интересуют только сцены
  if (data?.type !== "Scene") return;

  // Получаем документ сцены по UUID
  const sourceScene = await fromUuid(data.uuid);
  if (!sourceScene) return;

  console.log(
    "Scene Prefabs | Scene dropped",
    sourceScene.name,
    "at",
    data.x,
    data.y,
    "onto",
    canvas.scene?.name
  );

  // Здесь позже можно реализовать основную логику префабов:
  // - прочитать placeables из sourceScene
  // - вычислить смещение относительно data.x / data.y
  // - создать объекты на canvas.scene
});

