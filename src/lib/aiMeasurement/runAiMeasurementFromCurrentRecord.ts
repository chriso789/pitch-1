import { supabase } from "@/integrations/supabase/client";

export type AiMeasurementRecord = {
  id: string;
  company_id?: string | null;

  property_address?: string | null;
  address?: string | null;
  full_address?: string | null;

  street?: string | null;
  street_address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  postal_code?: string | null;

  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
};

export type AiMeasurementRecordType = "lead" | "project";

export function buildPropertyAddress(record: AiMeasurementRecord) {
  const direct =
    record.property_address ||
    record.full_address ||
    record.address;

  if (direct && direct.trim().length > 0) {
    return direct.trim();
  }

  const street = record.street || record.street_address;
  const zip = record.zip || record.postal_code;

  const built = [street, record.city, record.state, zip]
    .filter(Boolean)
    .join(", ");

  return built.trim();
}

export async function runAiMeasurementFromCurrentRecord({
  record,
  recordType,
}: {
  record: AiMeasurementRecord;
  recordType: AiMeasurementRecordType;
}) {
  if (!record?.id) {
    throw new Error(`Missing ${recordType} id.`);
  }

  const propertyAddress = buildPropertyAddress(record);

  if (!propertyAddress) {
    throw new Error(
      "This lead/project is missing a property address. Add the property address before running AI Measurement."
    );
  }

  const latitude = record.latitude || record.lat || null;
  const longitude = record.longitude || record.lng || null;

  const body = {
    lead_id: recordType === "lead" ? record.id : null,
    project_id: recordType === "project" ? record.id : null,
    company_id: record.company_id || null,
    property_address: propertyAddress,
    latitude,
    longitude,
    waste_factor_percent: 10,
    image_width: 768,
    image_height: 768,
    zoom: 20,
  };

  const { data, error } = await supabase.functions.invoke("ai-measurement", {
    body,
  });

  if (error) {
    console.error("AI Measurement failed:", error);
    throw new Error(error.message || "AI Measurement failed.");
  }

  return data;
}
