import { ResourceProfileEditor } from "./resource-profile-editor";
import { resourceProfileSchema } from "@patchwork/shared";
import { useState } from "react";
import { useLocale } from "../i18n";
import { Button } from "../components/Button";
import { Panel } from "../components/Panel";
import type { ResourceDetail } from "../resource-directory-ux";
import {
  fetchResourceViaApi,
  fetchMyOrganizationsViaApi,
  submitPublicResourceClaimViaApi,
  listPublicResourceClaimsViaApi,
  decidePublicResourceClaimViaApi,
  editPublicResourceViaApi,
  type MyOrganization,
} from "./api-client";

export function PublicResourceClaim({
  resource,
}: {
  resource: ResourceDetail;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [organizations, setOrganizations] = useState<MyOrganization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [evidence, setEvidence] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const start = async () => {
    setOpen(true);
    setBusy(true);
    setMessage("");
    setLoadFailed(false);
    const result = await fetchMyOrganizationsViaApi();
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      setLoadFailed(true);
      return;
    }
    const eligible = result.data.filter((item) =>
      ["owner", "admin"].includes(item.membership.role),
    );
    setOrganizations(eligible);
    setOrganizationId(eligible[0]?.id ?? "");
  };
  if (!resource.publicListing) return null;
  return (
    <div className="space-y-2 border-t border-mh-borderSoft pt-3">
      <p className="text-sm">
        {resource.publicListing.claimStatus === "claimed"
          ? t("claims.claimed")
          : t("claims.unclaimed")}{" "}
        ·{" "}
        <a
          className="underline"
          href={resource.publicListing.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("claims.source")}
        </a>
      </p>
      <p className="text-xs text-mh-textMuted">{t("claims.disclaimer")}</p>
      {resource.publicListing.claimStatus === "unclaimed" && !open && (
        <Button variant="neutral" onClick={() => void start()}>
          {t("claims.claim")}
        </Button>
      )}
      {resource.publicListing.claimStatus === "claimed" && (
        <a className="underline" href="/organizations">
          {t("claims.manage")}
        </a>
      )}
      {open && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setMessage("");
            void submitPublicResourceClaimViaApi({
              resourceUri: resource.uri,
              organizationId,
              evidence,
            }).then((result) => {
              setBusy(false);
              setMessage(result.ok ? t("claims.submitted") : result.error);
              if (result.ok) setOpen(false);
            });
          }}
        >
          <p className="text-sm">{t("claims.representative")}</p>
          {loadFailed && (
            <Button
              type="button"
              variant="neutral"
              disabled={busy}
              onClick={() => void start()}
            >
              {t("common.retry")}
            </Button>
          )}
          {organizations.length ? (
            <label className="block">
              {t("claims.organization")}
              <select
                className="mh-input block w-full"
                value={organizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
              >
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>
              <a className="underline" href="/organizations">
                {t("claims.join")}
              </a>{" "}
              {t("claims.before")}
            </p>
          )}
          {!!organizations.length && (
            <>
              <label className="block">
                {t("claims.evidence")}
                <textarea
                  className="mh-input block w-full"
                  required
                  minLength={20}
                  maxLength={2000}
                  value={evidence}
                  onChange={(event) => setEvidence(event.target.value)}
                />
              </label>
              <p className="text-xs">{t("claims.evidenceHelp")}</p>
              <Button type="submit" disabled={busy || !organizationId}>
                {t("claims.submit")}
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="neutral"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            {t("claims.cancel")}
          </Button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}

interface Claim {
  can_edit: boolean;
  claim_id: string;
  resource_uri: string;
  organization_name: string;
  status: string;
  evidence: string;
  decision_reason?: string;
}
export function PublicResourceClaimManagement() {
  const { t } = useLocale();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reviewer, setReviewer] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    setMessage("");
    const result = await listPublicResourceClaimsViaApi();
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    const data = result.data as { claims: Claim[]; reviewer: boolean };
    if (!Array.isArray(data.claims)) {
      setMessage(t("claims.loadFailed"));
      return;
    }
    setClaims(data.claims);
    setReviewer(data.reviewer);
    setLoaded(true);
  };
  return (
    <Panel title={t("claims.title")}>
      <p className="text-sm">{t("claims.track")}</p>
      <Button variant="neutral" disabled={busy} onClick={() => void load()}>
        {loaded ? t("claims.refresh") : t("claims.viewClaims")}
      </Button>
      {message && <p role="status">{message}</p>}
      {loaded && !claims.length && <p>{t("claims.empty")}</p>}
      <ul className="space-y-4">
        {claims.map((claim) => (
          <li key={claim.claim_id} className="border border-mh-borderSoft p-3">
            <p className="font-bold">
              {claim.organization_name} ·{" "}
              {["pending", "approved", "denied", "revoked"].includes(
                claim.status,
              )
                ? t(
                    `claims.${claim.status as "pending" | "approved" | "denied" | "revoked"}`,
                  )
                : claim.status}
            </p>
            <a
              className="underline"
              href={`/resources?resource=${encodeURIComponent(claim.resource_uri)}`}
            >
              {t("claims.viewResource")}
            </a>
            <p className="whitespace-pre-wrap text-sm">{claim.evidence}</p>
            {claim.decision_reason && <p>{claim.decision_reason}</p>}
            {reviewer && ["pending", "approved"].includes(claim.status) && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  setBusy(true);
                  void decidePublicResourceClaimViaApi({
                    claimId: claim.claim_id,
                    action: String(data.get("action")) as
                      "approve" | "deny" | "revoke",
                    reason: String(data.get("reason")),
                  }).then(async (result) => {
                    setBusy(false);
                    if (!result.ok) setMessage(result.error);
                    else await load();
                  });
                }}
              >
                <label className="block">
                  {t("claims.decision")}
                  <select name="action" className="mh-input">
                    {claim.status === "pending" ? (
                      <>
                        <option value="approve">{t("claims.approve")}</option>
                        <option value="deny">{t("claims.deny")}</option>
                      </>
                    ) : (
                      <option value="revoke">{t("claims.revoke")}</option>
                    )}
                  </select>
                </label>
                <label className="block">
                  {t("claims.reason")}
                  <textarea
                    name="reason"
                    className="mh-input block w-full"
                    required
                    minLength={10}
                    maxLength={2000}
                  />
                </label>
                <Button disabled={busy} type="submit">
                  {t("claims.saveDecision")}
                </Button>
              </form>
            )}
            {claim.can_edit && claim.status === "approved" && (
              <PublicResourceListingEditor resourceUri={claim.resource_uri} />
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function PublicResourceListingEditor({ resourceUri }: { resourceUri: string }) {
  const { t } = useLocale();
  const [resource, setResource] = useState<ResourceDetail>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <div className="mt-3">
      {!resource && (
        <Button
          variant="neutral"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void fetchResourceViaApi(resourceUri).then((result) => {
              setBusy(false);
              if (result.ok) setResource(result.data);
              else setMessage(result.error);
            });
          }}
        >
          {t("claims.edit")}
        </Button>
      )}
      {message && <p role="status">{message}</p>}
      {resource && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            const data = new FormData(event.currentTarget);
            if (
              resource.serviceProfile &&
              !resourceProfileSchema.safeParse(resource.serviceProfile).success
            ) {
              setMessage(t("profileEditor.invalid"));
              return;
            }
            setBusy(true);
            setMessage("");
            void editPublicResourceViaApi({
              resourceUri,
              expectedUpdatedAt: resource.updatedAt,
              serviceProfile: resource.serviceProfile,
              serviceProfileRevision: resource.serviceProfileRevision ?? 0,
              name: String(data.get("name")),
              openHours: String(data.get("hours")),
              eligibilityNotes: String(data.get("access")),
              contact: {
                url: String(data.get("website")),
                ...(data.get("phone")
                  ? { phone: String(data.get("phone")) }
                  : {}),
              },
            }).then((result) => {
              setBusy(false);
              setMessage(result.ok ? t("claims.updated") : result.error);
              if (result.ok) setResource(undefined);
            });
          }}
        >
          <label className="block">
            {t("claims.name")}
            <input
              name="name"
              className="mh-input block w-full"
              required
              maxLength={120}
              defaultValue={resource.name}
            />
          </label>
          <label className="block">
            {t("claims.hours")}
            <input
              name="hours"
              className="mh-input block w-full"
              required
              maxLength={200}
              defaultValue={resource.openHours}
            />
          </label>
          <label className="block">
            {t("claims.requirements")}
            <textarea
              name="access"
              className="mh-input block w-full"
              required
              maxLength={500}
              defaultValue={resource.eligibilityNotes}
            />
          </label>
          <label className="block">
            {t("claims.website")}
            <input
              name="website"
              type="url"
              className="mh-input block w-full"
              required
              defaultValue={resource.contact.url}
            />
          </label>
          <label className="block">
            {t("claims.phone")}
            <input
              name="phone"
              className="mh-input block w-full"
              maxLength={32}
              defaultValue={resource.contact.phone}
            />
          </label>
          <ResourceProfileEditor
            profile={resource.serviceProfile}
            onChange={(profile) =>
              setResource({ ...resource, serviceProfile: profile })
            }
            sourceUrl={
              resource.contact.url ?? resource.publicListing?.sourceUrl ?? ""
            }
            sourceName={resource.name}
          />
          <Button type="submit" disabled={busy}>
            {t("claims.save")}
          </Button>
          <Button
            type="button"
            variant="neutral"
            disabled={busy}
            onClick={() => setResource(undefined)}
          >
            {t("claims.cancel")}
          </Button>
        </form>
      )}
    </div>
  );
}
