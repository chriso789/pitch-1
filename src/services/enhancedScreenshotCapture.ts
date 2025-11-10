/**
 * Enhanced Screenshot Capture Service
 * Extends base screenshot capture with element highlighting, annotations, and advanced features
 */

import html2canvas from 'html2canvas';
import { screenshotCapture, CaptureOptions } from './screenshotCapture';

export interface Annotation {
  type: 'arrow' | 'text' | 'highlight' | 'blur' | 'circle';
  x: number;
  y: number;
  text?: string;
  color?: string;
  size?: number;
  endX?: number; // For arrows
  endY?: number; // For arrows
}

export interface EnhancedCaptureOptions extends CaptureOptions {
  highlightSelector?: string;
  highlightColor?: string;
  annotations?: Annotation[];
  fullPage?: boolean;
  qualityPreset?: 'low' | 'medium' | 'high' | 'ultra';
  contextPadding?: number;
}

class EnhancedScreenshotCaptureService {
  private temporaryHighlights: HTMLElement[] = [];

  /**
   * Get quality scale based on preset
   */
  private getQualityScale(quality: 'low' | 'medium' | 'high' | 'ultra'): number {
    const scales = {
      low: 1,
      medium: 1.5,
      high: 2,
      ultra: 3
    };
    return scales[quality];
  }

  /**
   * Capture screenshot with element highlighting
   */
  async captureWithHighlight(
    elementSelector: string,
    options: EnhancedCaptureOptions = {}
  ): Promise<string> {
    const element = document.querySelector(elementSelector) as HTMLElement;
    if (!element) {
      throw new Error(`Element ${elementSelector} not found`);
    }

    // Add temporary highlight overlay
    const highlight = this.createHighlightOverlay(element, options.highlightColor);
    this.temporaryHighlights.push(highlight);

    try {
      // Scroll element into view
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await this.wait(300);

      const scale = this.getQualityScale(options.qualityPreset || 'high');
      const screenshot = await screenshotCapture.captureScreen({
        element: options.element || document.body,
        quality: options.qualityPreset === 'ultra' ? 1.0 : 0.95,
        backgroundColor: options.backgroundColor || '#ffffff',
        width: options.width,
        height: options.height
      });

      // Add annotations if provided
      if (options.annotations && options.annotations.length > 0) {
        return await this.addAnnotations(screenshot, options.annotations);
      }

      return screenshot;
    } finally {
      // Clean up highlights
      this.removeTemporaryHighlights();
    }
  }

  /**
   * Create highlight overlay for element
   */
  private createHighlightOverlay(element: HTMLElement, color?: string): HTMLElement {
    const rect = element.getBoundingClientRect();
    const overlay = document.createElement('div');
    
    overlay.style.cssText = `
      position: fixed;
      top: ${rect.top - 4}px;
      left: ${rect.left - 4}px;
      width: ${rect.width + 8}px;
      height: ${rect.height + 8}px;
      border: 3px solid ${color || 'hsl(var(--primary))'};
      border-radius: 6px;
      box-shadow: 0 0 0 3px hsla(var(--primary) / 0.2);
      pointer-events: none;
      z-index: 9998;
    `;
    
    document.body.appendChild(overlay);
    return overlay;
  }

  /**
   * Remove all temporary highlights
   */
  private removeTemporaryHighlights(): void {
    this.temporaryHighlights.forEach(highlight => highlight.remove());
    this.temporaryHighlights = [];
  }

  /**
   * Capture element with surrounding context
   */
  async captureElementWithContext(
    elementSelector: string,
    contextPadding: number = 50
  ): Promise<string> {
    const element = document.querySelector(elementSelector) as HTMLElement;
    if (!element) {
      throw new Error(`Element ${elementSelector} not found`);
    }

    const rect = element.getBoundingClientRect();
    
    // Create temporary container that includes context
    const container = document.createElement('div');
    container.style.cssText = `
      position: fixed;
      top: ${Math.max(0, rect.top - contextPadding)}px;
      left: ${Math.max(0, rect.left - contextPadding)}px;
      width: ${rect.width + contextPadding * 2}px;
      height: ${rect.height + contextPadding * 2}px;
      pointer-events: none;
      z-index: -1;
    `;

    return await screenshotCapture.captureScreen({ element });
  }

  /**
   * Capture sequence of screenshots
   */
  async captureSequence(
    selectors: string[],
    delay: number = 500
  ): Promise<string[]> {
    const screenshots: string[] = [];

    for (const selector of selectors) {
      try {
        const screenshot = await this.captureWithHighlight(selector, { qualityPreset: 'high' });
        screenshots.push(screenshot);
        await this.wait(delay);
      } catch (error) {
        console.warn(`Failed to capture ${selector}:`, error);
      }
    }

    return screenshots;
  }

