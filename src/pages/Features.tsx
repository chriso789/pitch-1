import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Phone, 
  FileText, 
  TrendingUp, 
  BarChart3,
  MapPin,
  Mail,
  Calendar,
  Ruler,
  CheckCircle2,
  ArrowRight,
  Zap,
  Shield,
  Clock,
  Users,
  Camera,
  Briefcase,
  DollarSign,
  Settings,
  Smartphone,
  Lock,
  Globe,
  Layers,
  Target,
  Star
} from 'lucide-react';
import { 
  PowerDialerMockup, 
  EstimateMockup, 
  PipelineMockup, 
  AnalyticsMockup,
  MeasurementMockup,
  TerritoryMockup,
  AutomationMockup,
  CalendarMockup
} from '@/components/landing/FeatureMockups';

const Features = () => {
  const navigate = useNavigate();

  const coreFeatures = [
    {
      id: 'power-dialer',
      icon: Phone,
      title: 'Power Dialer & Call Management',
      subtitle: 'Connect with 3x more prospects every day',
      description: 'AI-powered outbound calling system with triple-line dialing, automatic voicemail detection, and real-time call analytics. Never miss a follow-up again.',
      color: 'from-blue-500 to-blue-600',
      features: [
        'Triple-line dialing for maximum efficiency',
        'Automatic voicemail detection & pre-recorded drops',
        'Real-time call recording & transcription',
        'AI-powered call summaries and sentiment analysis',
        'One-click appointment scheduling from calls',
        'Lead disposition tracking with custom outcomes',
        'Call queue management with priority sorting',
        'Performance analytics and conversion tracking'
      ],
      mockup: PowerDialerMockup
    },
    {
      id: 'estimates',
      icon: FileText,
      title: 'Professional Estimates & Proposals',
      subtitle: 'Create stunning proposals in minutes',
      description: 'Generate industry-standard estimates with automatic material calculations, Good/Better/Best pricing tiers, and built-in e-signature capture.',
      color: 'from-purple-500 to-purple-600',
      features: [
        'Instant estimate generation from measurements',
        'Good/Better/Best pricing tier options',
        'Automatic material calculations with waste factors',
        'Professional PDF export with your branding',
        'Built-in e-signature capture',
        'Template library with full customization',
        'Version history and change tracking',
        'Financing options and payment terms'
      ],
      mockup: EstimateMockup
    },
    {
      id: 'pipeline',
      icon: TrendingUp,
      title: 'Sales Pipeline Management',
      subtitle: 'Visualize and control your entire sales process',
      description: 'Drag-and-drop Kanban boards, customizable pipeline stages, and automated deal tracking that keeps your team aligned and accountable.',
      color: 'from-green-500 to-green-600',
      features: [
        'Drag-and-drop Kanban boards',
        'Customizable pipeline stages per project type',
        'Deal value tracking and forecasting',
        'Probability-weighted pipeline reporting',
        'Activity timeline for every lead',
        'Multi-touch attribution tracking',
        'Automated stage movement rules',
        'Team performance leaderboards'
      ],
      mockup: PipelineMockup
    },
    {
      id: 'analytics',
      icon: BarChart3,
      title: 'Real-Time Analytics & Reporting',
      subtitle: 'Data-driven decisions at your fingertips',
      description: 'Comprehensive dashboards showing revenue, conversion rates, rep performance, and pipeline health with drill-down capabilities.',
      color: 'from-orange-500 to-orange-600',
      features: [
        'Revenue tracking dashboards',
        'Conversion funnel visualization',
        'Rep performance scorecards',
        'Custom report builder',
        'Automated weekly summary reports',
        'ROI tracking by lead source',
        'Goal setting and progress tracking',
        'Export to Excel, PDF, and CSV'
      ],
      mockup: AnalyticsMockup
    },
    {
      id: 'measurement',
      icon: Ruler,
      title: 'AI Roof Measurement System',
      subtitle: 'Satellite-powered measurements in seconds',
      description: 'Pull accurate roof measurements from satellite imagery with AI-powered facet detection, pitch calculations, and instant material takeoffs.',
      color: 'from-cyan-500 to-cyan-600',
      features: [
        'Satellite imagery integration',
        'AI-powered roof facet detection',
        'Automatic pitch and waste calculations',
        'Professional measurement reports',
        'One-click estimate auto-population',
        'Interactive verification and adjustment tools',
        'Linear feature extraction (ridges, hips, valleys)',
        'Historical measurement comparison'
      ],
      mockup: MeasurementMockup
    },
    {
      id: 'territory',
      icon: MapPin,
      title: 'Territory Mapping & Canvassing',
      subtitle: 'Dominate your market with visual intelligence',
      description: 'Interactive territory maps with GPS tracking, door-by-door canvassing, heat maps, and gamified leaderboards to motivate your team.',
      color: 'from-emerald-500 to-emerald-600',
      features: [
        'Interactive territory maps',
        'GPS-tracked door knocking',
        'Real-time rep location tracking',
        'Heat maps and coverage visualization',
        'Route optimization for efficiency',
        'Gamified leaderboards and competitions',
        'Property status color coding',
        'Offline mode for field work'
      ],
      mockup: TerritoryMockup
    },
    {
      id: 'automation',
      icon: Mail,
      title: 'Email & SMS Automation',
      subtitle: 'Nurture leads on autopilot',
      description: 'Automated multi-touch campaigns that keep your pipeline warm with personalized emails, SMS reminders, and intelligent follow-up sequences.',
      color: 'from-pink-500 to-pink-600',
      features: [
        'Automated email sequence campaigns',
        'Personalized follow-ups at scale',
        'SMS appointment reminders',
        'Drip campaigns for lead nurturing',
        'Template library with merge fields',
        'Engagement analytics and tracking',
        'A/B testing for optimization',
        'Trigger-based automation rules'
      ],
      mockup: AutomationMockup
    },
    {
      id: 'scheduling',
      icon: Calendar,
      title: 'Smart Scheduling & Calendar',
      subtitle: 'Eliminate scheduling friction',
      description: 'AI-powered meeting scheduler that syncs with your calendar, sends automated reminders, and optimizes routes for field appointments.',
      color: 'from-indigo-500 to-indigo-600',
      features: [
        'AI meeting scheduler',
        'Calendar integrations (Google, Outlook)',
        'Automated appointment reminders',
        'Availability detection',
        'Group scheduling capabilities',
        'Route-optimized appointment booking',
        'Rescheduling and cancellation handling',
        'Time zone support'
      ],
      mockup: CalendarMockup
    }
  ];

  const additionalFeatures = [
    { icon: Camera, title: 'Photo Management', description: 'GPS-stamped photos organized by job' },
    { icon: Briefcase, title: 'Material Ordering', description: 'Direct supplier integration' },
    { icon: Lock, title: 'Digital Signatures', description: 'Legally binding e-signatures' },
    { icon: Users, title: 'Customer Portal', description: 'Self-service for clients' },
    { icon: DollarSign, title: 'Commission Tracking', description: 'Automated rep payouts' },
    { icon: Layers, title: 'Multi-Company', description: 'Manage multiple businesses' },
    { icon: Smartphone, title: 'Mobile App', description: 'Full access on any device' },
    { icon: Globe, title: 'API Integrations', description: 'Connect your favorite tools' },
    { icon: Settings, title: 'Purchase Orders', description: 'Streamlined PO workflow' },
    { icon: Target, title: 'Lead Scoring', description: 'AI-powered prioritization' },
    { icon: Shield, title: 'Role-Based Access', description: 'Secure team permissions' },
    { icon: Clock, title: 'Activity Tracking', description: 'Complete audit trails' }
  ];

  const toolCategories = [
    'Your Dialer Software',
    'Your CRM System',
    'Your Contact Database',
    'Your Lead Intelligence',
    'Your Estimate Software',
    'Your Project Management',
    'Your Field Service App'
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Navigation */}
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-md border-b border-slate-200 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 cursor-pointer" onClick={() => navigate('/')}>
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                PITCH CRM
              </span>
            </div>
            <div className="flex items-center space-x-4">
              <Button variant="ghost" className="hidden md:inline-flex" onClick={() => navigate('/pricing')}>
                Pricing
              </Button>
              <Button variant="outline" onClick={() => navigate('/login')}>
                Log In
              </Button>
              <Button 
                onClick={() => navigate('/signup')}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              >
                Start Free Trial
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-16 px-4">
        <div className="container mx-auto max-w-6xl text-center">
          <Badge className="mb-6 bg-blue-50 text-blue-700 hover:bg-blue-50">
            One Platform, Infinite Possibilities
          </Badge>
          
          <h1 className="text-5xl md:text-6xl font-bold text-slate-900 mb-6 leading-tight">
            Powerful Features Built for
            <br />
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Construction Professionals
            </span>
          </h1>
          
          <p className="text-xl text-slate-600 mb-8 max-w-3xl mx-auto leading-relaxed">
            Everything you need to manage leads, create estimates, track projects, and close more deals — 
            all in one AI-powered platform designed specifically for roofing and construction businesses.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 mb-12">
            <div className="flex items-center space-x-2 text-slate-600">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <span>Replace 7+ expensive tools</span>
            </div>
            <div className="flex items-center space-x-2 text-slate-600">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <span>Save $46K+/year</span>
            </div>
            <div className="flex items-center space-x-2 text-slate-600">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <span>AI-powered automation</span>
            </div>
          </div>
        </div>
      </section>

      {/* Core Features - Alternating Layout */}
      {coreFeatures.map((feature, index) => (
        <section 
          key={feature.id} 
          id={feature.id}
          className={`py-20 px-4 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}
        >
          <div className="container mx-auto max-w-6xl">
            <div className={`grid lg:grid-cols-2 gap-12 items-center ${index % 2 === 1 ? 'lg:flex-row-reverse' : ''}`}>
              {/* Content */}
              <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
                <div className={`inline-flex items-center space-x-2 px-4 py-2 rounded-full bg-gradient-to-r ${feature.color} text-white mb-4`}>
                  <feature.icon className="w-4 h-4" />
                  <span className="text-sm font-medium">{feature.title}</span>
                </div>
                
                <h2 className="text-4xl font-bold text-slate-900 mb-4">
                  {feature.subtitle}
                </h2>
                
                <p className="text-lg text-slate-600 mb-8 leading-relaxed">
                  {feature.description}
                </p>

                <div className="grid sm:grid-cols-2 gap-3">
                  {feature.features.map((item, i) => (
                    <div key={i} className="flex items-start space-x-2">
                      <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
                      <span className="text-slate-700 text-sm">{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Mockup */}
              <div className={index % 2 === 1 ? 'lg:order-1' : ''}>
                <Card className="border-2 border-slate-200 shadow-xl overflow-hidden">
                  <div className={`bg-gradient-to-br ${feature.color} p-4 text-white`}>
                    <feature.icon className="w-6 h-6 mb-1" />
                    <h3 className="font-bold">{feature.title}</h3>
                  </div>
                  <feature.mockup />
                </Card>
              </div>
            </div>
          </div>
        </section>
      ))}

      {/* Additional Features Grid */}
      <section className="py-20 px-4 bg-slate-900 text-white">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4">And So Much More</h2>
            <p className="text-xl text-slate-400">
              Every feature you need to run your business, all in one place
            </p>
          </div>

          <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {additionalFeatures.map((feature, index) => (
              <Card key={index} className="bg-slate-800 border-slate-700 hover:border-blue-500 transition-colors">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center mx-auto mb-4">
                    <feature.icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="font-bold text-white mb-2">{feature.title}</h3>
                  <p className="text-sm text-slate-400">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Replace Your Tools Section */}
      <section className="py-20 px-4 bg-blue-50">
        <div className="container mx-auto max-w-6xl text-center">
          <h2 className="text-4xl font-bold text-slate-900 mb-4">
            One Platform to Replace Them All
          </h2>
          <p className="text-xl text-slate-600 mb-12 max-w-3xl mx-auto">
            Stop juggling multiple subscriptions. PITCH CRM consolidates everything you need into a single, 
            powerful platform — saving you thousands every year.
          </p>
          
          <div className="flex flex-wrap justify-center gap-4 mb-12">
            {toolCategories.map((tool, index) => (
              <div key={index} className="bg-white px-6 py-3 rounded-full shadow-sm border border-slate-200 text-slate-700 font-medium">
                {tool}
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl p-8 shadow-lg max-w-2xl mx-auto">
            <div className="text-5xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
              $46,000+
            </div>
            <div className="text-xl text-slate-600 mb-4">Average Annual Savings</div>
            <p className="text-slate-500 mb-6">
              Compare the cost of 7+ separate tools versus one PITCH CRM subscription. 
              The math speaks for itself.
            </p>
            <Button 
              size="lg" 
              onClick={() => navigate('/pricing')}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
            >
              View Pricing <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </div>
        </div>
      </section>

      {/* Trust & Security */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-slate-900 mb-4">
              Built for Enterprise Security
            </h2>
            <p className="text-xl text-slate-600">
              Your data is protected with industry-leading security measures
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <Card className="border-2 border-slate-100 text-center">
              <CardContent className="p-8">
                <Shield className="w-12 h-12 text-blue-600 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-slate-900 mb-2">SOC 2 Compliant</h3>
                <p className="text-slate-600">Enterprise-grade security controls and auditing</p>
              </CardContent>
            </Card>
            <Card className="border-2 border-slate-100 text-center">
              <CardContent className="p-8">
                <Lock className="w-12 h-12 text-green-600 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-slate-900 mb-2">256-bit Encryption</h3>
                <p className="text-slate-600">All data encrypted at rest and in transit</p>
              </CardContent>
            </Card>
            <Card className="border-2 border-slate-100 text-center">
              <CardContent className="p-8">
                <Clock className="w-12 h-12 text-purple-600 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-slate-900 mb-2">99.9% Uptime</h3>
                <p className="text-slate-600">Reliable infrastructure you can count on</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white">
        <div className="container mx-auto max-w-4xl text-center">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            Ready to Transform Your Business?
          </h2>
          <p className="text-xl mb-8 opacity-90">
            Join hundreds of construction companies already using PITCH CRM to close more deals and save thousands.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button 
              size="lg" 
              onClick={() => navigate('/signup')}
              className="bg-white text-blue-600 hover:bg-slate-100 text-lg px-8 py-6"
            >
              Start Free Trial <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
            <Button 
              size="lg" 
              variant="outline" 
              className="border-2 border-white text-white hover:bg-white/10 text-lg px-8 py-6"
              onClick={() => navigate('/pricing')}
            >
              View Pricing
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
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="flex items-center space-x-2 mb-4 md:mb-0">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold">PITCH CRM</span>
            </div>
            <p className="text-slate-400 text-sm">
              © {new Date().getFullYear()} PITCH CRM. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Features;