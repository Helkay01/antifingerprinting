
(function() {
  'use strict';

 // --- CONFIGURATION (Tunable) ---

// Maximum ± jitter added to timing (in milliseconds)
const BASE_JITTER_RANGE = 0.75;

// Base drift rate (in ms per second of elapsed time)
const DRIFT_BASE = 0.015;

// Rotation interval controls how often the base noise/drift pattern resets
const MIN_ROTATION_INTERVAL = 10000; // ~10 seconds
const MAX_ROTATION_INTERVAL = 25000; // ~25 seconds

// Device classification threshold (≤ = low-end)
const LOW_END_THRESHOLD = 4;

// --- Manual override for testing (set to true to force low-end mode) ---
const FORCE_LOW_END = false;

// --- Runtime state ---
let deviceCores = navigator.hardwareConcurrency || 8;

// If device is low-end (or override is on), increase jitter/drift
let jitterRange = BASE_JITTER_RANGE;
let driftRate = DRIFT_BASE;

if (deviceCores <= LOW_END_THRESHOLD || FORCE_LOW_END) {
  jitterRange *= 1.8;   // Increase jitter by 80%
  driftRate *= 2.5;     // Increase drift by 150%
}



  // Generate a random integer seed for noise pattern per instance
  const noiseSeed = Math.floor(Math.random() * 1e9);

  // Generates a smooth pseudo-random noise based on time & seed
  function smoothNoise(t) {
    // Using sine waves + a simple pseudo-random function for smooth noise
    const val = (
      Math.sin(t * 0.001 + noiseSeed) * 0.5 +
      Math.sin(t * 0.003 + noiseSeed * 2) * 0.3 +
      Math.sin(t * 0.007 + noiseSeed * 3) * 0.2
    );
    return val; // range approx [-1, 1]
  }

  // Random rotation interval between min and max to avoid predictability
  function getRotationInterval() {
    return MIN_ROTATION_INTERVAL + Math.random() * (MAX_ROTATION_INTERVAL - MIN_ROTATION_INTERVAL);
  }

  // --- NOISE GENERATION STATE ---
  let lastRotation = performance.now();
  let rotationInterval = getRotationInterval();
  let baseNoise = Math.random() * 10;
  let driftOffset = 0;
  let lastTime = performance.now();

  // Complex drift pattern: sinusoidal + linear drift + jitter
  function getNoise(currentTime) {
    if (currentTime - lastRotation > rotationInterval) {
      // Reset base noise and drift at randomized intervals
      baseNoise = Math.random() * 10;
      driftOffset = 0;
      lastRotation = currentTime;
      rotationInterval = getRotationInterval();
    }

    const elapsed = (currentTime - lastTime) / 1000;
    lastTime = currentTime;

    // Nonlinear drift: sum of slow sinusoids + linear drift
    const nonlinearDrift = Math.sin(currentTime * 0.001 + noiseSeed) * 0.1 + Math.cos(currentTime * 0.002 + noiseSeed * 2) * 0.05;
    driftOffset += elapsed * driftRate * (1 + nonlinearDrift);

    // Smooth noise + jitter scaled by jitterRange
    const jitter = smoothNoise(currentTime) * jitterRange;

    // Final noise combines base, drift, jitter
    return baseNoise + driftOffset + jitter;
  }

  // --- UTILITIES FOR STEALTH ---

  // Store originals to allow undo
  const originals = {
    performanceNow: performance.now.bind(performance),
    dateNow: Date.now.bind(Date),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    audioContext: window.AudioContext || window.webkitAudioContext,
    getExtension: WebGLRenderingContext.prototype.getExtension,
  };

  // Proxy a function to add noise, keep stealthy toString
  function proxyFunction(fn, noiseFn) {
    const proxied = new Proxy(fn, {
      apply(target, thisArg, args) {
        const realTime = Reflect.apply(target, thisArg, args);
        const noise = noiseFn(realTime);
        return realTime + noise;
      },
      get(target, prop, receiver) {
        // Hide proxy internals and preserve native look for toString
        if (prop === 'toString') {
          return function() {
            return `function ${fn.name || ''}() { [native code] }`;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
      has(target, prop) {
        if (prop === 'toString') return true;
        return prop in target;
      },
      ownKeys(target) {
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, prop) {
        if (prop === 'toString') {
          return {
            configurable: true,
            enumerable: false,
            writable: false,
            value: proxied.toString()
          };
        }
        return Object.getOwnPropertyDescriptor(target, prop);
      }
    });
    return proxied;
  }

  // --- PATCH performance.now ---
  const patchedPerformanceNow = proxyFunction(originals.performanceNow, getNoise);
  Object.defineProperty(performance, 'now', {
    value: patchedPerformanceNow,
    writable: false,
    configurable: true,
    enumerable: false
  });

  // --- PATCH Date.now ---
  const patchedDateNow = proxyFunction(originals.dateNow, (rt) => getNoise(originals.performanceNow()));
  Object.defineProperty(Date, 'now', {
    value: patchedDateNow,
    writable: false,
    configurable: true,
    enumerable: false
  });

  // --- PATCH requestAnimationFrame ---
  function patchedRAF(callback) {
    return originals.requestAnimationFrame(function(time) {
      const noisyTime = time + getNoise(originals.performanceNow());
      return callback(noisyTime);
    });
  }
  // Stealth toString for patchedRAF
  patchedRAF.toString = () => originals.requestAnimationFrame.toString();
  Object.defineProperty(window, 'requestAnimationFrame', {
    value: patchedRAF,
    writable: false,
    configurable: true,
    enumerable: false
  });

  // --- PATCH AudioContext.currentTime ---
  if (originals.audioContext) {
    const AudioContextProxy = function(...args) {
      const ctx = new originals.audioContext(...args);

      // Grab original currentTime getter
      const proto = Object.getPrototypeOf(ctx);
      const desc = Object.getOwnPropertyDescriptor(proto, 'currentTime');
      if (desc && desc.get) {
        Object.defineProperty(ctx, 'currentTime', {
          get() {
            const originalTime = desc.get.call(ctx);
            return originalTime + getNoise(originals.performanceNow()) / 1000;
          },
          configurable: true,
          enumerable: true
        });
      }

      return ctx;
    };
    AudioContextProxy.prototype = originals.audioContext.prototype;

    Object.defineProperty(window, 'AudioContext', {
      value: AudioContextProxy,
      writable: false,
      configurable: true,
      enumerable: false
    });
    if (window.webkitAudioContext) {
      Object.defineProperty(window, 'webkitAudioContext', {
        value: AudioContextProxy,
        writable: false,
        configurable: true,
        enumerable: false
      });
    }
  }

  // --- PATCH WebGL EXT_disjoint_timer_query ---
  WebGLRenderingContext.prototype.getExtension = new Proxy(originals.getExtension, {
    apply(target, thisArg, args) {
      const extName = args[0];
      const ext = Reflect.apply(target, thisArg, args);
      if (ext && typeof ext === 'object' && extName && extName.includes('EXT_disjoint_timer_query')) {
        if (typeof ext.getQueryObjectEXT === 'function') {
          ext.getQueryObjectEXT = new Proxy(ext.getQueryObjectEXT, {
            apply(origFn, extThis, fnArgs) {
              const result = Reflect.apply(origFn, extThis, fnArgs);
              if (fnArgs[1] === ext.QUERY_RESULT_EXT && typeof result === 'number') {
                return result + getNoise(originals.performanceNow());
              }
              return result;
            }
          });
        }
      }
      return ext;
    },
    get(target, prop, receiver) {
      if (prop === 'toString') {
        return () => originals.getExtension.toString();
      }
      return Reflect.get(target, prop, receiver);
    }
  });

  // --- PATCH Function.prototype.toString comprehensively ---
  const originalFunctionToString = Function.prototype.toString;

  // Map of patched functions for stealth return of native code string
  const stealthFunctions = new WeakSet([
    performance.now,
    Date.now,
    window.requestAnimationFrame,
  ]);

  Function.prototype.toString = new Proxy(originalFunctionToString, {
    apply(target, thisArg, args) {
      if (stealthFunctions.has(thisArg)) {
        return `function ${thisArg.name || ''}() { [native code] }`;
      }
      return Reflect.apply(target, thisArg, args);
    }
  });

  // --- NON-ENUMERABLE / HIDDEN PROPERTIES ---
  // Hide patched properties on performance, Date, window, etc.
  function hideProp(obj, prop) {
    Object.defineProperty(obj, prop, {
      configurable: true,
      enumerable: false,
      writable: false
    });
  }
  hideProp(performance, 'now');
  hideProp(Date, 'now');
  hideProp(window, 'requestAnimationFrame');
  if (window.AudioContext) hideProp(window, 'AudioContext');
  if (window.webkitAudioContext) hideProp(window, 'webkitAudioContext');
  hideProp(WebGLRenderingContext.prototype, 'getExtension');

  // --- UNDO FUNCTION: restore all patched APIs ---
  function undoPatches() {
    Object.defineProperty(performance, 'now', {
      value: originals.performanceNow,
      writable: false,
      configurable: true,
      enumerable: false
    });
    Object.defineProperty(Date, 'now', {
      value: originals.dateNow,
      writable: false,
      configurable: true,
      enumerable: false
    });
    Object.defineProperty(window, 'requestAnimationFrame', {
      value: originals.requestAnimationFrame,
      writable: false,
      configurable: true,
      enumerable: false
    });
    if (originals.audioContext) {
      Object.defineProperty(window, 'AudioContext', {
        value: originals.audioContext,
        writable: false,
        configurable: true,
        enumerable: false
      });
      if (window.webkitAudioContext) {
        Object.defineProperty(window, 'webkitAudioContext', {
          value: originals.audioContext,
          writable: false,
          configurable: true,
          enumerable: false
        });
      }
    }
    Object.defineProperty(WebGLRenderingContext.prototype, 'getExtension', {
      value: originals.getExtension,
      writable: false,
      configurable: true,
      enumerable: false
    });
    Function.prototype.toString = originalFunctionToString;
  }

  // Expose undo function safely (optional)
  Object.defineProperty(window, '__undoTimingNoisePatch', {
    value: undoPatches,
    writable: false,
    configurable: false,
    enumerable: false
  });

})();