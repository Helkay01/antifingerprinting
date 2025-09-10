(function patchPropertyHooks() {
  const originalDefineProperty = window.nativeBackups.defineProperty;
  Object.defineProperty = makeNativeFunction(function(obj, prop, descriptor) {
    const copy = { ...descriptor };

    if (typeof copy.get === "function") {
      copy.get = makeNativeFunction(copy.get, `get ${prop}`);
    }
    if (typeof copy.set === "function") {
      copy.set = makeNativeFunction(copy.set, `set ${prop}`);
    }

    return originalDefineProperty(obj, prop, copy);
  }, "defineProperty");

  const originalGetOwnPropertyDescriptor = window.nativeBackups.getOwnPropertyDescriptor;
  Object.getOwnPropertyDescriptor = makeNativeFunction(function(obj, prop) {
    const desc = originalGetOwnPropertyDescriptor(obj, prop);
    if (!desc) return desc;

    if (typeof desc.get === "function") {
      desc.get = makeNativeFunction(desc.get, `get ${prop}`);
    }
    if (typeof desc.set === "function") {
      desc.set = makeNativeFunction(desc.set, `set ${prop}`);
    }

    return desc;
  }, "getOwnPropertyDescriptor");
})();
