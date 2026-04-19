import React from 'react';
import {
  Home,
  Users,
  Briefcase,
  FileText,
  BarChart3,
  Settings,
  Phone,
  Calendar,
  Map,
  Zap,
  DollarSign,
  Plus,
  Wrench,
  Wallet,
  Search,
  Bell,
  Printer,
  Download,
  CalendarDays,
  UserCheck,
  FileCheck,
  Eye,
  ChevronDown,
} from 'lucide-react';

const DashboardMockup = () => {
  const pipelineData = [
    { label: 'Leads', count: 6, color: 'bg-blue-400' },
    { label: 'Estimate Sent', count: 8, color: 'bg-blue-500' },
    { label: 'Contingency Signed', count: 3, color: 'bg-amber-500' },
    { label: 'Legal Review', count: 9, color: 'bg-violet-500' },
    { label: 'Ready for Approval', count: 1, color: 'bg-cyan-500' },
    { label: 'Project', count: 5, color: 'bg-green-500' },
    { label: 'Completed', count: 3, color: 'bg-emerald-600' },
  ];

  const actionTiles = [
    { label: 'New Contact', sub: 'Add a new customer contact', icon: Plus, gradient: 'from-blue-700 to-blue-900' },
    { label: 'Create Estimate', sub: 'Build a new roof estimate', icon: DollarSign, gradient: 'from-orange-500 to-orange-600' },
    { label: 'Schedule Work', sub: 'Manage project schedules', icon: Wrench, gradient: 'from-green-500 to-green-600' },
    { label: 'My Money', sub: 'Commissions, draws & earnings', icon: Wallet, gradient: 'from-amber-500 to-orange-500' },
  ];

  const progressCards = [
    { label: 'Unassigned Leads', value: 0, icon: UserCheck },
    { label: 'Jobs for Approval', value: 0, icon: FileCheck },
    { label: 'Jobs in Progress', value: 3, icon: Wrench },
    { label: 'Watch List', value: 0, icon: Eye },
  ];

  const sidebarItems = [
    { icon: Home, label: 'Dashboard', active: true },
    { icon: BarChart3, label: 'Pipeline' },
    { icon: Map, label: 'Storm Canvas Pro' },
    { icon: Phone, label: 'Follow Up Hub' },
    { icon: Users, label: 'Contacts' },
    { icon: FileText, label: 'Estimates' },
    { icon: Briefcase, label: 'Production' },
    { icon: Wallet, label: 'My Money' },
    { icon: Calendar, label: 'Calendar' },
    { icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="flex h-full min-h-[300px] md:min-h-[560px] bg-slate-50 text-slate-900 rounded-b-lg overflow-hidden">
      {/* Sidebar */}
      <div className="hidden md:flex w-56 bg-white border-r border-slate-200 flex-col">
        {/* Location Header */}
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center space-x-2 mb-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-base text-blue-700">PITCH CRM</span>
          </div>
          <div className="mt-3 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700">All Locations</span>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </div>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-hidden">
          {sidebarItems.map((item, index) => (
            <div
              key={index}
              className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm ${
                item.active
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <item.icon className="w-4 h-4" />
              <span className="truncate">{item.label}</span>
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="p-3 border-t border-slate-200">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-sm font-medium text-white">
              JD
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate text-slate-900">John Doe</div>
              <div className="text-xs text-slate-500 truncate">Owner</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Top Bar */}
        <div className="h-14 bg-white border-b border-slate-200 px-4 md:px-6 flex items-center justify-between gap-3">
          <div className="flex-1 max-w-md relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              readOnly
              placeholder="Search contacts, leads, jobs..."
              className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-600 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex w-8 h-8 bg-blue-600 rounded-md items-center justify-center">
              <BarChart3 className="w-4 h-4 text-white" />
            </div>
            <div className="relative">
              <Bell className="w-5 h-5 text-slate-500" />
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] rounded-full w-3.5 h-3.5 flex items-center justify-center">5</span>
            </div>
          </div>
        </div>

        {/* Dashboard Content */}
        <div className="p-4 md:p-6 space-y-5 overflow-auto flex-1">
          {/* Title */}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl md:text-2xl font-bold text-blue-700">Roofing CRM Dashboard</h1>
              <span className="inline-flex items-center gap-1 text-[10px] md:text-xs px-2 py-0.5 border border-slate-200 rounded-full bg-white text-slate-600">
                <Map className="w-3 h-3" /> All Locations
              </span>
            </div>
            <p className="text-xs md:text-sm text-slate-500 mt-1">Welcome back! Here's your roofing business overview.</p>
          </div>

          {/* Date / Export bar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-700">
              <CalendarDays className="w-3.5 h-3.5 text-slate-500" />
              Jan 19 - Apr 19
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-700">
              <Download className="w-3.5 h-3.5" /> Export <ChevronDown className="w-3 h-3" />
            </div>
            <div className="px-2 py-1.5 bg-white border border-slate-200 rounded-md">
              <Printer className="w-3.5 h-3.5 text-slate-600" />
            </div>
          </div>

          {/* Action Tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
            {actionTiles.map((t, i) => (
              <div
                key={i}
                className={`bg-gradient-to-br ${t.gradient} rounded-xl p-3 md:p-4 text-white text-center shadow-sm`}
              >
                <t.icon className="w-5 h-5 md:w-6 md:h-6 mx-auto mb-1 md:mb-2" />
                <div className="text-xs md:text-sm font-bold">{t.label}</div>
                <div className="text-[9px] md:text-[10px] opacity-90 mt-0.5 hidden sm:block">{t.sub}</div>
              </div>
            ))}
          </div>

          {/* Pipeline Status */}
          <div className="bg-white rounded-xl border border-slate-200 p-3 md:p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="w-4 h-4 text-blue-600" />
              <h2 className="text-sm font-semibold text-slate-800">Pipeline Status</h2>
            </div>
            <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
              {pipelineData.map((item, index) => (
                <div key={index} className={`${item.color} rounded-lg p-2 text-white text-center`}>
                  <div className="text-base md:text-xl font-bold leading-none">{item.count}</div>
                  <div className="text-[9px] md:text-[10px] mt-1 truncate">{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Progress */}
          <div>
            <h2 className="text-base md:text-lg font-bold text-slate-900">Progress</h2>
            <div className="text-[10px] uppercase tracking-wide text-slate-400 mt-1 mb-2">PROGRESS</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
              {progressCards.map((c, i) => (
                <div key={i} className="bg-white rounded-xl border border-slate-200 p-3 flex items-center justify-between">
                  <div>
                    <div className="text-xl md:text-2xl font-bold text-slate-900">{c.value}</div>
                    <div className="text-[10px] md:text-xs text-slate-500 mt-0.5">{c.label}</div>
                  </div>
                  <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                    <c.icon className="w-4 h-4 text-slate-500" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardMockup;
