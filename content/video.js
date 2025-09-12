rate this code 0 - 100
(() => {
  "use strict";

  // ================= CONFIG =================
  const CONFIG = {
    secretSalt: "video-stealth-nextgen",
    seedTTL: 5 * 60 * 1000,            // base seed rotation
    microSeedInterval: 7000,           // additional reseeding for micro-entropy
    frameNoiseSigma: 0.5,
    timingNoiseBase: 1.5,              // base ms jitter
    timingNoiseVar: 2.0,               // variable scaling
    resolutionJitterPx: 2,
    playbackJitterFraction: 0.015
  };

  // ================= NATIVE HOOKS =================
  const NATIVE = {
    getRandomValues: crypto.getRandomValues.bind(crypto),
    defineProperty: Object.defineProperty,
    ownKeys: Reflect.ownKeys,
    getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
    apply: Reflect.apply,
    setTimeout: window.setTimeout.bind(window)
  };

  // Keep original Function.toString
  const NativeFunctionToString = Function.prototype.toString;

  // ================= ENTROPY & SEED =================
  let tabEntropy = (() => {
    const buf = new Uint8Array(16);
    NATIVE.getRandomValues(buf);
    return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
  })();

  function getSeedKey() {
    const bucket = Math.floor(Date.now() / CONFIG.seedTTL);
    return `${location.origin}::${tabEntropy}::${bucket}`;
  }

  // PRNG based on xorshift
  function fastHash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function makePRNG(seed) {
    let x = seed >>> 0 || 123456789;
    return () => {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      return (x >>> 0) / 0x100000000;
    };
  }

  let prng = makePRNG(fastHash(getSeedKey() + CONFIG.secretSalt));

  // Dynamic reseeding for micro-entropy
  setInterval(() => {
    const buf = new Uint8Array(4);
    NATIVE.getRandomValues(buf);
    const extraSeed = buf.reduce((acc, b) => (acc << 8) ^ b, 0);
    prng = makePRNG(fastHash(getSeedKey() + extraSeed + CONFIG.secretSalt));
  }, CONFIG.microSeedInterval);

  // ================= STEALTH FUNCTION WRAPPER =================
  function stealthFunction(fn, name) {
    const nativeSrc = `function ${name || ""}() { [native code] }`;
    const proxy = new Proxy(fn, {
      apply(t, thisArg, args) { return NATIVE.apply(t, thisArg, args); },
      get(t, prop, r) {
        if (prop === "toString") return () => nativeSrc;
        return Reflect.get(t, prop, r);
      },
      ownKeys: t => NATIVE.ownKeys(t),
      getOwnPropertyDescriptor: (t, p) => NATIVE.getOwnPropertyDescriptor(t, p)
    });
    return proxy;
  }

  // Override global Function.prototype.toString for stealth
  NATIVE.defineProperty(Function.prototype, "toString", {
    value: stealthFunction(function toString() {
      return NativeFunctionToString.call(this);
    }, "toString"),
    configurable: true
  });

  // ================= PATCH UTIL =================
  function patchMethod(proto, name, wrapper) {
    const orig = proto[name];
    if (!orig || orig.__patched) return;
    const wrapped = stealthFunction(wrapper(orig), name);
    NATIVE.defineProperty(proto, name, { value: wrapped, configurable: true, writable: true });
    wrapped.__patched = true;
  }

  // ================= JITTER HELPERS =================
  function jitterMs() {
    const base = CONFIG.timingNoiseBase + (prng() * CONFIG.timingNoiseVar);
    return (prng() - 0.5) * 2 * base;
  }

  function jitterPx(px) {
    return px + Math.floor((prng() - 0.5) * 2 * CONFIG.resolutionJitterPx);
  }

  function jitterFrac(val) {
    return val * (1 + (prng() - 0.5) * CONFIG.playbackJitterFraction);
  }

  // Nonlinear human-like delay
  function humanDelay(callback) {
    const delay = Math.abs(Math.sin(prng() * Math.PI) * jitterMs() + Math.random() * 2);
    NATIVE.setTimeout(callback, delay);
  }

  // ================= PATCHES =================

  // requestVideoFrameCallback
  if (window.HTMLVideoElement) {
    patchMethod(HTMLVideoElement.prototype, "requestVideoFrameCallback", orig => function(cb) {
      return NATIVE.apply(orig, this, [function(ts, data) {
        humanDelay(() => cb(ts + jitterMs(), data));
      }]);
    });
  }

  // play() with delay
  patchMethod(HTMLMediaElement.prototype, "play", orig => function(...args) {
    const p = NATIVE.apply(orig, this, args);
    if (p && typeof p.then === "function") {
      return p.then(v => new Promise(res => humanDelay(() => res(v))));
    }
    return p;
  });

  // videoWidth / videoHeight
  function wrapGetter(proto, prop) {
    const desc = NATIVE.getOwnPropertyDescriptor(proto, prop);
    if (!desc || !desc.get) return;
    NATIVE.defineProperty(proto, prop, {
      get: stealthFunction(function() {
        return jitterPx(desc.get.call(this));
      }, `get ${prop}`)
    });
  }
  wrapGetter(HTMLVideoElement.prototype, "videoWidth");
  wrapGetter(HTMLVideoElement.prototype, "videoHeight");

  // getVideoPlaybackQuality
  if (HTMLVideoElement.prototype.getVideoPlaybackQuality) {
    patchMethod(HTMLVideoElement.prototype, "getVideoPlaybackQuality", orig => function(...a) {
      const q = NATIVE.apply(orig, this, a);
      if (q && typeof q === "object") {
        ["droppedVideoFrames", "totalVideoFrames"].forEach(k => {
          if (k in q) q[k] = Math.round(jitterFrac(q[k]));
        });
      }
      return q;
    });
  }

  // drawImage(video) with noise
  if (window.CanvasRenderingContext2D) {
    patchMethod(CanvasRenderingContext2D.prototype, "drawImage", orig => function(...a) {
      const res = NATIVE.apply(orig, this, a);
      if (a[0] instanceof HTMLVideoElement) {
        try {
          const frame = this.getImageData(0, 0, this.canvas.width, this.canvas.height);
          for (let i = 0; i < frame.data.length; i += 4) {
            const n = (prng() - 0.5) * CONFIG.frameNoiseSigma;
            frame.data[i] += n;
            frame.data[i+1] += n;
            frame.data[i+2] += n;
          }
          this.putImageData(frame, 0, 0);
        } catch (e) {}
      }
      return res;
    });
  }

})();