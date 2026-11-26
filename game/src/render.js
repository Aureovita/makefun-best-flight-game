// Drawing the world: a small WebGL renderer with two shader programs — one for the sky, one
// flat-shaded lambert program for everything solid — and the meshes of the vale built once
// from the terrain (ground, water, runway, trees, rocks, clouds), plus the few that move:
// the rings, whose colours change as the course is flown, and the aeroplane. The camera is
// a smoothed chase view by default, a seat view in the cockpit, or a slow orbit for the
// title screen. Nothing here knows the rules; it paints the state it is given.

import { GRID, PALETTE, VALE_HEIGHT, WORLD_SIZE } from './config.js';
import { createRandom } from './random.js';
import { forwardVector } from './flight-model.js';
import { RUNWAY } from './terrain.js';
import { buildAircraftMesh, buildCockpitMesh, buildPropellerMesh, PROPELLER_OFFSET, PILOT_EYE } from './aircraft.js';
import { createMesh, hexToRgb } from './mesh.js';

const HALF = WORLD_SIZE / 2;
const CELL = WORLD_SIZE / GRID;
/** The sun: low in the west, warm, the light every solid mesh is shaded by. */
const SUN_DIR = normalize3([-0.52, 0.46, 0.34]);
const FOG_NEAR = 1000;
const FOG_FAR = 4600;

function normalize3(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const depth = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * depth, -1,
    0, 0, 2 * far * near * depth, 0,
  ]);
}

