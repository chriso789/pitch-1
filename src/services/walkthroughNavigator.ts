/**
 * Walkthrough Navigator Service
 * Automates navigation through app walkthrough steps with element highlighting and scrolling
 */

export interface NavigationAction {
  type: 'navigate' | 'highlight' | 'scroll' | 'wait' | 'click';
  target: string;
  duration?: number;
}

export interface NavigationStep {
  id: string;
  action: string;
  description: string;
  waitForSelector?: string;
  highlightSelector?: string;
}

class WalkthroughNavigatorService {
  private navigate: ((path: string) => void) | null = null;
  private highlightOverlay: HTMLElement | null = null;

  /**
   * Initialize navigator with React Router navigate function
   */
  initialize(navigateFn: (path: string) => void): void {
    this.navigate = navigateFn;
  }

  /**
   * Parse action string into structured action
   */
  parseAction(actionString: string): NavigationAction {
    const [type, target] = actionString.split(':');
    return {
      type: type as NavigationAction['type'],
      target: target || '',
    };
  }

  /**
   * Execute navigation action
   */
  async executeAction(action: string): Promise<void> {
    const parsedAction = this.parseAction(action);

    switch (parsedAction.type) {
      case 'navigate':
        await this.navigateToRoute(parsedAction.target);
        break;
      case 'highlight':
        await this.highlightElement(parsedAction.target);
        break;
      case 'scroll':
        await this.scrollToElement(parsedAction.target);
        break;
      case 'wait':
        await this.wait(parseInt(parsedAction.target) || 1000);
        break;
      case 'click':
        await this.clickElement(parsedAction.target);
        break;
      default:
        console.warn(`Unknown action type: ${parsedAction.type}`);
    }
  }

  /**
   * Navigate to a specific route
   */
  async navigateToRoute(route: string): Promise<void> {
    if (!this.navigate) {
      throw new Error('Navigator not initialized. Call initialize() first.');
    }

    const routeMap: Record<string, string> = {
      dashboard: '/dashboard',
      pipeline: '/pipeline',
      'storm-canvass': '/storm-canvass/map',
      'storm-canvass-live': '/storm-canvass/live',
      'storm-canvass-leaderboard': '/storm-canvass/leaderboard',
      dialer: '/dialer',
      estimates: '/estimates',
      production: '/production',
      calendar: '/calendar',
      settings: '/settings',
      'price-management': '/price-management',
      approvals: '/approvals',
      'client-list': '/client-list',
      jobs: '/jobs',
      reviews: '/reviews',
      'lead-scoring': '/lead-scoring',
      automation: '/automation',
      'contract-reports': '/contract-reports',
    };

    const path = routeMap[route] || route;
    console.log(`🧭 Navigating to: ${path}`);
    this.navigate(path);
    await this.waitForPageLoad();
  }

  /**
   * Wait for page to fully load
   */
  async waitForPageLoad(timeout: number = 3000): Promise<void> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      const checkLoad = () => {
        if (document.readyState === 'complete' || Date.now() - startTime > timeout) {
          resolve();
        } else {
          setTimeout(checkLoad, 100);
        }
      };
      
      checkLoad();
    });
  }

  /**
   * Wait for specific element to appear
   */
  async waitForElement(selector: string, timeout: number = 5000): Promise<HTMLElement> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const checkElement = () => {
        const element = document.querySelector(selector) as HTMLElement;
        
        if (element) {
          resolve(element);
        } else if (Date.now() - startTime > timeout) {
          reject(new Error(`Element ${selector} not found within ${timeout}ms`));
        } else {
          setTimeout(checkElement, 100);
        }
      };
      
      checkElement();
    });
  }

  /**
   * Scroll element into view
   */
  async scrollToElement(selector: string, smooth: boolean = true): Promise<void> {
    try {
      const element = await this.waitForElement(selector);
      element.scrollIntoView({ 
        behavior: smooth ? 'smooth' : 'auto', 
        block: 'center',
        inline: 'center'
      });
      await this.wait(500); // Wait for scroll animation
      console.log(`📜 Scrolled to: ${selector}`);
    } catch (error) {
      console.warn(`Could not scroll to ${selector}:`, error);
    }
  }

  /**
   * Highlight specific element with overlay
   */
  async highlightElement(selector: string, duration: number = 2000): Promise<void> {
    try {
      // Remove existing highlight
      this.removeHighlight();

      const element = await this.waitForElement(selector);
      const rect = element.getBoundingClientRect();

      // Create highlight overlay
      this.highlightOverlay = document.createElement('div');
      this.highlightOverlay.style.cssText = `
        position: fixed;
        top: ${rect.top - 8}px;
        left: ${rect.left - 8}px;
        width: ${rect.width + 16}px;
        height: ${rect.height + 16}px;
        border: 3px solid hsl(var(--primary));
        border-radius: 8px;
        box-shadow: 0 0 0 4px hsla(var(--primary) / 0.2),
                    0 0 20px 4px hsla(var(--primary) / 0.4);
        pointer-events: none;
        z-index: 9999;
        animation: pulse 1s ease-in-out infinite;
      `;

      // Add pulse animation
      const style = document.createElement('style');
      style.textContent = `
        @keyframes pulse {
          0%, 100% { 
            transform: scale(1); 
            opacity: 1; 
          }
          50% { 
            transform: scale(1.02); 
            opacity: 0.8; 
          }
        }
      `;
      document.head.appendChild(style);

      document.body.appendChild(this.highlightOverlay);
      console.log(`✨ Highlighted: ${selector}`);

      // Auto-remove after duration
      if (duration > 0) {
        setTimeout(() => this.removeHighlight(), duration);
      }
    } catch (error) {
      console.warn(`Could not highlight ${selector}:`, error);
    }
  }

  /**
   * Remove highlight overlay
   */
  removeHighlight(): void {
    if (this.highlightOverlay) {
      this.highlightOverlay.remove();
      this.highlightOverlay = null;
    }
  }

  /**
   * Click on element
   */
  async clickElement(selector: string): Promise<void> {
    try {
      const element = await this.waitForElement(selector);
      element.click();
      console.log(`🖱️ Clicked: ${selector}`);
      await this.wait(300); // Wait for click response
    } catch (error) {
      console.warn(`Could not click ${selector}:`, error);
    }
  }

  /**
   * Get current route
   */
  getCurrentRoute(): string {
    return window.location.pathname;
  }

  /**
   * Wait for specified duration
   */
  async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute navigation step
   */
  async executeStep(step: NavigationStep): Promise<void> {
    console.log(`🎯 Executing step: ${step.id}`);
    
    await this.executeAction(step.action);
    
    if (step.waitForSelector) {
      await this.waitForElement(step.waitForSelector);
    }
    
    if (step.highlightSelector) {
      await this.highlightElement(step.highlightSelector, 2000);
    }
  }

  /**
   * Get element bounds for screenshot capture
   */
  getElementBounds(selector: string): DOMRect | null {
    const element = document.querySelector(selector);
    return element ? element.getBoundingClientRect() : null;
  }
}

export const walkthroughNavigator = new WalkthroughNavigatorService();
