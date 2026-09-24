-- Removing an organization must not remove a public place or block account deletion.
ALTER TABLE public_resource_listings
    DROP CONSTRAINT public_resource_listings_claimed_by_organization_id_fkey,
    ADD CONSTRAINT public_resource_listings_claimed_by_organization_id_fkey
        FOREIGN KEY (claimed_by_organization_id) REFERENCES organizations(organization_id)
        ON DELETE SET NULL;
ALTER TABLE public_resource_claims
    DROP CONSTRAINT public_resource_claims_organization_id_fkey,
    ADD CONSTRAINT public_resource_claims_organization_id_fkey
        FOREIGN KEY (organization_id) REFERENCES organizations(organization_id)
        ON DELETE CASCADE;
