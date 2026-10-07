# 3D Viewer & Editor

## Editor expansion — 2026-10-02

The dedicated tab is now **Viewers → 3D Viewer & Editor**. The six supplied
screenshots define the Insert, Object, Edit, Paint, and View tools. Existing STL/
3MF parsing, local-only operation, named cameras, and Windows source-mesh repair
remain available. The tab ID stays `3d-viewer`, preserving saved navigation.

### Tools

| Area | Implemented behavior |
| --- | --- |
| Insert | Add an STL/3MF to a scene; custom XYZ dimensions; cube, cylinder, pyramid, cone, sphere, hexagonal prism, wedge, torus, tetrahedron. |
| Object | Click/Shift-click or list selection; move/rotate/scale handles and numeric transforms; rename; duplicate; internal copy/cut/paste; delete; settle on Z=0; mirror X/Y/Z; two surface points for distance measurement. |
| Edit | Simplify by positional tolerance; capped plane split along X/Y/Z; geometric smoothing/refinement; centered text emboss on a flat top; extend the XY footprint downward; boolean merge, intersect, subtract; hollow with an inward spherical offset. |
| Paint | Plastic, matte, metal, gold, glass presets; color, roughness, metallic and opacity values; local PNG/JPEG/WebP textures; material picker; camera texture capture; local QR generation; 24 procedural texture swatches; 19 shape stamps; recent textures; transparent stamp/QR background. |
| View | Center, named views, orthographic; shading, shadows, original/painted colors, reflections, smooth/flat shading, wireframe, grid, axes, X-ray. |
| Project | Undo/redo, `.law3d` save/open, binary STL export in millimeters, explicit unsaved replacement/close confirmation. |

Subtract uses the first selected object as the base; the list labels it **Base**.
Click an object name for single selection; use its checkbox to add/remove it.
Transforms use the scene's declared units and degree rotations. Imported models
added to a scene are converted from their own declared units. STL assumes mm.
STL export preserves geometry only. A `.law3d` project retains separate objects,
names, transforms, material groups, embedded images and texture UVs. It does not
store undo history or the clipboard. Project files cannot request remote textures.

Transparent stamps blend over existing paint without making the mesh invisible.
Existing UVs are retained; imported meshes without UVs receive an XY projection.
Painting affects whole selected objects; face painting, brush strokes, texture
projection gizmos and UV unwrapping are outside this implementation.

### Lifecycle and boundaries

- Original files are never modified by editing. Desktop exports require a Save
  dialog and a new filename; an existing destination is rejected. Browser fallback
  downloads keep the unsaved state because a requested download cannot confirm a save.
- Unsaved edits in the main editor survive tab switches in RAM while the renderer
  is disposed. They are not written to localStorage or sent to a backend. Unedited
  loaded models still require manual reopening after leaving. Save a project before
  exiting the app. Embedded Local Files editors require saving before leaving.
- Undo shares immutable geometry and is bounded to 30 snapshots / 128 MB retained
  geometry and texture data. Clipboard data is internal to the current editor.
- Parsing, solid operations, project reading/writing and STL preparation use
  disposable workers. Cancel terminates a worker and retains the existing scene.
- Solid tools require closed, consistently oriented input; failures preserve the
  source objects. General edits allow up to 200,000 selected input triangles and
  1 million output triangles. Hollow is capped at 5,000 input triangles because
  erosion can be expensive. The existing 8 million scene triangle ceiling remains.
- Hollow creates an enclosed cavity with a faceted spherical inset. It does not
  create drain holes or guarantee printability. Extrude down fills the projected
  footprint beneath the lowest point, and is not arbitrary face extrusion. Emboss
  uses bundled Helvetiker glyphs on the top XY plane and requires contact with the
  selected mesh. Unsupported glyphs produce an error.
- Project input/output and STL output are capped at 128 MB. Local textures accept
  PNG/JPEG/WebP up to 12 MB and are resized to at most 2048 pixels on the longer side.
