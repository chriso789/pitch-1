import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createCentzInvoiceLink, type CentzLineInput } from "@/lib/centz";

interface PayWithCentzButtonProps {
  pitchId?: string;
  pipelineEntryId?: string;
  contactId?: string;
  invoiceNumber: string;
  amountCents: number;
  taxesCents?: number;
  customer?: {
    external_id?: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    mobile_phone?: string;
  };
  description?: string;
  lines?: CentzLineInput[];
  children?: React.ReactNode;
  disabled?: boolean;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
}

/**
 * Creates a Centz invoice (omits customer) and redirects the browser to the
 * returned Centz payment link for self-checkout. Card/ACH details are entered
 * on Centz — never inside PITCH.
 */
export function PayWithCentzButton({
  pitchId,
  pipelineEntryId,
  contactId,
  invoiceNumber,
  amountCents,
  taxesCents = 0,
  customer,
  description,
  lines,
  children,
  disabled,
  variant = "default",
  size = "default",
  className,
}: PayWithCentzButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (!(amountCents > 0)) {
      toast.error("Invalid amount");
      return;
    }
    setLoading(true);
    try {
      const { data, error, raw } = await createCentzInvoiceLink({
        pitch_id: pitchId,
        pipeline_entry_id: pipelineEntryId,
        contact_id: contactId,
        invoice_number: invoiceNumber,
        amount_cents: amountCents,
        taxes_cents: taxesCents,
        description,
        customer, // saved for record-keeping but not sent to Centz
        send_customer_to_centz: false,
        lines,
      });

      if (error || !data?.payment_link) {
        const code = (raw && "code" in raw && (raw as { code?: string }).code) || "";
        const msg =
          error ||
          (code === "centz_not_connected"
            ? "Centz isn't connected for this company yet. Ask an admin to add API credentials."
            : "Could not create Centz payment link.");
        toast.error(msg);
        return;
      }

      toast.success("Redirecting to Centz checkout…");
      window.location.href = data.payment_link;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={handleClick}
      disabled={disabled || loading}
      variant={variant}
      size={size}
      className={className}
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Loading…
        </>
      ) : (
        children ?? "Pay with Centz"
      )}
    </Button>
  );
}

export default PayWithCentzButton;
