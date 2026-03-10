import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet, FileText, Palette, Facebook, ExternalLink } from "lucide-react";
import { downloadFacebookCatalogCSV, downloadAdCopyPack, downloadBrandGuidelines } from "@/lib/marketing-export";
import { toast } from "sonner";
import { BRAND } from "@/lib/branding/legal";

const assets = [
  {
    title: "Facebook Product Catalog (CSV)",
    description: "Upload to Facebook Commerce Manager. Contains all PITCH CRM features formatted as catalog items with id, title, description, link, and brand fields.",
    icon: FileSpreadsheet,
    filename: "pitch-crm-facebook-catalog.csv",
    action: () => { downloadFacebookCatalogCSV(); toast.success("Catalog CSV downloaded"); },
    badge: "Facebook Ready",
  },
  {
    title: "Facebook Ad Copy Pack",
    description: "5 ready-to-use campaign templates — Awareness, Feature Demo, Testimonial, Cost Savings, and Free Trial — with headlines, primary text, and CTAs.",
    icon: FileText,
    filename: "pitch-crm-facebook-ad-copy.txt",
    action: () => { downloadAdCopyPack(); toast.success("Ad copy pack downloaded"); },
    badge: "5 Campaigns",
  },
  {
    title: "Brand Guidelines",
    description: "Colors, typography, logo usage rules, tone of voice, and legal trademark notices for consistent branding across all marketing channels.",
    icon: Palette,
    filename: "pitch-crm-brand-guidelines.txt",
    action: () => { downloadBrandGuidelines(); toast.success("Brand guidelines downloaded"); },
    badge: "Style Guide",
  },
];

const MarketingAssetsPage = () => {
  const handleDownloadAll = () => {
    downloadFacebookCatalogCSV();
    setTimeout(() => downloadAdCopyPack(), 300);
    setTimeout(() => downloadBrandGuidelines(), 600);
    toast.success("All marketing assets downloading");
  };

  return (
    <GlobalLayout>
      <div className="space-y-6 p-4 md:p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Facebook className="h-6 w-6 text-primary" />
              Marketing Assets
            </h1>
            <p className="text-muted-foreground mt-1">
              Download promotional files for Facebook, Instagram, and social media campaigns.
            </p>
          </div>
          <Button onClick={handleDownloadAll} className="gap-2">
            <Download className="h-4 w-4" />
            Download All
          </Button>
        </div>

        {/* Quick guide */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm text-foreground mb-2">📋 Quick Upload Guide</h3>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Download the <strong>Product Catalog CSV</strong> below</li>
              <li>Go to <strong>Facebook Commerce Manager → Catalog → Data Sources</strong></li>
              <li>Select <strong>"Upload file"</strong> and choose the CSV</li>
              <li>Map the columns (they're already named to Facebook's spec)</li>
              <li>Create a <strong>Dynamic Ad</strong> using your new catalog</li>
            </ol>
          </CardContent>
        </Card>

        {/* Asset cards */}
        <div className="grid gap-4">
          {assets.map((asset) => (
            <Card key={asset.title} className="hover:border-primary/30 transition-colors">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <asset.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{asset.title}</CardTitle>
                      <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                        {asset.badge}
                      </span>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={asset.action} className="gap-2 shrink-0">
                    <Download className="h-3.5 w-3.5" />
                    {asset.filename}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <CardDescription>{asset.description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Footer */}
        <p className="text-xs text-muted-foreground text-center pt-4">
          {BRAND.copyright} &middot; {BRAND.trademarkShort}
        </p>
      </div>
    </GlobalLayout>
  );
};

export default MarketingAssetsPage;
