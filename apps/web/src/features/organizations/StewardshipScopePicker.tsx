import { useEffect, useId, useMemo, useState } from 'react';
import { useLocale } from '../../i18n';
import {
    fetchMyOrganizationsViaApi,
    fetchOrganizationResourcesViaApi,
    type MyOrganization,
    type OrganizationResource,
} from '../api-client';

const roleRank = { member: 0, steward: 1, admin: 2, owner: 3 } as const;
type MinimumRole = 'steward' | 'admin';

export interface StewardshipScope {
    organizationId: string;
    resourceUri: string;
}

interface StewardshipScopePickerProps {
    /** Signed-in DID, used to keep resources to the ones this person stewards. */
    did: string;
    value: StewardshipScope;
    onChange: (scope: StewardshipScope) => void;
    /** Also pick a directory resource with an active stewardship. */
    includeResource: boolean;
    minimumRole: MinimumRole;
    organizationLabel: string;
    resourceLabel: string;
}

/**
 * Organization and resource selects built from what the account may act on,
 * replacing free-text organization IDs and AT URIs.
 */
export const StewardshipScopePicker = ({
    did,
    value,
    onChange,
    includeResource,
    minimumRole,
    organizationLabel,
    resourceLabel,
}: StewardshipScopePickerProps) => {
    const { t } = useLocale();
    const orgId = useId();
    const resourceId = useId();
    const [organizations, setOrganizations] = useState<MyOrganization[]>();
    const [resources, setResources] = useState<OrganizationResource[]>();

    useEffect(() => {
        const controller = new AbortController();
        void fetchMyOrganizationsViaApi(controller.signal).then((result) => {
            if (!controller.signal.aborted) {
                setOrganizations(result.ok ? result.data : []);
            }
        });
        return () => controller.abort();
    }, []);

    const eligible = useMemo(
        () =>
            (organizations ?? []).filter(
                (organization) =>
                    roleRank[organization.membership.role] >=
                    roleRank[minimumRole],
            ),
        [minimumRole, organizations],
    );
    const selected = eligible.find(
        (organization) => organization.id === value.organizationId,
    );
    const canManageAll = selected
        ? roleRank[selected.membership.role] >= roleRank.admin
        : false;

    useEffect(() => {
        if (!includeResource || !value.organizationId) {
            setResources(undefined);
            return undefined;
        }
        const controller = new AbortController();
        void fetchOrganizationResourcesViaApi(
            value.organizationId,
            controller.signal,
        ).then((result) => {
            if (!controller.signal.aborted) {
                setResources(result.ok ? result.data : []);
            }
        });
        return () => controller.abort();
    }, [includeResource, value.organizationId]);

    const stewarded = (resources ?? []).filter(
        (resource) =>
            resource.stewardship?.status === 'active' &&
            (canManageAll || resource.stewardship.stewardDid === did),
    );

    return (
        <>
            <div className='grid gap-1.5'>
                <label htmlFor={orgId} className='mh-field-label'>
                    {organizationLabel}
                </label>
                <select
                    id={orgId}
                    className='mh-input w-full px-3 py-2'
                    required
                    value={value.organizationId}
                    onChange={(event) =>
                        onChange({
                            organizationId: event.target.value,
                            resourceUri: '',
                        })
                    }
                >
                    <option value=''>
                        {organizations === undefined
                            ? t('scopePicker.loading')
                            : t('scopePicker.chooseOrganization')}
                    </option>
                    {eligible.map((organization) => (
                        <option key={organization.id} value={organization.id}>
                            {organization.name}
                        </option>
                    ))}
                </select>
                {organizations !== undefined && eligible.length === 0 ? (
                    <p className='mh-field-hint'>
                        {minimumRole === 'admin'
                            ? t('scopePicker.noAdminOrganizations')
                            : t('scopePicker.noStewardOrganizations')}
                    </p>
                ) : null}
            </div>
            {includeResource ? (
                <div className='grid gap-1.5'>
                    <label htmlFor={resourceId} className='mh-field-label'>
                        {resourceLabel}
                    </label>
                    <select
                        id={resourceId}
                        className='mh-input w-full px-3 py-2'
                        required
                        disabled={!value.organizationId}
                        value={value.resourceUri}
                        onChange={(event) =>
                            onChange({
                                organizationId: value.organizationId,
                                resourceUri: event.target.value,
                            })
                        }
                    >
                        <option value=''>
                            {value.organizationId && resources === undefined
                                ? t('scopePicker.loading')
                                : t('scopePicker.chooseResource')}
                        </option>
                        {stewarded.map((resource) => (
                            <option key={resource.uri} value={resource.uri}>
                                {resource.name}
                            </option>
                        ))}
                    </select>
                    {value.organizationId &&
                    resources !== undefined &&
                    stewarded.length === 0 ? (
                        <p className='mh-field-hint'>
                            {t('scopePicker.noStewardedResources')}
                        </p>
                    ) : null}
                </div>
            ) : null}
        </>
    );
};
