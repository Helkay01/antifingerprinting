if (window.nativeBackups.permissionsQuery) {
  navigator.permissions.query = makeNativeFunction(function(params) {
    return Promise.resolve({
      state: "prompt",
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    });
  }, "query");
}
