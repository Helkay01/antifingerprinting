const sscript = document.createElement('script');
sscript.textContent = `

HTMLCanvasElement.prototype.toDataURL = function(type, ...args) {
  const ctx = this.getContext('2d');
  if (ctx && this.width && this.height) {
    try {
      const imageData = ctx.getImageData(0, 0, this.width, this.height);
      for (let i = 0; i < imageData.data.length; i += 4 * 50) {
        imageData.data[i] = (imageData.data[i] + 1) % 256;
        imageData.data[i + 1] = (imageData.data[i + 1] + 1) % 256;
        imageData.data[i + 2] = (imageData.data[i + 2] + 1) % 256;
      }
      ctx.putImageData(imageData, 0, 0);
    } catch (e) {}
  }
  return window.nativeBackups.toDataURL.apply(this, [type, ...args]);
};


`;

document.documentElement.appendChild(script);
sscript.remove();