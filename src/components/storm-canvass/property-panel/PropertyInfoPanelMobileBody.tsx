/**
 * PropertyInfoPanelMobileBody — iPhone/iPad/Field-Mode layout for the
 * canvass property bottom sheet.
 *
 * This component is pure presentation. All state, handlers, and Supabase
 * calls live in the parent `PropertyInfoPanel` and are passed in as props.
 * Switching between mobile and desktop layouts is a JSX swap only — nothing
 * about business logic changes.
 *
 * Layout:
 *   A. Sticky header (owner / address / distance / disposition)
 *   B. Sticky quick-actions row (Call / Navigate / Photo / Add Customer / More)
 *   C. Disposition strip (horizontal chips, h-11)
 *   D. Contact info (top 2 phones + 1 email, expand for more, DNC marked)
 *   E. Property intel (collapsed accordion)
 *   F. Field tools (collapsed accordion, 3-col icon grid, h-16)
 *   G. AI strategy + storm reports + score (collapsed accordions)
 *   H. Notes (collapsed by default)
 */
import { useState } from "react";
import {
  Phone,
  Mail,
  MapPin,
  Navigation,
  User,
  Plus,
  Camera,
  Calculator,
  Cloud,
  Sun,
  Compass,
  Brain,
  StickyNote,
  Sparkles,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  PhoneOff,
  MoreHorizontal,
  ChevronDown,
  TrendingUp,
  Building2,
  HardHat,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { haptic, openNativeCamera, openNativeMaps } from "@/utils/nativeBridge";

interface Disposition {
  id: string;
  label: string;
  icon: any;
  color: string;
  bgColor: string;
}

interface Props {
  // Identity & address
  ownerName: string;
  fullAddress: string;
  primaryOwner: any;

  // Property state
  localProperty: any;
  property: any;
  propertyLat: number;
  propertyLng: number;

  // Verification
  verification: {
    badgeVariant: any;
    badgeText: string;
    isWithinRange: boolean;
    isWarning: boolean;
    isBlocked: boolean;
  };

  // Contact data
  phoneNumbers: any[];
  emails: any[];

  // Loading / error flags
  publicLookupLoading: boolean;
  enriching: boolean;
  skipTraceError: string | null;

  // AI / scoring
  doorStrategy: any;
  generatingStrategy: boolean;
  pipelineScores: any;

  // Notes
  notes: string;
  setNotes: (v: string) => void;

  // Dispositions
  dispositions: Disposition[];
  getDispositionBgColor: (d: string) => string;

  // Handlers (unchanged from parent — never modify business logic here)
  onDisposition: (id: string) => void;
  onCall: (phone: string) => void;
  onEmail: (email: string) => void;
  onNavigate: () => void;
  onAddCustomer: (manual?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
  }) => void;
  onSkipTrace: () => void;
  onPhoto: () => void;
  onFastEstimate: () => void;
  onInspection: () => void;
  onStormReports: () => void;
  onGenerateStrategy: () => void;
  onGoogleSun: () => void;
}

