// Burnt-out look for a TankModel (shared charred materials). Used for static wrecks and for destroyed enemies.
import { MeshStandardMaterial, Color } from 'three';
import { makeBurnt } from '../environment/ProcTextures.js';
import { patchMaterial } from '../environment/Atmosphere.js';

let M = null;
function mats() {
  if (M) return M;
  M = {
    paint: patchMaterial(new MeshStandardMaterial({ map: makeBurnt(), roughness: 0.95, metalness: 0.1, color: 0xffffff })),
    dark: patchMaterial(new MeshStandardMaterial({ color: 0x1b1a18, roughness: 0.95, metalness: 0.1 })),
    wheel: patchMaterial(new MeshStandardMaterial({ vertexColors: true, color: 0x555555, roughness: 0.95, metalness: 0 })),
  };
  return M;
}

// swaps every material of the model for charred ones (matte, never glossy)
export function burnModel(model) {
  const m = mats(), src = model.mats;
  model.root.traverse((o) => {
    if (!o.isMesh || o.userData.burnt) return;
    const x = o.material;
    if (x === src.paint || x === src.cloth || x === src.clothA || x === src.clothB || x === src.clothC || x === src.clothD || x === src.barrel || x === src.metal) o.material = m.paint;
    else if (x === src.glass || x === src.rubber || x === src.dark) o.material = m.dark;
    else if (x === src.wheel) o.material = m.wheel;
    else if (x.map) { const t = x.clone(); t.color = new Color(0x2c2823); t.metalness = 0.1; t.roughness = 0.95; o.material = patchMaterial(t); }
    o.userData.burnt = true;
  });
}