- Camera access starts only after the Camera action and a native permission dialog.
  The trusted main window receives a 30-second video-only permission window; audio
  and remote/child frames are excluded. Capture, Cancel, leaving Paint, or unmounting
  stops the video tracks. Cancelled permission requests cannot grant access later.
- The geometry engine is bundled locally. CSP adds `wasm-unsafe-eval` for WebAssembly;
  JavaScript string evaluation and remote scripts remain blocked.

### Implementation and verification

`ModelViewer.jsx` keeps the existing entry point and loads `ModelEditor.jsx`.
`editor.js` owns immutable geometry records, transforms, validation and history.
`editorScene.js` owns rendering, ray selection, transform handles and measurement.
`operations.js`/`editWorker.js` run Manifold solid operations with UV/color/material
provenance; each worker releases its WASM allocation when it exits. `ModelPaint`
and `materials.js` provide local textures. `projectWorker.js`/`export.js` handle
projects and STL. `electron/modelEditor.js` owns native saves and camera requests.

Unit tests cover all nine closed primitives, transforms, reflected winding,
known boolean volumes, capped split, hollow wall thickness, simplification,
smoothing, emboss/extension, rejected open/empty meshes, project validation,
units/export round-trips, overwrite refusal and camera permission boundaries.
Native Electron QA uses the production `app://local` origin, CSP, disposable
profiles, neutral models and actual WebGL. It checks editing, painting, QR textures,
project/download round-trips, STL output, view toggles, measurement, idle rendering,
unsaved recovery and canvas disposal. Physical webcam capture is not established
by automated permission tests. No user model files are needed for these checks.

Run `node scripts/build-model-editor-qa.mjs`, then
`electron scripts/qa-model-editor.cjs`. The original viewer regression suite remains
in `scripts/qa-model-viewer.cjs` (build using `scripts/build-viewer-qa.mjs`).

