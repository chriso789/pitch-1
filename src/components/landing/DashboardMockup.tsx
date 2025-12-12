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
  TrendingUp,
  TrendingDown,
  DollarSign,
  Clock,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

const DashboardMockup = () => {
  const pipelineData = [
    { label: 'Lead', count: 12, color: 'bg-yellow-500' },
    { label: 'Legal', count: 8, color: 'bg-orange-500' },
    { label: 'Contingency', count: 5, color: 'bg-blue-500' },
    { label: 'Project', count: 23, color: 'bg-green-500' },
    { label: 'Completed', count: 47, color: 'bg-emerald-600' },
    { label: 'Closed', count: 156, color: 'bg-slate-500' },
  ];

  const kpis = [
    { label: 'Total Revenue', value: '$847,500', change: '+12%', positive: true, icon: DollarSign },
    { label: 'Active Projects', value: '31', change: '+8%', positive: true, icon: Briefcase },
    { label: 'Completed MTD', value: '12', change: '+4%', positive: true, icon: CheckCircle2 },
    { label: 'Avg Margin', value: '32%', change: '+2%', positive: true, icon: TrendingUp },
  ];

  const recentProjects = [
    { name: 'Rodriguez Residence', address: '4205 Custer Dr', status: 'In Progress', value: '$18,500', statusColor: 'bg-blue-500' },
    { name: 'Summit Commercial', address: '1200 Main St', status: 'Approved', value: '$45,200', statusColor: 'bg-green-500' },
    { name: 'Taylor Home', address: '892 Oak Ave', status: 'Pending', value: '$12,800', statusColor: 'bg-yellow-500' },
    { name: 'Chen Property', address: '3421 Pine Rd', status: 'In Progress', value: '$22,100', statusColor: 'bg-blue-500' },
    { name: 'Martinez Roofing', address: '567 Elm St', status: 'Complete', value: '$31,400', statusColor: 'bg-emerald-500' },
  ];

  const sidebarItems = [
    { icon: Home, label: 'Dashboard', active: true },
    { icon: BarChart3, label: 'Pipeline' },
    { icon: Users, label: 'Contacts' },
    { icon: Briefcase, label: 'Jobs' },
    { icon: FileText, label: 'Estimates' },
    { icon: Phone, label: 'Power Dialer' },
    { icon: Calendar, label: 'Calendar' },
    { icon: Map, label: 'Canvass' },
    { icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="flex h-full min-h-[300px] md:min-h-[500px] bg-slate-900 text-slate-100 rounded-b-lg overflow-hidden">
      {/* Sidebar - Hidden on mobile */}
      <div className="hidden md:flex w-56 bg-slate-950 border-r border-slate-800 flex-col">
        {/* Logo */}
        <div className="p-4 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg">PITCH CRM</span>
          </div>
        </div>
        
        {/* Nav Items */}
        <nav className="flex-1 p-2 space-y-1">
          {sidebarItems.map((item, index) => (
            <div
              key={index}
              className={`flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm ${
                item.active 
                  ? 'bg-blue-600 text-white' 
                  : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              <item.icon className="w-4 h-4" />
              <span>{item.label}</span>
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="p-3 border-t border-slate-800">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-sm font-medium">
              JD
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">John Doe</div>
              <div className="text-xs text-slate-500 truncate">Sales Manager</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {/* Header */}
        <div className="h-14 bg-slate-900 border-b border-slate-800 px-6 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Dashboard</h1>
          <div className="flex items-center space-x-2">
            <div className="px-3 py-1.5 bg-slate-800 rounded-lg text-xs text-slate-400">
              <Clock className="w-3 h-3 inline mr-1" />
              Last updated: 2 min ago
            </div>
          </div>
        </div>

        {/* Dashboard Content */}
        <div className="p-6 space-y-6 overflow-auto h-[calc(100%-3.5rem)]">
          {/* Pipeline Status Row */}
          <div>
            <h2 className="text-sm font-medium text-slate-400 mb-2 md:mb-3">Pipeline Status</h2>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 md:gap-3">
              {pipelineData.map((item, index) => (
                <div key={index} className="bg-slate-800 rounded-lg p-2 md:p-3">
                  <div className="flex items-center justify-between mb-1 md:mb-2">
                    <span className="text-[10px] md:text-xs text-slate-400">{item.label}</span>
                    <div className={`w-1.5 md:w-2 h-1.5 md:h-2 rounded-full ${item.color}`}></div>
                  </div>
                  <div className="text-lg md:text-2xl font-bold">{item.count}</div>
                </div>
              ))}
            </div>
          </div>

          {/* KPIs Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
            {kpis.map((kpi, index) => (
              <div key={index} className="bg-slate-800 rounded-lg p-2 md:p-4">
                <div className="flex items-center justify-between mb-1 md:mb-2">
                  <span className="text-[10px] md:text-xs text-slate-400">{kpi.label}</span>
                  <kpi.icon className="w-3 md:w-4 h-3 md:h-4 text-slate-500" />
                </div>
                <div className="text-base md:text-2xl font-bold mb-0.5 md:mb-1">{kpi.value}</div>
                <div className={`text-[10px] md:text-xs flex items-center ${kpi.positive ? 'text-green-400' : 'text-red-400'}`}>
                  {kpi.positive ? <TrendingUp className="w-2.5 md:w-3 h-2.5 md:h-3 mr-0.5 md:mr-1" /> : <TrendingDown className="w-2.5 md:w-3 h-2.5 md:h-3 mr-0.5 md:mr-1" />}
                  <span className="hidden sm:inline">{kpi.change} from last month</span>
                  <span className="sm:hidden">{kpi.change}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Recent Projects Table - Hidden on very small screens, simplified on mobile */}
          <div className="hidden sm:block">
            <h2 className="text-sm font-medium text-slate-400 mb-2 md:mb-3">Recent Projects</h2>
            <div className="bg-slate-800 rounded-lg overflow-hidden">
              <table className="w-full text-xs md:text-sm">
                <thead className="bg-slate-700/50">
                  <tr>
                    <th className="text-left p-2 md:p-3 text-slate-400 font-medium">Project</th>
                    <th className="text-left p-2 md:p-3 text-slate-400 font-medium hidden md:table-cell">Address</th>
                    <th className="text-left p-2 md:p-3 text-slate-400 font-medium">Status</th>
                    <th className="text-right p-2 md:p-3 text-slate-400 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {recentProjects.slice(0, 3).map((project, index) => (
                    <tr key={index} className="hover:bg-slate-700/30">
                      <td className="p-2 md:p-3 font-medium truncate max-w-[100px] md:max-w-none">{project.name}</td>
                      <td className="p-2 md:p-3 text-slate-400 hidden md:table-cell">{project.address}</td>
                      <td className="p-2 md:p-3">
                        <span className={`px-1.5 md:px-2 py-0.5 md:py-1 rounded-full text-[10px] md:text-xs ${project.statusColor} text-white`}>
                          {project.status}
                        </span>
                      </td>
                      <td className="p-2 md:p-3 text-right font-medium text-green-400">{project.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardMockup;
