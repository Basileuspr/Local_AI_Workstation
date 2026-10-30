import { expect, it } from "vitest";
import { fitKnowledgeGraph3D, knowledgeGraphSpace, layoutKnowledgeGraph3D, layoutKnowledgeLabels, moveKnowledgeNode, orbitKnowledgeGraph, projectGraphPoint, projectGraphSegment, rotateGraphPoint, zoomKnowledgeGraph } from "../../src/knowledgeGraph3D";

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

it("encloses empty, flat and widely separated graphs in a padded room without moving documents", () => {
  for (const positions of [{}, { a: { x: 20, y: 10, z: 30 } }, { a: { x: -100000, y: 400, z: 50000 }, b: { x: 100000, y: 400, z: -50000 } }]) {
    const saved = structuredClone(positions), space = knowledgeGraphSpace(positions);
    for (const point of Object.values(positions)) for (const axis of ["x", "y", "z"]) {
      expect(space.min[axis]).toBeLessThanOrEqual(point[axis] - 96);
      expect(space.max[axis]).toBeGreaterThanOrEqual(point[axis] + 96);
    }
    expect(space.floor.every(point => point.y === space.max.y)).toBe(true);
    expect(positions).toEqual(saved);
    for (const orbit of [{ yaw: 0, pitch: 0 }, { yaw: 1.3, pitch: -.8 }, { yaw: -2.5, pitch: 2.9 }]) {
      const camera = fitKnowledgeGraph3D(positions, orbit);
      expect(camera.yaw).toBe(orbit.yaw); expect(camera.pitch).toBe(orbit.pitch);
      for (const corner of space.corners) {
        const screen = projectGraphPoint(corner, camera);
        expect(screen.visible).toBe(true);
        expect(screen.x).toBeGreaterThanOrEqual(139.99); expect(screen.x).toBeLessThanOrEqual(1060.01);
        expect(screen.y).toBeGreaterThanOrEqual(129.99); expect(screen.y).toBeLessThanOrEqual(670.01);
      }
    }
  }
});

it("keeps crossing links and room edges visible at close zoom while clipping behind-camera endpoints", () => {
  const camera = { target: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, distance: 100, panX: 0, panY: 0 };
  const front = { x: -10, y: 20, z: 0 }, behind = { x: 10, y: -20, z: 150 };
  const segment = projectGraphSegment(front, behind, camera);
  expect(segment[0]).toEqual(projectGraphPoint(front, camera));
  expect(segment[1].visible).toBe(true); expect(segment[1].z).toBeCloseTo(69);
  expect(segment.flatMap(point => Object.values(point)).every(value => typeof value === "boolean" || Number.isFinite(value))).toBe(true);
  expect(projectGraphSegment(behind, front, camera)).toEqual([...segment].reverse());
  expect(projectGraphSegment(behind, { ...behind, z: 200 }, camera)).toBeNull();
  expect(behind.z).toBe(150);
});

it("separates clustered labels without moving their nodes and keeps edge labels inside the viewport", () => {
  const items = Array.from({ length: 8 }, (_, index) => ({ id: String(index), x: 500 + index * 12, y: 400 + index % 3 * 24, radius: 15, width: 180, height: 28 }));
  items.push({ id: "edge", x: 1190, y: 790, radius: 15, width: 180, height: 28 });
  const saved = structuredClone(items), labels = layoutKnowledgeLabels(items);
  expect(items).toEqual(saved);
  for (const [id, box] of Object.entries(labels)) {
    expect(box.x - box.width / 2).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width / 2).toBeLessThanOrEqual(1200);
    expect(box.y - box.height / 2).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height / 2).toBeLessThanOrEqual(800);
    for (const [otherId, other] of Object.entries(labels)) {
      if (id === otherId) continue;
      expect(Math.abs(box.x - other.x) >= (box.width + other.width) / 2 || Math.abs(box.y - other.y) >= (box.height + other.height) / 2).toBe(true);
    }
  }
});
