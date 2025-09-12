(() => {
  'use strict';

  const ENABLE_SPOOF = true;
  const BATTERY_UPDATE_INTERVAL = 5000; // ms
  const BATTERY_DRAIN_RATE = 0.0015;
  const BATTERY_CHARGE_RATE = 0.0025;

  // ------------------- Utility functions -------------------
  function redefine(obj, prop, value) {
    Object.defineProperty(obj, prop, {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: () => {},
    });
  }

  // Simple deterministic hash for origin + tab
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  // Generate per-origin + per-tab seed
  const origin = location.origin;
  const tabId = Math.floor(Math.random() * 1e6);
  const seed = hashString(origin + tabId);

  function randomBetween(min, max, s) {
    const x = Math.sin(s) * 10000;
    return min + ((x - Math.floor(x)) * (max - min));
  }

  // ------------------- Create a battery instance -------------------
  function createFakeBattery() {
    const FakeBattery = function() {};
    FakeBattery.prototype = Object.create(Object.getPrototypeOf(navigator.battery || {}));
    FakeBattery.prototype.constructor = FakeBattery;

    const instance = new FakeBattery();

    // Initial per-tab, per-origin values
    let batteryState = {
      charging: randomBetween(0, 1, seed) > 0.5,
      level: parseFloat(randomBetween(0.2, 0.9, seed + 1).toFixed(3)),
      chargingTime: 0,
      dischargingTime: 0
    };

    // ------------------- Event Handlers -------------------
    const events = {};
    ['chargingchange','levelchange','chargingtimechange','dischargingtimechange'].forEach(evt => {
      events[evt] = null;
      Object.defineProperty(instance, 'on' + evt, {
        configurable: true,
        enumerable: true,
        get: () => events[evt],
        set: fn => { events[evt] = typeof fn === 'function' ? fn : null; }
      });
    });

    // ------------------- Event Listener spoof -------------------
    const listenerMap = {};
    instance.addEventListener = (evt, fn) => {
      if (!listenerMap[evt]) listenerMap[evt] = new Set();
      listenerMap[evt].add(fn);
    };
    instance.removeEventListener = (evt, fn) => {
      listenerMap[evt]?.delete(fn);
    };
    instance.dispatchEvent = (evtObj) => {
      const evt = evtObj.type;
      listenerMap[evt]?.forEach(fn => fn.call(instance, evtObj));
      const handler = events['on' + evt];
      if (handler) handler.call(instance, evtObj);
      return true;
    };

    // ------------------- Update battery properties -------------------
    function updateBattery() {
      const oldLevel = batteryState.level;
      const oldCharging = batteryState.charging;

      // Randomly toggle charging occasionally
      if (Math.random() < 0.01) batteryState.charging = !batteryState.charging;

      // Gradual drift
      if (batteryState.charging) {
        batteryState.level = Math.min(1, batteryState.level + BATTERY_CHARGE_RATE * Math.random());
      } else {
        batteryState.level = Math.max(0, batteryState.level - BATTERY_DRAIN_RATE * Math.random());
      }
      batteryState.level = parseFloat(batteryState.level.toFixed(3));

      // Update times
      batteryState.chargingTime = batteryState.charging ? Math.floor((1 - batteryState.level) * 3600) : 0;
      batteryState.dischargingTime = batteryState.charging ? 0 : Math.floor(batteryState.level * 3600);

      // Redefine properties
      ['charging','chargingTime','dischargingTime','level'].forEach(p => redefine(instance, p, batteryState[p]));

      // Fire events if changed
      if (batteryState.level !== oldLevel) instance.dispatchEvent(new Event('levelchange'));
      if (batteryState.charging !== oldCharging) instance.dispatchEvent(new Event('chargingchange'));
      instance.dispatchEvent(new Event('chargingtimechange'));
      instance.dispatchEvent(new Event('dischargingtimechange'));
    }

    setInterval(updateBattery, BATTERY_UPDATE_INTERVAL);

    // ------------------- Enumeration & prototype spoof -------------------
    const realKeys = [
      'charging','chargingTime','dischargingTime','level',
      'onchargingchange','onlevelchange','onchargingtimechange','ondischargingtimechange'
    ];
    Object.defineProperty(instance, Symbol.toStringTag, { value: 'BatteryManager' });

    return new Proxy(instance, {
      ownKeys() { return realKeys; },
      getOwnPropertyDescriptor(target, prop) {
        if (realKeys.includes(prop)) return { configurable: true, enumerable: true, writable: false, value: target[prop] };
        return Object.getOwnPropertyDescriptor(target, prop);
      }
    });
  }

  const fakeInstance = createFakeBattery();

  // ------------------- Patch navigator.getBattery -------------------
  if (ENABLE_SPOOF && navigator.getBattery) {
    const originalGetBattery = navigator.getBattery.bind(navigator);
    Object.defineProperty(navigator, 'getBattery', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: () => Promise.resolve(fakeInstance)
    });

    const originalFuncStr = originalGetBattery.toString();
    Function.prototype.toString = new Proxy(Function.prototype.toString, {
      apply(target, thisArg, args) {
        if (thisArg === navigator.getBattery) return originalFuncStr;
        return target.apply(thisArg, args);
      }
    });
  }

  // ------------------- Patch navigator.battery -------------------
  if ('battery' in navigator) {
    Object.defineProperty(navigator, 'battery', { configurable: true, enumerable: true, get: () => fakeInstance });
  }

})();
