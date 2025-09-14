const sscript = document.createElement('script');
sscript.textContent = `
// Upgraded injected script: Canvas anti-fingerprinting v4 (WebGL removed)
(function () {
  'use strict';

  /* ---------------------------
     CONFIG
     --------------------------- */
  const CONFIG = {
    maxPixelShiftBase: 1.0,
    maxPixelShiftCap: 3.5,
    baseNoiseProbability: 0.35,
    sampleStride: 61,
    timeSeedRotateMs: 60 * 1000,
    minSafeCanvasDim: 8,
    timingNoiseMsAsyncBase: 0.6,
    maxMutationArea: 100 * 100,
    maxGetImageDataCopyPixels: 2000 * 2000,
    mutationPatchSize: 32,
    performanceJitterUs: 20,
  };

  /* ---------------------------
     Helpers & PRNG
     --------------------------- */
  function xorshift32(seed) {
    let [a, b, c, d] = seed.map(v => v >>> 0);
    return function () {
      let t = (a ^ (a << 11)) >>> 0;
      a = b; b = c; c = d;
      d = (d ^ (d >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
      return d >>> 0;
    };
  }

  function createSeed(...parts) {
    try {
      const arr = new Uint32Array(4);
      crypto.getRandomValues(arr);
      for (let i = 0; i < parts.length; i++) {
        const s = String(parts[i] ?? '');
        for (let j = 0; j < s.length; j++) {
          const ch = s.charCodeAt(j) >>> 0;
          arr[j % 4] = (arr[j % 4] ^ ((ch << ((j % 3) * 8)) >>> 0)) >>> 0;
        }
      }
      return [arr[0], arr[1], arr[2], arr[3]];
    } catch (e) {
      const t = (Math.random() * 0xffffffff) >>> 0;
      return [t, t ^ 0x9e3779b9, t ^ 0x243f6a88, t ^ 0xb7e15162];
    }
  }

  function seededRand01(rng) {
    return (rng() / 0x100000000) || 0;
  }

  function tinyPerturb(rng, scale = 1) {
    return (seededRand01(rng) + seededRand01(rng) - 1) * 0.5 * scale;
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ---------------------------
     Native references
     --------------------------- */
  const native = {
    HTMLCanvasElement_toDataURL: HTMLCanvasElement.prototype.toDataURL,
    HTMLCanvasElement_toBlob: HTMLCanvasElement.prototype.toBlob,
    CanvasRenderingContext2D_getImageData: CanvasRenderingContext2D.prototype.getImageData,
    CanvasRenderingContext2D_putImageData: CanvasRenderingContext2D.prototype.putImageData,
    HTMLCanvasElement_getContext: HTMLCanvasElement.prototype.getContext,
    OffscreenCanvas_prototype: typeof OffscreenCanvas !== 'undefined' ? OffscreenCanvas.prototype : null,
    Function_toString: Function.prototype.toString,
    performance_now: typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now.bind(performance) : null,
  };

  let globalSeed = createSeed('global', Date.now(), Math.random());
  let globalRng = xorshift32(globalSeed);

  setInterval(() => {
    globalSeed = createSeed('globalRotate', Date.now(), Math.random());
    globalRng = xorshift32(globalSeed);
  }, CONFIG.timeSeedRotateMs);

  /* ---------------------------
     Performance.now jitter
     --------------------------- */
  if (native.performance_now) {
    try {
      const origPerfNow = native.performance_now;
      const perfRng = xorshift32(createSeed('perf', Date.now(), Math.random()));
      const jitterUs = CONFIG.performanceJitterUs;
      const jitteredNow = function () {
        const base = origPerfNow();
        const noise = tinyPerturb(perfRng, jitterUs / 1000);
        return base + noise;
      };
      Object.defineProperty(performance, 'now', { value: jitteredNow, configurable: true, writable: true });
      native.performance_now = jitteredNow;
    } catch (e) {}
  }

  /* ---------------------------
     Canvas seed management
     --------------------------- */
  const symCanvasSeed = Symbol('canvas_priv_seed_v4');
  function getOrCreateCanvasSeed(canvas) {
    try {
      if (!canvas[symCanvasSeed]) {
        const seed = createSeed(canvas.width || 0, canvas.height || 0, native.performance_now ? native.performance_now() : Date.now(), Math.random());
        Object.defineProperty(canvas, symCanvasSeed, { value: seed, configurable: true, enumerable: false, writable: false });
      }
      return canvas[symCanvasSeed];
    } catch (e) {
      return createSeed(Math.random());
    }
  }

  /* ---------------------------
     Dynamic noise scaling
     --------------------------- */
  function computeNoiseParams(seed, width, height) {
    const area = Math.max(1, (width || 1) * (height || 1));
    const areaScale = Math.max(0.4, Math.min(1.0, 1 - (Math.log10(area) - 1) * 0.07));
    const rng = xorshift32(createSeed(...seed, native.performance_now ? native.performance_now() : Date.now()));
    const entropyScale = 0.85 + seededRand01(rng) * 0.45;
    const t = (new Date()).getUTCHours();
    const timeScale = 0.9 + (Math.abs(12 - t) / 24) * 0.2;
    const noiseProbability = clamp(CONFIG.baseNoiseProbability * areaScale * entropyScale * timeScale, 0.02, 0.8);
    const maxPixelShift = clamp(CONFIG.maxPixelShiftBase * (1 + seededRand01(rng) * 0.8) * (1 / Math.sqrt(Math.max(1, Math.sqrt(area))/10)), 0.2, CONFIG.maxPixelShiftCap);
    return { noiseProbability, maxPixelShift, rng };
  }

  /* ---------------------------
     Core pixel mutation
     --------------------------- */
  function subtlyMutateImageData(data, width, height, seed, options = {}) {
    if (!data || !data.length) return;
    const stride = Math.max(1, options.stride || CONFIG.sampleStride);
    const prob = options.noiseProbability ?? CONFIG.baseNoiseProbability;
    const maxShift = options.maxPixelShift ?? CONFIG.maxPixelShiftBase;
    const rng = xorshift32(seed);
    const totalPixels = Math.floor(data.length / 4);
    const maxSamples = Math.max(1, Math.floor(totalPixels / Math.max(1, stride)));
    const sampleCap = Math.min(maxSamples, 5000);
    let samples = 0;
    for (let base = 0; base < data.length && samples < sampleCap; base += 4 * stride) {
      if (seededRand01(rng) > prob) continue;
      samples++;
      const pattern = rng() & 7;
      for (let c = 0; c < 3; c++) {
        if (pattern <= 1) {
          data[base + c] = data[base + c] ^ (rng() & 1);
        } else if (pattern <= 3) {
          const delta = (rng() & 1) ? 1 : -1;
          data[base + c] = clamp(data[base + c] + delta, 0, 255);
        } else {
          const delta = Math.round(tinyPerturb(rng, maxShift));
          data[base + c] = clamp(data[base + c] + delta, 0, 255);
        }
      }
    }
  }

  function safeCopyImageData(image) {
    if (!image || !image.data) return null;
    const pixelCount = image.width * image.height;
    if (pixelCount * 4 > CONFIG.maxGetImageDataCopyPixels) return null;
    return new Uint8ClampedArray(image.data);
  }

  function makeNativeLike(fn, name, originalFn) {
    try { Object.defineProperty(fn, 'name', { value: name, configurable: true });
          Object.defineProperty(fn, 'length', { value: originalFn.length, configurable: true }); } catch (e) {}
    return fn;
  }

  /* ---------------------------
     Patched methods
     --------------------------- */
  const patchedGetImageData = makeNativeLike(function patchedGetImageData(x, y, w, h) {
    const result = native.CanvasRenderingContext2D_getImageData.apply(this, arguments);
    try {
      const canvas = this && this.canvas ? this.canvas : null;
      if (!canvas || canvas.width < CONFIG.minSafeCanvasDim || canvas.height < CONFIG.minSafeCanvasDim) return result;
      const seed = getOrCreateCanvasSeed(canvas).slice();
      const { noiseProbability, maxPixelShift, rng } = computeNoiseParams(seed, result.width, result.height);
      const callSeed = createSeed(seed[0], seed[1], seed[2], seed[3], x, y, w, h, native.performance_now ? native.performance_now() : Date.now());
      const arr = safeCopyImageData(result);
      if (!arr) return result;
      subtlyMutateImageData(arr, result.width, result.height, callSeed, {
        stride: Math.max(1, Math.floor(CONFIG.sampleStride / 4)),
        maxPixelShift: maxPixelShift,
        noiseProbability: noiseProbability,
      });
      return new ImageData(arr, result.width, result.height);
    } catch (e) { return result; }
  }, 'getImageData', native.CanvasRenderingContext2D_getImageData);

  const patchedToDataURL = makeNativeLike(function patchedToDataURL() {
    try {
      const canvas = this;
      if (canvas && canvas.width >= CONFIG.minSafeCanvasDim && canvas.height >= CONFIG.minSafeCanvasDim) {
        const ctx = canvas.getContext && canvas.getContext('2d');
        if (ctx && native.CanvasRenderingContext2D_getImageData && native.CanvasRenderingContext2D_putImageData) {
          const w = Math.min(CONFIG.mutationPatchSize, canvas.width);
          const h = Math.min(CONFIG.mutationPatchSize, canvas.height);
          const seed = getOrCreateCanvasSeed(canvas).slice();
          const { noiseProbability, maxPixelShift } = computeNoiseParams(seed, canvas.width, canvas.height);
          const sRng = xorshift32(createSeed(...seed, native.performance_now ? native.performance_now() : Date.now()));
          const cx = Math.max(0, Math.floor((canvas.width - w)/2 + tinyPerturb(sRng,2)));
          const cy = Math.max(0, Math.floor((canvas.height - h)/2 + tinyPerturb(sRng,2)));
          try {
            const origImage = native.CanvasRenderingContext2D_getImageData.call(ctx, cx, cy, w, h);
            const origArr = new Uint8ClampedArray(origImage.data);
            const arr = new Uint8ClampedArray(origImage.data);
            subtlyMutateImageData(arr, w, h, createSeed(...seed, native.performance_now ? native.performance_now() : Date.now()), {
              stride: Math.max(3, Math.floor(CONFIG.sampleStride/8)),
              maxPixelShift: maxPixelShift,
              noiseProbability: Math.max(0.05, noiseProbability*0.9)
            });
            native.CanvasRenderingContext2D_putImageData.call(ctx, new ImageData(arr,w,h), cx, cy);
            const out = native.HTMLCanvasElement_toDataURL.apply(this, arguments);
            try { native.CanvasRenderingContext2D_putImageData.call(ctx, new ImageData(origArr,w,h), cx, cy); } catch(e){}
            return out;
          } catch(e){}
        }
      }
    } catch(e){}
    return native.HTMLCanvasElement_toDataURL.apply(this, arguments);
  }, 'toDataURL', native.HTMLCanvasElement_toDataURL);

  /* ---------------------------
     Patch CanvasRenderingContext2D.prototype
     --------------------------- */
  try { Object.defineProperty(CanvasRenderingContext2D.prototype,'getImageData',{value:patchedGetImageData,configurable:true,writable:true}); } catch(e){}
  try { Object.defineProperty(HTMLCanvasElement.prototype,'toDataURL',{value:patchedToDataURL,configurable:true,writable:true}); } catch(e){}

  /* ---------------------------
     Stealth Function.prototype.toString
     --------------------------- */
  const originalFunctionToString = native.Function_toString;
  function stealthToString() {
    try {
      if (originalToStringMap.has(this)) return originalFunctionToString.call(originalToStringMap.get(this));
    } catch(e){}
    return originalFunctionToString.call(this);
  }
  try { Object.defineProperty(Function.prototype,'toString',{value:stealthToString,configurable:true,writable:true}); } catch(e){}
})();
`;

document.documentElement.appendChild(sscript);
sscript.remove();