  /**
   * Capture full page with scrolling and stitching
   */
  async captureFullPage(): Promise<string> {
    const bodyHeight = document.body.scrollHeight;
    const viewportHeight = window.innerHeight;
    const scrollSteps = Math.ceil(bodyHeight / viewportHeight);
    
    const screenshots: string[] = [];
    const originalScrollPos = window.scrollY;

    try {
      for (let i = 0; i < scrollSteps; i++) {
        window.scrollTo(0, i * viewportHeight);
        await this.wait(300); // Wait for scroll

        const screenshot = await screenshotCapture.captureScreen({
          element: document.body,
          quality: 0.9
        });
        screenshots.push(screenshot);
      }

      // Stitch screenshots together (simplified - returns first for now)
      // Full implementation would use canvas stitching
      return screenshots[0];
    } finally {
      // Restore scroll position
      window.scrollTo(0, originalScrollPos);
    }
  }

  /**
   * Add annotations to screenshot
   */
  async addAnnotations(
    screenshotDataUrl: string,
    annotations: Annotation[]
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        // Draw original image
        ctx.drawImage(img, 0, 0);

        // Draw annotations
        annotations.forEach(annotation => {
          this.drawAnnotation(ctx, annotation, img.width, img.height);
        });

        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = screenshotDataUrl;
    });
  }

  /**
   * Draw single annotation on canvas
   */
  private drawAnnotation(
    ctx: CanvasRenderingContext2D,
    annotation: Annotation,
    canvasWidth: number,
    canvasHeight: number
  ): void {
    const x = annotation.x * canvasWidth;
    const y = annotation.y * canvasHeight;
    const color = annotation.color || '#3b82f6';
    const size = annotation.size || 20;

    ctx.save();

    switch (annotation.type) {
      case 'arrow':
        if (annotation.endX !== undefined && annotation.endY !== undefined) {
          this.drawArrow(
            ctx,
            x,
            y,
            annotation.endX * canvasWidth,
            annotation.endY * canvasHeight,
            color
          );
        }
        break;

      case 'text':
        ctx.font = `${size}px sans-serif`;
        ctx.fillStyle = color;
        ctx.fillText(annotation.text || '', x, y);
        break;

      case 'highlight':
        ctx.fillStyle = `${color}40`; // 25% opacity
        ctx.fillRect(x - size / 2, y - size / 2, size * 4, size * 2);
        break;

      case 'circle':
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, 2 * Math.PI);
        ctx.stroke();
        break;

      case 'blur':
        // Simplified blur effect
        ctx.filter = 'blur(10px)';
        ctx.drawImage(
          ctx.canvas,
          x - size,
          y - size,
          size * 2,
          size * 2,
          x - size,
          y - size,
          size * 2,
          size * 2
        );
        ctx.filter = 'none';
        break;
    }

    ctx.restore();
  }

  /**
   * Draw arrow on canvas
   */
  private drawArrow(
    ctx: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    color: string
  ): void {
    const headLength = 15;
    const angle = Math.atan2(toY - fromY, toX - fromX);

    // Draw line
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    // Draw arrowhead
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(
      toX - headLength * Math.cos(angle - Math.PI / 6),
      toY - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      toX - headLength * Math.cos(angle + Math.PI / 6),
      toY - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  }

  /**
   * Capture with automatic element detection and highlighting
   */
  async captureSmartHighlight(
    elementSelector: string,
    options: EnhancedCaptureOptions = {}
  ): Promise<string> {
    return await this.captureWithHighlight(elementSelector, {
      ...options,
      qualityPreset: options.qualityPreset || 'high',
      highlightColor: options.highlightColor || 'hsl(var(--primary))'
    });
  }

  /**
   * Batch capture multiple elements
   */
  async batchCapture(
    selectors: string[],
    options: EnhancedCaptureOptions = {}
  ): Promise<Record<string, string>> {
    const results: Record<string, string> = {};

    for (const selector of selectors) {
      try {
        results[selector] = await this.captureWithHighlight(selector, options);
        await this.wait(300); // Brief delay between captures
      } catch (error) {
        console.warn(`Failed to capture ${selector}:`, error);
      }
    }

    return results;
  }

  /**
   * Wait helper
   */
  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Download screenshot with custom filename
   */
  downloadScreenshot(dataUrl: string, filename: string = 'screenshot.png'): void {
    screenshotCapture.downloadScreenshot(dataUrl, filename);
  }

  /**
   * Clear all cached screenshots
   */
  clearCache(): void {
    screenshotCapture.clearCache();
  }
}

export const enhancedScreenshotCapture = new EnhancedScreenshotCaptureService();
