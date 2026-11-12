const { desktopCapturer, screen } = require('electron');
const logger = require('../core/logger').createServiceLogger('CAPTURE');

class CaptureService {
  constructor() {
    this.isProcessing = false;
  }

  listDisplays() {
    try {
      const displays = screen.getAllDisplays().map(d => ({
        id: d.id,
        bounds: d.bounds,
        size: d.size,
        scaleFactor: d.scaleFactor,
        rotation: d.rotation,
        touchSupport: d.touchSupport || 'unknown'
      }));
      return { success: true, displays };
    } catch (error) {
      logger.error('Failed to list displays', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Capture screenshot and return an image buffer.
   * options: { displayId?: number }; always the full display.
   */
  async captureAndProcess(options = {}) {
    if (this.isProcessing) throw new Error('Capture already in progress');
    this.isProcessing = true;
    const startTime = Date.now();
    try {
      const { image, metadata } = await this.captureScreenshot(options);

      // Always capture the entire display; no crop or adjustable selection frame.
      const finalImage = image;
      const buffer = finalImage.toPNG();
      logger.logPerformance('Screenshot capture', startTime, {
        bytes: buffer.length,
        dimensions: finalImage.getSize()
      });

      return {
        imageBuffer: buffer,
        mimeType: 'image/png',
        metadata: {
          timestamp: new Date().toISOString(),
          source: metadata,
          processingTime: Date.now() - startTime
        }
      };
    } finally {
      this.isProcessing = false;
    }
  }

  async captureScreenshot(options = {}) {
    const targetDisplay = this._getTargetDisplay(options.displayId);
    const size = targetDisplay.size || targetDisplay.bounds;
    const scale = targetDisplay.scaleFactor || 1;
    const width = Math.round(size.width * scale);
    const height = Math.round(size.height * scale);

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height }
    });

    if (sources.length === 0) {
      throw new Error('No screen sources available for capture');
    }

    // Display IDs distinguish monitors with identical resolutions.
    let source = sources.find(s => String(s.display_id) === String(targetDisplay.id));
    if (!source && sources.length === 1 && screen.getAllDisplays().length === 1) source = sources[0];
    if (!source) throw new Error('Could not identify the current monitor. Move the pointer to the screen you want and try again.');

    const image = source.thumbnail;
    if (!image || image.isEmpty?.()) throw new Error('Failed to capture full screen image');

    logger.debug('Screenshot captured successfully', {
      sourceName: source.name,
      imageSize: image.getSize()
    });

    return {
      image,
      metadata: {
        displayId: targetDisplay.id,
        sourceName: source.name,
        dimensions: image.getSize(),
        captureTime: new Date().toISOString()
      }
    };
  }

  _getTargetDisplay(displayId) {
    const all = screen.getAllDisplays();
    if (!all || all.length === 0) return screen.getPrimaryDisplay();
    if (displayId == null) return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const found = all.find(d => d.id === displayId);
    if (!found) throw new Error('The requested monitor is no longer available.');
    return found;
  }

}

module.exports = new CaptureService();
