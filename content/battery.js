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
    // Initial per-tab, per-origin values
    let batteryState = {
      charging: randomBetween(0, 1, seed) > 0.5,
      level: parseFloat(randomBetween(0.2, 0.9, seed + 1).toFixed(2)), // 2 decimal places
      chargingTime: 0,
      dischargingTime: Infinity
    };

    // Create event target for event handling
    const eventTarget = new EventTarget();
    
    const batteryObject = {
      // Properties
      charging: batteryState.charging,
      level: batteryState.level,
      chargingTime: batteryState.chargingTime,
      dischargingTime: batteryState.dischargingTime,
      
      // Event handlers
      onchargingchange: null,
      onlevelchange: null,
      onchargingtimechange: null,
      ondischargingtimechange: null,
      
      // Event methods
      addEventListener: (type, listener, options) => {
        eventTarget.addEventListener(type, listener, options);
      },
      removeEventListener: (type, listener, options) => {
        eventTarget.removeEventListener(type, listener, options);
      },
      dispatchEvent: (event) => {
        return eventTarget.dispatchEvent(event);
      }
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
        batteryState.chargingTime = Math.floor((1 - batteryState.level) * 3600);
        batteryState.dischargingTime = Infinity;
      } else {
        batteryState.level = Math.max(0.01, batteryState.level - BATTERY_DRAIN_RATE * Math.random());
        batteryState.chargingTime = 0;
        batteryState.dischargingTime = Math.floor(batteryState.level * 3600);
      }
      
      // Format to 2 decimal places and ensure it's a number
      batteryState.level = parseFloat(batteryState.level.toFixed(2));

      // Update object properties
      batteryObject.charging = batteryState.charging;
      batteryObject.level = batteryState.level;
      batteryObject.chargingTime = batteryState.chargingTime;
      batteryObject.dischargingTime = batteryState.dischargingTime;

      // Fire events if changed
      if (batteryState.level !== oldLevel) {
        batteryObject.dispatchEvent(new Event('levelchange'));
        if (batteryObject.onlevelchange) batteryObject.onlevelchange(new Event('levelchange'));
      }
      
      if (batteryState.charging !== oldCharging) {
        batteryObject.dispatchEvent(new Event('chargingchange'));
        if (batteryObject.onchargingchange) batteryObject.onchargingchange(new Event('chargingchange'));
      }
      
      batteryObject.dispatchEvent(new Event('chargingtimechange'));
      batteryObject.dispatchEvent(new Event('dischargingtimechange'));
      
      if (batteryObject.onchargingtimechange) batteryObject.onchargingtimechange(new Event('chargingtimechange'));
      if (batteryObject.ondischargingtimechange) batteryObject.ondischargingtimechange(new Event('dischargingtimechange'));
    }

    setInterval(updateBattery, BATTERY_UPDATE_INTERVAL);

    // Set Symbol.toStringTag for proper object identification
    Object.defineProperty(batteryObject, Symbol.toStringTag, {
      value: 'BatteryManager',
      configurable: true
    });

    return batteryObject;
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

    // Preserve original function toString behavior
    const originalFuncStr = originalGetBattery.toString();
    const originalToString = Function.prototype.toString;
    
    Function.prototype.toString = function() {
      if (this === navigator.getBattery) {
        return originalFuncStr;
      }
      return originalToString.call(this);
    };
  }

  // For direct property access (some browsers)
  if (ENABLE_SPOOF) {
    Object.defineProperty(navigator, 'battery', {
      configurable: true,
      enumerable: true,
      get: () => fakeInstance
    });
  }

})();