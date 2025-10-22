/**
 * Screenshot Capture Service
 * Captures screenshots of the current application view using html2canvas
 */

import html2canvas from 'html2canvas';

export interface CaptureOptions {
  element?: HTMLElement;
  quality?: number;
  width?: number;
  height?: number;
  backgroundColor?: string;
}

class ScreenshotCaptureService {
  private cache: Map<string, string> = new Map();

  /**
   * Capture screenshot of entire page or specific element
   */
  async captureScreen(options: CaptureOptions = {}): Promise<string> {
    const {
      element = document.body,
      quality = 0.95,
      width,
      height,
      backgroundColor = '#ffffff'
    } = options;

    try {
      const canvas = await html2canvas(element, {
        backgroundColor,
        scale: 2, // Higher quality
        logging: false,
        useCORS: true,
        allowTaint: true,
        width,
        height
      });

      // Convert to base64 image
      const dataUrl = canvas.toDataURL('image/png', quality);
      return dataUrl;
    } catch (error) {
      console.error('Screenshot capture failed:', error);
      throw new Error('Failed to capture screenshot');
    }
  }

  /**
   * Capture screenshot and cache it with a key
   */
  async captureAndCache(key: string, options: CaptureOptions = {}): Promise<string> {
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const screenshot = await this.captureScreen(options);
    this.cache.set(key, screenshot);
    return screenshot;
  }

  /**
   * Get cached screenshot
   */
  getCached(key: string): string | undefined {
    return this.cache.get(key);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Capture specific section by ID
   */
  async captureSection(sectionId: string, options: CaptureOptions = {}): Promise<string> {
    const element = document.getElementById(sectionId);
    if (!element) {
      throw new Error(`Element with ID ${sectionId} not found`);
    }

    return this.captureScreen({ ...options, element });
  }

  /**
   * Download screenshot as file
   */
  downloadScreenshot(dataUrl: string, filename: string = 'screenshot.png'): void {
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    link.click();
  }
}

export const screenshotCapture = new ScreenshotCaptureService();