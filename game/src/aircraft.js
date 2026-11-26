// The aeroplane itself, as geometry: a cream-and-red high-wing prop plane, the "Kestrel",
// built from boxes and cylinders in local space (nose toward -Z, up +Y, the origin at the
// centre of gravity). Three meshes come out: the airframe, the propeller on its own so the
// renderer can spin it, and the cockpit the pilot's view sits inside — a dash, a glare
// shield and the nose over it, drawn around the camera when the view is from the seat.

import { PALETTE } from './config.js';
import { createMesh } from './mesh.js';

/** The whole airframe except the propeller, ready to be placed at the plane's position. */
export function buildAircraftMesh() {
  const mesh = createMesh();
  const cream = PALETTE.planeCream;
  const red = PALETTE.planeRed;
  const dark = PALETTE.planeDark;

  // Fuselage in three reaches: engine cowling, cabin, and the taper to the tail.
  mesh.addBox(0, 0, -1.95, 0.92, 0.92, 1.5, dark, { shade: 0.8 });
  mesh.addBox(0, 0.08, -0.45, 1.06, 1.02, 1.9, cream);
  mesh.addBox(0, 0.3, 1.45, 0.58, 0.62, 2.1, cream);
  // The glasshouse: a dark canopy let into the cabin top.
  mesh.addBox(0, 0.68, -0.55, 0.82, 0.4, 1.15, PALETTE.glass, { shade: 0.9 });
  // The high wing, red with cream tips, and its two struts down to the fuselage.
  mesh.addBox(0, 0.86, -0.15, 5.6, 0.15, 1.3, red);
  mesh.addBox(-3.25, 0.86, -0.15, 1.5, 0.15, 1.3, cream);
  mesh.addBox(3.25, 0.86, -0.15, 1.5, 0.15, 1.3, cream);
  mesh.addBox(-0.85, 0.42, -0.15, 0.09, 0.85, 0.09, dark, { rotation: [0, 0, 0.5] });
  mesh.addBox(0.85, 0.42, -0.15, 0.09, 0.85, 0.09, dark, { rotation: [0, 0, -0.5] });
  // Tail feathers: a red stabiliser and fin, cream rudder.
  mesh.addBox(0, 0.52, 2.4, 2.5, 0.12, 0.72, red);
  mesh.addBox(0, 0.95, 2.42, 0.12, 0.95, 0.78, red);
  mesh.addBox(0, 0.95, 2.78, 0.1, 0.8, 0.3, cream);
  // Fixed gear: two legs, two spatted wheels and a tail wheel.
  mesh.addBox(-0.55, -0.62, -0.7, 0.1, 0.75, 0.1, dark, { rotation: [0, 0, 0.22] });
  mesh.addBox(0.55, -0.62, -0.7, 0.1, 0.75, 0.1, dark, { rotation: [0, 0, -0.22] });
  mesh.addCylinder(-0.72, -1.02, -0.7, 0.34, 0.2, dark, { rotation: [0, 0, Math.PI / 2], segments: 12 });
  mesh.addCylinder(0.72, -1.02, -0.7, 0.34, 0.2, dark, { rotation: [0, 0, Math.PI / 2], segments: 12 });
  mesh.addCylinder(0, -0.28, 2.35, 0.17, 0.12, dark, { rotation: [0, 0, Math.PI / 2], segments: 10 });
  // Exhaust stubs and a pitot tube, the small things that make it look built.
  mesh.addBox(-0.4, -0.32, -2.2, 0.12, 0.12, 0.55, dark);
  mesh.addBox(0.4, -0.32, -2.2, 0.12, 0.12, 0.55, dark);
  mesh.addBox(-1.9, 0.72, -0.3, 0.05, 0.3, 0.05, dark);
  return mesh.build();
}

/** The two-blade propeller and its hub, centred on the prop shaft at the nose. */
export function buildPropellerMesh() {
  const mesh = createMesh();
  mesh.addBox(0, 0, 0, 0.17, 2.7, 0.07, PALETTE.planeDark, { shade: 0.75 });
  mesh.addBox(0, 0, 0, 0.5, 0.5, 0.22, PALETTE.planeRed);
  mesh.addDisc(0, 0, -0.05, 1.42, PALETTE.planeDark, { rotation: [Math.PI / 2, 0, 0], alpha: 0.13, segments: 20 });
  return mesh.build();
}

/** Where the propeller sits, in airframe space: at the nose, ahead of the cowling. */
export const PROPELLER_OFFSET = { x: 0, y: 0, z: -2.78 };

/**
 * The cockpit the pilot sees: dash and glare shield low ahead, the cowling top beyond
 * them, frame pillars at the edges and a yoke in the lap. Built in camera space — the
 * camera sits at the origin looking down -Z — so the renderer draws it unrotated.
 */
export function buildCockpitMesh() {
  const mesh = createMesh();
  const dark = PALETTE.planeDark;
  // The dash: a wide dark panel, its top edge the glare shield, tilted back a little.
  mesh.addBox(0, -0.52, -0.92, 1.5, 0.52, 0.14, dark, { rotation: [0.35, 0, 0], shade: 0.7 });
  mesh.addBox(0, -0.3, -1.02, 1.56, 0.1, 0.42, dark, { shade: 0.6 });
  // The cowling over the engine, red, running away ahead of the dash.
  mesh.addBox(0, -0.34, -1.85, 0.9, 0.3, 1.5, PALETTE.planeRed, { shade: 0.92 });
  // Windscreen pillars and the top frame.
  mesh.addBox(-0.78, 0.08, -0.95, 0.07, 0.85, 0.07, dark, { rotation: [0.3, 0, 0.16] });
  mesh.addBox(0.78, 0.08, -0.95, 0.07, 0.85, 0.07, dark, { rotation: [0.3, 0, -0.16] });
  mesh.addBox(0, 0.5, -1.06, 1.6, 0.07, 0.07, dark);
  // The yoke: a column and a grip bar, low in the middle.
  mesh.addBox(0, -0.78, -0.72, 0.09, 0.4, 0.09, dark, { rotation: [0.5, 0, 0] });
  mesh.addBox(0, -0.62, -0.8, 0.52, 0.07, 0.07, dark);
  return mesh.build();
}

/** Where the pilot's eye sits, in airframe space: in the seat, a little above the dash line. */
export const PILOT_EYE = { x: 0, y: 0.78, z: 0.35 };
