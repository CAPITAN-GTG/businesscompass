"use client";

import { useState } from "react";
import type { Business, BusinessEnrichment } from "@/lib/types/business";

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

export function formatOneLineAddress(parts: {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string | null {
  const street = parts.street?.trim() || "";
  const city = parts.city?.trim() || "";
  const state = parts.state?.trim() || "";
  const zip = parts.zip?.trim() || "";
  const cityStateZip = [city, [state, zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const line = [street, cityStateZip].filter(Boolean).join(", ");
  return line || null;
}

export function DetailField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="detail-field">
      <dt>{label}</dt>
      <dd>{value && value.trim() !== "" ? value : "—"}</dd>
    </div>
  );
}

export function DetailAddressField({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const display = value && value.trim() !== "" ? value : null;

  async function copyAddress() {
    if (!display) return;
    try {
      await navigator.clipboard.writeText(display);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  }

  return (
    <div className="detail-field detail-address-field">
      <dt>{label}</dt>
      <dd>
        <span className="detail-address-text">{display ?? "—"}</span>
        {display ? (
          <button
            type="button"
            className="detail-copy"
            onClick={() => void copyAddress()}
            aria-label={copied ? "Copied" : `Copy ${label.toLowerCase()}`}
            title={copied ? "Copied" : "Copy"}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </dd>
    </div>
  );
}

function ContactBlock({
  enrichment,
  failed,
}: {
  enrichment: BusinessEnrichment | null;
  failed: boolean;
}) {
  if (!enrichment) {
    if (failed) return null;
    return <p className="detail-contact-status">Looking up public phone…</p>;
  }

  if (enrichment.status === "unavailable") {
    return (
      <p className="detail-contact-status">Phone lookup is temporarily unavailable.</p>
    );
  }

  if (enrichment.status === "matched" && (enrichment.phone || enrichment.website)) {
    return (
      <div className="detail-contact">
        {enrichment.phone ? (
          <a className="detail-link" href={`tel:${enrichment.phone}`}>
            {enrichment.phoneDisplay ?? enrichment.phone}
          </a>
        ) : (
          <p className="detail-contact-status">No public phone number found.</p>
        )}
        {enrichment.website ? (
          <a
            className="detail-link"
            href={enrichment.website}
            target="_blank"
            rel="noopener noreferrer"
          >
            {displayHost(enrichment.website)}
          </a>
        ) : null}
        <p className="detail-source-note">Public listing from OpenStreetMap</p>
      </div>
    );
  }

  return <p className="detail-contact-status">No public phone number found.</p>;
}

function displayHost(website: string): string {
  try {
    return new URL(website).host.replace(/^www\./, "");
  } catch {
    return website;
  }
}

export function BusinessDetailPanel({
  selected,
  ageColor,
  detailLoading,
  detailError,
  enrichment,
  showAdvanced,
  setShowAdvanced,
  onClose,
  className,
}: {
  selected: Business;
  ageColor: string | null;
  detailLoading: boolean;
  detailError: string | null;
  enrichment: BusinessEnrichment | null;
  showAdvanced: boolean;
  setShowAdvanced: (value: boolean | ((v: boolean) => boolean)) => void;
  onClose: () => void;
  className?: string;
}) {
  return (
    <div className={className ? `detail ${className}` : "detail"}>
      <button type="button" className="detail-back" onClick={onClose}>
        ← Back
      </button>

      <header className="detail-header">
        {ageColor ? (
          <span
            className="detail-pin-swatch"
            style={{ background: ageColor }}
            aria-hidden
          />
        ) : null}
        <div>
          <h1 className="detail-title">
            {selected.businessName ?? "Unnamed business"}
          </h1>
          {selected.dbaName ? (
            <p className="detail-dba">DBA: {selected.dbaName}</p>
          ) : null}
        </div>
      </header>

      {detailLoading ? <p className="meta">Loading full details…</p> : null}
      {detailError ? (
        <p className="error" role="alert">
          {detailError}
        </p>
      ) : null}

      <section className="detail-section">
        <h2 className="detail-section-title">Identity</h2>
        <dl className="detail-section-body">
          <DetailField label="Account #" value={selected.id} />
          <DetailField label="Legal name" value={selected.businessName} />
          <DetailField label="DBA" value={selected.dbaName} />
        </dl>
      </section>

      {!detailError || enrichment ? (
        <section className="detail-section">
          <h2 className="detail-section-title">Contact</h2>
          <div className="detail-section-body">
            <ContactBlock enrichment={enrichment} failed={Boolean(detailError)} />
          </div>
        </section>
      ) : null}

      <section className="detail-section">
        <h2 className="detail-section-title">Dates</h2>
        <dl className="detail-section-body">
          <DetailField
            label="Start date"
            value={formatDate(selected.businessStartDate)}
          />
        </dl>
      </section>

      <section className="detail-section">
        <h2 className="detail-section-title">Industry</h2>
        <dl className="detail-section-body">
          <DetailField label="Industry" value={selected.industry} />
        </dl>
      </section>

      <section className="detail-section">
        <h2 className="detail-section-title">Location</h2>
        <dl className="detail-section-body">
          <DetailAddressField
            label="Address"
            value={formatOneLineAddress({
              street: selected.streetAddress,
              city: selected.city,
              state: selected.state,
              zip: selected.zipCode,
            })}
          />
        </dl>
      </section>

      <section className="detail-section">
        <h2 className="detail-section-title">Mailing</h2>
        <dl className="detail-section-body">
          <DetailAddressField
            label="Address"
            value={formatOneLineAddress({
              street: selected.mailingAddress,
              city: selected.mailingCity,
              zip: selected.mailingZipCode,
            })}
          />
        </dl>
      </section>

      <div className="detail-advanced">
        <button
          type="button"
          className="detail-advanced-toggle"
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          Advanced {showAdvanced ? "▴" : "▾"}
        </button>
        {showAdvanced ? (
          <dl className="detail-section-body detail-advanced-body">
            <DetailField
              label="Location note"
              value={selected.locationDescription}
            />
            <DetailField
              label="End date"
              value={formatDate(selected.businessEndDate)}
            />
            <DetailField label="NAICS" value={selected.naicsCode} />
            <DetailField
              label="Council district"
              value={selected.councilDistrict}
            />
            <DetailField label="Latitude" value={selected.latitude} />
            <DetailField label="Longitude" value={selected.longitude} />
            <DetailField label="Source" value={selected.source} />
            <DetailField label="Type" value={selected.sourceType} />
          </dl>
        ) : null}
      </div>

      <p className="detail-note">
        Start date is first registered location activity (Office of Finance),
        not California Secretary of State formation.
      </p>
    </div>
  );
}
