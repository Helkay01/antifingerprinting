
// Stealth Permissions Wrapper — Production-grade (v5)
// Target: mimic native navigator.permissions.query with strong anti-fingerprinting features.
// Installs a stealth wrapper that preserves prototypes, stack-like async depth,
// native-looking toString, event behavior, gaussian/human timing, and randomized resolution.
//
// Usage:
//   window.setPermissionsMock({ enabled: true, state: 'granted', randomize: true, debug: false });
//
// Exports:
//   window._nativePermissionsQuery -> original native function
//   window.setPermissionsMock(...) -> runtime toggles




(function () {
  if (!navigator.permissions || !navigator.permissions.query) return;

  const nativeQuery = navigator.permissions.query.bind(navigator.permissions);

  // Default stored config (non-enumerable)
  Object.defineProperty(window, "PERMISSIONS_MOCK", {
    value: { enabled: false, state: "prompt", randomize: false, jitter: true, debug: false },
    writable: true,
    configurable: true,
    enumerable: false
  });

  // Expose native
  Object.defineProperty(window, "_nativePermissionsQuery", {
    value: nativeQuery,
    writable: false,
    configurable: true,
    enumerable: false
  });

  // Utility: Box-Muller gaussian random (mean=0, std=1)
  function gaussianRandom() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  // Human-like delay generator: base ms +/- gaussian noise, clipped
  function humanDelay(baseMs = 12, jitter = true, scale = 0.6) {
    if (!jitter) return Math.max(0, Math.round(baseMs));
    // Add small skew (positive) to simulate slightly longer human timings
    const noise = gaussianRandom() * baseMs * scale;
    const skew = Math.abs(gaussianRandom()) * (baseMs * 0.15);
    const raw = baseMs + noise + skew;
    return Math.max(1, Math.round(raw));
  }

  // Create an async microtask chain of variable depth to mimic native stack traces:
  // returns a Promise that resolves after 'depth' microtasks (await Promise.resolve()).
  async function microtaskChain(depth = 1) {
    // depth between 1 and 5 (random)
    const d = Math.max(1, Math.min(6, Math.floor(depth)));
    for (let i = 0; i < d; i++) {
      // slightly vary each microtask
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }
    return;
  }

  // Randomize state with bias
  function getRandomizedState(configState) {
    if (!window.PERMISSIONS_MOCK.randomize) return configState;
    const states = ["granted", "denied", "prompt"];
    const bias = configState && states.includes(configState) ? configState : "prompt";
    // 75% biased, 25% random
    if (Math.random() < 0.75) return bias;
    return states[Math.floor(Math.random() * states.length)];
  }

  // Build a native-like PermissionStatus mock with event support
  function createMockPermissionStatus(initialState = "prompt") {
    // Try to obtain the real PermissionStatus prototype if available
    const proto = (typeof PermissionStatus !== "undefined" && PermissionStatus.prototype) ? PermissionStatus.prototype : Object.prototype;

    // Create object but then set prototype to match real PermissionStatus
    const mock = {};
    Reflect.setPrototypeOf(mock, proto);

    // Internal listener storage (non-enumerable)
    const listeners = { change: [] };
    Object.defineProperty(mock, "__listeners__", {
      value: listeners,
      writable: false,
      enumerable: false,
      configurable: false
    });

    // Define internal state (non-enumerable)
    let _state = initialState;
    Object.defineProperty(mock, "__state__", {
      get() { return _state; },
      set(v) { _state = v; },
      enumerable: false,
      configurable: false
    });

    // Define state as enumerable property (like native)
    Object.defineProperty(mock, "state", {
      get() { return mock.__state__; },
      set(v) { // setting triggers onchange-like behavior
        const old = mock.__state__;
        mock.__state__ = v;
        if (old !== v) {
          // schedule onchange/event dispatch with human-like jitter
          const delay = humanDelay(8 + Math.random() * 40, window.PERMISSIONS_MOCK.jitter, 0.8);
          setTimeout(() => dispatchChangeEvent(), delay);
        }
      },
      enumerable: true,
      configurable: true
    });

    // onchange property (writable)
    Object.defineProperty(mock, "onchange", {
      value: null,
      writable: true,
      enumerable: true,
      configurable: true
    });

    // addEventListener
    Object.defineProperty(mock, "addEventListener", {
      value: function (type, handler, options) {
        try {
          if (!type || typeof handler !== "function") return;
          const t = String(type);
          if (!listeners[t]) listeners[t] = [];
          // small de-dup protection
          if (!listeners[t].some(l => l.handler === handler)) {
            listeners[t].push({ handler, options: options || false });
          }
          // mimic native: returns undefined; but schedule a microtask so its side effects look real
          microtaskChain(1 + Math.floor(Math.random() * 2)).then(()=>{ /* noop */ });
        } catch (e) {
          // swallow to avoid leaks
        }
      },
      writable: false,
      enumerable: false,
      configurable: true
    });

    // removeEventListener
    Object.defineProperty(mock, "removeEventListener", {
      value: function (type, handler, options) {
        try {
          const t = String(type);
          if (!listeners[t]) return;
          for (let i = listeners[t].length - 1; i >= 0; i--) {
            if (listeners[t][i].handler === handler) listeners[t].splice(i, 1);
          }
          // small microtask to mimic internal removal scheduling
          microtaskChain(1).then(()=>{ /* noop */ });
        } catch (e) {}
      },
      writable: false,
      enumerable: false,
      configurable: true
    });

    // dispatchEvent: emulate Event semantics; return true if not canceled
    Object.defineProperty(mock, "dispatchEvent", {
      value: function (evt) {
        try {
          if (!evt || !evt.type) return false;
          const type = String(evt.type);
          let canceled = false;
          // call listeners synchronously like native but with micro-jitter
          const registered = listeners[type] ? listeners[type].slice() : [];
          for (const { handler } of registered) {
            try {
              // call inside try; allow handler to call preventDefault by setting evt.defaultPrevented
              // but we can't fully emulate DOM Events; so emulate minimal behavior
              handler.call(mock, evt);
              if (evt && evt.defaultPrevented) canceled = true;
            } catch (err) {
              // swallow
            }
          }
          // call onchange if appropriate
          if (type === "change" && typeof mock.onchange === "function") {
            try { mock.onchange.call(mock, evt); } catch (e) {}
          }
          // return !canceled (native returns boolean)
          return !canceled;
        } catch (e) {
          return false;
        }
      },
      writable: false,
      enumerable: false,
      configurable: true
    });

    // Small helper: trigger a "change" event with a tiny human-like delay
    function dispatchChangeEvent() {
      const eventLike = { type: "change", target: mock, currentTarget: mock, defaultPrevented: false };
      // dispatchEvent returns true if not canceled
      mock.dispatchEvent(eventLike);
    }

    // Make object appear native: set constructor to PermissionStatus if exists
    try {
      if (typeof PermissionStatus !== "undefined") {
        Object.defineProperty(mock, "constructor", {
          value: PermissionStatus,
          writable: false,
          enumerable: false,
          configurable: true
        });
      }
    } catch (e) {
      // ignore
    }

    return mock;
  }

  // Build a native-looking toString result: prefer nativeQuery.toString() if available
  function nativeFunctionToStringFallback(fn) {
    try { return nativeQuery.toString(); } catch (e) { return "function query() { [native code] }"; }
  }

  // Create wrapped query function (keeps arity 1 and name 'query' for plausibility)
  const wrappedQuery = function query(descriptor) {
    // We return a Promise and try to make the async profile look native
    return new Promise(async (resolve, reject) => {
      try {
        if (window.PERMISSIONS_MOCK.debug) console.info("[permissions-wrapper] query called:", descriptor);

        // If mock enabled -> produce a mock PermissionStatus after human-like delay + microtask chain
        if (window.PERMISSIONS_MOCK.enabled) {
          const chosen = getRandomizedState(window.PERMISSIONS_MOCK.state || "prompt");
          // variable microtask depth 1..4
          const depth = 1 + Math.floor(Math.random() * 4);
          await microtaskChain(depth);

          // base delay influenced by descriptor complexity + small gaussian noise
          let base = 8 + (descriptor && Object.keys(descriptor).length ? 6 : 0);
          base += Math.min(80, Math.abs(gaussianRandom()) * 12); // occasional longer tails
          const delay = humanDelay(base, window.PERMISSIONS_MOCK.jitter, 0.7);

          setTimeout(() => {
            try {
              resolve(createMockPermissionStatus(chosen));
            } catch (e) {
              resolve(createMockPermissionStatus("prompt"));
            }
          }, delay);
          return;
        }

        // When not mocking: call native, but add small human-ish extra delay relative to native elapsed time
        const start = performance.now();
        const nativePromise = nativeQuery(descriptor);

        // Introduce random microtask chain BEFORE awaiting native to influence stack traces slightly
        const preDepth = 1 + Math.floor(Math.random() * 3);
        await microtaskChain(preDepth);

        nativePromise.then(async (result) => {
          // measure elapsed
          const elapsed = Math.max(1, performance.now() - start);
          // bias extra delay: gaussian around 10% of elapsed, clipped
          const extraBase = Math.max(0, Math.round(elapsed * (0.05 + Math.random() * 0.2)));
          const extra = humanDelay(extraBase, window.PERMISSIONS_MOCK.jitter, 0.6);

          // Put the resolve into a microtask or timeout to match browser internals
          setTimeout(() => resolve(result), extra);
        }).catch(err => {
          // if native rejects, propagate or fallback gracefully
          try { reject(err); } catch (e) { resolve(createMockPermissionStatus("prompt")); }
        });
      } catch (e) {
        // On any unexpected errors, fallback to a safe mock to avoid exposing errors
        try { resolve(createMockPermissionStatus("prompt")); } catch (er) { resolve({ state: "prompt" }); }
      }
    });
  };

  // Preserve native-looking toString behavior by binding native source
  try {
    // Many engines use Function.prototype.toString internal slots; setting .toString helps callers
    Object.defineProperty(wrappedQuery, "toString", {
      value: nativeFunctionToStringFallback,
      writable: false,
      configurable: true,
      enumerable: false
    });
  } catch (e) {
    // ignore if not possible
  }

  // Freeze name and length-like properties to avoid detection
  try {
    // Attempt to set name to 'query' (it already is) and keep length 1
    Object.defineProperty(wrappedQuery, "name", { value: "query", configurable: true });
  } catch (e) {}

  // Install the wrapper
  try {
    // Keep navigator.permissions non-writable fields intact as much as possible
    navigator.permissions.query = wrappedQuery;
  } catch (e) {
    try {
      // fallback: define property if direct assignment fails
      Object.defineProperty(navigator.permissions, "query", { value: wrappedQuery, configurable: true });
    } catch (er) {
      // give up silently to avoid crash
    }
  }

  // Provide runtime toggle with safe defaults
  window.setPermissionsMock = function setPermissionsMock({ enabled = false, state = "prompt", randomize = false, jitter = true, debug = false } = {}) {
    // Keep object non-enumerable but update value
    window.PERMISSIONS_MOCK = { enabled: !!enabled, state: String(state || "prompt"), randomize: !!randomize, jitter: !!jitter, debug: !!debug };
    if (window.PERMISSIONS_MOCK.debug) {
      console.info("[permissions-wrapper] setPermissionsMock:", window.PERMISSIONS_MOCK);
      console.info("[permissions-wrapper] native function source:", nativeFunctionToStringFallback());
    }
  };

  // If debug initially enabled, log
  if (window.PERMISSIONS_MOCK && window.PERMISSIONS_MOCK.debug) {
    console.info("[permissions-wrapper] installed (v5). Use setPermissionsMock({enabled:true,state:'granted'}) to enable mock.");
  }

})();