export default function PropertyInfoPanelMobileBody(props: Props) {
  const {
    ownerName,
    fullAddress,
    primaryOwner,
    localProperty,
    property,
    propertyLat,
    propertyLng,
    verification,
    phoneNumbers,
    emails,
    publicLookupLoading,
    enriching,
    skipTraceError,
    doorStrategy,
    generatingStrategy,
    pipelineScores,
    notes,
    setNotes,
    dispositions,
    getDispositionBgColor,
    onDisposition,
    onCall,
    onEmail,
    onNavigate,
    onAddCustomer,
    onSkipTrace,
    onPhoto,
    onFastEstimate,
    onInspection,
    onStormReports,
    onGenerateStrategy,
    onGoogleSun,
  } = props;

  const [showAllContact, setShowAllContact] = useState(false);
  const [showFullStrategy, setShowFullStrategy] = useState(false);
  const [manualFirstName, setManualFirstName] = useState("");
  const [manualLastName, setManualLastName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualEmail, setManualEmail] = useState("");

  const hasManualEntry = Boolean(
    manualFirstName.trim() || manualLastName.trim() || manualPhone.trim() || manualEmail.trim(),
  );

  const handleAddCustomerClick = () => {
    if (hasManualEntry) {
      onAddCustomer({
        firstName: manualFirstName.trim() || undefined,
        lastName: manualLastName.trim() || undefined,
        phone: manualPhone.trim() || undefined,
        email: manualEmail.trim() || undefined,
      });
    } else {
      onAddCustomer();
    }
  };

  const propData = localProperty?.property_data || {};
  const confidence: number | undefined = propData.confidence_score;
  const hasPhone = (phoneNumbers?.length ?? 0) > 0;
  const hasEmail = (emails?.length ?? 0) > 0;
  const hasContact = hasPhone || hasEmail;

  const sortedPhones = hasPhone
    ? [...phoneNumbers].sort((a: any, b: any) => {
        const aDnc = typeof a === "object" && a.dnc === true ? 1 : 0;
        const bDnc = typeof b === "object" && b.dnc === true ? 1 : 0;
        return aDnc - bDnc;
      })
    : [];
  const visiblePhones = showAllContact ? sortedPhones : sortedPhones.slice(0, 2);
  const visibleEmails = showAllContact ? emails : emails?.slice(0, 1) ?? [];

  // Quick-action handlers wrap parent handlers with native bridge + haptics.
  const handleQuickPhoto = async () => {
    const res = await openNativeCamera();
    if (!res.ok) onPhoto();
  };
  const handleQuickNavigate = async () => {
    if (propertyLat && propertyLng) {
      await openNativeMaps(propertyLat, propertyLng, fullAddress);
    }
    onNavigate();
  };
  const handleDispositionTap = (id: string) => {
    onDisposition(id);
    void haptic("success");
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* A. Sticky Header */}
      <div className="sticky top-0 z-20 bg-background border-b px-4 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <User className="h-5 w-5 text-primary flex-shrink-0" />
              <h2 className="font-semibold text-base leading-tight truncate">
                {ownerName}
              </h2>
              {primaryOwner?.age && (
                <Badge variant="outline" className="text-[10px] font-normal px-1.5 py-0">
                  Age {primaryOwner.age}
                </Badge>
              )}
              {publicLookupLoading && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
              <MapPin className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span className="leading-snug">{fullAddress}</span>
            </p>
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <Badge
                variant={verification.badgeVariant}
                className={cn(
                  "text-[10px] h-5",
                  verification.isWithinRange && "bg-green-500 hover:bg-green-600 text-white",
                  verification.isWarning && "bg-yellow-500 hover:bg-yellow-600 text-black",
                  verification.isBlocked && "bg-red-500 hover:bg-red-600 text-white",
                )}
              >
                {verification.isWithinRange && <ShieldCheck className="h-3 w-3 mr-0.5" />}
                {verification.isBlocked && <ShieldAlert className="h-3 w-3 mr-0.5" />}
                {verification.badgeText}
              </Badge>
              {property.disposition && (
                <Badge
                  className={cn(
                    "text-white text-[10px] h-5",
                    getDispositionBgColor(property.disposition),
                  )}
                >
                  {property.disposition.replace(/_/g, " ")}
                </Badge>
              )}
              {confidence != null && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] h-5",
                    confidence >= 80 && "bg-green-50 text-green-700 border-green-300",
                    confidence >= 60 &&
                      confidence < 80 &&
                      "bg-yellow-50 text-yellow-700 border-yellow-300",
                    confidence < 60 && "bg-red-50 text-red-700 border-red-300",
                  )}
                >
                  {confidence}%
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* B. Sticky Quick Actions */}
      <div className="sticky top-[88px] z-10 bg-background border-b px-3 py-2 flex-shrink-0">
        <div className="grid grid-cols-5 gap-1.5">
          <QuickAction
            icon={Phone}
            label="Call"
            onClick={() => {
              const first = sortedPhones[0];
              const num = typeof first === "string" ? first : first?.number;
              const isDnc = typeof first === "object" && first?.dnc === true;
              if (num && !isDnc) onCall(num);
            }}
            disabled={!hasPhone}
            tone="primary"
          />
          <QuickAction
            icon={Navigation}
            label="Navigate"
            onClick={handleQuickNavigate}
            tone="default"
          />
          <QuickAction
            icon={Camera}
            label="Photo"
            onClick={handleQuickPhoto}
            tone="default"
          />
          <QuickAction
            icon={Plus}
            label="Add"
            onClick={onAddCustomer}
            tone="success"
          />
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex flex-col items-center justify-center h-12 rounded-lg bg-muted/60 active:bg-muted text-foreground gap-0.5"
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="text-[10px] leading-none">More</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1">
              <button
                className="w-full text-left text-sm px-3 py-2 rounded hover:bg-muted flex items-center gap-2"
                onClick={onFastEstimate}
              >
                <Calculator className="h-4 w-4 text-purple-500" /> Fast Estimate
              </button>
              <button
                className="w-full text-left text-sm px-3 py-2 rounded hover:bg-muted flex items-center gap-2"
                onClick={onInspection}
              >
                <Camera className="h-4 w-4 text-teal-500" /> Inspection
              </button>
              <button
                className="w-full text-left text-sm px-3 py-2 rounded hover:bg-muted flex items-center gap-2"
                onClick={onStormReports}
              >
                <Cloud className="h-4 w-4 text-blue-500" /> Storm Reports
              </button>
              <button
                className="w-full text-left text-sm px-3 py-2 rounded hover:bg-muted flex items-center gap-2"
                onClick={onGoogleSun}
              >
                <Sun className="h-4 w-4 text-yellow-500" /> Google Sun
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Scrollable body */}
      <div
        className="flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-6"
        style={{ WebkitOverflowScrolling: "touch" } as any}
      >
        {/* C. Disposition strip */}
        <div className="mb-4">
          <p className="text-[11px] font-medium text-muted-foreground mb-1.5 px-1">
            Set Disposition
          </p>
          <div className="overflow-x-auto -mx-3 px-3">
            <div className="flex gap-2 pb-1 min-w-max">
              {dispositions.map((disp) => {
                const Icon = disp.icon;
                const isSelected = property.disposition === disp.id;
                return (
                  <button
                    key={disp.id}
                    type="button"
                    onClick={() => handleDispositionTap(disp.id)}
                    className={cn(
                      "flex-shrink-0 flex items-center gap-1.5 h-11 px-3.5 rounded-full border-2 text-xs font-medium transition-colors",
                      isSelected
                        ? `${disp.bgColor} text-white border-transparent`
                        : `bg-background ${disp.color}`,
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="whitespace-nowrap">{disp.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* D. Contact info */}
        {hasContact ? (
          <div className="mb-4 rounded-lg border bg-card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium text-muted-foreground">Contact</p>
              {(sortedPhones.length > 2 || (emails?.length ?? 0) > 1) && (
                <button
                  type="button"
                  className="text-[11px] text-primary"
                  onClick={() => setShowAllContact((v) => !v)}
                >
                  {showAllContact ? "Show less" : "Show all"}
                </button>
              )}
            </div>
            {visiblePhones.map((phone: any, idx: number) => {
              const num = typeof phone === "string" ? phone : phone.number;
              const phoneType = typeof phone === "object" ? phone.type : null;
              const isDnc = typeof phone === "object" && phone.dnc === true;
              return (
                <button
                  key={`p-${idx}`}
                  type="button"
                  disabled={isDnc}
                  onClick={() => onCall(num)}
                  className={cn(
                    "w-full flex items-center justify-between rounded-md border px-3 h-11 text-sm",
                    isDnc
                      ? "opacity-50 line-through cursor-not-allowed bg-muted/40"
                      : "bg-background active:bg-muted",
                  )}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {isDnc ? (
                      <PhoneOff className="h-4 w-4 text-destructive flex-shrink-0" />
                    ) : (
                      <Phone className="h-4 w-4 text-primary flex-shrink-0" />
                    )}
                    <span className="truncate">{num}</span>
                    {phoneType && phoneType !== "Unknown" && (
                      <span className="text-[10px] text-muted-foreground">({phoneType})</span>
                    )}
                  </span>
                  {isDnc && (
                    <Badge variant="destructive" className="text-[9px] h-5 px-1">
                      DNC
                    </Badge>
                  )}
                </button>
              );
            })}
            {visibleEmails.map((email: any, idx: number) => {
              const addr = typeof email === "string" ? email : email.address;
              return (
                <button
                  key={`e-${idx}`}
                  type="button"
                  onClick={() => onEmail(addr)}
                  className="w-full flex items-center gap-2 rounded-md border px-3 h-11 text-sm active:bg-muted"
                >
                  <Mail className="h-4 w-4 text-primary flex-shrink-0" />
                  <span className="truncate">{addr}</span>
                </button>
              );
            })}
          </div>
        ) : !publicLookupLoading ? (
          <div className="mb-4 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 p-4 text-center">
            <Phone className="h-5 w-5 mx-auto text-primary/60 mb-1.5" />
            <p className="text-xs text-muted-foreground mb-2">
              Phone & email require a skip-trace lookup
            </p>
            <Button
              size="sm"
              className="gap-1.5 h-10"
              onClick={onSkipTrace}
              disabled={enriching}
            >
              {enriching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {enriching ? "Looking up…" : "Get Contact Info"}
            </Button>
            {skipTraceError && (
              <p className="text-[10px] text-destructive mt-2">{skipTraceError}</p>
            )}
          </div>
        ) : null}

        {skipTraceError && hasContact === false && !enriching && (
          <Alert variant="destructive" className="mb-4 py-2">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs flex items-center justify-between">
              <span>{skipTraceError}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs ml-2"
                onClick={onSkipTrace}
              >
                <RefreshCw className="h-3 w-3 mr-1" /> Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* E/F/G. Collapsibles */}
        <Accordion type="multiple" className="space-y-2">
          <AccordionItem value="intel" className="border rounded-lg bg-card px-3">
            <AccordionTrigger className="text-sm py-3 hover:no-underline">
              Property Intel
            </AccordionTrigger>
            <AccordionContent className="pb-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <IntelRow label="APN" value={propData.parcel_id} />
                <IntelRow
                  label="Living sqft"
                  value={propData.living_sqft?.toLocaleString()}
                />
                <IntelRow label="Year built" value={propData.year_built} />
                <IntelRow
                  label="Assessed"
                  value={
                    propData.assessed_value
                      ? `$${Number(propData.assessed_value).toLocaleString()}`
                      : undefined
                  }
                />
                <IntelRow
                  label="Lot size"
                  value={propData.lot_size?.toLocaleString?.()}
                />
                <IntelRow
                  label="Homestead"
                  value={propData.homestead ? "Yes" : undefined}
                />
              </div>
              {Array.isArray(propData.sources) && propData.sources.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {propData.sources.map((s: string) => (
                    <Badge
                      key={s}
                      variant="outline"
                      className="text-[9px] h-4 px-1 bg-green-50 text-green-700 border-green-200"
                    >
                      ✔ {s}
                    </Badge>
                  ))}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="tools" className="border rounded-lg bg-card px-3">
            <AccordionTrigger className="text-sm py-3 hover:no-underline">
              Field Tools
            </AccordionTrigger>
            <AccordionContent className="pb-3">
              <div className="grid grid-cols-3 gap-2">
                <ToolButton icon={Cloud} label="Storm" color="text-blue-500" onClick={onStormReports} />
                <ToolButton icon={Sun} label="Google Sun" color="text-yellow-500" onClick={onGoogleSun} />
                <ToolButton icon={Compass} label="Directions" color="text-green-500" onClick={handleQuickNavigate} />
                <ToolButton icon={Calculator} label="Fast Est." color="text-purple-500" onClick={onFastEstimate} />
                <ToolButton icon={Camera} label="Photo" color="text-orange-500" onClick={handleQuickPhoto} />
                <ToolButton
                  icon={generatingStrategy ? Loader2 : Brain}
                  label={generatingStrategy ? "AI…" : "Strategy"}
                  color="text-primary"
                  onClick={onGenerateStrategy}
                  spinning={generatingStrategy}
                />
                <ToolButton icon={Camera} label="Inspection" color="text-teal-500" onClick={onInspection} />
              </div>
            </AccordionContent>
          </AccordionItem>

          {doorStrategy && (
            <AccordionItem value="strategy" className="border rounded-lg bg-card px-3">
              <AccordionTrigger className="text-sm py-3 hover:no-underline">
                <span className="flex items-center gap-2">
                  <Brain className="h-4 w-4 text-primary" /> AI Door Strategy
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-[10px]">
                    {doorStrategy.angle}
                  </Badge>
                  <button
                    type="button"
                    className="text-[11px] text-primary"
                    onClick={() => setShowFullStrategy((v) => !v)}
                  >
                    {showFullStrategy ? "Hide details" : "View details"}
                  </button>
                </div>
                <p className="text-xs leading-relaxed">{doorStrategy.opener}</p>
                {showFullStrategy && doorStrategy.objections?.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <p className="text-[10px] font-medium text-muted-foreground">
                      Objections
                    </p>
                    {doorStrategy.objections.map((obj: any, i: number) => (
                      <div key={i} className="text-[11px] pl-2 border-l-2 border-primary/30">
                        <p className="font-medium">"{obj.objection}"</p>
                        <p className="text-muted-foreground">→ {obj.response}</p>
                      </div>
                    ))}
                  </div>
                )}
                {doorStrategy.next_action && (
                  <p className="text-[10px] text-muted-foreground pt-1 border-t">
                    Next: {String(doorStrategy.next_action).replace(/_/g, " ")}
                  </p>
                )}
              </AccordionContent>
            </AccordionItem>
          )}

          {pipelineScores && (
            <AccordionItem value="scores" className="border rounded-lg bg-card px-3">
              <AccordionTrigger className="text-sm py-3 hover:no-underline">
                Lead Scores
              </AccordionTrigger>
              <AccordionContent className="pb-3">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Equity", data: pipelineScores.equity, icon: TrendingUp, color: "text-green-600" },
                    { label: "Absentee", data: pipelineScores.absentee, icon: Building2, color: "text-blue-600" },
                    { label: "Roof Age", data: pipelineScores.roof_age, icon: HardHat, color: "text-orange-600" },
                  ].map(({ label, data, icon: Icon, color }) => (
                    <div key={label} className="border rounded-lg p-2 text-center bg-background">
                      <Icon className={cn("h-4 w-4 mx-auto mb-1", color)} />
                      <p className="text-base font-bold leading-none">{data?.score ?? "—"}</p>
                      <p className="text-[9px] text-muted-foreground mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          <AccordionItem value="notes" className="border rounded-lg bg-card px-3">
            <AccordionTrigger className="text-sm py-3 hover:no-underline">
              <span className="flex items-center gap-2">
                <StickyNote className="h-4 w-4" /> Notes
                {notes?.trim() && (
                  <Badge variant="secondary" className="text-[9px] h-4 px-1">
                    {notes.trim().length} chars
                  </Badge>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-3">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes about this property…"
                className="min-h-[100px] text-sm"
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
}

// ---------- helpers ----------

function QuickAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  tone,
}: {
  icon: any;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "success" | "default";
}) {
  const toneCls =
    tone === "primary"
      ? "bg-primary text-primary-foreground active:bg-primary/90"
      : tone === "success"
      ? "bg-green-600 text-white active:bg-green-700"
      : "bg-muted/60 text-foreground active:bg-muted";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col items-center justify-center h-12 rounded-lg gap-0.5 disabled:opacity-40 disabled:cursor-not-allowed",
        toneCls,
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="text-[10px] leading-none">{label}</span>
    </button>
  );
}

function IntelRow({ label, value }: { label: string; value?: any }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-muted/40 px-2 py-1.5">
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-xs font-medium truncate">{value ?? "—"}</span>
    </div>
  );
}

function ToolButton({
  icon: Icon,
  label,
  color,
  onClick,
  spinning,
}: {
  icon: any;
  label: string;
  color: string;
  onClick: () => void;
  spinning?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center h-16 rounded-lg border bg-background active:bg-muted gap-1"
    >
      <Icon className={cn("h-5 w-5", color, spinning && "animate-spin")} />
      <span className="text-[10px]">{label}</span>
    </button>
  );
}
