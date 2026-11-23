import { pathToFileURL } from 'node:url';
import path from 'node:path';
const three = pathToFileURL(path.resolve('node_modules/three/build/three.module.js')).href;
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: three, shortCircuit: true };
  return next(spec, ctx);
}
