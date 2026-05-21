interface Props {
  headline?: string;
  subheadline?: string;
  partnerName?: string | null;
}

export function PublicCompanySignupReferralHero({
  headline = "Referred to Pitch CRM by a contractor who uses it.",
  subheadline = "Run roofing and construction leads, estimates, jobs, documents, communications, and follow-up from one CRM built for contractors.",
  partnerName,
}: Props) {
  return (
    <header className="bg-gradient-to-b from-primary/10 via-background to-background py-16 px-4 text-center">
      <div className="mx-auto max-w-3xl space-y-6">
        {partnerName && (
          <p className="text-sm font-medium uppercase tracking-wider text-primary">
            Referred by {partnerName}
          </p>
        )}
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground">
          {headline}
        </h1>
        <p className="text-lg text-muted-foreground">{subheadline}</p>
      </div>
    </header>
  );
}

export default PublicCompanySignupReferralHero;
