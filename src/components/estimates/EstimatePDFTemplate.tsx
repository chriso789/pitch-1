import React from 'react';
import { type LineItem } from '@/hooks/useEstimatePricing';

interface EstimatePDFTemplateProps {
  estimateNumber: string;
  customerName: string;
  customerAddress: string;
  companyName?: string;
  companyLogo?: string;
  materialItems: LineItem[];
  laborItems: LineItem[];
  breakdown: {
    materialsTotal: number;
    laborTotal: number;
    directCost: number;
    overheadAmount: number;
    totalCost: number;
    profitAmount: number;
    repCommissionAmount: number;
    sellingPrice: number;
    actualProfitMargin: number;
  };
  config: {
    overheadPercent: number;
    profitMarginPercent: number;
    repCommissionPercent: number;
  };
  createdAt?: string;
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

export const EstimatePDFTemplate: React.FC<EstimatePDFTemplateProps> = ({
  estimateNumber,
  customerName,
  customerAddress,
  companyName = 'PITCH CRM',
  companyLogo,
  materialItems,
  laborItems,
  breakdown,
  config,
  createdAt,
}) => {
  const dateStr = createdAt 
    ? new Date(createdAt).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })
    : new Date().toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });

  return (
    <div 
      id="estimate-pdf-template"
      className="bg-white text-black p-8 w-[816px] min-h-[1056px]"
      style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      {/* Header */}
      <div className="flex justify-between items-start mb-8 pb-6 border-b-2 border-gray-200">
        <div>
          {companyLogo ? (
            <img src={companyLogo} alt="Company Logo" className="h-12 mb-2" />
          ) : (
            <h1 className="text-2xl font-bold text-gray-900">{companyName}</h1>
          )}
          <p className="text-sm text-gray-500">Professional Roofing Estimate</p>
        </div>
        <div className="text-right">
          <h2 className="text-xl font-bold text-gray-900">{estimateNumber}</h2>
          <p className="text-sm text-gray-500">{dateStr}</p>
        </div>
      </div>

      {/* Customer Info */}
      <div className="mb-8 p-4 bg-gray-50 rounded-lg">
        <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Prepared For</h3>
        <p className="font-semibold text-lg text-gray-900">{customerName || 'Customer'}</p>
        <p className="text-gray-600 text-sm">{customerAddress || 'Address not specified'}</p>
      </div>

      {/* Materials Section */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
          Materials
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 text-gray-600 font-medium">Item</th>
              <th className="text-right py-2 text-gray-600 font-medium w-20">Qty</th>
              <th className="text-right py-2 text-gray-600 font-medium w-16">Unit</th>
              <th className="text-right py-2 text-gray-600 font-medium w-24">Unit Cost</th>
              <th className="text-right py-2 text-gray-600 font-medium w-28">Total</th>
            </tr>
          </thead>
          <tbody>
            {materialItems.map((item, idx) => (
              <tr key={item.id || idx} className="border-b border-gray-100">
                <td className="py-2 text-gray-900">{item.item_name}</td>
                <td className="py-2 text-right text-gray-700">{item.qty.toFixed(2)}</td>
                <td className="py-2 text-right text-gray-500">{item.unit}</td>
                <td className="py-2 text-right text-gray-700">{formatCurrency(item.unit_cost)}</td>
                <td className="py-2 text-right font-medium text-gray-900">{formatCurrency(item.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200">
              <td colSpan={4} className="py-3 text-right font-semibold text-gray-700">Materials Subtotal</td>
              <td className="py-3 text-right font-bold text-gray-900">{formatCurrency(breakdown.materialsTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Labor Section */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500 rounded-full"></span>
          Labor
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 text-gray-600 font-medium">Item</th>
              <th className="text-right py-2 text-gray-600 font-medium w-20">Qty</th>
              <th className="text-right py-2 text-gray-600 font-medium w-16">Unit</th>
              <th className="text-right py-2 text-gray-600 font-medium w-24">Rate</th>
              <th className="text-right py-2 text-gray-600 font-medium w-28">Total</th>
            </tr>
          </thead>
          <tbody>
            {laborItems.map((item, idx) => (
              <tr key={item.id || idx} className="border-b border-gray-100">
                <td className="py-2 text-gray-900">{item.item_name}</td>
                <td className="py-2 text-right text-gray-700">{item.qty.toFixed(2)}</td>
                <td className="py-2 text-right text-gray-500">{item.unit}</td>
                <td className="py-2 text-right text-gray-700">{formatCurrency(item.unit_cost)}</td>
                <td className="py-2 text-right font-medium text-gray-900">{formatCurrency(item.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200">
              <td colSpan={4} className="py-3 text-right font-semibold text-gray-700">Labor Subtotal</td>
              <td className="py-3 text-right font-bold text-gray-900">{formatCurrency(breakdown.laborTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Cost Summary */}
      <div className="bg-gray-50 rounded-lg p-6 mb-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Estimate Summary</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Direct Cost (Materials + Labor)</span>
            <span className="font-medium">{formatCurrency(breakdown.directCost)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Overhead ({config.overheadPercent}%)</span>
            <span className="font-medium">{formatCurrency(breakdown.overheadAmount)}</span>
          </div>
          <div className="flex justify-between border-t border-gray-200 pt-2 mt-2">
            <span className="text-gray-700 font-medium">Total Cost</span>
            <span className="font-semibold">{formatCurrency(breakdown.totalCost)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Profit ({breakdown.actualProfitMargin.toFixed(1)}%)</span>
            <span className="font-medium text-green-600">{formatCurrency(breakdown.profitAmount)}</span>
          </div>
        </div>
        
        {/* Final Price */}
        <div className="mt-6 pt-4 border-t-2 border-gray-300">
          <div className="flex justify-between items-center">
            <span className="text-xl font-bold text-gray-900">Total Investment</span>
            <span className="text-3xl font-bold text-blue-600">{formatCurrency(breakdown.sellingPrice)}</span>
          </div>
        </div>
      </div>

      {/* Rep Commission (Internal) */}
      <div className="text-xs text-gray-400 mb-8 p-3 bg-gray-50 rounded border border-dashed border-gray-200">
        <span className="font-medium">Internal:</span> Rep Commission ({config.repCommissionPercent}%) = {formatCurrency(breakdown.repCommissionAmount)}
      </div>

      {/* Terms */}
      <div className="text-xs text-gray-500 border-t pt-4">
        <h4 className="font-semibold text-gray-700 mb-2">Terms & Conditions</h4>
        <p className="mb-1">• This estimate is valid for 30 days from the date above.</p>
        <p className="mb-1">• A 50% deposit is required to schedule the project.</p>
        <p className="mb-1">• Final balance due upon completion.</p>
        <p>• All work includes standard manufacturer warranty.</p>
      </div>

      {/* Signature Block */}
      <div className="mt-8 pt-6 border-t grid grid-cols-2 gap-8">
        <div>
          <div className="border-b border-gray-400 h-12 mb-2"></div>
          <p className="text-xs text-gray-500">Customer Signature</p>
        </div>
        <div>
          <div className="border-b border-gray-400 h-12 mb-2"></div>
          <p className="text-xs text-gray-500">Date</p>
        </div>
      </div>
    </div>
  );
};

export default EstimatePDFTemplate;
