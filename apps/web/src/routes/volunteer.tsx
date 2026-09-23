import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type FormEvent,
} from 'react';
import { aidCategories } from '../discovery-filters';
import {
    buildVolunteerProfileCreatePayload,
    isVolunteerFullyVerified,
    summarizeCheckpoints,
    validateVolunteerOnboardingDraft,
    type VolunteerOnboardingDraft,
    type VolunteerOnboardingValidationIssue,
} from '../volunteer-onboarding';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { ToggleChip } from '../components/ToggleChip';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Panel } from '../components/Panel';
import {
    type AtVolunteerProfileResult,
    type VolunteerDiscoveryProfile,
    type VolunteerProfileCommandInput,
    createAtVolunteerProfileViaApi,
    deleteAtVolunteerProfileViaApi,
    appendDedupedPage,
    fetchVolunteerProfilePageViaApi,
    getAtVolunteerProfileViaApi,
    updateAtVolunteerProfileViaApi,
} from '../features/api-client';
import { useLocale } from '../i18n';
import {
    nowIso,
} from '../app/runtime';
import {
    formatCategoryLabel,
    formatLocalizedLabel,
    parseCommaList,
    readPaginationPageFromUrl,
    usePaginationFocus,
} from '../features/shell-shared';

const volunteerCapabilityOptions: readonly VolunteerOnboardingDraft['capabilities'][number][] =
    [
        'transport',
        'food-delivery',
        'translation',
        'first-aid',
        'childcare',
        'other',
    ];

const volunteerAvailabilityOptions: readonly VolunteerOnboardingDraft['availability'][] =
    ['immediate', 'within-24h', 'scheduled', 'unavailable'];

const volunteerContactOptions: readonly VolunteerOnboardingDraft['contactPreference'][] =
    ['chat-only', 'chat-or-call'];

const checkpointStatusOptions: readonly VolunteerOnboardingDraft['checkpoints']['identityCheck'][] =
    ['pending', 'approved', 'rejected'];

const urgencyPreferenceOptions: readonly VolunteerOnboardingDraft['preferredUrgencies'][number][] =
    ['low', 'medium', 'high', 'critical'];

const toggleInList = <TValue extends string>(
    list: readonly TValue[],
    value: TValue,
): TValue[] => {
    if (list.includes(value)) {
        return list.filter((item) => item !== value);
    }

    return [...list, value];
};

