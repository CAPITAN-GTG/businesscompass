import Link from "next/link";
import { defaultSource } from "@/lib/sources";
import {
  LosAngelesDataUnavailableError,
  withLaErrorHandling,
} from "@/lib/sources/losAngelesBusinesses";
import type { Business } from "@/lib/types/business";

export const dynamic = "force-dynamic";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <tr>
      <th
        style={{
          textAlign: "left",
          padding: "0.35rem 0.5rem 0.35rem 0",
          verticalAlign: "top",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </th>
      <td style={{ padding: "0.35rem 0" }}>{value ?? "—"}</td>
    </tr>
  );
}

export default async function BusinessDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);

  let business: Business | null = null;
  let unavailable = false;
  let notFound = false;

  try {
    business = await withLaErrorHandling(() =>
      defaultSource.getById(decoded),
    );
    if (!business) notFound = true;
  } catch (err) {
    if (err instanceof LosAngelesDataUnavailableError) {
      unavailable = true;
    } else {
      unavailable = true;
    }
  }

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "1rem",
        maxWidth: 800,
        margin: "0 auto",
      }}
    >
      <p>
        <Link href="/">← Back to list</Link>
      </p>

      {unavailable && (
        <p role="alert" style={{ color: "#a00" }}>
          Los Angeles business data is temporarily unavailable.
        </p>
      )}

      {notFound && !unavailable && (
        <p>Business not found for account {decoded}.</p>
      )}

      {business && (
        <>
          <h1 style={{ fontSize: "1.25rem" }}>
            {business.businessName ?? "(no business name)"}
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#444" }}>
            Source: City of Los Angeles Office of Finance
            <br />
            Type: {business.sourceType}
            <br />
            <a
              href={defaultSource.meta.officialUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Official Los Angeles Open Data dataset
            </a>
          </p>
          <p style={{ fontSize: "0.8rem", color: "#666" }}>
            Business Start Date is the first registered business activity at
            this location (Office of Finance), not legal entity formation with
            the California Secretary of State.
          </p>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.9rem",
              marginTop: "1rem",
            }}
          >
            <tbody>
              <Field label="Account Number" value={business.id} />
              <Field label="Business Name" value={business.businessName} />
              <Field label="DBA" value={business.dbaName} />
              <Field
                label="Business Start Date"
                value={formatDate(business.businessStartDate)}
              />
              <Field
                label="Business End Date"
                value={formatDate(business.businessEndDate)}
              />
              <Field label="Industry" value={business.industry} />
              <Field label="NAICS" value={business.naicsCode} />
              <Field label="Street Address" value={business.streetAddress} />
              <Field label="City" value={business.city} />
              <Field label="State" value={business.state} />
              <Field label="ZIP" value={business.zipCode} />
              <Field
                label="Location Description"
                value={business.locationDescription}
              />
              <Field label="Mailing Address" value={business.mailingAddress} />
              <Field label="Mailing City" value={business.mailingCity} />
              <Field label="Mailing ZIP" value={business.mailingZipCode} />
              <Field
                label="Council District"
                value={business.councilDistrict}
              />
              <Field label="Latitude" value={business.latitude} />
              <Field label="Longitude" value={business.longitude} />
              <Field label="Source" value={business.source} />
              <Field label="Source Type" value={business.sourceType} />
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
