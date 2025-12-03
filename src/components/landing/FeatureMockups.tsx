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
  Pen
} from 'lucide-react';

// Power Dialer Mockup
export const PowerDialerMockup = () => {
  return (
    <div className="bg-slate-900 rounded-lg p-4 h-full min-h-[280px]">
      <div className="flex gap-4 h-full">
        {/* Call Interface */}
        <div className="flex-1 bg-slate-800 rounded-lg p-4 flex flex-col">
          {/* Contact Info */}
          <div className="text-center mb-4">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full mx-auto mb-3 flex items-center justify-center">
              <span className="text-2xl font-bold text-white">MR</span>
            </div>
            <div className="text-lg font-semibold text-white">Mike Rodriguez</div>
            <div className="text-slate-400 text-sm">(813) 555-0142</div>
            <div className="text-slate-500 text-xs flex items-center justify-center mt-1">
              <Building2 className="w-3 h-3 mr-1" />
              Rodriguez Roofing LLC
            </div>
          </div>

          {/* Call Timer */}
          <div className="text-center mb-4">
            <div className="inline-flex items-center px-4 py-2 bg-green-500/20 rounded-full">
              <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
              <span className="text-green-400 font-mono text-lg">03:24</span>
            </div>
          </div>

          {/* Call Controls */}
          <div className="flex justify-center gap-3 mt-auto">
            <button className="w-12 h-12 bg-slate-700 rounded-full flex items-center justify-center hover:bg-slate-600">
              <Mic className="w-5 h-5 text-white" />
            </button>
            <button className="w-14 h-14 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600">
              <PhoneOff className="w-6 h-6 text-white" />
            </button>
            <button className="w-12 h-12 bg-slate-700 rounded-full flex items-center justify-center hover:bg-slate-600">
              <Clock4 className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        {/* Stats Sidebar */}
        <div className="w-32 space-y-3">
          <div className="bg-slate-800 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-white">23</div>
            <div className="text-xs text-slate-400">Calls Today</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-400">4</div>
            <div className="text-xs text-slate-400">Appointments</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-blue-400">18%</div>
            <div className="text-xs text-slate-400">Conversion</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-purple-400">47</div>
            <div className="text-xs text-slate-400">In Queue</div>
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
    <div className="bg-slate-900 rounded-lg p-4 h-full min-h-[280px]">
      {/* Metrics Row */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {metrics.map((m, i) => (
          <div key={i} className="bg-slate-800 rounded-lg p-2 text-center">
            <div className="text-xs text-slate-400">{m.label}</div>
            <div className="text-lg font-bold text-white">{m.value}</div>
            <div className={`text-xs flex items-center justify-center ${m.positive ? 'text-green-400' : 'text-red-400'}`}>
              {m.positive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
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
