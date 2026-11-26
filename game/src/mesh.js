// A tiny geometry toolkit: parts go in as boxes, cylinders, discs and tori described in
// plain metres, and come out as flat-shaded triangle arrays (positions, normals, RGBA
// colours) the renderer can hand to WebGL in one go. Every face gets its own normal, which
// is what gives the game its low-poly look. Colours are hex strings; an optional alpha
// rides along for the few things that are not solid (water, the propeller disc).

/** '#rrggbb' to [r, g, b] in 0..1. */
export function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function rotatePoint(point, rotation) {
  const { x, y, z } = point;
  const [rx, ry, rz] = rotation;
  // Yaw (Y), then pitch (X), then roll (Z): the order an airframe is assembled in.
  let px = x;
  let py = y;
  let pz = z;
  if (rz) {
    const c = Math.cos(rz);
    const s = Math.sin(rz);
    [px, py] = [px * c - py * s, px * s + py * c];
  }
  if (rx) {
    const c = Math.cos(rx);
    const s = Math.sin(rx);
    [py, pz] = [py * c - pz * s, py * s + pz * c];
  }
  if (ry) {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    [px, pz] = [px * c + pz * s, -px * s + pz * c];
  }
  return { x: px, y: py, z: pz };
}

export function createMesh() {
  const positions = [];
  const normals = [];
  const colors = [];

  /** One flat triangle; the normal is worked out from its winding. */
  function addTriangle(a, b, c, color, alpha = 1) {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    const [r, g, blue] = hexToRgb(color);
    for (const point of [a, b, c]) {
      positions.push(point.x, point.y, point.z);
      normals.push(nx, ny, nz);
      colors.push(r, g, blue, alpha);
    }
  }

  /** A quad as two triangles: corners in order around the face. */
  function addQuad(a, b, c, d, color, alpha = 1) {
    addTriangle(a, b, c, color, alpha);
    addTriangle(a, c, d, color, alpha);
  }

  /**
   * A box centred at (cx, cy, cz) with the given size, optionally rotated by [rx, ry, rz].
   * `shade` multiplies the colour of the sides a touch darker than the top, a cheap way to
   * make plain boxes read as solid before the lighting even runs.
   */
  function addBox(cx, cy, cz, width, height, depth, color, options = {}) {
    const rotation = options.rotation ?? [0, 0, 0];
    const shade = options.shade ?? 0.86;
    const alpha = options.alpha ?? 1;
    const hx = width / 2;
    const hy = height / 2;
    const hz = depth / 2;
    const corner = (x, y, z) => {
      const rotated = rotatePoint({ x, y, z }, rotation);
      return { x: rotated.x + cx, y: rotated.y + cy, z: rotated.z + cz };
    };
    const dark = shadeColor(color, shade);
    const darker = shadeColor(color, shade * shade);
    // Top and bottom (wound so their flat normals point out of the box).
    addQuad(corner(-hx, hy, hz), corner(hx, hy, hz), corner(hx, hy, -hz), corner(-hx, hy, -hz), color, alpha);
    addQuad(corner(-hx, -hy, -hz), corner(hx, -hy, -hz), corner(hx, -hy, hz), corner(-hx, -hy, hz), darker, alpha);
    // North (-Z) and south (+Z) faces.
    addQuad(corner(hx, -hy, -hz), corner(-hx, -hy, -hz), corner(-hx, hy, -hz), corner(hx, hy, -hz), dark, alpha);
    addQuad(corner(-hx, -hy, hz), corner(hx, -hy, hz), corner(hx, hy, hz), corner(-hx, hy, hz), dark, alpha);
    // West (-X) and east (+X) faces.
    addQuad(corner(-hx, -hy, -hz), corner(-hx, -hy, hz), corner(-hx, hy, hz), corner(-hx, hy, -hz), darker, alpha);
    addQuad(corner(hx, -hy, hz), corner(hx, -hy, -hz), corner(hx, hy, -hz), corner(hx, hy, hz), darker, alpha);
  }

  /** A round disc in the XZ plane (or turned by rotation): for wheels seen edge-on and the prop. */
  function addDisc(cx, cy, cz, radius, color, options = {}) {
    const segments = options.segments ?? 14;
    const rotation = options.rotation ?? [0, 0, 0];
    const alpha = options.alpha ?? 1;
    const centre = { x: cx, y: cy, z: cz };
    let previous = null;
    for (let index = 0; index <= segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      const local = { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius };
      const turned = rotatePoint(local, rotation);
      const point = { x: centre.x + turned.x, y: centre.y + turned.y, z: centre.z + turned.z };
      if (previous) addTriangle(centre, previous, point, color, alpha);
      previous = point;
    }
  }

  /** A cylinder along Y between two heights; `axis` can lay it along X or Z instead. */
  function addCylinder(cx, cy, cz, radius, height, color, options = {}) {
    const segments = options.segments ?? 10;
    const rotation = options.rotation ?? [0, 0, 0];
    const alpha = options.alpha ?? 1;
    const place = (x, y, z) => {
      const turned = rotatePoint({ x, y, z }, rotation);
      return { x: turned.x + cx, y: turned.y + cy, z: turned.z + cz };
    };
    for (let index = 0; index < segments; index += 1) {
      const a0 = (index / segments) * Math.PI * 2;
      const a1 = ((index + 1) / segments) * Math.PI * 2;
      const p0 = place(Math.cos(a0) * radius, -height / 2, Math.sin(a0) * radius);
      const p1 = place(Math.cos(a1) * radius, -height / 2, Math.sin(a1) * radius);
      const p2 = place(Math.cos(a1) * radius, height / 2, Math.sin(a1) * radius);
      const p3 = place(Math.cos(a0) * radius, height / 2, Math.sin(a0) * radius);
      addQuad(p0, p3, p2, p1, color, alpha);
    }
  }

  /** A torus standing in the XY plane (its hole facing ±Z), turned by `yaw` around Y. */
  function addTorus(cx, cy, cz, radius, tube, color, options = {}) {
    const sides = options.sides ?? 20;
    const around = options.around ?? 8;
    const yaw = options.yaw ?? 0;
    const alpha = options.alpha ?? 1;
    const point = (side, step) => {
      const a = (side / sides) * Math.PI * 2;
      const b = (step / around) * Math.PI * 2;
      const ringX = Math.cos(a) * (radius + Math.cos(b) * tube);
      const ringY = Math.sin(a) * (radius + Math.cos(b) * tube);
      const ringZ = Math.sin(b) * tube;
      const turned = rotatePoint({ x: ringX, y: ringY, z: ringZ }, [0, yaw, 0]);
      return { x: turned.x + cx, y: turned.y + cy, z: turned.z + cz };
    };
    for (let side = 0; side < sides; side += 1) {
      for (let step = 0; step < around; step += 1) {
        addQuad(point(side, step), point(side + 1, step), point(side + 1, step + 1), point(side, step + 1), color, alpha);
      }
    }
  }

  /** Merge another mesh's arrays into this one, offset by a translation. */
  function addMesh(other, dx = 0, dy = 0, dz = 0) {
    for (let index = 0; index < other.positions.length; index += 3) {
      positions.push(other.positions[index] + dx, other.positions[index + 1] + dy, other.positions[index + 2] + dz);
      normals.push(other.normals[index], other.normals[index + 1], other.normals[index + 2]);
      colors.push(other.colors[(index / 3) * 4], other.colors[(index / 3) * 4 + 1], other.colors[(index / 3) * 4 + 2], other.colors[(index / 3) * 4 + 3]);
    }
  }

  function build() {
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      colors: new Float32Array(colors),
      triangles: positions.length / 9,
    };
  }

  return { addTriangle, addQuad, addBox, addDisc, addCylinder, addTorus, addMesh, build };
}

/** A hex colour multiplied toward black: shadeColor('#ffffff', 0.5) is mid grey. */
export function shadeColor(hex, factor) {
  const [r, g, b] = hexToRgb(hex);
  const channel = (value) => Math.round(clamp255(value * factor));
  return `#${[channel(r * 255), channel(g * 255), channel(b * 255)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function clamp255(value) {
  return Math.max(0, Math.min(255, value));
}