function lookAt(eye, target, up) {
  const zAxis = normalize3([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const xAxis = normalize3([
    up[1] * zAxis[2] - up[2] * zAxis[1],
    up[2] * zAxis[0] - up[0] * zAxis[2],
    up[0] * zAxis[1] - up[1] * zAxis[0],
  ]);
  const yAxis = [
    zAxis[1] * xAxis[2] - zAxis[2] * xAxis[1],
    zAxis[2] * xAxis[0] - zAxis[0] * xAxis[2],
    zAxis[0] * xAxis[1] - zAxis[1] * xAxis[0],
  ];
  return new Float32Array([
    xAxis[0], yAxis[0], zAxis[0], 0,
    xAxis[1], yAxis[1], zAxis[1], 0,
    xAxis[2], yAxis[2], zAxis[2], 0,
    -(xAxis[0] * eye[0] + xAxis[1] * eye[1] + xAxis[2] * eye[2]),
    -(yAxis[0] * eye[0] + yAxis[1] * eye[1] + yAxis[2] * eye[2]),
    -(zAxis[0] * eye[0] + zAxis[1] * eye[1] + zAxis[2] * eye[2]),
    1,
  ]);
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] = a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function translation(x, y, z) {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

function rotationZ(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/**
 * The model matrix that puts the airframe (nose -Z, up +Y) at the plane's state: its
 * columns are the plane's right, up and backward axes, built from its forward vector and
 * bank, so the renderer and the flight model can never disagree about where the nose is.
 */
function aircraftMatrix(state) {
  const ahead = forwardVector(state);
  const right = normalize3([-ahead.z, 0, ahead.x]);
  let up = [
    right[1] * ahead.z - right[2] * ahead.y,
    right[2] * ahead.x - right[0] * ahead.z,
    right[0] * ahead.y - right[1] * ahead.x,
  ];
  const cos = Math.cos(state.roll);
  const sin = Math.sin(state.roll);
  const rolledRight = [
    right[0] * cos - up[0] * sin,
    right[1] * cos - up[1] * sin,
    right[2] * cos - up[2] * sin,
  ];
  const rolledUp = [
    up[0] * cos + right[0] * sin,
    up[1] * cos + right[1] * sin,
    up[2] * cos + right[2] * sin,
  ];
  return new Float32Array([
    rolledRight[0], rolledRight[1], rolledRight[2], 0,
    rolledUp[0], rolledUp[1], rolledUp[2], 0,
    -ahead.x, -ahead.y, -ahead.z, 0,
    state.pos.x, state.pos.y, state.pos.z, 1,
  ]);
}

/** The top 3x3 of a matrix, for transforming normals. */
function normalMatrixOf(model) {
  return new Float32Array([
    model[0], model[1], model[2],
    model[4], model[5], model[6],
    model[8], model[9], model[10],
  ]);
}

const SOLID_VERTEX = `
attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec4 a_color;
uniform mat4 u_mvp;
uniform mat4 u_viewMat;
uniform mat3 u_normalMat;
uniform vec3 u_sunDir;
varying vec4 v_color;
varying float v_depth;
void main() {
  vec3 normal = normalize(u_normalMat * a_normal);
  float diffuse = max(dot(normal, u_sunDir), 0.0);
  float sky = max(normal.y, 0.0) * 0.16;
  vec3 lit = a_color.rgb * (0.46 + sky + diffuse * 0.66) * mix(vec3(1.0), vec3(1.06, 0.94, 0.8), diffuse);
  v_color = vec4(lit, a_color.a);
  vec4 viewPos = u_viewMat * vec4(a_position, 1.0);
  v_depth = -viewPos.z;
  gl_Position = u_mvp * vec4(a_position, 1.0);
}`;

const SOLID_FRAGMENT = `
precision mediump float;
uniform vec3 u_fogColor;
uniform float u_fogNear;
uniform float u_fogFar;
varying vec4 v_color;
varying float v_depth;
void main() {
  float fog = smoothstep(u_fogNear, u_fogFar, v_depth);
  gl_FragColor = vec4(mix(v_color.rgb, u_fogColor, fog), v_color.a);
}`;

const SKY_VERTEX = `
attribute vec2 a_corner;
varying vec2 v_ndc;
void main() {
  v_ndc = a_corner;
  gl_Position = vec4(a_corner, 0.9999, 1.0);
}`;

const SKY_FRAGMENT = `
precision mediump float;
uniform vec3 u_top;
uniform vec3 u_horizon;
uniform vec3 u_sunDir;
uniform vec3 u_sunColor;
uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform vec3 u_camForward;
uniform vec2 u_tan;
varying vec2 v_ndc;
void main() {
  vec3 dir = normalize(u_camForward + v_ndc.x * u_tan.x * u_camRight + v_ndc.y * u_tan.y * u_camUp);
  float height = clamp(dir.y, -1.0, 1.0);
  vec3 color = mix(u_horizon, u_top, smoothstep(0.0, 0.45, height));
  if (height < 0.0) color = mix(u_horizon, u_horizon * 0.82, smoothstep(0.0, -0.2, height));
  float sunAmount = max(dot(dir, u_sunDir), 0.0);
  color += u_sunColor * (pow(sunAmount, 700.0) * 1.4 + pow(sunAmount, 10.0) * 0.16);
  gl_FragColor = vec4(color, 1.0);
}`;

function compileProgram(gl, vertexSource, fragmentSource) {
  function shader(type, source) {
    const handle = gl.createShader(type);
    gl.shaderSource(handle, source);
    gl.compileShader(handle);
    return handle;
  }
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  return program;
}

/** Split built mesh arrays into an opaque draw and a transparent draw, by vertex alpha. */
function splitByAlpha(arrays) {
  const opaque = { positions: [], normals: [], colors: [] };
  const clear = { positions: [], normals: [], colors: [] };
  const triangles = arrays.positions.length / 9;
  for (let t = 0; t < triangles; t += 1) {
    const target = arrays.colors[t * 12 + 3] >= 0.999 ? opaque : clear;
    for (let v = 0; v < 3; v += 1) {
      const p = (t * 3 + v) * 3;
      const c = (t * 3 + v) * 4;
      target.positions.push(arrays.positions[p], arrays.positions[p + 1], arrays.positions[p + 2]);
      target.normals.push(arrays.normals[p], arrays.normals[p + 1], arrays.normals[p + 2]);
      target.colors.push(arrays.colors[c], arrays.colors[c + 1], arrays.colors[c + 2], arrays.colors[c + 3]);
    }
  }
  const pack = (part) => ({
    positions: new Float32Array(part.positions),
    normals: new Float32Array(part.normals),
    colors: new Float32Array(part.colors),
    count: part.positions.length / 3,
  });
  return { opaque: pack(opaque), clear: pack(clear) };
}

/** The vale floor as one mesh: two triangles a cell, coloured by the land at their middle. */
function buildTerrainMesh(terrain) {
  const mesh = createMesh();
  const row = GRID + 1;
  const at = (i, j) => ({ x: -HALF + i * CELL, y: terrain.heights[j * row + i], z: -HALF + j * CELL });
  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      const midX = (a.x + c.x) / 2;
      const midZ = (a.z + c.z) / 2;
      const color = terrain.colorAt(midX, midZ);
      mesh.addTriangle(a, c, b, color);
      mesh.addTriangle(a, d, c, color);
    }
  }
  return mesh.build();
}

/** The field: asphalt, paint and threshold bars, sitting a breath above the levelled ground. */
function buildRunwayMesh() {
  const mesh = createMesh();
  const top = VALE_HEIGHT + 0.3;
  mesh.addBox(RUNWAY.x, VALE_HEIGHT + 0.14, RUNWAY.zCenter, RUNWAY.width, 0.3, RUNWAY.length, PALETTE.runway, { shade: 0.94 });
  // Centreline dashes and threshold bars at both ends.
  for (let z = RUNWAY.zFar + 40; z < RUNWAY.zNear - 30; z += 62) {
    mesh.addBox(RUNWAY.x, top + 0.03, z, 1.1, 0.06, 26, PALETTE.runwayMark, { shade: 1 });
  }
  for (const end of [RUNWAY.zNear - 14, RUNWAY.zFar + 14]) {
    for (let stripe = -2.5; stripe <= 2.5; stripe += 1) {
      mesh.addBox(RUNWAY.x + stripe * 6.4, top + 0.03, end, 3.4, 0.06, 17, PALETTE.runwayMark, { shade: 1 });
    }
  }
  // Edge lines, the full length of the strip.
  mesh.addBox(RUNWAY.x - RUNWAY.width / 2 + 1.2, top + 0.02, RUNWAY.zCenter, 0.7, 0.05, RUNWAY.length - 8, PALETTE.runwayMark, { shade: 1 });
  mesh.addBox(RUNWAY.x + RUNWAY.width / 2 - 1.2, top + 0.02, RUNWAY.zCenter, 0.7, 0.05, RUNWAY.length - 8, PALETTE.runwayMark, { shade: 1 });
  return mesh.build();
}

/** Trees and rocks, merged into one mesh: trunks and layered crowns, grey tumbled blocks. */
function buildScatterMesh(terrain) {
  const mesh = createMesh();
  for (const tree of terrain.trees) {
    const s = tree.scale;
    mesh.addCylinder(tree.x, tree.y + 1.1 * s, tree.z, 0.32 * s, 2.2 * s, PALETTE.treeTrunk, { segments: 6 });
    const leaf = tree.dry ? PALETTE.treeLeafDry : PALETTE.treeLeaf;
    mesh.addBox(tree.x, tree.y + (2.2 + 1.7) * s, tree.z, 3.1 * s, 3.4 * s, 3.1 * s, leaf, { rotation: [0, tree.x % 1.2, 0] });
    mesh.addBox(tree.x, tree.y + (2.2 + 4.4) * s, tree.z, 2.1 * s, 2.8 * s, 2.1 * s, leaf, { rotation: [0, tree.z % 1.1, 0] });
  }
  for (const rock of terrain.rocks) {
    mesh.addBox(rock.x, rock.y + 0.8 * rock.scale, rock.z, 3.4 * rock.scale, 2.2 * rock.scale, 2.8 * rock.scale, PALETTE.rock, { rotation: [0.2, rock.turn, 0.12] });
  }
  return mesh.build();
}

/** A still lake in the south-east basin: one translucent sheet at the water level. */
function buildWaterMesh() {
  const mesh = createMesh();
  const y = 16;
  const a = { x: 320, y, z: 1740 };
  const b = { x: 1880, y, z: 1740 };
  const c = { x: 1880, y, z: 420 };
  const d = { x: 320, y, z: 420 };
  mesh.addQuad(a, b, c, d, PALETTE.water, 0.88);
  return mesh.build();
}

/** The field's lights: edge lamps the length of the strip, and a PAPI row by the threshold. */
function buildLightsMesh() {
  const mesh = createMesh();
  for (let z = RUNWAY.zFar + 30; z <= RUNWAY.zNear - 30; z += 90) {
    for (const side of [-1, 1]) {
      mesh.addBox(RUNWAY.x + side * (RUNWAY.width / 2 + 2.5), VALE_HEIGHT + 0.55, z, 0.9, 0.5, 0.9, PALETTE.runwayEdge, { shade: 1 });
    }
  }
  // On the glidepath a PAPI shows two whites and two reds; the row sits left of the threshold.
  const papi = [PALETTE.runwayMark, PALETTE.runwayMark, PALETTE.planeRed, PALETTE.planeRed];
  papi.forEach((color, index) => {
    mesh.addBox(RUNWAY.x - 30 - index * 6, VALE_HEIGHT + 0.5, RUNWAY.zNear + 16, 1.6, 0.5, 0.8, color, { shade: 1 });
  });
  return mesh.build();
}

/** Still evening clouds: flat white slabs in loose clusters, high over the vale. */
function buildCloudsMesh() {
  const mesh = createMesh();
  const random = createRandom(20261126);
  for (let cluster = 0; cluster < 14; cluster += 1) {
    const cx = (random() * 2 - 1) * 2100;
    const cz = (random() * 2 - 1) * 2100;
    const cy = 400 + random() * 140;
    const slabs = 3 + Math.floor(random() * 3);
    for (let slab = 0; slab < slabs; slab += 1) {
      const w = 90 + random() * 150;
      mesh.addBox(cx + (random() * 2 - 1) * 90, cy + (random() * 2 - 1) * 9, cz + (random() * 2 - 1) * 60, w, 13 + random() * 9, w * (0.45 + random() * 0.3), PALETTE.cloud, { shade: 0.97 });
    }
  }
  return mesh.build();
}

/** The ring course as one mesh; colours say which gate is next, which are flown, which wait. */
function buildRingsMesh(rings, mission) {
  const mesh = createMesh();
  rings.forEach((ring, index) => {
    const color = mission && index < mission.index ? PALETTE.ringDone : mission && index === mission.index ? PALETTE.ringNext : PALETTE.ringTodo;
    mesh.addTorus(ring.x, ring.y, ring.z, ring.radius, 2.4, color, { yaw: ring.yaw, sides: 22, around: 7 });
  });
  return mesh.build();
}

export function createRenderer(canvas, terrain) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
  if (!gl) return null;
  const solid = compileProgram(gl, SOLID_VERTEX, SOLID_FRAGMENT);
  const sky = compileProgram(gl, SKY_VERTEX, SKY_FRAGMENT);
  const solidLoc = {
    position: gl.getAttribLocation(solid, 'a_position'),
    normal: gl.getAttribLocation(solid, 'a_normal'),
    color: gl.getAttribLocation(solid, 'a_color'),
    mvp: gl.getUniformLocation(solid, 'u_mvp'),
    viewMat: gl.getUniformLocation(solid, 'u_viewMat'),
    normalMat: gl.getUniformLocation(solid, 'u_normalMat'),
    sunDir: gl.getUniformLocation(solid, 'u_sunDir'),
    fogColor: gl.getUniformLocation(solid, 'u_fogColor'),
    fogNear: gl.getUniformLocation(solid, 'u_fogNear'),
    fogFar: gl.getUniformLocation(solid, 'u_fogFar'),
  };
  const skyLoc = {
    corner: gl.getAttribLocation(sky, 'a_corner'),
    top: gl.getUniformLocation(sky, 'u_top'),
    horizon: gl.getUniformLocation(sky, 'u_horizon'),
    sunDir: gl.getUniformLocation(sky, 'u_sunDir'),
    sunColor: gl.getUniformLocation(sky, 'u_sunColor'),
    camRight: gl.getUniformLocation(sky, 'u_camRight'),
    camUp: gl.getUniformLocation(sky, 'u_camUp'),
    camForward: gl.getUniformLocation(sky, 'u_camForward'),
    tan: gl.getUniformLocation(sky, 'u_tan'),
  };

  function makeBuffer(data) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
  }

  function makeDrawable(arrays) {
    const parts = splitByAlpha(arrays);
    const pack = (part) => (part.count === 0 ? null : {
      positions: makeBuffer(part.positions),
      normals: makeBuffer(part.normals),
      colors: makeBuffer(part.colors),
      count: part.count,
    });
    return { opaque: pack(parts.opaque), clear: pack(parts.clear) };
  }

  const worldDrawable = makeDrawable((() => {
    const merged = createMesh();
    merged.addMesh(buildTerrainMesh(terrain));
    merged.addMesh(buildRunwayMesh());
    merged.addMesh(buildScatterMesh(terrain));
    merged.addMesh(buildWaterMesh());
    merged.addMesh(buildLightsMesh());
    merged.addMesh(buildCloudsMesh());
    return merged.build();
  })());
  const aircraftDrawable = makeDrawable(buildAircraftMesh());
  const propellerDrawable = makeDrawable(buildPropellerMesh());
  const cockpitDrawable = makeDrawable(buildCockpitMesh());

  let ringsDrawable = null;
  let ringsKey = '';
  function refreshRings(rings, mission) {
    const key = mission ? `${mission.index}:${mission.passed.join(',')}` : 'none';
    if (key === ringsKey) return;
    ringsKey = key;
    ringsDrawable = makeDrawable(buildRingsMesh(rings, mission));
  }

  const skyBuffer = makeBuffer(new Float32Array([-1, -1, 3, -1, -1, 3]));

  const view = { width: 1, height: 1 };
  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    if (width !== view.width || height !== view.height) {
      canvas.width = width;
      canvas.height = height;
      view.width = width;
      view.height = height;
    }
  }
  window.addEventListener('resize', resize);
  resize();

  const camera = { pos: [0, 200, 900], target: [0, 100, 0], up: [0, 1, 0], snapped: false };
  function snapCamera() {
    camera.snapped = false;
  }

  function updateCamera(scene, dt) {
    const plane = scene.aircraft;
    if (scene.view === 'orbit') {
      const t = scene.orbitT ?? 0;
      const cx = RUNWAY.x;
      const cz = RUNWAY.zCenter;
      camera.pos = [cx + Math.sin(t) * 300, VALE_HEIGHT + 95, cz + Math.cos(t) * 300];
      camera.target = [cx, VALE_HEIGHT + 12, cz];
      camera.up = [0, 1, 0];
      camera.snapped = true;
      return;
    }
    if (scene.view === 'cockpit') {
      // The seat view, built from the flight model's own vectors rather than by picking
      // elements out of the model matrix: the airframe's rolled frame (right, up, and
      // backward along the tail) is worked out directly, the eye is placed at PILOT_EYE
      // in that frame, and the camera looks straight down the nose with the frame's up.
      const ahead = forwardVector(plane);
      const right = normalize3([-ahead.z, 0, ahead.x]);
      const flatUp = [
        right[1] * ahead.z - right[2] * ahead.y,
        right[2] * ahead.x - right[0] * ahead.z,
        right[0] * ahead.y - right[1] * ahead.x,
      ];
      const cos = Math.cos(plane.roll);
      const sin = Math.sin(plane.roll);
      const rolledRight = [
        right[0] * cos - flatUp[0] * sin,
        right[1] * cos - flatUp[1] * sin,
        right[2] * cos - flatUp[2] * sin,
      ];
      const rolledUp = [
        flatUp[0] * cos + right[0] * sin,
        flatUp[1] * cos + right[1] * sin,
        flatUp[2] * cos + right[2] * sin,
      ];
      // Airframe +Z (toward the tail) points along -ahead in the world, hence the sign.
      const eye = [
        plane.pos.x + rolledRight[0] * PILOT_EYE.x + rolledUp[0] * PILOT_EYE.y - ahead.x * PILOT_EYE.z,
        plane.pos.y + rolledRight[1] * PILOT_EYE.x + rolledUp[1] * PILOT_EYE.y - ahead.y * PILOT_EYE.z,
        plane.pos.z + rolledRight[2] * PILOT_EYE.x + rolledUp[2] * PILOT_EYE.y - ahead.z * PILOT_EYE.z,
      ];
      camera.pos = eye;
      camera.target = [eye[0] + ahead.x, eye[1] + ahead.y, eye[2] + ahead.z];
      camera.up = rolledUp;
      camera.snapped = true;
      return;
    }
    // Chase: behind, above and a step to the side, eased toward its post so it never
    // fights the pilot. The post sits far enough back that the whole airframe fits in
    // the frame, and the camera aims at the aeroplane itself — only a short look-ahead
    // past it — so the plane always rides in the lower-centre of the picture with the
    // world it is flying into spread out above it.
    const ahead = forwardVector(plane);
    const side = normalize3([-ahead.z, 0, ahead.x]);
    const desired = [
      plane.pos.x - ahead.x * 21 + side[0] * 4,
      plane.pos.y + 6.2 - ahead.y * 9,
      plane.pos.z - ahead.z * 21 + side[2] * 4,
    ];
    const groundY = terrain.heightAt(desired[0], desired[2]) + 2.2;
    if (desired[1] < groundY) desired[1] = groundY;
    if (!camera.snapped || dt <= 0) {
      camera.pos = desired;
      camera.snapped = true;
    } else {
      const ease = 1 - Math.exp(-dt * 5.2);
      camera.pos = [
        camera.pos[0] + (desired[0] - camera.pos[0]) * ease,
        camera.pos[1] + (desired[1] - camera.pos[1]) * ease,
        camera.pos[2] + (desired[2] - camera.pos[2]) * ease,
      ];
    }
    // The post is kept off the ground above; the eased path toward it is too, so a
    // turn toward rising country can never bury the camera in the hillside mid-frame.
    const cameraGroundY = terrain.heightAt(camera.pos[0], camera.pos[2]) + 1.6;
    if (camera.pos[1] < cameraGroundY) camera.pos[1] = cameraGroundY;
    camera.target = [plane.pos.x + ahead.x * 8, plane.pos.y + ahead.y * 8 + 0.6, plane.pos.z + ahead.z * 8];
    camera.up = [0, 1, 0];
  }

  function drawPart(part, mvp, viewMat, normalMat) {
    if (!part) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, part.positions);
    gl.enableVertexAttribArray(solidLoc.position);
    gl.vertexAttribPointer(solidLoc.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, part.normals);
    gl.enableVertexAttribArray(solidLoc.normal);
    gl.vertexAttribPointer(solidLoc.normal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, part.colors);
    gl.enableVertexAttribArray(solidLoc.color);
    gl.vertexAttribPointer(solidLoc.color, 4, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(solidLoc.mvp, false, mvp);
    gl.uniformMatrix4fv(solidLoc.viewMat, false, viewMat);
    gl.uniformMatrix3fv(solidLoc.normalMat, false, normalMat);
    gl.drawArrays(gl.TRIANGLES, 0, part.count);
  }

  const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

  /** Paint one frame of the scene: { aircraft, rings, mission, view, orbitT }. */
  function draw(scene, dt) {
    resize();
    gl.viewport(0, 0, view.width, view.height);
    updateCamera(scene, dt);
    const proj = perspective(1.12, view.width / view.height, 0.5, 7000);
    const viewMat = lookAt(camera.pos, camera.target, camera.up);
    const viewProj = multiply(proj, viewMat);

    // Sky first, at the far plane, writing no depth; then a fresh depth for the world.
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(sky);
    gl.bindBuffer(gl.ARRAY_BUFFER, skyBuffer);
    gl.enableVertexAttribArray(skyLoc.corner);
    gl.vertexAttribPointer(skyLoc.corner, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3fv(skyLoc.top, hexToRgb(PALETTE.skyTop));
    gl.uniform3fv(skyLoc.horizon, hexToRgb(PALETTE.skyHorizon));
    gl.uniform3fv(skyLoc.sunDir, SUN_DIR);
    gl.uniform3fv(skyLoc.sunColor, hexToRgb(PALETTE.sun));
    gl.uniform3f(skyLoc.camRight, viewMat[0], viewMat[4], viewMat[8]);
    gl.uniform3f(skyLoc.camUp, viewMat[1], viewMat[5], viewMat[9]);
    gl.uniform3f(skyLoc.camForward, -viewMat[2], -viewMat[6], -viewMat[10]);
    const tanY = Math.tan(1.12 / 2);
    gl.uniform2f(skyLoc.tan, tanY * (view.width / view.height), tanY);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    // Solid world, then the plane, then anything translucent.
    gl.useProgram(solid);
    gl.uniform3fv(solidLoc.sunDir, SUN_DIR);
    gl.uniform3fv(solidLoc.fogColor, hexToRgb(PALETTE.fog));
    gl.uniform1f(solidLoc.fogNear, FOG_NEAR);
    gl.uniform1f(solidLoc.fogFar, FOG_FAR);
    gl.disable(gl.BLEND);
    drawPart(worldDrawable.opaque, viewProj, viewMat, IDENTITY3);
    refreshRings(scene.rings, scene.mission);
    if (ringsDrawable) drawPart(ringsDrawable.opaque, viewProj, viewMat, IDENTITY3);

    const plane = scene.aircraft;
    const model = aircraftMatrix(plane);
    const planeView = multiply(viewMat, model);
    const planeMvp = multiply(proj, planeView);
    if (scene.view !== 'cockpit') {
      drawPart(aircraftDrawable.opaque, planeMvp, planeView, normalMatrixOf(model));
      // Any airframe triangle the alpha split set aside (the glasshouse, should its
      // finish ever turn translucent) still belongs to the aeroplane: paint it with
      // the same care as the propeller disc below, so no part of the airframe can
      // silently vanish from the frame.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      drawPart(aircraftDrawable.clear, planeMvp, planeView, normalMatrixOf(model));
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      const propModel = multiply(model, multiply(translation(PROPELLER_OFFSET.x, PROPELLER_OFFSET.y, PROPELLER_OFFSET.z), rotationZ(plane.propPhase)));
      const propView = multiply(viewMat, propModel);
      const propMvp = multiply(proj, propView);
      drawPart(propellerDrawable.opaque, propMvp, propView, normalMatrixOf(propModel));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      drawPart(propellerDrawable.clear, propMvp, propView, normalMatrixOf(propModel));
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    drawPart(worldDrawable.clear, viewProj, viewMat, IDENTITY3);
    if (ringsDrawable) drawPart(ringsDrawable.clear, viewProj, viewMat, IDENTITY3);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // The cockpit is drawn in camera space over a cleared depth, so it always frames the view.
    if (scene.view === 'cockpit') {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      drawPart(cockpitDrawable.opaque, proj, IDENTITY, IDENTITY3);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      drawPart(cockpitDrawable.clear, proj, IDENTITY, IDENTITY3);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }

  return { draw, snapCamera, isAvailable: true };
}
