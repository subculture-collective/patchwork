-- Public-source location evidence is independent of organization ownership.
CREATE TABLE public_resource_listings (
    resource_uri TEXT PRIMARY KEY,
    source_name TEXT NOT NULL,
    source_url TEXT NOT NULL CHECK (source_url ~ '^https://'),
    source_retrieved_at TIMESTAMPTZ NOT NULL,
    source_snapshot JSONB NOT NULL,
    source_expires_at TIMESTAMPTZ NOT NULL,
    street_address TEXT NOT NULL CHECK (char_length(street_address) BETWEEN 1 AND 300),
    postal_code TEXT NOT NULL CHECK (postal_code ~ '^[0-9]{5}$'),
    latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    public_access TEXT NOT NULL,
    listed BOOLEAN NOT NULL DEFAULT TRUE,
    claimed_by_organization_id UUID REFERENCES organizations(organization_id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public_resource_claims (
    claim_id UUID PRIMARY KEY,
    resource_uri TEXT NOT NULL REFERENCES public_resource_listings(resource_uri),
    organization_id UUID NOT NULL REFERENCES organizations(organization_id),
    applicant_did TEXT NOT NULL,
    evidence TEXT NOT NULL CHECK (char_length(evidence) BETWEEN 20 AND 2000),
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'revoked')),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ,
    decided_by_did TEXT,
    decision_reason TEXT
);
CREATE UNIQUE INDEX public_resource_pending_claim
    ON public_resource_claims (resource_uri, organization_id) WHERE status = 'pending';
CREATE UNIQUE INDEX public_resource_approved_claim
    ON public_resource_claims (resource_uri) WHERE status = 'approved';
CREATE TABLE public_resource_audit_events (
    audit_id BIGSERIAL PRIMARY KEY,
    resource_uri TEXT NOT NULL,
    actor_did TEXT NOT NULL,
    action TEXT NOT NULL,
    details JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE VIEW eligible_public_resource_addresses AS
SELECT e.resource_uri, e.street_address, e.latitude, e.longitude,
    e.approval_expires_at AS valid_until, 'reviewed'::text AS basis, NULL::text AS source_url
FROM exact_public_address_requests e
WHERE e.status='approved' AND NOT e.confidential_facility AND e.approval_expires_at>NOW()
AND EXISTS(SELECT 1 FROM verification_applications v WHERE v.subject_type='organization'
    AND v.organization_id=e.organization_id AND v.subject_ref=e.organization_id::text AND v.status='approved' AND v.expires_at>NOW())
AND EXISTS(SELECT 1 FROM verification_applications v WHERE v.subject_type='resource'
    AND v.organization_id=e.organization_id AND v.subject_ref=e.resource_uri AND v.status='approved' AND v.expires_at>NOW())
AND EXISTS(SELECT 1 FROM organization_resource_stewardships s WHERE s.organization_id=e.organization_id
    AND s.resource_uri=e.resource_uri AND s.status='active')
UNION ALL
SELECT resource_uri, street_address, latitude, longitude, source_expires_at,
    'public-source'::text, source_url
FROM public_resource_listings WHERE listed AND source_expires_at>NOW();
