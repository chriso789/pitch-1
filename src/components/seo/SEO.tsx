import { Helmet } from "react-helmet-async";

interface SEOProps {
  title: string;
  description: string;
  path: string;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  noindex?: boolean;
  ogType?: "website" | "article" | "profile" | "product";
  ogImage?: string;
}

const SITE_URL = "https://pitch-crm.ai";

export function SEO({ title, description, path, jsonLd, noindex, ogType = "website", ogImage }: SEOProps) {
  const url = `${SITE_URL}${path}`;
  const absoluteOgImage = ogImage
    ? ogImage.startsWith("http")
      ? ogImage
      : `${SITE_URL}${ogImage}`
    : undefined;
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:type" content={ogType} />
      {absoluteOgImage && <meta property="og:image" content={absoluteOgImage} />}
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:card" content={absoluteOgImage ? "summary_large_image" : "summary"} />
      {absoluteOgImage && <meta name="twitter:image" content={absoluteOgImage} />}
      {noindex && <meta name="robots" content="noindex,nofollow" />}
      {jsonLd && (
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      )}
    </Helmet>
  );
}