Dependencies: `manifold-3d@3.5.4`, `qrcode@1.5.4`. References:
[Manifold API](https://manifoldcad.org/docs/jsuser/classes/Manifold.html),
[Manifold project](https://github.com/elalish/manifold),
[node-qrcode](https://github.com/soldair/node-qrcode).
The [Helvetiker font](https://github.com/mrdoob/three.js/tree/r185/examples/fonts)
and its license are bundled under `src/modelViewer/fonts`.

## Initial viewer implementation (historical)

Implemented 2026-10-02 from the supplied proposal. The supplied document ended
mid-sentence; implementation follows its available requirements. The user chose
a dedicated tab with manual reopening of files.

## Use

Open **Viewers → 3D Viewer**, then **Open file** or drop an STL/3MF. Drag to rotate,
scroll/pinch to zoom, and right-drag/two fingers to pan. Named front/back/left/right/
top/bottom/isometric views, Reset, Fit, orthographic projection, wireframe, grid,
and XYZ axes are available. The initial view centers and fits the model.

Information includes filename, format, file size, X/Y/Z dimensions, bounds,
triangle/mesh counts, and transformed surface area. STL dimensions assume
millimeters and explicitly say so. 3MF uses declared units, including component
part unit normalization. Enclosed volume is not estimated because this version
does not validate watertightness, manifoldness, or mesh intersections.

Leaving the viewer (unless it remains visible as a pinned tool) unmounts it,
terminates parsing, discards the model, and releases graphics resources. Reopen
files manually. No file path, model bytes, camera state, or screenshot is saved
automatically. Original files are never modified. There are no backend, LLM,
image-generation, or remote-network calls in the viewer.

## Implementation

- React lazy import from `src/App.jsx`; no Three.js startup initialization.
- `src/modelViewer/worker.js` handles file reading, validation, parsing, and area
  analysis off the main UI thread. Cancellation terminates the worker, including
  while a synchronous loader is parsing. Typed geometry buffers transfer back.
- Three.js `STLLoader` and `ThreeMFLoader` parse geometry. A worker-only LinkeDOM
  XML parser supports the 3MF loader without a browser DOM. The loader registry
  can accept future file formats without changing rendering controls.
- 3MF preparation merges model parts with distinct resource IDs, normalizes units,
  preserves component transforms/hierarchy and base/vertex colors, and checks
  component cycles and expansion before constructing geometry. It does not convert
  3MF to STL. Unsupported material properties fall back to neutral shading.
- `src/modelViewer/scene.js` owns one renderer and event-driven OrbitControls.
  No damping/animation loop runs at rest. Hidden documents stop scheduled rendering.
  Resize, theme, camera, and setting changes request frames. Pixel ratio is capped
  at 1.5 and the renderer requests low-power preference; actual GPU selection is
  controlled by the OS/driver. Replacing/closing disposes geometry/materials,
  textures if present, helpers, controls, listeners, observers, renderer caches,
  and the graphics context. Initialization failure also cleans up allocated objects.
- The existing explicit tab screenshot action can request a fresh WebGL frame.
  This does not add automatic screenshots or AI analysis.

## Limits

Texture images, beam lattices, implicit-only geometry, and vendor slicer settings
are omitted with warnings. Available ordinary mesh geometry still displays.
OBJ/GLB/GLTF/PLY, decimation, slicing, repair, and volume measurement are not part
of this initial viewer. It is not an authoritative printability validator.

Warnings require confirmation above 50 MB input/expanded archive data or 1 million
triangles. Hard safety ceilings are 512 MB input, 256 MB expanded archive, 128 MB
per model XML, 8 million stored/displayed triangles, 4,096 archive entries, 10,000
expanded instances per assembly, and 128 component nesting levels. These prevent
unbounded parser/GPU allocations; re-export a smaller preview above those limits.
ZIP64 archives are supported within the same size limits, including small files
written with forced ZIP64 headers. The directory and each entry's optional 64-bit
sizes/offsets are checked before allocation; loaded model parts are CRC-checked.
Encrypted/split archives, duplicate/path-traversal entries, XML entities,
invalid indices/coordinates, and cyclic components are rejected. Archives are
processed in memory and never extracted to the filesystem.

## Validation

- Unit tests: binary and ASCII STL dimensions/area/counts; 3MF colors, hierarchy,
  transforms, cross-part duplicate IDs/units, unsupported-material fallback; invalid
  indices/coordinates, cycles, archive expansion/traversal, and file-size limits.
- Native Electron 44.4.5 QA runs with the production `app://local` origin and
  security headers: worker loading, STL and colored 3MF rendering, file input and
  drag/drop, camera/orthographic controls, no idle render loop, large-model
  cancellation, malformed-file recovery, and repeated open/close/tab transitions.
- Seven repeated 19,200-triangle open/close cycles: collected renderer JavaScript
  heap measured 3.56, 3.65, 3.71, 3.99, 4.03, 4.04, and 4.04 MB. This supports bounded
  fixture retention; it is not a long-duration VRAM/driver benchmark.
- Screenshots were visually inspected. Native WebGL was enabled. Tests do not
  establish performance while real image generation/LLM jobs saturate the GPU.
- Full frontend suite: 115 files / 973 tests. Production build passes; Vite reports
  a chunk-size warning for the lazily loaded renderer and the existing main bundle.

Run `node scripts/build-viewer-qa.mjs`, then
`electron scripts/qa-model-viewer.cjs`. Native fixtures use disposable profiles;
test artifacts are printed by the runner. No user model files are required.

Dependencies added: `three@0.186.1`, `linkedom@0.18.12`.
References: [STLLoader](https://threejs.org/docs/pages/STLLoader.html),
[ThreeMFLoader](https://threejs.org/docs/pages/ThreeMFLoader.html).
