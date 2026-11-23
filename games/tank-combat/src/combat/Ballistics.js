// Shared ballistic helpers: elevation solution for the fire-control computer and fall-of-shot prediction.
// Projectiles use constant gravity and no drag, so the closed form matches the simulation exactly.
export const GRAVITY = 9.81;

// Elevation angle (rad) to hit a point 'd' metres away horizontally and 'h' metres higher.
export function solveElevation(d, h, v) {
  if (d < 2) return Math.atan2(h, Math.max(d, 0.001));
  const g = GRAVITY, v2 = v * v;
  const disc = v2 * v2 - g * (g * d * d + 2 * h * v2);
  if (disc < 0) return Math.PI / 4;
  return Math.atan((v2 - Math.sqrt(disc)) / (g * d));
}

const _hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, kind: null, collider: null, dist: 0 };

// Simulate a shot from origin along unit direction (dx,dy,dz); writes impact into out {x,y,z,hit,dist}.
export function predictImpact(world, ox, oy, oz, dx, dy, dz, speed, owner, out) {
  let x = ox, y = oy, z = oz;
  let vx = dx * speed, vy = dy * speed, vz = dz * speed;
  const dt = 0.05;
  const maxSteps = 140;
  let travelled = 0;
  out.hit = false;
  for (let i = 0; i < maxSteps; i++) {
    vy -= GRAVITY * dt;
    const nx = x + vx * dt, ny = y + vy * dt, nz = z + vz * dt;
    if (world.raycastSegment(x, y, z, nx, ny, nz, owner, _hit)) {
      out.hit = true; out.x = _hit.x; out.y = _hit.y; out.z = _hit.z;
      out.dist = travelled + _hit.dist;
      return out;
    }
    travelled += Math.sqrt(vx * vx + vy * vy + vz * vz) * dt;
    x = nx; y = ny; z = nz;
    if (Math.abs(x) > 1100 || Math.abs(z) > 1100 || y < -100) break;
  }
  out.x = x; out.y = y; out.z = z; out.dist = travelled;
  return out;
}
