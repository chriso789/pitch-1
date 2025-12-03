/**
 * Cookie Consent Banner
 * GDPR/CCPA compliant consent management
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { X, Cookie, Shield, ChevronDown, ChevronUp } from 'lucide-react';
import { trackingService } from '@/lib/analytics/trackingService';
import { cn } from '@/lib/utils';

export function ConsentBanner() {
  const [isVisible, setIsVisible] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [analyticsConsent, setAnalyticsConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);

  useEffect(() => {
    // Only show on marketing site pages (not in the app)
    const isMarketingPage = window.location.pathname === '/' || 
      window.location.pathname.startsWith('/features') ||
      window.location.pathname.startsWith('/pricing') ||
      window.location.pathname.startsWith('/about');

    if (!isMarketingPage) return;

    // Check if consent already given
    const existingConsent = trackingService.loadConsent();
    if (!existingConsent) {
      // Show banner after a short delay
      const timer = setTimeout(() => setIsVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAcceptAll = () => {
    trackingService.setConsent({
      analytics: true,
      marketing: true
    });
    setIsVisible(false);
  };

  const handleAcceptEssential = () => {
    trackingService.setConsent({
      analytics: false,
      marketing: false
    });
    setIsVisible(false);
  };

  const handleSavePreferences = () => {
    trackingService.setConsent({
      analytics: analyticsConsent,
      marketing: marketingConsent
    });
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 animate-in slide-in-from-bottom duration-300">
      <Card className="max-w-2xl mx-auto p-4 shadow-lg border-border/50 bg-card/95 backdrop-blur-sm">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-primary/10">
            <Cookie className="h-5 w-5 text-primary" />
          </div>
          
          <div className="flex-1 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-foreground">Cookie Preferences</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  We use cookies to enhance your experience and analyze site traffic.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 -mt-1 -mr-1"
                onClick={handleAcceptEssential}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Expandable Details */}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {showDetails ? 'Hide details' : 'Customize preferences'}
            </button>

            {showDetails && (
              <div className="space-y-3 pt-2 border-t border-border/50">
                {/* Essential - Always On */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-green-500" />
                    <div>
                      <Label className="text-sm font-medium">Essential</Label>
                      <p className="text-xs text-muted-foreground">Required for site functionality</p>
                    </div>
                  </div>
                  <Switch checked={true} disabled className="data-[state=checked]:bg-green-500" />
                </div>

                {/* Analytics */}
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">Analytics</Label>
                    <p className="text-xs text-muted-foreground">Help us improve the site</p>
                  </div>
                  <Switch 
                    checked={analyticsConsent} 
                    onCheckedChange={setAnalyticsConsent}
                  />
                </div>

                {/* Marketing */}
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">Marketing</Label>
                    <p className="text-xs text-muted-foreground">Personalized content & offers</p>
                  </div>
                  <Switch 
                    checked={marketingConsent} 
                    onCheckedChange={setMarketingConsent}
                  />
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2 pt-1">
              {showDetails ? (
                <Button onClick={handleSavePreferences} size="sm">
                  Save Preferences
                </Button>
              ) : (
                <>
                  <Button onClick={handleAcceptAll} size="sm">
                    Accept All
                  </Button>
                  <Button onClick={handleAcceptEssential} variant="outline" size="sm">
                    Essential Only
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
