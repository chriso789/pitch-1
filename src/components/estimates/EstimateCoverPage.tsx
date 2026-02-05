 /**
  * EstimateCoverPage - Professional cover page for estimate PDFs
  * 
  * A full-page cover that displays company branding, customer info,
  * and optional property photo for a polished presentation.
  */
 import React from 'react';
 
 // Letter size: 8.5" x 11" at 96 DPI = 816 x 1056 pixels
 const PAGE_WIDTH = 816;
 const PAGE_HEIGHT = 1056;
 
 interface CompanyInfo {
   name: string;
   logo_url?: string | null;
   phone?: string | null;
   email?: string | null;
   address_street?: string | null;
   address_city?: string | null;
   address_state?: string | null;
   address_zip?: string | null;
   license_number?: string | null;
 }
 
 interface EstimateCoverPageProps {
   companyInfo?: CompanyInfo;
   companyLogo?: string;
   companyName: string;
   customerName: string;
   customerAddress: string;
   estimateNumber: string;
   createdAt?: string;
   propertyPhoto?: string;
 }
 
 export const EstimateCoverPage: React.FC<EstimateCoverPageProps> = ({
   companyInfo,
   companyLogo,
   companyName,
   customerName,
   customerAddress,
   estimateNumber,
   createdAt,
   propertyPhoto,
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
 
   const companyAddressParts = [
     companyInfo?.address_street,
     [companyInfo?.address_city, companyInfo?.address_state].filter(Boolean).join(', '),
     companyInfo?.address_zip
   ].filter(Boolean);
   const companyAddressStr = companyAddressParts.join(' • ');
 
   const logoUrl = companyLogo || companyInfo?.logo_url;
 
   return (
     <div 
       data-report-page
       className="bg-white text-black flex flex-col"
       style={{ 
         width: `${PAGE_WIDTH}px`, 
         minHeight: `${PAGE_HEIGHT}px`,
         maxHeight: `${PAGE_HEIGHT}px`,
         fontFamily: 'Inter, system-ui, sans-serif',
         overflow: 'hidden'
       }}
     >
       {/* Top accent bar */}
       <div 
        className="w-full h-3 bg-primary"
       />
       
       {/* Main content area */}
       <div className="flex-1 flex flex-col items-center justify-between px-12 py-8">
         
         {/* Company Logo & Name Section */}
         <div className="text-center space-y-4 mt-4">
           {logoUrl && (
             <img 
               src={logoUrl} 
               alt={companyInfo?.name || companyName}
               className="h-20 object-contain mx-auto"
             />
           )}
           {!logoUrl && (
             <h1 className="text-3xl font-bold text-gray-900">
               {companyInfo?.name || companyName}
             </h1>
           )}
         </div>
 
         {/* Title Section */}
         <div className="text-center space-y-2 my-8">
           <p className="text-sm uppercase tracking-widest text-gray-500">Professional</p>
           <h2 className="text-5xl font-bold text-gray-900 tracking-tight">
             ROOFING ESTIMATE
           </h2>
          <div className="w-24 h-1 bg-primary mx-auto mt-4" />
         </div>
 
         {/* Customer Info Section */}
         <div className="text-center space-y-1 bg-gray-50 rounded-xl px-12 py-6 w-full max-w-lg">
           <p className="text-xs uppercase tracking-wider text-gray-500 mb-3">Prepared For</p>
           <h3 className="text-2xl font-semibold text-gray-900">{customerName}</h3>
           <p className="text-gray-600">{customerAddress}</p>
         </div>
 
         {/* Property Photo (if provided) */}
         {propertyPhoto && (
           <div className="w-full max-w-md rounded-xl overflow-hidden shadow-lg border border-gray-200 my-6">
             <img 
               src={propertyPhoto} 
               alt="Property" 
               className="w-full h-48 object-cover"
             />
           </div>
         )}
 
         {/* Estimate Meta */}
         <div className="flex gap-12 text-center my-4">
           <div>
             <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">Estimate #</p>
             <p className="text-lg font-semibold text-gray-900">{estimateNumber}</p>
           </div>
           <div>
             <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">Date</p>
             <p className="text-lg font-semibold text-gray-900">{dateStr}</p>
           </div>
         </div>
 
         {/* Company Footer Info */}
         <div className="text-center space-y-2 mt-auto pt-6 border-t border-gray-200 w-full">
           <p className="text-xs uppercase tracking-wider text-gray-500">Prepared By</p>
           <h4 className="text-lg font-semibold text-gray-900">
             {companyInfo?.name || companyName}
           </h4>
           {companyAddressStr && (
             <p className="text-sm text-gray-600">{companyAddressStr}</p>
           )}
           <div className="flex justify-center gap-4 text-sm text-gray-600">
             {companyInfo?.phone && <span>{companyInfo.phone}</span>}
             {companyInfo?.email && <span>{companyInfo.email}</span>}
           </div>
           {companyInfo?.license_number && (
             <p className="text-xs text-gray-500">License #{companyInfo.license_number}</p>
           )}
         </div>
       </div>
 
       {/* Bottom accent bar */}
       <div 
        className="w-full h-2 bg-primary"
       />
     </div>
   );
 };
 
 export default EstimateCoverPage;