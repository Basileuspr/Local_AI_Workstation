# 3D Viewer & Editor

The dedicated tab is now **Viewers → 3D Viewer & Editor**. Existing STL/
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
  erosion can be expensive. Imported scenes have no application triangle ceiling;
  available memory and the geometry engine determine what can be processed.
- Hollow creates an enclosed cavity with a faceted spherical inset. It does not
  create drain holes or guarantee printability. Extrude down fills the projected
  footprint beneath the lowest point, and is not arbitrary face extrusion. Emboss
  uses bundled Helvetiker glyphs on the top XY plane and requires contact with the
  selected mesh. Unsupported glyphs produce an error.
- Model/project input, project/STL output and local PNG/JPEG/WebP texture files
  have no application byte ceiling. Working textures are resized to at most
  2048 pixels on the longer side. Large imports can still exceed available memory.
- Camera access starts only after the Camera action and a native permission dialog.
  The trusted main window receives a 30-second video-only permission window; audio
  and remote/child frames are excluded. Capture, Cancel, leaving Paint, or unmounting
  stops the video tracks. Cancelled permission requests cannot grant access later.
- The geometry engine is bundled locally. CSP adds `wasm-unsafe-eval` for WebAssembly;
  JavaScript string evaluation and remote scripts remain blocked.