export const LegacyFixtureVolunteerRoute = ({ did }: { did: string }) => {
    const [draft, setDraft] = useState<VolunteerOnboardingDraft>(() => ({
        did,
        displayName: '',
        capabilities: [],
        availability: 'within-24h',
        contactPreference: 'chat-only',
        skills: [],
        availabilityWindows: [],
        preferredCategories: [],
        preferredUrgencies: [],
        maxDistanceKm: 5,
        acceptsLateNight: false,
        checkpoints: {
            identityCheck: 'pending',
            safetyTraining: 'pending',
            communityReference: 'pending',
        },
        notes: '',
    }));
    const [skillsText, setSkillsText] = useState('');
    const [windowsText, setWindowsText] = useState('');
    const [errors, setErrors] = useState<
        readonly VolunteerOnboardingValidationIssue[]
    >([]);
    const [savedSummary, setSavedSummary] =
        useState<ReturnType<typeof summarizeCheckpoints>>();
    const [isVerified, setIsVerified] = useState<boolean>();

    const candidateDraft = useMemo(
        () => ({
            ...draft,
            skills: parseCommaList(skillsText),
            availabilityWindows: parseCommaList(windowsText),
        }),
        [draft, skillsText, windowsText],
    );

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const validation = validateVolunteerOnboardingDraft(candidateDraft);
        setErrors(validation.errors);

        if (!validation.ok) {
            setSavedSummary(undefined);
            setIsVerified(undefined);
            return;
        }

        const payload = buildVolunteerProfileCreatePayload(candidateDraft, {
            now: nowIso(),
        });

        setSavedSummary(payload.checkpointSummary);
        setIsVerified(isVolunteerFullyVerified(candidateDraft.checkpoints));
        setDraft(candidateDraft);
    };

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>Volunteer onboarding</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    Capture capabilities, availability, and verification
                    checkpoints for safe matching.
                </p>
            </header>

            <Panel title='Volunteer profile draft'>
                <form className='space-y-4' onSubmit={handleSubmit}>
                    <div className='grid gap-4 sm:grid-cols-2'>
                        <div>
                            <label
                                htmlFor='volunteer-did'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                DID
                            </label>
                            <Input
                                id='volunteer-did'
                                value={draft.did}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        did: event.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div>
                            <label
                                htmlFor='volunteer-display-name'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                Display name
                            </label>
                            <Input
                                id='volunteer-display-name'
                                value={draft.displayName}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        displayName: event.target.value,
                                    }))
                                }
                            />
                        </div>
                    </div>

                    <div className='grid gap-4 sm:grid-cols-2'>
                        <div>
                            <label
                                htmlFor='volunteer-availability'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                Availability
                            </label>
                            <select
                                id='volunteer-availability'
                                className='mh-input w-full px-3 py-2 text-base'
                                value={draft.availability}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        availability: event.target
                                            .value as VolunteerOnboardingDraft['availability'],
                                    }))
                                }
                            >
                                {volunteerAvailabilityOptions.map((option) => (
                                    <option key={option} value={option}>
                                        {formatCategoryLabel(option)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label
                                htmlFor='volunteer-contact-preference'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                Contact preference
                            </label>
                            <select
                                id='volunteer-contact-preference'
                                className='mh-input w-full px-3 py-2 text-base'
                                value={draft.contactPreference}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        contactPreference: event.target
                                            .value as VolunteerOnboardingDraft['contactPreference'],
                                    }))
                                }
                            >
                                {volunteerContactOptions.map((option) => (
                                    <option key={option} value={option}>
                                        {formatCategoryLabel(option)}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div>
                        <p className='mb-2 text-xs font-bold uppercase tracking-[0.12em] text-mh-text'>
                            Capabilities
                        </p>
                        <div className='flex flex-wrap gap-2'>
                            {volunteerCapabilityOptions.map((capability) => (
                                <ToggleChip
                                    key={capability}
                                    pressed={draft.capabilities.includes(capability)}
                                    onClick={() =>
                                        setDraft((current) => ({
                                            ...current,
                                            capabilities: toggleInList(
                                                current.capabilities,
                                                capability,
                                            ) as VolunteerOnboardingDraft['capabilities'],
                                        }))
                                    }
                                >
                                    {formatCategoryLabel(capability)}
                                </ToggleChip>
                            ))}
                        </div>
                    </div>

                    <div className='grid gap-4 sm:grid-cols-2'>
                        <div>
                            <label
                                htmlFor='volunteer-skills'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                Skills (comma-separated)
                            </label>
                            <Input
                                id='volunteer-skills'
                                value={skillsText}
                                onChange={(event) =>
                                    setSkillsText(event.target.value)
                                }
                            />
                        </div>
                        <div>
                            <label
                                htmlFor='volunteer-windows'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                Availability windows
                            </label>
                            <Input
                                id='volunteer-windows'
                                value={windowsText}
                                onChange={(event) =>
                                    setWindowsText(event.target.value)
                                }
                            />
                        </div>
                    </div>

                    <div>
                        <p className='mb-2 text-xs font-bold uppercase tracking-[0.12em] text-mh-text'>
                            Preferred categories
                        </p>
                        <div className='flex flex-wrap gap-2'>
                            {aidCategories.map((category) => (
                                <ToggleChip
                                    key={category}
                                    pressed={draft.preferredCategories.includes( category, )}
                                    onClick={() =>
                                        setDraft((current) => ({
                                            ...current,
                                            preferredCategories: toggleInList(
                                                current.preferredCategories,
                                                category,
                                            ) as VolunteerOnboardingDraft['preferredCategories'],
                                        }))
                                    }
                                >
                                    {formatCategoryLabel(category)}
                                </ToggleChip>
                            ))}
                        </div>
                    </div>

                    <div>
                        <p className='mb-2 text-xs font-bold uppercase tracking-[0.12em] text-mh-text'>
                            Preferred urgencies
                        </p>
                        <div className='flex flex-wrap gap-2'>
                            {urgencyPreferenceOptions.map((urgency) => (
                                <ToggleChip
                                    key={urgency}
                                    pressed={draft.preferredUrgencies.includes( urgency, )}
                                    onClick={() =>
                                        setDraft((current) => ({
                                            ...current,
                                            preferredUrgencies: toggleInList(
                                                current.preferredUrgencies,
                                                urgency,
                                            ) as VolunteerOnboardingDraft['preferredUrgencies'],
                                        }))
                                    }
                                >
                                    {formatCategoryLabel(urgency)}
                                </ToggleChip>
                            ))}
                        </div>
                    </div>

                    <div className='grid gap-4 sm:grid-cols-2'>
                        <div>
                            <label
                                htmlFor='volunteer-distance'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                Max distance (km)
                            </label>
                            <Input
                                id='volunteer-distance'
                                type='number'
                                min={1}
                                max={250}
                                value={draft.maxDistanceKm}
                                onChange={(event) => {
                                    const value = Number.parseInt(
                                        event.target.value,
                                        10,
                                    );
                                    if (Number.isNaN(value)) {
                                        return;
                                    }
                                    setDraft((current) => ({
                                        ...current,
                                        maxDistanceKm: value,
                                    }));
                                }}
                            />
                        </div>
                        <div className='flex items-end'>
                            <label className='inline-flex items-center gap-2 text-sm text-mh-textMuted'>
                                <input
                                    type='checkbox'
                                    className='h-4 w-4'
                                    checked={draft.acceptsLateNight}
                                    onChange={(event) =>
                                        setDraft((current) => ({
                                            ...current,
                                            acceptsLateNight:
                                                event.target.checked,
                                        }))
                                    }
                                />
                                Accept late-night handoffs
                            </label>
                        </div>
                    </div>

                    <div className='grid gap-4 sm:grid-cols-3'>
                        <div>
                            <label
                                htmlFor='checkpoint-identity'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                Identity check
                            </label>
                            <select
                                id='checkpoint-identity'
                                className='mh-input w-full px-3 py-2 text-base'
                                value={draft.checkpoints.identityCheck}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        checkpoints: {
                                            ...current.checkpoints,
                                            identityCheck: event.target
                                                .value as VolunteerOnboardingDraft['checkpoints']['identityCheck'],
                                        },
                                    }))
                                }
                            >
                                {checkpointStatusOptions.map((status) => (
                                    <option key={status} value={status}>
                                        {formatCategoryLabel(status)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label
                                htmlFor='checkpoint-safety'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                Safety training
                            </label>
                            <select
                                id='checkpoint-safety'
                                className='mh-input w-full px-3 py-2 text-base'
                                value={draft.checkpoints.safetyTraining}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        checkpoints: {
                                            ...current.checkpoints,
                                            safetyTraining: event.target
                                                .value as VolunteerOnboardingDraft['checkpoints']['safetyTraining'],
                                        },
                                    }))
                                }
                            >
                                {checkpointStatusOptions.map((status) => (
                                    <option key={status} value={status}>
                                        {formatCategoryLabel(status)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label
                                htmlFor='checkpoint-reference'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                Community reference
                            </label>
                            <select
                                id='checkpoint-reference'
                                className='mh-input w-full px-3 py-2 text-base'
                                value={draft.checkpoints.communityReference}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        checkpoints: {
                                            ...current.checkpoints,
                                            communityReference: event.target
                                                .value as VolunteerOnboardingDraft['checkpoints']['communityReference'],
                                        },
                                    }))
                                }
                            >
                                {checkpointStatusOptions.map((status) => (
                                    <option key={status} value={status}>
                                        {formatCategoryLabel(status)}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {errors.length > 0 ? (
                        <div className='space-y-1'>
                            {errors.map((issue) => (
                                <p
                                    key={`${issue.field}-${issue.message}`}
                                    className='mh-alert text-xs font-bold'
                                >
                                    {issue.field}: {issue.message}
                                </p>
                            ))}
                        </div>
                    ) : null}

                    {savedSummary ? (
                        <div className='rounded-none border-2 border-mh-border bg-mh-surfaceElev p-3'>
                            <div className='flex flex-wrap gap-2'>
                                <Badge tone='success'>
                                    Approved {savedSummary.approved}
                                </Badge>
                                <Badge tone='info'>
                                    Pending {savedSummary.pending}
                                </Badge>
                                <Badge tone='danger'>
                                    Rejected {savedSummary.rejected}
                                </Badge>
                                {isVerified ? (
                                    <Badge tone='success'>Fully verified</Badge>
                                ) : null}
                            </div>
                        </div>
                    ) : null}

                    <Button type='submit'>Save volunteer profile</Button>
                </form>
            </Panel>
        </section>
    );
};

const emptyVolunteerCommand = (): VolunteerProfileCommandInput => ({
    profile: {
        displayName: '',
        bio: '',
        capabilities: [],
        availability: 'within-24h',
        contactPreference: 'chat-only',
        skills: [],
        languages: ['en'],
    },
    privateProfile: {
        contactEmail: null,
        contactPhone: null,
        availabilityWindows: [],
        matchingPreferences: {
            preferredCategories: ['other'],
            preferredUrgencies: ['medium'],
            maxDistanceKm: 10,
            acceptsLateNight: false,
        },
    },
});

export const VolunteerRoute = ({
    did,
    historyVersion,
}: {
    did: string;
    historyVersion: number;
}) => {
    const { t } = useLocale();
    const [profiles, setProfiles] = useState<VolunteerDiscoveryProfile[]>([]);
    const [discoveryStatus, setDiscoveryStatus] = useState(
        t('volunteer.loading'),
    );
    const [searchText, setSearchText] = useState('');
    const [command, setCommand] = useState<VolunteerProfileCommandInput>(
        emptyVolunteerCommand,
    );
    const [owned, setOwned] = useState<AtVolunteerProfileResult>();
    const [skillsText, setSkillsText] = useState('');
    const [languagesText, setLanguagesText] = useState('en');
    const [windowsText, setWindowsText] = useState('');
    const [formStatus, setFormStatus] = useState<string>();
    const [volunteerPage, setVolunteerPage] = useState(() => readPaginationPageFromUrl());
    const volunteerPageRef = useRef(volunteerPage);
    const restoringVolunteerPageRef = useRef(false);
    const lastVolunteerRequestKeyRef = useRef<string | undefined>(undefined);
    const [volunteerHasNextPage, setVolunteerHasNextPage] = useState(false);
    const [volunteerTotal, setVolunteerTotal] = useState(0);
    const [isVolunteerLoading, setIsVolunteerLoading] = useState(false);
    const paginationFocus = usePaginationFocus({
        itemCount: profiles.length,
        isLoading: isVolunteerLoading,
        hasNextPage: volunteerHasNextPage,
        announce: useCallback(
            (start: number, end: number) =>
                String(t('discovery.loadedRange', { start, end })),
            [t],
        ),
    });

    const loadProfiles = useCallback(async (page = 1, force = false) => {
        const requestKey = `${page}\u0000${searchText.trim()}`;
        if (!force && lastVolunteerRequestKeyRef.current === requestKey) return;
        lastVolunteerRequestKeyRef.current = requestKey;
        const previousPage = volunteerPageRef.current;
        if (typeof window !== 'undefined' && page !== previousPage) {
            const params = new URLSearchParams(window.location.search);
            if (page > 1) params.set('page', String(page));
            else params.delete('page');
            const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
            if (!restoringVolunteerPageRef.current) {
                window.history.pushState({}, '', next);
            }
        }
        restoringVolunteerPageRef.current = false;
        volunteerPageRef.current = page;
        setIsVolunteerLoading(true);
        setDiscoveryStatus(t('volunteer.loading'));
        const result = await fetchVolunteerProfilePageViaApi({ searchText }, page);
        if (!result.ok) {
            lastVolunteerRequestKeyRef.current = undefined;
            setIsVolunteerLoading(false);
            setDiscoveryStatus(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }
        setProfiles((current) =>
            page === 1
                ? appendDedupedPage([], result.data.items, (profile) => profile.uri)
                : appendDedupedPage(current, result.data.items, (profile) => profile.uri),
        );
        setVolunteerPage(page);
        setVolunteerHasNextPage(result.data.hasNextPage);
        setVolunteerTotal(result.data.total);
        setIsVolunteerLoading(false);
        setDiscoveryStatus(
            result.data.items.length === 0 && page === 1
                ? t('volunteer.noneFound')
                : t('volunteer.results', { count: result.data.total }),
        );
        const mine = result.data.items.find((profile) => profile.authorDid === did);
        if (!mine || !did) return;
        const ownedResult = await getAtVolunteerProfileViaApi(mine.uri);
        if (!ownedResult.ok) return;
        setOwned(ownedResult.data);
        const record = ownedResult.data.record;
        setCommand({
            profile: {
                displayName: record.displayName,
                bio: record.bio ?? '',
                capabilities: [...record.capabilities],
                availability: record.availability,
                contactPreference: record.contactPreference,
                skills: [...(record.skills ?? [])],
                languages: [...(record.languages ?? [])],
                serviceArea: record.serviceArea,
            },
            privateProfile:
                ownedResult.data.privateProfile ??
                emptyVolunteerCommand().privateProfile,
        });
        setSkillsText((record.skills ?? []).join(', '));
        setLanguagesText((record.languages ?? []).join(', '));
        setWindowsText(
            (ownedResult.data.privateProfile?.availabilityWindows ?? []).join(
                ', ',
            ),
        );
    }, [did, searchText, t]);

    useEffect(() => {
        if (historyVersion > 0) restoringVolunteerPageRef.current = true;
        void loadProfiles(readPaginationPageFromUrl());
    }, [historyVersion, loadProfiles]);

    const updateProfile = (
        patch: Partial<VolunteerProfileCommandInput['profile']>,
    ) =>
        setCommand((current) => ({
            ...current,
            profile: { ...current.profile, ...patch },
        }));

    const save = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const next: VolunteerProfileCommandInput = {
            ...command,
            profile: {
                ...command.profile,
                skills: parseCommaList(skillsText),
                languages: parseCommaList(languagesText),
                serviceArea: command.profile.serviceArea?.areaLabel.trim()
                    ? command.profile.serviceArea
                    : undefined,
            },
            privateProfile: {
                ...command.privateProfile,
                availabilityWindows: parseCommaList(windowsText),
            },
        };
        setFormStatus(t('volunteer.saving'));
        const result = owned
            ? await updateAtVolunteerProfileViaApi({
                  ...next,
                  uri: owned.uri,
                  expectedCid: owned.cid,
              })
            : await createAtVolunteerProfileViaApi(next);
        if (!result.ok) {
            setFormStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setOwned(result.data);
        setCommand(next);
        setFormStatus(
            owned ? t('volunteer.updated') : t('volunteer.published'),
        );
        await loadProfiles(1, true);
    };

    const remove = async () => {
        if (!owned) return;
        setFormStatus(t('volunteer.deleting'));
        const result = await deleteAtVolunteerProfileViaApi({
            uri: owned.uri,
            expectedCid: owned.cid,
        });
        if (!result.ok) {
            setFormStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setOwned(undefined);
        setCommand(emptyVolunteerCommand());
        setSkillsText('');
        setLanguagesText('en');
        setWindowsText('');
        setFormStatus(t('volunteer.deleted'));
        await loadProfiles(1, true);
    };

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>
                    {t('volunteer.profilesHeading')}
                </h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('volunteer.profilesDescription')}
                </p>
            </header>

            <Panel title={t('volunteer.find')}>
                <form
                    className='flex flex-wrap gap-2'
                    onSubmit={(event) => {
                        event.preventDefault();
                        void loadProfiles(1, true);
                    }}
                >
                    <label className='grow text-sm font-bold'>
                        {t('volunteer.searchPublic')}
                        <Input
                            value={searchText}
                            onChange={(event) =>
                                setSearchText(event.target.value)
                            }
                        />
                    </label>
                    <Button type='submit'>{t('volunteer.search')}</Button>
                </form>
                <p
                    className='mt-3 text-sm text-mh-textMuted'
                    role={
                        discoveryStatus.startsWith('Error:')
                            ? 'alert'
                            : 'status'
                    }
                >
                    {discoveryStatus}
                </p>
                <p ref={paginationFocus.loadedCountRef} tabIndex={-1} className='mt-2 text-xs text-mh-textMuted' role='status'>
                    {t('discovery.loadedCount', { loaded: profiles.length, total: volunteerTotal })}
                </p>
                <span className='sr-only' role='status' aria-live='polite'>{paginationFocus.announcement}</span>
                <div className='mt-4 grid gap-3 sm:grid-cols-2'>
                    {profiles.map((profile) => (
                        <Card key={profile.uri} title={profile.displayName}>
                            {profile.recordOrigin === 'synthetic' ? (
                                <Badge tone='info'>
                                    {t('volunteer.synthetic')}
                                </Badge>
                            ) : profile.recordOrigin === 'sourced-public' ? (
                                <Badge tone='info'>
                                    {t('volunteer.publicSource')}
                                </Badge>
                            ) : null}
                            <p className='text-sm'>{profile.bio}</p>
                            <p className='mt-2 text-xs text-mh-textMuted'>
                                {profile.capabilities.join(', ')} ·{' '}
                                {profile.availability}
                            </p>
                            <p className='mt-1 text-xs text-mh-textMuted'>
                                {t('volunteer.languages', {
                                    languages:
                                        profile.languages.join(', ') ||
                                        t('volunteer.notListed'),
                                })}
                            </p>
                            {profile.serviceArea ? (
                                <p className='mt-1 text-xs text-mh-textMuted'>
                                    {t('volunteer.serviceArea', {
                                        area: profile.serviceArea.areaLabel,
                                    })}
                                    {profile.serviceArea.noPermanentAddress
                                        ? ` · ${t('volunteer.noPermanentAddressShort')}`
                                        : ''}
                                </p>
                            ) : null}
                        </Card>
                    ))}
                </div>
                {volunteerHasNextPage ? (
                    <Button
                        ref={paginationFocus.loadMoreRef}
                        type='button'
                        variant='neutral'
                        className='mt-4'
                        disabled={isVolunteerLoading}
                        onClick={() =>
                            paginationFocus.loadMore(() => {
                                void loadProfiles(volunteerPage + 1);
                            })
                        }
                    >
                        {t('discovery.loadMore')}
                    </Button>
                ) : null}
            </Panel>

            {did ? (
                <Panel
                    title={
                        owned ? t('volunteer.manage') : t('volunteer.create')
                    }
                >
                    <form className='space-y-4' onSubmit={save}>
                        <div className='grid gap-3 sm:grid-cols-2'>
                            <label className='text-sm font-bold'>
                                {t('volunteer.displayNameLabel')}
                                <Input
                                    value={command.profile.displayName}
                                    onChange={(event) =>
                                        updateProfile({
                                            displayName: event.target.value,
                                        })
                                    }
                                />
                            </label>
                            <label className='text-sm font-bold'>
                                {t('volunteer.availabilityLabel')}
                                <select
                                    className='mh-input mt-1 w-full px-3 py-2'
                                    value={command.profile.availability}
                                    onChange={(event) =>
                                        updateProfile({
                                            availability: event.target
                                                .value as VolunteerProfileCommandInput['profile']['availability'],
                                        })
                                    }
                                >
                                    {volunteerAvailabilityOptions.map(
                                        (value) => (
                                            <option key={value} value={value}>
                                                {formatLocalizedLabel(t, value)}
                                            </option>
                                        ),
                                    )}
                                </select>
                            </label>
                        </div>
                        <label className='block text-sm font-bold'>
                            {t('volunteer.publicBio')}
                            <textarea
                                className='mh-input mt-1 min-h-24 w-full px-3 py-2'
                                value={command.profile.bio ?? ''}
                                onChange={(event) =>
                                    updateProfile({ bio: event.target.value })
                                }
                            />
                        </label>
                        <fieldset>
                            <legend className='text-sm font-bold'>
                                {t('volunteer.publicCapabilities')}
                            </legend>
                            <div className='mt-2 flex flex-wrap gap-2'>
                                {volunteerCapabilityOptions.map((value) => (
                                    <label key={value} className='text-sm'>
                                        <input
                                            type='checkbox'
                                            checked={command.profile.capabilities.includes(
                                                value,
                                            )}
                                            onChange={() =>
                                                updateProfile({
                                                    capabilities: toggleInList(
                                                        command.profile
                                                            .capabilities,
                                                        value,
                                                    ) as VolunteerProfileCommandInput['profile']['capabilities'],
                                                })
                                            }
                                        />{' '}
                                        {formatLocalizedLabel(t, value)}
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                        <div className='grid gap-3 sm:grid-cols-2'>
                            <label className='text-sm font-bold'>
                                {t('volunteer.publicSkills')}
                                <Input
                                    value={skillsText}
                                    onChange={(event) =>
                                        setSkillsText(event.target.value)
                                    }
                                    placeholder={t(
                                        'volunteer.skillsPlaceholder',
                                    )}
                                />
                            </label>
                            <label className='text-sm font-bold'>
                                {t('volunteer.publicLanguages')}
                                <Input
                                    value={languagesText}
                                    onChange={(event) =>
                                        setLanguagesText(event.target.value)
                                    }
                                    placeholder={t(
                                        'volunteer.languagesPlaceholder',
                                    )}
                                />
                            </label>
                            <label className='text-sm font-bold'>
                                {t('volunteer.serviceAreaLabel')}
                                <Input
                                    value={
                                        command.profile.serviceArea
                                            ?.areaLabel ?? ''
                                    }
                                    onChange={(event) =>
                                        updateProfile({
                                            serviceArea: {
                                                ...(command.profile
                                                    .serviceArea ?? {
                                                    noPermanentAddress: false,
                                                }),
                                                areaLabel: event.target.value,
                                            },
                                        })
                                    }
                                />
                            </label>
                            <label className='text-sm font-bold'>
                                {t('volunteer.precision')}
                                <Input
                                    type='number'
                                    min={1}
                                    value={
                                        command.profile.serviceArea
                                            ?.precisionKm ?? 2
                                    }
                                    onChange={(event) =>
                                        updateProfile({
                                            serviceArea: {
                                                ...(command.profile
                                                    .serviceArea ?? {
                                                    areaLabel: '',
                                                    noPermanentAddress: false,
                                                }),
                                                precisionKm: Number(
                                                    event.target.value,
                                                ),
                                            },
                                        })
                                    }
                                />
                            </label>
                            <label className='text-sm font-bold'>
                                {t('volunteer.latitude')}
                                <Input
                                    type='number'
                                    step='0.01'
                                    value={
                                        command.profile.serviceArea?.latitude ??
                                        ''
                                    }
                                    onChange={(event) =>
                                        updateProfile({
                                            serviceArea: {
                                                ...(command.profile
                                                    .serviceArea ?? {
                                                    areaLabel: '',
                                                    noPermanentAddress: false,
                                                }),
                                                precisionKm:
                                                    command.profile.serviceArea
                                                        ?.precisionKm ?? 2,
                                                latitude: Number(
                                                    event.target.value,
                                                ),
                                            },
                                        })
                                    }
                                />
                            </label>
                            <label className='text-sm font-bold'>
                                {t('volunteer.longitude')}
                                <Input
                                    type='number'
                                    step='0.01'
                                    value={
                                        command.profile.serviceArea
                                            ?.longitude ?? ''
                                    }
                                    onChange={(event) =>
                                        updateProfile({
                                            serviceArea: {
                                                ...(command.profile
                                                    .serviceArea ?? {
                                                    areaLabel: '',
                                                    noPermanentAddress: false,
                                                }),
                                                precisionKm:
                                                    command.profile.serviceArea
                                                        ?.precisionKm ?? 2,
                                                longitude: Number(
                                                    event.target.value,
                                                ),
                                            },
                                        })
                                    }
                                />
                            </label>
                        </div>
                        <label className='block text-sm'>
                            <input
                                type='checkbox'
                                checked={
                                    command.profile.serviceArea
                                        ?.noPermanentAddress ?? false
                                }
                                onChange={(event) =>
                                    updateProfile({
                                        serviceArea: {
                                            ...(command.profile.serviceArea ?? {
                                                areaLabel: '',
                                            }),
                                            noPermanentAddress:
                                                event.target.checked,
                                        },
                                    })
                                }
                            />{' '}
                            {t('volunteer.noPermanentAddress')}
                        </label>
                        <Card title={t('volunteer.privateDetails')}>
                            <div className='grid gap-3 sm:grid-cols-2'>
                                <label className='text-sm font-bold'>
                                    {t('volunteer.privateEmail')}
                                    <Input
                                        type='email'
                                        value={
                                            command.privateProfile
                                                .contactEmail ?? ''
                                        }
                                        onChange={(event) =>
                                            setCommand((current) => ({
                                                ...current,
                                                privateProfile: {
                                                    ...current.privateProfile,
                                                    contactEmail:
                                                        event.target.value ||
                                                        null,
                                                },
                                            }))
                                        }
                                    />
                                </label>
                                <label className='text-sm font-bold'>
                                    {t('volunteer.privateWindows')}
                                    <Input
                                        value={windowsText}
                                        onChange={(event) =>
                                            setWindowsText(event.target.value)
                                        }
                                    />
                                </label>
                            </div>
                        </Card>
                        <div className='flex flex-wrap items-center gap-2'>
                            <Button type='submit'>
                                {owned
                                    ? t('volunteer.save')
                                    : t('volunteer.publish')}
                            </Button>
                            {owned ? (
                                <Button
                                    type='button'
                                    variant='neutral'
                                    onClick={() => void remove()}
                                >
                                    {t('volunteer.delete')}
                                </Button>
                            ) : null}
                            {formStatus ? (
                                <span
                                    role={
                                        formStatus.startsWith('Error:')
                                            ? 'alert'
                                            : 'status'
                                    }
                                    className='text-sm'
                                >
                                    {formStatus}
                                </span>
                            ) : null}
                        </div>
                    </form>
                </Panel>
            ) : (
                <Panel title={t('volunteer.signIn')}>
                    <p>{t('volunteer.signInHelp')}</p>
                </Panel>
            )}
        </section>
    );
};
