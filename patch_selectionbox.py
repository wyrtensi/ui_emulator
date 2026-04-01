with open("canvas/canvas-engine.js", "r") as f:
    engine = f.read()

engine = engine.replace('''let startDragX, startDragY;''', '''let startDragX, startDragY;
let isMarqueeSelect = false;
let marqueeStartX = 0, marqueeStartY = 0;
let selectionBox = null;''')

with open("canvas/canvas-engine.js", "w") as f:
    f.write(engine)

# Fix config is not defined in boot
with open("js/app.js", "r") as f:
    app_js = f.read()

app_js = app_js.replace('''async function boot() {
  // Fetch last edit
  updateLastEditTime();''', '''async function boot() {
  // Config is not defined globally yet here, so updateLastEditTime handles it by fetching it itself!
  updateLastEditTime();''')

with open("js/app.js", "w") as f:
    f.write(app_js)
