import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  Phone, 
  Mail, 
  MessageSquare, 
  Calendar, 
  FileText, 
  BarChart3,
  CheckCircle2,
  ArrowRight,
  Star,
  Zap,
  Shield,
  TrendingUp,
  Loader2
} from 'lucide-react';
import { useMarketingTracking } from '@/lib/analytics/usePageTracking';
import { ConsentBanner } from '@/components/ConsentBanner';
import DashboardMockup from '@/components/landing/DashboardMockup';
import { PowerDialerMockup, EstimateMockup, PipelineMockup, AnalyticsMockup } from '@/components/landing/FeatureMockups';
import { supabase } from '@/integrations/supabase/client';
import { DemoVideoModal } from '@/components/landing/DemoVideoModal';

const LandingPage = () => {
  const navigate = useNavigate();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [showDemo, setShowDemo] = useState(false);
  const { 
    trackNavLogin, 
    trackNavSignup, 
    trackHeroStartTrial, 
    trackHeroBookDemo,
    trackCTAClick 
  } = useMarketingTracking();

  // Auto-redirect authenticated users to dashboard
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          console.log('[LandingPage] User authenticated, redirecting to dashboard');
          navigate('/dashboard', { replace: true });
          return;
        }
      } catch (error) {
        console.error('[LandingPage] Auth check error:', error);
      }
      setCheckingAuth(false);
    };
    
    checkAuth();
  }, [navigate]);

  // Show loading while checking auth
  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 to-white">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  const features = [
    {
      icon: Phone,
      title: 'Power Dialer',
      description: 'AI-powered calling system that automates outreach and tracks every interaction in real-time.',
      color: 'text-blue-500'
    },
    {
      icon: Mail,
      title: 'Email Sequences',
      description: 'Automated email campaigns that nurture leads and close deals while you focus on building.',
      color: 'text-green-500'
    },
    {
      icon: MessageSquare,
      title: 'SMS Automation',
      description: 'Instant SMS responses and follow-ups that keep your pipeline warm 24/7.',
      color: 'text-purple-500'
    },
    {
      icon: Calendar,
      title: 'Smart Scheduling',
      description: 'AI meeting scheduler that eliminates back-and-forth and books appointments automatically.',
      color: 'text-orange-500'
    },
    {
      icon: FileText,
      title: 'Professional Estimates',
      description: 'Generate stunning, industry-standard estimates and proposals in minutes, not hours.',
      color: 'text-pink-500'
    },
    {
      icon: BarChart3,
      title: 'Pipeline Analytics',
      description: 'Real-time insights and reporting that show exactly where your deals stand.',
      color: 'text-cyan-500'
    }
  ];

  const benefits = [
    {
      stat: '$46K+',
      label: 'Average Annual Savings',
      description: 'Replace expensive tools with one AI-powered platform'
    },
    {
      stat: '10x',
      label: 'Faster Workflows',
      description: 'Automate repetitive tasks and focus on closing deals'
    },
    {
      stat: '99.9%',
      label: 'Uptime Guarantee',
      description: 'Enterprise-grade reliability you can count on'
    }
  ];

  const testimonials = [
    {
      name: 'Mike Rodriguez',
      role: 'Owner, Rodriguez Roofing',
      content: 'PITCH CRM replaced 5 different tools for us. We\'re saving over $40,000 a year and our team is more productive than ever. The estimate builder alone is worth the investment.',
      rating: 5,
      avatar: 'MR'
    },
    {
      name: 'Sarah Chen',
      role: 'Sales Director, Summit Construction',
      content: 'The Power Dialer has transformed our outbound sales. We\'re connecting with 3x more prospects and the AI handles all the follow-ups. It\'s like having a full sales team working 24/7.',
      rating: 5,
      avatar: 'SC'
    },
    {
      name: 'James Taylor',
      role: 'CEO, Taylor Home Improvements',
      content: 'Finally, a CRM built specifically for construction businesses. The professional estimates impress our clients and the automation saves us hours every single day.',
      rating: 5,
      avatar: 'JT'
    }
  ];

  const replaces = [
    'Your Dialer Software',
    'Your CRM System',
    'Your Contact Database',
    'Your Lead Intelligence',
    'Your Estimate Software',
    'Your Project Management',
    'Your Field Service App'
  ];

  return (
    <div className="min-h-screen min-h-[100dvh] bg-gradient-to-b from-slate-50 to-white">
      {/* Navigation - Mobile Safe Area */}
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-md border-b border-slate-200 z-50 pt-[env(safe-area-inset-top)]">
        <div className="container mx-auto px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-7 h-7 sm:w-8 sm:h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              </div>
              <span className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                PITCH CRM™
              </span>
            </div>
            <div className="flex items-center space-x-2 sm:space-x-4">
              <Button variant="ghost" className="hidden md:inline-flex" onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}>
                Features
              </Button>
              <Button variant="ghost" className="hidden md:inline-flex" onClick={() => navigate('/pricing')}>
                Pricing
              </Button>
              <Button variant="outline" size="sm" className="text-xs sm:text-sm" onClick={() => { trackNavLogin(); navigate('/login'); }}>
                Log In
              </Button>
              <Button 
                size="sm"
                onClick={() => { trackNavSignup(); navigate('/signup'); }}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-xs sm:text-sm hidden sm:inline-flex"
              >
                Start Free Trial
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section - Account for nav height + safe area */}
      <section className="pt-24 sm:pt-32 pb-12 sm:pb-20 px-4 mt-[env(safe-area-inset-top)]">
        <div className="container mx-auto max-w-6xl text-center">
          <div className="inline-flex items-center space-x-2 bg-blue-50 text-blue-700 px-4 py-2 rounded-full mb-6">
            <Shield className="w-4 h-4" />
            <span className="text-sm font-medium">Trusted by 500+ Construction Companies</span>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold text-slate-900 mb-6 leading-tight">
            Track Projects from
            <br />
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Start to Finish
            </span>
          </h1>
          
          <p className="text-xl text-slate-600 mb-8 max-w-3xl mx-auto leading-relaxed">
            The AI-powered CRM built specifically for construction and roofing businesses. 
            Replace expensive tools, automate your sales pipeline, and close more deals.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <Button 
              size="lg" 
              onClick={() => { trackHeroStartTrial(); navigate('/signup'); }}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-lg px-8 py-6"
            >
              Start Free Trial <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
            <Button 
              size="lg" 
              variant="outline" 
              className="text-lg px-8 py-6"
              onClick={() => { 
                trackHeroBookDemo(); 
                setShowDemo(true); 
              }}
            >
              Watch Demo
            </Button>
          </div>

          {/* Demo Video Modal */}
          <DemoVideoModal 
            isOpen={showDemo} 
            onClose={() => setShowDemo(false)} 
          />

          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-slate-500">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span>No credit card required</span>
            </div>
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span>14-day free trial</span>
            </div>
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span>Cancel anytime</span>
            </div>
          </div>
        </div>
      </section>

      {/* Screenshot Hero */}
      <section className="pb-20 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl blur-3xl opacity-20"></div>
            <Card className="relative border-2 border-slate-200 shadow-2xl overflow-hidden">
              <div className="bg-slate-100 px-4 py-3 flex items-center space-x-2 border-b border-slate-200">
                <div className="flex space-x-2">
                  <div className="w-3 h-3 rounded-full bg-red-400"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                  <div className="w-3 h-3 rounded-full bg-green-400"></div>
                </div>
                <div className="text-sm text-slate-600 ml-4">pitch-crm.ai/dashboard</div>
              </div>
              <DashboardMockup />
            </Card>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-20 px-4 bg-slate-900 text-white">
        <div className="container mx-auto max-w-6xl">
          <div className="grid md:grid-cols-3 gap-8">
            {benefits.map((benefit, index) => (
              <div key={index} className="text-center">
                <div className="text-5xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent mb-2">
                  {benefit.stat}
                </div>
                <div className="text-xl font-semibold mb-2">{benefit.label}</div>
                <div className="text-slate-400">{benefit.description}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Replace Expensive Tools */}
      <section className="py-20 px-4 bg-blue-50">
        <div className="container mx-auto max-w-6xl text-center">
          <h2 className="text-4xl font-bold text-slate-900 mb-4">
            Replace 7+ Expensive Tools
          </h2>
          <p className="text-xl text-slate-600 mb-12">
            Stop paying for multiple subscriptions. Get everything in one platform.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            {replaces.map((tool, index) => (
              <div key={index} className="bg-white px-6 py-3 rounded-full shadow-sm border border-slate-200 text-slate-700 font-medium">
                {tool}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4">
              Everything You Need to Win
            </h2>
            <p className="text-xl text-slate-600">
              Powerful features designed specifically for construction businesses
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <Card key={index} className="border-2 border-slate-100 hover:border-blue-200 hover:shadow-lg transition-all duration-300">
                <CardContent className="p-6">
                  <feature.icon className={`w-12 h-12 ${feature.color} mb-4`} />
                  <h3 className="text-xl font-bold text-slate-900 mb-3">
                    {feature.title}
                  </h3>
                  <p className="text-slate-600 leading-relaxed">
                    {feature.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Screenshots Section */}
      <section className="py-20 px-4 bg-slate-50">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4">
              See PITCH CRM™ in Action
            </h2>
            <p className="text-xl text-slate-600">
              Professional tools that match the quality of enterprise software
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Power Dialer Screenshot */}
            <Card className="overflow-hidden border-2 border-slate-200">
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 p-6 text-white">
                <Phone className="w-8 h-8 mb-2" />
                <h3 className="text-xl font-bold">Power Dialer</h3>
              </div>
              <PowerDialerMockup />
            </Card>

            {/* Estimates Screenshot */}
            <Card className="overflow-hidden border-2 border-slate-200">
              <div className="bg-gradient-to-br from-purple-500 to-purple-600 p-6 text-white">
                <FileText className="w-8 h-8 mb-2" />
                <h3 className="text-xl font-bold">Professional Estimates</h3>
              </div>
              <EstimateMockup />
            </Card>

            {/* Pipeline Screenshot */}
            <Card className="overflow-hidden border-2 border-slate-200">
              <div className="bg-gradient-to-br from-green-500 to-green-600 p-6 text-white">
                <TrendingUp className="w-8 h-8 mb-2" />
                <h3 className="text-xl font-bold">Pipeline Management</h3>
              </div>
              <PipelineMockup />
            </Card>

            {/* Analytics Screenshot */}
            <Card className="overflow-hidden border-2 border-slate-200">
              <div className="bg-gradient-to-br from-orange-500 to-orange-600 p-6 text-white">
                <BarChart3 className="w-8 h-8 mb-2" />
                <h3 className="text-xl font-bold">Real-Time Analytics</h3>
              </div>
              <AnalyticsMockup />
            </Card>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4">
              Loved by Construction Pros
            </h2>
            <p className="text-xl text-slate-600">
              See what our customers have to say about PITCH CRM™
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {testimonials.map((testimonial, index) => (
              <Card key={index} className="border-2 border-slate-100">
                <CardContent className="p-6">
                  <div className="flex space-x-1 mb-4">
                    {[...Array(testimonial.rating)].map((_, i) => (
                      <Star key={i} className="w-5 h-5 fill-yellow-400 text-yellow-400" />
                    ))}
                  </div>
                  <p className="text-slate-700 mb-6 leading-relaxed">
                    "{testimonial.content}"
                  </p>
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full flex items-center justify-center text-white font-bold">
                      {testimonial.avatar}
                    </div>
                    <div>
                      <div className="font-bold text-slate-900">{testimonial.name}</div>
                      <div className="text-sm text-slate-600">{testimonial.role}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white">
        <div className="container mx-auto max-w-4xl text-center">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            Ready to Transform Your Sales Process?
          </h2>
          <p className="text-xl mb-8 opacity-90">
            Join hundreds of construction companies already using PITCH CRM™ to close more deals and save thousands.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button 
              size="lg" 
              onClick={() => { trackCTAClick('cta_start_trial', 'Start Free Trial'); navigate('/signup'); }}
              className="bg-white text-blue-600 hover:bg-slate-100 text-lg px-8 py-6"
            >
              Start Free Trial <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
            <Button 
              size="lg" 
              variant="outline" 
              className="border-2 border-white text-white hover:bg-white/10 text-lg px-8 py-6"
              onClick={() => trackCTAClick('cta_schedule_demo', 'Schedule Demo')}
            >
              Schedule Demo
            </Button>
          </div>
          <p className="text-sm mt-6 opacity-75">
            14-day free trial • No credit card required • Cancel anytime
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-white py-12 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                  <Zap className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold">PITCH CRM™</span>
              </div>
              <p className="text-slate-400 text-sm">
                The AI-powered CRM for construction businesses.
              </p>
            </div>
            <div>
              <h4 className="font-bold mb-4">Product</h4>
              <ul className="space-y-2 text-slate-400 text-sm">
                <li><a href="/features" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="/pricing" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="/integration" className="hover:text-white transition-colors">Integration</a></li>
                <li><a href="/demo-request" className="hover:text-white transition-colors">Request Demo</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Company</h4>
              <ul className="space-y-2 text-slate-400 text-sm">
                <li><a href="/demo-request" className="hover:text-white transition-colors">Contact</a></li>
                <li><a href="/help" className="hover:text-white transition-colors">Support</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Legal</h4>
              <ul className="space-y-2 text-slate-400 text-sm">
                <li><a href="/legal/privacy" className="hover:text-white transition-colors">Privacy Policy</a></li>
                <li><a href="/legal/terms" className="hover:text-white transition-colors">Terms of Service</a></li>
                <li><a href="/legal/security" className="hover:text-white transition-colors">Security</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-800 pt-8 text-center text-slate-400 text-sm space-y-3">
            <p>&copy; {new Date().getFullYear()} PITCH CRM™. All rights reserved.</p>
            <p className="text-xs text-slate-500 max-w-2xl mx-auto">
              PITCH™ and PITCH CRM™ are trademarks of PITCH CRM, Inc. This software is not affiliated with, endorsed by, or connected to any other product or service with a similar name.
            </p>
          </div>
        </div>
      </footer>

      {/* Consent Banner */}
      <ConsentBanner />
    </div>
  );
};

export default LandingPage;
