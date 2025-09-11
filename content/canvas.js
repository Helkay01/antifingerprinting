const sscript = document.createElement('script');
sscript.textContent = `
  // Upgraded injected script: Canvas/WebGL anti-fingerprinting v3-upgrade
(function () {
  'use strict';

  /* ---------------------------
     CONFIG (tweak to taste)
     --------------------------- */
  const CONFIG = {
    maxPixelShiftBase: 1.0,        // base pixel shift magnitude
    maxPixelShiftCap: 3.5,         // absolute cap
    baseNoiseProbability: 0.35,    // base chance a sampled pixel will change
    sampleStride: 61,
    timeSeedRotateMs: 60 * 1000,
    minSafeCanvasDim: 8,
    patchWebGL: true,
    timingNoiseMsAsyncBase: 0.6,   // ms base (async)
    maxMutationArea: 100 * 100,
    maxGetImageDataCopyPixels: 2000 * 2000,
    mutationPatchSize: 32,
    webglReadPixelsStrideDivisor: 16,
    performanceJitterUs: 20,       // microsecond jitter for performance.now()
    fakeWebGL: {
      enabled: true,
      vendorPool: ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'ARM', 'Qualcomm'],
      rendererPool: [
        'ANGLE (Intel(R) HD Graphics 530 Direct3D11 vs_5_0 ps_5_0)',
        'ANGLE (NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)',
        'Mali-G72', 'Adreno (TM) 640', 'AMD Radeon (TM)']
    },
    extensionFakeProbability: 0.02, // probability to fabricate plausible extension objects (low)
    dropExtensionProbability: 0.015, // probability to deny an extension request (small)
    reorderExtensionsProbability: 0.05,
  };

  /* ---------------------------
     Helpers & PRNG (xorshift32)
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
      return [arr[0] >>> 0, arr[1] >>> 0, arr[2] >>> 0, arr[3] >>> 0];
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
     Internal state & native refs
     --------------------------- */
  const symCanvasSeed = Symbol('canvas_priv_seed_v3_up');
  const patched = new WeakSet();
  const functionMap = new WeakMap();
  const originalToStringMap = new WeakMap();
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
     Performance.now jitter (very small, microseconds)
     --------------------------- */
  if (native.performance_now) {
    try {
      const origPerfNow = native.performance_now;
      const perfRng = xorshift32(createSeed('perf', Date.now(), Math.random()));
      const jitterUs = CONFIG.performanceJitterUs;
      const jitteredNow = function () {
        const base = origPerfNow();
        // tiny microsecond jitter, deterministic per-call via perfRng
        const noise = tinyPerturb(perfRng, jitterUs / 1000); // convert microseconds to ms-scale small value
        return base + noise;
      };
      Object.defineProperty(performance, 'now', {
        value: jitteredNow,
        configurable: true,
        writable: true,
      });
      // keep a ref so we can seed other things from this "noisy" clock
      native.performance_now = jitteredNow;
    } catch (e) {
      // if environment prevents overriding, ignore
    }
  }

  /* ---------------------------
     Async timing noise helper (non-blocking)
     --------------------------- */
  function tinyTimingNoiseAsync(scale = 1) {
    const noiseMs = CONFIG.timingNoiseMsAsyncBase * (1 + seededRand01(globalRng)) * scale;
    if (typeof window.requestIdleCallback === 'function') {
      return new Promise(res => requestIdleCallback(() => setTimeout(res, 0)));
    }
    return new Promise(res => setTimeout(res, Math.max(0, noiseMs)));
  }

  /* ---------------------------
     Canvas seed management
     --------------------------- */
  function getOrCreateCanvasSeed(canvas) {
    try {
      if (!canvas[symCanvasSeed]) {
        const seed = createSeed(canvas.width || 0, canvas.height || 0, native.performance_now ? native.performance_now() : Date.now(), Math.random());
        Object.defineProperty(canvas, symCanvasSeed, {
          value: seed,
          configurable: true,
          enumerable: false,
          writable: false
        });
      }
      return canvas[symCanvasSeed];
    } catch (e) {
      return createSeed(Math.random());
    }
  }

  /* ---------------------------
     Dynamic noise scaling (per-call)
     - uses canvas area, time entropy and global rng
     --------------------------- */
  function computeNoiseParams(seed, width, height) {
    // base scale: larger canvases get slightly lower noise (avoid obvious artifacts)
    const area = Math.max(1, (width || 1) * (height || 1));
    const areaScale = Math.max(0.4, Math.min(1.0, 1 - (Math.log10(area) - 1) * 0.07)); // ~0.4..1.0
    const rng = xorshift32(createSeed(...seed, native.performance_now ? native.performance_now() : Date.now()));
    const entropyScale = 0.85 + seededRand01(rng) * 0.45; // 0.85 to 1.3
    // time-of-day micro variation
    const t = (new Date()).getUTCHours();
    const timeScale = 0.9 + (Math.abs(12 - t) / 24) * 0.2; // slight day/night variation
    // final scales
    const noiseProbability = clamp(CONFIG.baseNoiseProbability * areaScale * entropyScale * timeScale, 0.02, 0.8);
    const maxPixelShift = clamp(CONFIG.maxPixelShiftBase * (1 + seededRand01(rng) * 0.8) * (1 / Math.sqrt(Math.max(1, Math.sqrt(area))/10)), 0.2, CONFIG.maxPixelShiftCap);
    const timingScale = 0.5 + seededRand01(rng) * 1.5;
    return { noiseProbability, maxPixelShift, timingScale, rng };
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
      if (seededRand01(rng) > prob) { continue; }
      samples++;
      // choose a mutation pattern that varies per-sample to avoid deterministic bias
      const pattern = rng() & 7;
      for (let c = 0; c < 3; c++) {
        if (pattern <= 1) {
          // tiny flip or xor
          data[base + c] = data[base + c] ^ (rng() & 1);
        } else if (pattern <= 3) {
          // ±1 delta
          const delta = (rng() & 1) ? 1 : -1;
          data[base + c] = clamp(data[base + c] + delta, 0, 255);
        } else {
          const delta = Math.round(tinyPerturb(rng, maxShift));
          data[base + c] = clamp(data[base + c] + delta, 0, 255);
        }
      }
      // alpha left unchanged
    }
  }

  /* ---------------------------
     Utility: safe copy of ImageData
     --------------------------- */
  function safeCopyImageData(image) {
    if (!image || !image.data) return null;
    const pixelCount = image.width * image.height;
    if (pixelCount > 0 && pixelCount * 4 > CONFIG.maxGetImageDataCopyPixels) {
      return null;
    }
    return new Uint8ClampedArray(image.data);
  }

  /* ---------------------------
     makeNativeLike & toString stealth helpers
     --------------------------- */
  function makeNativeLike(fn, name, originalFn) {
    try {
      Object.defineProperty(fn, 'name', { value: name, configurable: true });
      Object.defineProperty(fn, 'length', { value: originalFn.length, configurable: true });
    } catch (e) {}
    return fn;
  }

  const patchedGetImageData = makeNativeLike(function patchedGetImageData(x, y, w, h) {
    const result = native.CanvasRenderingContext2D_getImageData.apply(this, arguments);
    try {
      const canvas = this && this.canvas ? this.canvas : null;
      if (!canvas) return result;
      if (canvas.width < CONFIG.minSafeCanvasDim || canvas.height < CONFIG.minSafeCanvasDim) return result;

      const area = (w || result.width) * (h || result.height);
      if (area > CONFIG.maxMutationArea && (result.width * result.height > CONFIG.maxGetImageDataCopyPixels)) {
        return result;
      }

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

      // Return mutated ImageData (original canvas untouched)
      return new ImageData(arr, result.width, result.height);
    } catch (e) {
      return result;
    }
  }, 'getImageData', native.CanvasRenderingContext2D_getImageData);

  const patchedToDataURL = makeNativeLike(function patchedToDataURL(/* ...args */) {
    try {
      const canvas = this;
      if (!canvas) return native.HTMLCanvasElement_toDataURL.apply(this, arguments);
      if (canvas.width >= CONFIG.minSafeCanvasDim && canvas.height >= CONFIG.minSafeCanvasDim) {
        const ctx = canvas.getContext && canvas.getContext('2d');
        if (ctx && native.CanvasRenderingContext2D_getImageData && native.CanvasRenderingContext2D_putImageData) {
          const w = Math.min(CONFIG.mutationPatchSize, canvas.width);
          const h = Math.min(CONFIG.mutationPatchSize, canvas.height);
          const seed = getOrCreateCanvasSeed(canvas).slice();
          const { noiseProbability, maxPixelShift, rng } = computeNoiseParams(seed, canvas.width, canvas.height);
          const sRng = xorshift32(createSeed(seed[0], seed[1], seed[2], seed[3], native.performance_now ? native.performance_now() : Date.now()));
          const cx = Math.max(0, Math.floor((canvas.width - w) / 2 + tinyPerturb(sRng, 2)));
          const cy = Math.max(0, Math.floor((canvas.height - h) / 2 + tinyPerturb(sRng, 2)));
          try {
            const originalImage = native.CanvasRenderingContext2D_getImageData.call(ctx, cx, cy, w, h);
            const origArr = new Uint8ClampedArray(originalImage.data);
            const arr = new Uint8ClampedArray(originalImage.data);

            subtlyMutateImageData(arr, w, h, createSeed(...seed, native.performance_now ? native.performance_now() : Date.now()), {
              stride: Math.max(3, Math.floor(CONFIG.sampleStride / 8)),
              maxPixelShift: maxPixelShift,
              noiseProbability: Math.max(0.05, noiseProbability * 0.9),
            });

            native.CanvasRenderingContext2D_putImageData.call(ctx, new ImageData(arr, w, h), cx, cy);

            // Call native toDataURL synchronously while mutated patch is present
            const out = native.HTMLCanvasElement_toDataURL.apply(this, arguments);

            // restore original region immediately (best-effort)
            try {
              native.CanvasRenderingContext2D_putImageData.call(ctx, new ImageData(origArr, w, h), cx, cy);
            } catch (e) {}

            return out;
          } catch (e) {
            // cross-origin or other failure — fallback to native
          }
        }
      }
    } catch (e) { /* swallow */ }
    return native.HTMLCanvasElement_toDataURL.apply(this, arguments);
  }, 'toDataURL', native.HTMLCanvasElement_toDataURL);

  const patchedToBlob = native.HTMLCanvasElement_toBlob ? makeNativeLike(function patchedToBlob() {
    try {
      const canvas = this;
      if (canvas && canvas.width >= CONFIG.minSafeCanvasDim && canvas.height >= CONFIG.minSafeCanvasDim) {
        const ctx = canvas.getContext && canvas.getContext('2d');
        if (ctx && native.CanvasRenderingContext2D_getImageData && native.CanvasRenderingContext2D_putImageData) {
          const w = Math.min(24, canvas.width);
          const h = Math.min(24, canvas.height);
          const seed = getOrCreateCanvasSeed(canvas).slice();
          const { noiseProbability, maxPixelShift, rng } = computeNoiseParams(seed, canvas.width, canvas.height);
          const sRng = xorshift32(createSeed(seed[0], seed[1], seed[2], seed[3], native.performance_now ? native.performance_now() : Date.now()));
          const cx = Math.max(0, Math.floor((canvas.width - w) / 2 + tinyPerturb(sRng, 2)));
          const cy = Math.max(0, Math.floor((canvas.height - h) / 2 + tinyPerturb(sRng, 2)));
          try {
            const originalImage = native.CanvasRenderingContext2D_getImageData.call(ctx, cx, cy, w, h);
            const origArr = new Uint8ClampedArray(originalImage.data);
            const arr = new Uint8ClampedArray(originalImage.data);

            subtlyMutateImageData(arr, w, h, createSeed(...seed, native.performance_now ? native.performance_now() : Date.now()), {
              stride: Math.max(3, Math.floor(CONFIG.sampleStride / 8)),
              maxPixelShift: maxPixelShift,
              noiseProbability: Math.max(0.05, noiseProbability * 0.9),
            });

            native.CanvasRenderingContext2D_putImageData.call(ctx, new ImageData(arr, w, h), cx, cy);

            const args = Array.from(arguments);
            const origCallback = args[0] && typeof args[0] === 'function' ? args[0] : null;
            const cb = function (blob) {
              try {
                native.CanvasRenderingContext2D_putImageData.call(ctx, new ImageData(origArr, w, h), cx, cy);
              } catch (e) {}
              if (origCallback) origCallback(blob);
            };

            return native.HTMLCanvasElement_toBlob.call(this, cb, ...args.slice(1));
          } catch (e) {
            // fall through to native
          }
        }
      }
    } catch (e) {}
    return native.HTMLCanvasElement_toBlob.apply(this, arguments);
  }, 'toBlob', native.HTMLCanvasElement_toBlob) : undefined;

  /* ---------------------------
     Patch HTMLCanvasElement.getContext (and OffscreenCanvas if available)
     --------------------------- */
  const patchedGetContext = makeNativeLike(function patchedGetContext(type, ...args) {
    const ctx = native.HTMLCanvasElement_getContext.apply(this, [type, ...args]);
    try {
      if (!ctx) return ctx;
      // Only patch WebGL contexts if configured
      if ((type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') && CONFIG.patchWebGL) {
        tryPatchWebGLContext(ctx, this);
      }
    } catch (e) {}
    return ctx;
  }, 'getContext', native.HTMLCanvasElement_getContext);

  /* ---------------------------
     WebGL patching & fake capabilities
     --------------------------- */
  function tryPatchWebGLContext(gl, canvas) {
    if (!gl || patched.has(gl)) return;
    try {
      const seed = getOrCreateCanvasSeed(canvas);
      const ctxRng = xorshift32(createSeed(...seed, native.performance_now ? native.performance_now() : Date.now()));

      // patch readPixels
      if (typeof gl.readPixels === 'function') {
        const nativeReadPixels = gl.readPixels.bind(gl);
        const patchedReadPixels = function (...args) {
          try {
            const buf = args[6];
            const width = args[2] || 1;
            const height = args[3] || 1;
            const ret = nativeReadPixels(...args);
            if (buf) {
              if (buf instanceof Uint8Array || buf instanceof Uint8ClampedArray) {
                const { noiseProbability, maxPixelShift } = computeNoiseParams(seed, width, height);
                subtlyMutateImageData(buf, width, height, createSeed(...seed, native.performance_now ? native.performance_now() : Date.now()), {
                  stride: Math.max(1, Math.floor(CONFIG.sampleStride / Math.max(1, CONFIG.webglReadPixelsStrideDivisor))),
                  maxPixelShift: maxPixelShift / 1.5,
                  noiseProbability: Math.max(0.01, noiseProbability * 0.7),
                });
              }
            }
            return ret;
          } catch (e) {
            try { return nativeReadPixels(...args); } catch (ee) { return null; }
          }
        };
        try {
          gl.readPixels = patchedReadPixels;
          functionMap.set(patchedReadPixels, nativeReadPixels);
          originalToStringMap.set(patchedReadPixels, nativeReadPixels);
        } catch (e) {}
      }

      // patch getParameter
      if (typeof gl.getParameter === 'function') {
        const nativeGetParameter = gl.getParameter.bind(gl);
        const patchedGetParameter = function (param) {
          const val = nativeGetParameter(param);
          try {
            // numeric jitter for numeric results
            if (typeof val === 'number' && Math.abs(val) > 1e-9) {
              const noise = tinyPerturb(ctxRng, Math.max(1e-3, Math.abs(val) * 1e-4));
              // some params are integer-only; clamp to integers in those cases by checking typical param names
              const intLike = Number.isInteger(val);
              const out = val + noise;
              return intLike ? Math.round(clamp(out, 0, Number.MAX_SAFE_INTEGER)) : out;
            }

            // known vendor/renderer parameters (UNMASKED_VENDOR_WEBGL = 37445, UNMASKED_RENDERER_WEBGL = 37446)
            // we create plausible strings based on pools
            if (CONFIG.fakeWebGL && CONFIG.fakeWebGL.enabled) {
              try {
                if (param === 37445) { // UNMASKED_VENDOR_WEBGL
                  const vendor = CONFIG.fakeWebGL.vendorPool[Math.floor(seededRand01(ctxRng) * CONFIG.fakeWebGL.vendorPool.length)];
                  return vendor;
                }
                if (param === 37446) { // UNMASKED_RENDERER_WEBGL
                  const renderer = CONFIG.fakeWebGL.rendererPool[Math.floor(seededRand01(ctxRng) * CONFIG.fakeWebGL.rendererPool.length)];
                  return renderer;
                }
              } catch (e) {}
            }
          } catch (e) {}
          return val;
        };
        try {
          gl.getParameter = patchedGetParameter;
          functionMap.set(patchedGetParameter, nativeGetParameter);
          originalToStringMap.set(patchedGetParameter, nativeGetParameter);
        } catch (e) {}
      }

      // patch getExtension
      if (typeof gl.getExtension === 'function') {
        const nativeGetExtension = gl.getExtension.bind(gl);
        const patchedGetExtension = function (name) {
          try {
            // small probability to deny some extensions (helps break deterministic checks)
            if (seededRand01(ctxRng) < CONFIG.dropExtensionProbability) return null;

            // occasionally fabricate plausible extension objects (very small probability)
            if (seededRand01(ctxRng) < CONFIG.extensionFakeProbability) {
              // fabricate a minimal plausible object for known extension families
              if (typeof name === 'string') {
                if (name.indexOf('WEBGL_debug_renderer_info') !== -1 || name.indexOf('WEBGL_debug') !== -1) {
                  return {
                    UNMASKED_VENDOR_WEBGL: 37445,
                    UNMASKED_RENDERER_WEBGL: 37446,
                  };
                }
                // simulate anisotropic extension object
                if (name.indexOf('EXT_texture_filter_anisotropic') !== -1) {
                  return { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84FF };
                }
                // fallback: return an object with harmless fields
                return { name: name, fabricated: true };
              }
            }

            return nativeGetExtension(name);
          } catch (e) {
            try { return nativeGetExtension(name); } catch (ee) { return null; }
          }
        };
        try {
          gl.getExtension = patchedGetExtension;
          functionMap.set(patchedGetExtension, nativeGetExtension);
          originalToStringMap.set(patchedGetExtension, nativeGetExtension);
        } catch (e) {}
      }

      // patch getSupportedExtensions: reorder, occasionally drop or add plausible ones
      if (typeof gl.getSupportedExtensions === 'function') {
        const nativeGetSupportedExtensions = gl.getSupportedExtensions.bind(gl);
        const patchedGetSupportedExtensions = function () {
          const list = nativeGetSupportedExtensions();
          try {
            const out = Array.from(list || []);
            const rngVal = seededRand01(ctxRng);
            if (rngVal < CONFIG.reorderExtensionsProbability && out.length > 3) {
              const i = Math.floor(seededRand01(ctxRng) * out.length);
              const j = Math.floor(seededRand01(ctxRng) * out.length);
              const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
            }
            // occasionally add a plausible-but-fake extension to confuse enum checks
            if (seededRand01(ctxRng) < 0.01) {
              out.push('WEBGL_fake_perf_hint_' + Math.floor(seededRand01(ctxRng) * 1000));
            }
            // remove duplicates and return
            return Array.from(new Set(out));
          } catch (e) {
            return list;
          }
        };
        try {
          gl.getSupportedExtensions = patchedGetSupportedExtensions;
          functionMap.set(patchedGetSupportedExtensions, nativeGetSupportedExtensions);
          originalToStringMap.set(patchedGetSupportedExtensions, nativeGetSupportedExtensions);
        } catch (e) {}
      }

      patched.add(gl);
    } catch (e) {
      // ignore silently
    }
  }

  /* ---------------------------
     Apply prototype patches
     --------------------------- */
  try {
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'getImageData', {
      value: patchedGetImageData,
      configurable: true,
      writable: true,
    });
    functionMap.set(patchedGetImageData, native.CanvasRenderingContext2D_getImageData);
    originalToStringMap.set(patchedGetImageData, native.CanvasRenderingContext2D_getImageData);
  } catch (e) {}

  try {
    Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
      value: patchedToDataURL,
      configurable: true,
      writable: true,
    });
    functionMap.set(patchedToDataURL, native.HTMLCanvasElement_toDataURL);
    originalToStringMap.set(patchedToDataURL, native.HTMLCanvasElement_toDataURL);
  } catch (e) {}

  if (patchedToBlob) {
    try {
      Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
        value: patchedToBlob,
        configurable: true,
        writable: true,
      });
      functionMap.set(patchedToBlob, native.HTMLCanvasElement_toBlob);
      originalToStringMap.set(patchedToBlob, native.HTMLCanvasElement_toBlob);
    } catch (e) {}
  }

  try {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: patchedGetContext,
      configurable: true,
      writable: true,
    });
    functionMap.set(patchedGetContext, native.HTMLCanvasElement_getContext);
    originalToStringMap.set(patchedGetContext, native.HTMLCanvasElement_getContext);
  } catch (e) {}

  if (CONFIG.applyToOffscreen && native.OffscreenCanvas_prototype) {
    try {
      const proto = native.OffscreenCanvas_prototype;
      if (proto.toDataURL) {
        Object.defineProperty(proto, 'toDataURL', {
          value: patchedToDataURL,
          configurable: true,
          writable: true
        });
      }
      if (proto.toBlob && patchedToBlob) {
        Object.defineProperty(proto, 'toBlob', {
          value: patchedToBlob,
          configurable: true,
          writable: true
        });
      }
    } catch (e) {}
  }

  /* ---------------------------
     Stealthy Function.prototype.toString override
     --------------------------- */
  const originalFunctionToString = native.Function_toString;
  function stealthToString() {
    try {
      if (originalToStringMap.has(this)) {
        try {
          return originalFunctionToString.call(originalToStringMap.get(this));
        } catch (e) {
          return 'function () { [native code] }';
        }
      }
    } catch (e) {}
    return originalFunctionToString.call(this);
  }

  try {
    Object.defineProperty(Function.prototype, 'toString', {
      value: stealthToString,
      configurable: true,
      writable: true,
    });
  } catch (e) {
    // if locked, ignore
  }

  /* ---------------------------
     Final: annotate installed patch
     --------------------------- */
  try {
    Object.defineProperty(window, '__canvas_privacy_patch_v3_upgraded__', {
      value: {
        installedAt: new Date().toISOString(),
        config: Object.assign({}, CONFIG),
      },
      configurable: true,
      writable: false,
      enumerable: false
    });
  } catch (e) {}

  // done
})();

  
`;

document.documentElement.appendChild(sscript);
sscript.remove();
