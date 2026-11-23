// Terrain chunk + orbit-map bake worker. Pure number crunching from the recipe module.
const recipes = {};
async function recipe(id) { return recipes[id] || (recipes[id] = await import(`./${id}.js`)); }

self.onmessage = async (e) => {
  const m = e.data;
  const rc = await recipe(m.recipe);
  if (m.t === 'chunk') {
    const { N, size, cx, cz } = m;
    const edges = m.edges || [1, 1, 1, 1];
    const step = size / N, M = N + 3;
    if (rc.setBand) rc.setBand(step > 6 ? step : 0);      // band-limit distant ranges to what this chunk's grid can resolve
    const H = new Float32Array(M * M);
    let ymin = 1e9, ymax = -1e9;
    for (let j = -1; j <= N + 1; j++) for (let i = -1; i <= N + 1; i++) {
      const h = rc.heightAt(cx + (i * step - size / 2), cz + (j * step - size / 2));
      H[(j + 1) * M + (i + 1)] = h;
      if (i >= 0 && j >= 0 && i <= N && j <= N) { if (h < ymin) ymin = h; if (h > ymax) ymax = h; }
    }
    // stitch edges adjoining coarser neighbours: odd edge vertices follow the neighbour's linear interpolation
    const stitch = (r, get, set) => { if (r <= 1) return; for (let k = 0; k <= N; k++) { if (k % r === 0) continue; const k0 = k - (k % r), k1 = Math.min(N, k0 + r), tt = (k - k0) / r; set(k, get(k0) * (1 - tt) + get(k1) * tt); } };
    stitch(edges[0], (k) => H[1 * M + k + 1], (k, v) => { H[1 * M + k + 1] = v; });
    stitch(edges[1], (k) => H[(N + 1) * M + k + 1], (k, v) => { H[(N + 1) * M + k + 1] = v; });
    stitch(edges[2], (k) => H[(k + 1) * M + 1], (k, v) => { H[(k + 1) * M + 1] = v; });
    stitch(edges[3], (k) => H[(k + 1) * M + N + 1], (k, v) => { H[(k + 1) * M + N + 1] = v; });
    const G = N + 1, nGrid = G * G, nSkirt = 4 * G, nv = nGrid + nSkirt;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), aux = new Float32Array(nv * 4);
    const sk = 0.6 + 0.07 * step;
    const mat = [0, 0, 0, 0];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const k = j * G + i, c = (j + 1) * M + (i + 1);
      const hx = H[c + 1] - H[c - 1], hz = H[c + M] - H[c - M];
      const inv = 1 / Math.sqrt(hx * hx + 4 * step * step + hz * hz);
      const nx = -hx * inv, ny = 2 * step * inv, nz = -hz * inv;
      pos[k * 3] = i * step - size / 2; pos[k * 3 + 1] = H[c]; pos[k * 3 + 2] = j * step - size / 2;
      nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
      const slope = Math.sqrt(Math.max(0, 1 - ny * ny));
      rc.materialAt(cx + pos[k * 3], cz + pos[k * 3 + 2], slope, mat);
      aux[k * 4] = mat[0]; aux[k * 4 + 1] = mat[1]; aux[k * 4 + 2] = mat[2]; aux[k * 4 + 3] = mat[3];
    }
    // water surface per grid vertex (worlds with water): wat = -1e9 where dry; null when the chunk has no water at all
    let wat = null;
    if (rc.waterSurface) {
      const w = new Float32Array(nGrid); let any = false;
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
        const k = j * G + i, c = (j + 1) * M + (i + 1);
        const wv = rc.waterSurface(cx + pos[k * 3], cz + pos[k * 3 + 2], H[c]);
        w[k] = wv; if (wv > -1e8 && wv > H[c] - 0.25) any = true;
      }
      if (any) wat = w;
    }
    // skirts: N edge (j=0), S edge (j=N), W (i=0), E (i=N)
    const edge = (e, t) => (e === 0 ? t : e === 1 ? N * G + t : e === 2 ? t * G : t * G + N);
    for (let e = 0; e < 4; e++) for (let t = 0; t < G; t++) {
      const src = edge(e, t), dst = nGrid + e * G + t;
      pos[dst * 3] = pos[src * 3]; pos[dst * 3 + 1] = pos[src * 3 + 1] - sk; pos[dst * 3 + 2] = pos[src * 3 + 2];
      nor[dst * 3] = nor[src * 3]; nor[dst * 3 + 1] = nor[src * 3 + 1]; nor[dst * 3 + 2] = nor[src * 3 + 2];
      aux.set(aux.subarray(src * 4, src * 4 + 4), dst * 4);
    }
    const tr = [pos.buffer, nor.buffer, aux.buffer]; if (wat) tr.push(wat.buffer);
    self.postMessage({ t: 'chunk', id: m.id, pos, nor, aux, ymin, ymax, wat }, tr);
  } else if (m.t === 'bake') {
    // equirect orbit map rows: R height, G rust, B ice/blue, A rock
    const { W, H: HH, r0, r1, R } = m;
    if (rc.setBand) rc.setBand(0);
    const L = 2 * Math.PI * R;
    const out = new Uint8Array(W * (r1 - r0) * 4);
    const mat = [0, 0, 0, 0];
    for (let v = r0; v < r1; v++) for (let u = 0; u < W; u++) {
      const lon = ((u + 0.5) / W) * 2 * Math.PI - Math.PI;
      const lat = -Math.PI / 2 + ((v + 0.5) / HH) * Math.PI;
      const x = lon * R, z = -lat * R;
      let h = rc.heightAt(x, z);
      const tb = (u + 0.5) / W;
      let hh = h;
      if (tb > 0.94) { const t = (tb - 0.94) / 0.06; hh = h * (1 - t) + rc.heightAt(x - L, z) * t; }
      (rc.bakeMaterial || rc.materialAt)(x, z, 0.12, mat);      // recipes may supply a planet-scale look for the orbit map
      const k = ((v - r0) * W + u) * 4;
      out[k] = Math.max(0, Math.min(255, ((hh + 600) / 1800) * 255));
      out[k + 1] = mat[0] * 255; out[k + 2] = mat[1] * 255; out[k + 3] = mat[2] * 255;
    }
    self.postMessage({ t: 'bake', id: m.id, r0, r1, out }, [out.buffer]);
  }
};
