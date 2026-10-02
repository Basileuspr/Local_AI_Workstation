import { expect, it } from "vitest";
import { fitKnowledgeGraph3D, layoutKnowledgeGraph3D, moveKnowledgeNode, orbitKnowledgeGraph, projectGraphPoint, rotateGraphPoint, zoomKnowledgeGraph } from "../../src/knowledgeGraph3D";

it("gives documents stable depth while preserving legacy x/y and saved xyz positions", () => {
  const nodes = [{ doc_id: "a", position: { x: 12, y: 13 } }, { doc_id: "b", position: { x: 4, y: 5, z: 67 } }, { doc_id: "c" }];
  const first = layoutKnowledgeGraph3D(nodes, []), next = layoutKnowledgeGraph3D(nodes, [{ source: "a", target: "c" }]);
  expect(first.a.x).toBe(12); expect(first.a.y).toBe(13);
  expect(next.a).toEqual(first.a); expect(next.c.z).toBe(first.c.z);
  expect(first.b).toEqual({ x: 4, y: 5, z: 67 });
  expect(new Set(Object.values(first).map(point => point.z)).size).toBe(3);
});

it("projects depth with perspective and rotates through full orbits without changing world positions", () => {
  const camera = { target: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, distance: 900, panX: 0, panY: 0 };
  const far = projectGraphPoint({ x: 100, y: 0, z: -200 }, camera), near = projectGraphPoint({ x: 100, y: 0, z: 200 }, camera);
  expect(near.scale).toBeGreaterThan(far.scale); expect(near.x).toBeGreaterThan(far.x);
  expect(projectGraphPoint({ x: 0, y: 0, z: 890 }, camera).visible).toBe(false);
  const turn = orbitKnowledgeGraph(camera, Math.PI / .006, 0);
  const point = { x: 100, y: 20, z: 30 };
  expect(rotateGraphPoint(point, turn).x).toBeCloseTo(-100);
  const full = orbitKnowledgeGraph(camera, 2 * Math.PI / .006, 2 * Math.PI / .006);
  expect(rotateGraphPoint(point, full)).toEqual(expect.objectContaining({ x: expect.closeTo(100), y: expect.closeTo(20), z: expect.closeTo(30) }));
  expect(point).toEqual({ x: 100, y: 20, z: 30 });
});

it("moves nodes along the camera plane and through depth at arbitrary orientations", () => {
  const camera = { target: { x: 0, y: 0, z: 0 }, yaw: 1.1, pitch: -.7, distance: 900, panX: 0, panY: 0 };
  const point = { x: 33, y: 54, z: -70 };
  const before = rotateGraphPoint(point, camera);
  const dragged = rotateGraphPoint(moveKnowledgeNode(point, camera, 40, -15), camera);
  const scale = projectGraphPoint(point, camera).scale;
  expect(dragged.x - before.x).toBeCloseTo(40 / scale);
  expect(dragged.y - before.y).toBeCloseTo(-15 / scale);
  expect(dragged.z).toBeCloseTo(before.z);
  const deeper = rotateGraphPoint(moveKnowledgeNode(point, camera, 0, 35, true), camera);
  expect(deeper.x).toBeCloseTo(before.x); expect(deeper.y).toBeCloseTo(before.y);
  expect(deeper.z).toBeLessThan(before.z);
});

it("fits the entire volume at different orientations and keeps extreme zoom finite", () => {
  const positions = { a: { x: -100000, y: 400, z: 50000 }, b: { x: 100000, y: -400, z: -50000 } };
  for (const orbit of [{ yaw: 0, pitch: 0 }, { yaw: 1.3, pitch: -.8 }, { yaw: -2.5, pitch: 2.9 }]) {
    const camera = fitKnowledgeGraph3D(positions, orbit);
    for (const point of Object.values(positions)) {
      const screen = projectGraphPoint(point, camera);
      expect(screen.visible).toBe(true); expect(screen.x).toBeGreaterThan(100); expect(screen.x).toBeLessThan(1100);
      expect(screen.y).toBeGreaterThan(70); expect(screen.y).toBeLessThan(700);
    }
    expect(zoomKnowledgeGraph(camera, 1000000).distance).toBe(40);
    expect(zoomKnowledgeGraph(camera, .000001).distance).toBe(2000000);
  }
  expect(fitKnowledgeGraph3D({}).target).toEqual({ x: 0, y: 0, z: 0 });
});
