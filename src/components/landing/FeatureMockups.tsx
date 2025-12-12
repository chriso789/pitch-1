import React from 'react';
import { 
  Phone, 
  PhoneOff, 
  Mic, 
  MicOff,
  Clock,
  User,
  Building2,
  Calendar,
  CheckCircle2,
  XCircle,
  Clock4,
  TrendingUp,
  DollarSign,
  BarChart3,
  PieChart,
  ArrowUpRight,
  ArrowDownRight,
  FileText,
  Send,
  Pen,
  MapPin,
  Mail,
  MessageSquare,
  Play,
  Pause,
  ChevronRight,
  Ruler,
  Home,
  Users
} from 'lucide-react';

// Power Dialer Mockup
export const PowerDialerMockup = () => {
  return (
    <div className="bg-slate-900 rounded-lg p-3 md:p-4 h-full min-h-[220px] md:min-h-[280px]">
      <div className="flex flex-col md:flex-row gap-3 md:gap-4 h-full">
        {/* Call Interface */}
        <div className="flex-1 bg-slate-800 rounded-lg p-3 md:p-4 flex flex-col">
          {/* Contact Info */}
          <div className="text-center mb-3 md:mb-4">
            <div className="w-12 md:w-16 h-12 md:h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full mx-auto mb-2 md:mb-3 flex items-center justify-center">
              <span className="text-lg md:text-2xl font-bold text-white">MR</span>
            </div>
            <div className="text-base md:text-lg font-semibold text-white">Mike Rodriguez</div>
            <div className="text-slate-400 text-xs md:text-sm">(813) 555-0142</div>
            <div className="text-slate-500 text-xs flex items-center justify-center mt-1">
              <Building2 className="w-3 h-3 mr-1" />
              Rodriguez Roofing LLC
            </div>
          </div>

          {/* Call Timer */}
          <div className="text-center mb-3 md:mb-4">
            <div className="inline-flex items-center px-3 md:px-4 py-1.5 md:py-2 bg-green-500/20 rounded-full">
              <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
              <span className="text-green-400 font-mono text-base md:text-lg">03:24</span>
            </div>
          </div>

          {/* Call Controls */}
          <div className="flex justify-center gap-2 md:gap-3 mt-auto">
            <button className="w-10 md:w-12 h-10 md:h-12 bg-slate-700 rounded-full flex items-center justify-center hover:bg-slate-600">
              <Mic className="w-4 md:w-5 h-4 md:h-5 text-white" />
            </button>
            <button className="w-12 md:w-14 h-12 md:h-14 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600">
              <PhoneOff className="w-5 md:w-6 h-5 md:h-6 text-white" />
            </button>
            <button className="w-10 md:w-12 h-10 md:h-12 bg-slate-700 rounded-full flex items-center justify-center hover:bg-slate-600">
              <Clock4 className="w-4 md:w-5 h-4 md:h-5 text-white" />
            </button>
          </div>
        </div>

        {/* Stats - Row on mobile, sidebar on desktop */}
        <div className="grid grid-cols-4 md:grid-cols-1 md:w-32 gap-2 md:gap-3">
          <div className="bg-slate-800 rounded-lg p-2 md:p-3 text-center">
            <div className="text-lg md:text-2xl font-bold text-white">23</div>
            <div className="text-[10px] md:text-xs text-slate-400">Calls Today</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-2 md:p-3 text-center">
            <div className="text-lg md:text-2xl font-bold text-green-400">4</div>
            <div className="text-[10px] md:text-xs text-slate-400">Appointments</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-2 md:p-3 text-center">
            <div className="text-lg md:text-2xl font-bold text-blue-400">18%</div>
            <div className="text-[10px] md:text-xs text-slate-400">Conversion</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-2 md:p-3 text-center">
            <div className="text-lg md:text-2xl font-bold text-purple-400">47</div>
            <div className="text-[10px] md:text-xs text-slate-400">In Queue</div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Estimate Builder Mockup
export const EstimateMockup = () => {
  const lineItems = [
    { desc: 'GAF HDZ Shingles (Charcoal)', qty: '32 SQ', price: '$4,160.00' },
    { desc: 'Ridge Cap Shingles', qty: '4 BDL', price: '$320.00' },
    { desc: 'Ice & Water Shield', qty: '6 RL', price: '$780.00' },
    { desc: 'Synthetic Underlayment', qty: '8 RL', price: '$640.00' },
    { desc: 'Labor - Tear Off & Install', qty: '1', price: '$6,400.00' },
  ];

  return (
    <div className="bg-white rounded-lg p-4 h-full min-h-[280px] text-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-3">
        <div>
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded flex items-center justify-center">
              <span className="text-white text-xs font-bold">PR</span>
            </div>
            <div>
              <div className="font-bold text-sm">Premier Roofing Co.</div>
              <div className="text-xs text-slate-500">License #ROC-12345</div>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Estimate #</div>
          <div className="font-mono font-bold text-sm">EST-2024-0342</div>
        </div>
      </div>

      {/* Customer */}
      <div className="mb-3 text-xs">
        <span className="text-slate-500">Prepared for: </span>
        <span className="font-medium">Mike Rodriguez • 4205 Custer Dr, Valrico FL</span>
      </div>

      {/* Line Items */}
      <div className="bg-slate-50 rounded-lg overflow-hidden mb-3">
        <table className="w-full text-xs">
          <thead className="bg-slate-100">
            <tr>
              <th className="text-left p-2 font-medium text-slate-600">Description</th>
              <th className="text-center p-2 font-medium text-slate-600">Qty</th>
              <th className="text-right p-2 font-medium text-slate-600">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {lineItems.map((item, i) => (
              <tr key={i}>
                <td className="p-2">{item.desc}</td>
                <td className="p-2 text-center text-slate-600">{item.qty}</td>
                <td className="p-2 text-right font-medium">{item.price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="flex justify-between items-end">
        <div className="flex items-center space-x-2">
          <button className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs flex items-center">
            <Send className="w-3 h-3 mr-1" /> Send
          </button>
          <button className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded text-xs flex items-center">
            <Pen className="w-3 h-3 mr-1" /> Sign
          </button>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Subtotal: $12,300.00</div>
          <div className="text-xs text-slate-500">Tax (7%): $861.00</div>
          <div className="text-lg font-bold text-green-600">$13,161.00</div>
        </div>
      </div>
    </div>
  );
};

// Pipeline Mockup
export const PipelineMockup = () => {
  const columns = [
    { 
      name: 'Lead', 
      color: 'bg-yellow-500', 
      cards: [
        { name: 'Johnson', value: '$8.5K' },
        { name: 'Williams', value: '$12K' },
      ]
    },
    { 
      name: 'Legal', 
      color: 'bg-orange-500', 
      cards: [
        { name: 'Davis', value: '$22K' },
      ]
    },
    { 
      name: 'Project', 
      color: 'bg-green-500', 
      cards: [
        { name: 'Rodriguez', value: '$18.5K' },
        { name: 'Chen', value: '$31K' },
        { name: 'Taylor', value: '$15K' },
      ]
    },
    { 
      name: 'Complete', 
      color: 'bg-emerald-600', 
      cards: [
        { name: 'Martinez', value: '$24K' },
        { name: 'Anderson', value: '$19K' },
      ]
    },
  ];

  return (
    <div className="bg-slate-900 rounded-lg p-4 h-full min-h-[280px]">
      <div className="flex gap-3 h-full overflow-x-auto">
        {columns.map((col, i) => (
          <div key={i} className="flex-1 min-w-[140px]">
            {/* Column Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${col.color}`}></div>
                <span className="text-sm font-medium text-white">{col.name}</span>
              </div>
              <span className="text-xs bg-slate-700 px-2 py-0.5 rounded-full text-slate-300">
                {col.cards.length}
              </span>
            </div>
            
            {/* Cards */}
            <div className="space-y-2">
              {col.cards.map((card, j) => (
                <div key={j} className="bg-slate-800 rounded-lg p-3 border-l-2 border-slate-600 hover:border-blue-500 transition-colors">
                  <div className="font-medium text-sm text-white mb-1">{card.name}</div>
                  <div className="text-xs text-green-400 font-medium">{card.value}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Analytics Mockup
export const AnalyticsMockup = () => {
  const metrics = [
    { label: 'Revenue MTD', value: '$127K', change: '+18%', positive: true },
    { label: 'Close Rate', value: '34%', change: '+5%', positive: true },
    { label: 'Avg Deal Size', value: '$18.2K', change: '+12%', positive: true },
    { label: 'Pipeline Value', value: '$892K', change: '-3%', positive: false },
  ];

  return (
    <div className="bg-slate-900 rounded-lg p-3 md:p-4 h-full min-h-[220px] md:min-h-[280px]">
      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 md:mb-4">
        {metrics.map((m, i) => (
          <div key={i} className="bg-slate-800 rounded-lg p-2 text-center">
            <div className="text-[10px] md:text-xs text-slate-400">{m.label}</div>
            <div className="text-base md:text-lg font-bold text-white">{m.value}</div>
            <div className={`text-[10px] md:text-xs flex items-center justify-center ${m.positive ? 'text-green-400' : 'text-red-400'}`}>
              {m.positive ? <ArrowUpRight className="w-2.5 md:w-3 h-2.5 md:h-3" /> : <ArrowDownRight className="w-2.5 md:w-3 h-2.5 md:h-3" />}
              {m.change}
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-3">
        {/* Revenue Chart */}
        <div className="bg-slate-800 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-2">Monthly Revenue</div>
          <div className="flex items-end justify-between h-24 px-1">
            {[65, 45, 80, 55, 90, 75, 95].map((h, i) => (
              <div key={i} className="flex flex-col items-center">
                <div 
                  className={`w-4 rounded-t ${i === 6 ? 'bg-blue-500' : 'bg-slate-600'}`}
                  style={{ height: `${h}%` }}
                ></div>
                <span className="text-[10px] text-slate-500 mt-1">
                  {['J', 'F', 'M', 'A', 'M', 'J', 'J'][i]}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Funnel */}
        <div className="bg-slate-800 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-2">Conversion Funnel</div>
          <div className="space-y-1">
            <div className="flex items-center">
              <div className="w-full bg-blue-500 h-5 rounded text-[10px] text-white flex items-center px-2">
                Leads: 156
              </div>
            </div>
            <div className="flex items-center">
              <div className="w-[75%] bg-blue-600 h-5 rounded text-[10px] text-white flex items-center px-2">
                Qualified: 117
              </div>
            </div>
            <div className="flex items-center">
              <div className="w-[50%] bg-purple-500 h-5 rounded text-[10px] text-white flex items-center px-2">
                Proposal: 78
              </div>
            </div>
            <div className="flex items-center">
              <div className="w-[34%] bg-green-500 h-5 rounded text-[10px] text-white flex items-center px-2">
                Won: 53
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// AI Measurement Mockup
export const MeasurementMockup = () => {
  return (
    <div className="bg-slate-900 rounded-lg p-3 md:p-4 h-full min-h-[220px] md:min-h-[280px]">
      <div className="flex flex-col md:flex-row gap-3 md:gap-4 h-full">
        {/* Satellite View */}
        <div className="flex-1 min-h-[140px] md:min-h-0 bg-slate-800 rounded-lg overflow-hidden relative">
          {/* Simulated satellite image with roof overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-900 via-emerald-800 to-green-900">
            {/* House shape */}
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
              <svg className="w-32 md:w-40 h-24 md:h-30" viewBox="0 0 160 120">
                {/* Roof facets */}
                <polygon 
                  points="10,60 80,10 150,60" 
                  fill="rgba(59, 130, 246, 0.3)" 
                  stroke="#3b82f6" 
                  strokeWidth="2"
                />
                <polygon 
                  points="10,60 80,60 80,110 10,110" 
                  fill="rgba(168, 85, 247, 0.3)" 
                  stroke="#a855f7" 
                  strokeWidth="2"
                />
                <polygon 
                  points="80,60 150,60 150,110 80,110" 
                  fill="rgba(34, 197, 94, 0.3)" 
                  stroke="#22c55e" 
                  strokeWidth="2"
                />
                {/* Ridge line */}
                <line x1="10" y1="60" x2="150" y2="60" stroke="#10b981" strokeWidth="3" strokeDasharray="5,3" />
              </svg>
            </div>
          </div>
          
          {/* Overlay badge */}
          <div className="absolute top-2 left-2 bg-blue-500 text-white text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 md:py-1 rounded">
            AI Detected: 3 Facets
          </div>
          <div className="absolute bottom-2 right-2 bg-slate-900/80 text-white text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 md:py-1 rounded">
            Zoom: 20 | Pitch: 6/12
          </div>
        </div>

        {/* Measurement Data - Row on mobile, sidebar on desktop */}
        <div className="grid grid-cols-4 md:grid-cols-1 md:w-36 gap-2">
          <div className="bg-slate-800 rounded-lg p-2 md:p-3">
            <div className="text-[10px] md:text-xs text-slate-400">Total Area</div>
            <div className="text-base md:text-xl font-bold text-white">3,245</div>
            <div className="text-[10px] md:text-xs text-slate-500">sq ft</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-2 md:p-3">
            <div className="text-[10px] md:text-xs text-slate-400">Squares</div>
            <div className="text-sm md:text-lg font-bold text-green-400">32.5</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-2 md:p-3">
            <div className="text-[10px] md:text-xs text-slate-400">Ridge</div>
            <div className="text-sm md:text-lg font-bold text-blue-400">68 LF</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-2 md:p-3">
            <div className="text-[10px] md:text-xs text-slate-400">Confidence</div>
            <div className="text-sm md:text-lg font-bold text-emerald-400">94%</div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Territory Map Mockup
export const TerritoryMockup = () => {
  const pins = [
    { x: 20, y: 30, status: 'interested', label: 'J' },
    { x: 45, y: 25, status: 'not_interested', label: 'W' },
    { x: 70, y: 35, status: 'follow_up', label: 'D' },
    { x: 30, y: 55, status: 'interested', label: 'R' },
    { x: 55, y: 60, status: 'new', label: 'C' },
    { x: 80, y: 50, status: 'interested', label: 'T' },
    { x: 25, y: 75, status: 'not_interested', label: 'M' },
    { x: 60, y: 80, status: 'follow_up', label: 'A' },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'interested': return 'bg-green-500';
      case 'not_interested': return 'bg-red-500';
      case 'follow_up': return 'bg-yellow-500';
      default: return 'bg-slate-500';
    }
  };

  return (
    <div className="bg-slate-900 rounded-lg p-3 md:p-4 h-full min-h-[220px] md:min-h-[280px]">
      <div className="flex flex-col md:flex-row gap-3 md:gap-4 h-full">
        {/* Map Area */}
        <div className="flex-1 min-h-[140px] md:min-h-0 bg-slate-800 rounded-lg overflow-hidden relative">
          {/* Map grid background */}
          <div className="absolute inset-0 opacity-20" style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px)',
            backgroundSize: '20px 20px'
          }} />
          
          {/* Pins */}
          {pins.map((pin, i) => (
            <div 
              key={i}
              className={`absolute w-5 md:w-6 h-5 md:h-6 ${getStatusColor(pin.status)} rounded-full flex items-center justify-center text-white text-[10px] md:text-xs font-bold shadow-lg transform -translate-x-1/2 -translate-y-1/2 cursor-pointer hover:scale-110 transition-transform`}
              style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
            >
              {pin.label}
            </div>
          ))}
          
          {/* Current location pulse */}
          <div className="absolute left-[50%] top-[45%] transform -translate-x-1/2 -translate-y-1/2">
            <div className="w-3 md:w-4 h-3 md:h-4 bg-blue-500 rounded-full animate-ping absolute" />
            <div className="w-3 md:w-4 h-3 md:h-4 bg-blue-500 rounded-full relative" />
          </div>
          
          {/* Legend */}
          <div className="absolute bottom-2 left-2 bg-slate-900/90 rounded p-1.5 md:p-2 text-[10px] md:text-xs">
            <div className="flex items-center gap-2 md:gap-3">
              <span className="flex items-center"><span className="w-1.5 md:w-2 h-1.5 md:h-2 bg-green-500 rounded-full mr-0.5 md:mr-1"></span>Interested</span>
              <span className="flex items-center"><span className="w-1.5 md:w-2 h-1.5 md:h-2 bg-yellow-500 rounded-full mr-0.5 md:mr-1"></span>Follow-up</span>
              <span className="hidden sm:flex items-center"><span className="w-1.5 md:w-2 h-1.5 md:h-2 bg-red-500 rounded-full mr-0.5 md:mr-1"></span>Not Int.</span>
            </div>
          </div>
        </div>

        {/* Stats - Row on mobile, sidebar on desktop */}
        <div className="grid grid-cols-4 md:grid-cols-1 md:w-28 gap-2">
          <div className="bg-slate-800 rounded-lg p-2 text-center">
            <div className="text-lg md:text-xl font-bold text-white">47</div>
            <div className="text-[9px] md:text-[10px] text-slate-400">Doors Today</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-2 text-center">
            <div className="text-lg md:text-xl font-bold text-green-400">12</div>
            <div className="text-[9px] md:text-[10px] text-slate-400">Interested</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-2 text-center">
            <div className="text-lg md:text-xl font-bold text-blue-400">3</div>
            <div className="text-[9px] md:text-[10px] text-slate-400">Appointments</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-2 text-center">
            <div className="text-lg md:text-xl font-bold text-purple-400">2.3</div>
            <div className="text-[9px] md:text-[10px] text-slate-400">Miles</div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Email/SMS Automation Mockup
export const AutomationMockup = () => {
  const sequences = [
    { name: 'New Lead Welcome', status: 'active', sent: 156, opened: 89, clicked: 34 },
    { name: 'Estimate Follow-up', status: 'active', sent: 78, opened: 52, clicked: 21 },
    { name: 'Appointment Reminder', status: 'paused', sent: 234, opened: 198, clicked: 0 },
  ];

  return (
    <div className="bg-slate-900 rounded-lg p-4 h-full min-h-[280px]">
      {/* Sequence List */}
      <div className="space-y-3 mb-4">
        {sequences.map((seq, i) => (
          <div key={i} className="bg-slate-800 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${seq.status === 'active' ? 'bg-green-500' : 'bg-yellow-500'}`} />
                <span className="text-sm font-medium text-white">{seq.name}</span>
              </div>
              <button className="text-slate-400 hover:text-white">
                {seq.status === 'active' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
            </div>
            <div className="flex items-center space-x-4 text-xs">
              <span className="text-slate-400">Sent: <span className="text-white">{seq.sent}</span></span>
              <span className="text-slate-400">Opened: <span className="text-green-400">{Math.round((seq.opened/seq.sent)*100)}%</span></span>
              <span className="text-slate-400">Clicked: <span className="text-blue-400">{Math.round((seq.clicked/seq.sent)*100)}%</span></span>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-slate-800 rounded-lg p-2 text-center">
          <Mail className="w-4 h-4 text-blue-400 mx-auto mb-1" />
          <div className="text-lg font-bold text-white">468</div>
          <div className="text-[10px] text-slate-400">Emails Sent</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-2 text-center">
          <MessageSquare className="w-4 h-4 text-green-400 mx-auto mb-1" />
          <div className="text-lg font-bold text-white">234</div>
          <div className="text-[10px] text-slate-400">SMS Sent</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-2 text-center">
          <TrendingUp className="w-4 h-4 text-purple-400 mx-auto mb-1" />
          <div className="text-lg font-bold text-white">67%</div>
          <div className="text-[10px] text-slate-400">Open Rate</div>
        </div>
      </div>
    </div>
  );
};

// Calendar/Scheduling Mockup
export const CalendarMockup = () => {
  const appointments = [
    { time: '9:00 AM', name: 'Mike Rodriguez', type: 'Inspection', address: 'Valrico, FL' },
    { time: '11:30 AM', name: 'Sarah Chen', type: 'Estimate Review', address: 'Tampa, FL' },
    { time: '2:00 PM', name: 'James Taylor', type: 'Contract Signing', address: 'Brandon, FL' },
  ];

  return (
    <div className="bg-slate-900 rounded-lg p-3 md:p-4 h-full min-h-[220px] md:min-h-[280px]">
      <div className="flex flex-col md:flex-row gap-3 md:gap-4 h-full">
        {/* Mini Calendar - Hidden on very small screens */}
        <div className="hidden sm:block w-full md:w-40 bg-slate-800 rounded-lg p-2 md:p-3">
          <div className="text-center mb-2">
            <div className="text-xs text-slate-400">December 2024</div>
          </div>
          <div className="grid grid-cols-7 gap-0.5 md:gap-1 text-[9px] md:text-[10px] text-center">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <div key={i} className="text-slate-500">{d}</div>
            ))}
            {Array.from({ length: 31 }, (_, i) => (
              <div 
                key={i} 
                className={`p-0.5 md:p-1 rounded ${i === 2 ? 'bg-blue-500 text-white' : i === 5 || i === 12 || i === 19 ? 'bg-green-500/20 text-green-400' : 'text-slate-400 hover:bg-slate-700'}`}
              >
                {i + 1}
              </div>
            ))}
          </div>
        </div>

        {/* Today's Schedule */}
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between mb-1 md:mb-2">
            <div className="text-xs md:text-sm font-medium text-white">Today's Schedule</div>
            <div className="text-[10px] md:text-xs text-slate-400">Dec 3</div>
          </div>
          
          {appointments.map((apt, i) => (
            <div key={i} className="bg-slate-800 rounded-lg p-2 md:p-3 border-l-2 border-blue-500">
              <div className="flex items-center justify-between mb-0.5 md:mb-1">
                <span className="text-[10px] md:text-xs text-blue-400 font-medium">{apt.time}</span>
                <span className="text-[9px] md:text-[10px] bg-slate-700 px-1.5 md:px-2 py-0.5 rounded text-slate-300">{apt.type}</span>
              </div>
              <div className="text-xs md:text-sm font-medium text-white">{apt.name}</div>
              <div className="text-[10px] md:text-xs text-slate-400 flex items-center">
                <MapPin className="w-2.5 md:w-3 h-2.5 md:h-3 mr-1" />
                {apt.address}
              </div>
            </div>
          ))}
          
          <button className="w-full py-1.5 md:py-2 bg-blue-500/20 text-blue-400 rounded-lg text-[10px] md:text-xs flex items-center justify-center hover:bg-blue-500/30">
            <Calendar className="w-2.5 md:w-3 h-2.5 md:h-3 mr-1" />
            Add Appointment
          </button>
        </div>
      </div>
    </div>
  );
};