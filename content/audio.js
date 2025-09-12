(() => {
  // === CONFIG ===
  const CONFIG = {
    secretSalt: "s3cr3t-s4lt",      // rotate from server periodically
    seedTTL: 5 * 60 * 1000,         // rotation window per-origin (ms)
    baseSigma: 1e-5,                // base Gaussian sigma (small)
    sigmaJitter: 0.3,               // per-origin sigma variation
    glitchProbability: 1e-4,        // tiny chance to simulate a failure
    bufferSize: 65536,              // pre-generated noise buffer size
    timingNoiseMaxMs: 0.2           // max timing noise in ms
  };

  // === NATIVES BACKUP ===
  const native = {
    AudioContext: window.AudioContext,
    OfflineAudioContext: window.OfflineAudioContext,
    getRandomValues: crypto.getRandomValues.bind(crypto),
    subtle: crypto.subtle,
    Function_toString: Function.prototype.toString,
    defineProperty: Object.defineProperty,
    getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
    ownKeys: Reflect.ownKeys
  };

  // === TAB + ORIGIN ENTROPY ===
  const tabEntropy = (() => {
    const buf = new Uint8Array(16);
    native.getRandomValues(buf);
    return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
  })();

  // === SEED / NOISE CACHE ===
  const noiseCache = new Map();

  function getSeedKey() {
    const origin = location.origin || "null_origin";
    const nowBucket = Math.floor(Date.now() / CONFIG.seedTTL);
    return `${origin}::${tabEntropy}::${nowBucket}`;
  }

  // small, fast 32-bit FNV-1a style-ish hash for strings
  function fastHash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  // xorshift32 PRNG (deterministic, fast)
  function makePRNG(seed) {
    let x = seed >>> 0;
    if (x === 0) x = 0xdeadbeef;
    return () => {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      return (x >>> 0) / 0x100000000;
    };
  }

  function getNoiseBuffer() {
    const key = getSeedKey();
    if (noiseCache.has(key)) return noiseCache.get(key);

    // seed derived from key + secretSalt, combine with crypto random for extra entropy
    const seedNum = fastHash(key + "::" + CONFIG.secretSalt);
    const prng = makePRNG(seedNum);

    const sigma = CONFIG.baseSigma * (1 + CONFIG.sigmaJitter * (prng() - 0.5) * 2);
    const buf = new Float32Array(CONFIG.bufferSize);

    for (let i = 0; i < CONFIG.bufferSize; i += 2) {
      // Box-Muller using PRNG (avoid Math.random)
      let u1 = prng() || 1e-10;
      let u2 = prng() || 1e-10;
      const mag = sigma * Math.sqrt(-2 * Math.log(u1));
      buf[i] = mag * Math.cos(2 * Math.PI * u2);
      if (i + 1 < CONFIG.bufferSize) buf[i + 1] = mag * Math.sin(2 * Math.PI * u2);
    }

    const state = { buf, prng, idx: 0 };
    noiseCache.set(key, state);
    return state;
  }

  function nextNoise() {
    const state = getNoiseBuffer();
    if (state.idx >= state.buf.length) state.idx = 0;
    return state.buf[state.idx++];
  }

  // === SMALL HELPER: secure jitter (no Math.random) ===
  function jitterMs() {
    // returns jitter in [-timingNoiseMaxMs, +timingNoiseMaxMs]
    const state = getNoiseBuffer();
    const r = state.prng();
    return (r - 0.5) * 2 * CONFIG.timingNoiseMaxMs;
  }

  // === STEALTH WRAPPER ===
  function stealthFunction(fn, name) {
    // Return a Proxy that mimics native function appearance as much as practical.
    const nativeSrc = `function ${name || ""}() { [native code] }`;
    const handler = {
      apply(target, thisArg, args) {
        return Reflect.apply(target, thisArg, args);
      },
      get(target, prop, receiver) {
        if (prop === "toString") {
          // calling Function.prototype.toString on the wrapper should return a native-like string
          return function() {
            return nativeSrc;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
      ownKeys(target) {
        // mirror original function's keys
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, prop) {
        return Reflect.getOwnPropertyDescriptor(target, prop);
      }
    };

    const prox = new Proxy(fn, handler);
    try {
      // preserve the common writable/configurable attributes in a conventional way
      native.defineProperty(prox, "name", { value: fn.name || name || "", configurable: true });
    } catch (e) { /* ignore */ }
    return prox;
  }

  // === HELPER: wrap methods safely ===
  function patchMethod(obj, methodName, wrapperFactory) {
    try {
      const orig = obj[methodName];
      if (!orig || orig.__patched) return;
      const wrapped = wrapperFactory(orig);
      const stealthed = stealthFunction(wrapped, orig.name || methodName);
      native.defineProperty(obj, methodName, {
        value: stealthed,
        writable: true,
        configurable: true
      });
      stealthed.__patched = true;
    } catch (e) {
      // fail gracefully — avoid noisy exceptions which sites can detect
      // console.debug("patchMethod failed", methodName, e);
    }
  }

  // === TIMING NOISE: decodeAudioData wrapper (supports Promise and callback) ===
  function makeDecodeAudioDataWrapper(orig) {
    return function(...args) {
      // args: (ArrayBuffer, successCb?, errorCb?)
      const self = this;
      const start = performance.now();
      const jitter = jitterMs();

      // If original returns a Promise (modern), wrap it
      try {
        const res = Reflect.apply(orig, self, args);
        if (res && typeof res.then === "function") {
          return res.then(value => {
            // observe timing but don't block
            const elapsed = performance.now() - start + jitter;
            // no-op (timing affects only reading)
            return value;
          }, err => { throw err; });
        }
      } catch (e) {
        // if orig threw synchronously, just rethrow
        throw e;
      }

      // old callback style: invoke as-is; don't alter control flow
      return Reflect.apply(orig, self, args);
    };
  }

  // === AUDIO BUFFER NOISE WRAPPERS ===
  function makeGetChannelDataWrapper(orig) {
    return function(channel) {
      // Expect `orig` to be AudioBuffer.prototype.getChannelData
      const buf = Reflect.apply(orig, this, arguments);
      // copy into a new Float32Array so we don't mutate original
      let copy = new Float32Array(buf.length);
      copy.set(buf);

      // add tiny noise from buffer; keep fast loop
      const n = copy.length;
      for (let i = 0; i < n; i++) {
        copy[i] += nextNoise();
      }

      // occasional tiny glitch: very rare
      const state = getNoiseBuffer();
      if (state.prng() < CONFIG.glitchProbability) {
        // throw a DOMException similar to real audio errors
        throw new DOMException("Audio buffer error", "InvalidStateError");
      }

      return copy;
    };
  }

  function makeCopyFromChannelWrapper(orig) {
    // Some code uses copyFromChannel(target, channelNumber, startInChannel)
    return function(destination, channelNumber, startInChannel) {
      try {
        // call original to populate destination
        const res = Reflect.apply(orig, this, arguments);
        // add noise into destination in place
        for (let i = 0; i < destination.length; i++) {
          destination[i] = destination[i] + nextNoise();
        }
        return res;
      } catch (e) {
        throw e;
      }
    };
  }

  // === APPLY PATCHES ===
  try {
    // Patch AudioBuffer methods (getChannelData, copyFromChannel)
    if (window.AudioBuffer && AudioBuffer.prototype) {
      patchMethod(AudioBuffer.prototype, "getChannelData", orig => makeGetChannelDataWrapper(orig));
      if (typeof AudioBuffer.prototype.copyFromChannel === "function") {
        patchMethod(AudioBuffer.prototype, "copyFromChannel", orig => makeCopyFromChannelWrapper(orig));
      }
    }

    // Patch decodeAudioData on contexts with timing noise wrapper
    if (native.AudioContext && native.AudioContext.prototype) {
      patchMethod(native.AudioContext.prototype, "decodeAudioData", orig => makeDecodeAudioDataWrapper(orig));
    }
    if (native.OfflineAudioContext && native.OfflineAudioContext.prototype) {
      patchMethod(native.OfflineAudioContext.prototype, "decodeAudioData", orig => makeDecodeAudioDataWrapper(orig));
    }
  } catch (e) {
    // silent fail
  }

  // === EXPORT for testing/debug (non-enumerable) ===
  try {
    native.defineProperty(window, "__audio_stealth_debug", {
      value: {
        CONFIG,
        getSeedKey,
        getNoiseBuffer
      },
      configurable: true,
      enumerable: false,
      writable: false
    });
  } catch (e) { /* ignore */ }

})();
