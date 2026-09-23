import {
    useEffect,
    useRef,
    useState,
    type FormEvent,
} from 'react';
import { aidCategories } from '../discovery-filters';
import {
    validatePostingDraft,
    type AidPostingCategory,
    type NormalizedAidPostingDraft,
    type PostingValidationIssue,
} from '../posting-form';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Banner } from '../components/Banner';
import { PageHeader } from '../components/PageHeader';
import { SegmentedControl } from '../components/SegmentedControl';
import { Surface } from '../components/Surface';
import { queryAidPostLifecycleViaApi, uploadPrivateAttachmentViaApi } from '../features/api-client';
import { useLocale } from '../i18n';
import { PUBLIC_MIN_PRECISION_KM } from '@patchwork/shared';
import { type FeedRecordEnvelope } from '../features/discovery-runtime';
import {
    type AppRoute,
} from '../app/routes';
import {
    nowIso,
} from '../app/runtime';
import {
    formatLocalizedLabel,
    parseCommaList,
} from '../features/shell-shared';

interface PostingRouteProps {
    location: {
        center: { lat: number; lng: number };
        areaLabel: string;
    };
    onCreateRecord: (record: FeedRecordEnvelope) => void;
    onNavigate: (route: AppRoute) => void;
    onCreateViaApi: (input: {
        draft: NormalizedAidPostingDraft;
        rkey: string;
        now: string;
    }) => Promise<
        { ok: true; data: FeedRecordEnvelope } | { ok: false; error: string }
    >;
}

export const PostingRoute = ({
    location,
    onCreateRecord,
    onNavigate,
    onCreateViaApi,
}: PostingRouteProps) => {
    const { t } = useLocale();
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState<AidPostingCategory>('food');
    const [urgency, setUrgency] = useState<1 | 2 | 3 | 4 | 5>(4);
    const [tagsText, setTagsText] = useState('');
    const [startAt, setStartAt] = useState('');
    const [endAt, setEndAt] = useState('');
    const [errors, setErrors] = useState<readonly PostingValidationIssue[]>([]);
    const [successMessage, setSuccessMessage] = useState<string>();
    const [apiError, setApiError] = useState<string>();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
    const [attachmentStatus, setAttachmentStatus] = useState<string>();
    const [projectionNotice, setProjectionNotice] = useState<string>();
    const [projectionFailed, setProjectionFailed] = useState(false);
    const [projectionPostUri, setProjectionPostUri] = useState<string>();
    const projectionTimerRef = useRef<number | undefined>(undefined);

    useEffect(
        () => () => {
            if (projectionTimerRef.current !== undefined) {
                window.clearTimeout(projectionTimerRef.current);
            }
        },
        [],
    );

    const pollProjection = async (postUri: string, attempts = 0) => {
        if (projectionTimerRef.current !== undefined) {
            window.clearTimeout(projectionTimerRef.current);
            projectionTimerRef.current = undefined;
        }
        const lifecycle = await queryAidPostLifecycleViaApi(postUri);
        if (!lifecycle.ok || !lifecycle.data.projectionReceipt) {
            setProjectionNotice('Source accepted. Public discovery is still waiting for projection confirmation.');
            setProjectionFailed(false);
            return;
        }
        const receipt = lifecycle.data.projectionReceipt;
        if (receipt.state === 'projected') {
            setProjectionNotice('Public discovery confirmed this request.');
            setProjectionFailed(false);
            return;
        }
        if (receipt.state === 'failed') {
            setProjectionNotice(`Public discovery did not project this request${receipt.failureCode ? ` (${receipt.failureCode})` : ''}. Retry the check or contact support.`);
            setProjectionFailed(true);
            return;
        }
        setProjectionNotice('Source accepted. Public discovery is pending projection.');
        setProjectionFailed(false);
        if (attempts < 4) {
            const seconds = Math.max(1, Math.min(receipt.retryAfterSeconds ?? 5, 30));
            projectionTimerRef.current = window.setTimeout(() => {
                void pollProjection(postUri, attempts + 1);
            }, seconds * 1000);
        }
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setApiError(undefined);
        setProjectionNotice(undefined);
        setProjectionFailed(false);

        const draft = {
            title,
            description,
            category,
            urgency,
            accessibilityTags: parseCommaList(tagsText),
            location: {
                lat: location.center.lat,
                lng: location.center.lng,
                precisionMeters: PUBLIC_MIN_PRECISION_KM * 1000,
            },
            timeWindow:
                startAt.length > 0 && endAt.length > 0
                    ? {
                          startAt: new Date(startAt).toISOString(),
                          endAt: new Date(endAt).toISOString(),
                      }
                    : undefined,
            attachments: attachmentFiles.map((file) => ({
                filename: file.name,
                mimeType: file.type,
                sizeBytes: file.size,
                previewUrl: '',
            })),
        };

        const validation = validatePostingDraft(draft);
        setErrors(validation.errors);

        if (!validation.ok || !validation.normalizedDraft) {
            setSuccessMessage(undefined);
            return;
        }

        const localId = `post-${Date.now().toString(36)}`;
        setIsSubmitting(true);

        try {
            const createResult = await onCreateViaApi({
                draft: validation.normalizedDraft,
                rkey: localId,
                now: nowIso(),
            });

            if (!createResult.ok) {
                setSuccessMessage(undefined);
                setApiError(createResult.error);
                return;
            }

            onCreateRecord(createResult.data);
            setProjectionPostUri(createResult.data.aidPostUri);
            void pollProjection(createResult.data.aidPostUri);

            let uploaded = 0;
            for (const file of attachmentFiles) {
                setAttachmentStatus(
                    `Uploading private attachment ${uploaded + 1} of ${attachmentFiles.length}…`,
                );
                const attachment = await uploadPrivateAttachmentViaApi(
                    file,
                    'aid-post',
                    createResult.data.aidPostUri,
                );
                if (!attachment.ok) {
                    setSuccessMessage(
                        `Created post ${localId}. ${uploaded} attachment(s) were accepted.`,
                    );
                    setApiError(
                        `The request is public, but a private attachment upload failed: ${attachment.error}`,
                    );
                    setAttachmentStatus(
                        'Attachment upload stopped. Selected files remain available to retry on a new request.',
                    );
                    return;
                }
                uploaded += 1;
            }
            setAttachmentFiles([]);
            setAttachmentStatus(
                uploaded > 0
                    ? `${uploaded} private attachment(s) uploaded and queued for malware scanning.`
                    : undefined,
            );
            setSuccessMessage(
                t('posting.publicationPending', { id: localId }),
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <section className='mx-auto max-w-3xl'>
            <PageHeader
                title={t('posting.heading')}
                description={t('posting.description')}
            />

            <Surface aria-label={String(t('posting.formTitle'))}>
                <form className='grid gap-5' onSubmit={handleSubmit}>
                    <div>
                        <label
                            htmlFor='posting-title'
                            className='mb-1.5 block mh-field-label'
                        >
                            {t('posting.titleLabel')}
                        </label>
                        <Input
                            id='posting-title'
                            name='title'
                            autoComplete='off'
                            required
                            minLength={1}
                            maxLength={140}
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                        />
                    </div>

                    <div>
                        <label
                            htmlFor='posting-description'
                            className='mb-1.5 block mh-field-label'
                        >
                            {t('posting.descriptionLabel')}
                        </label>
                        <textarea
                            id='posting-description'
                            name='description'
                            autoComplete='off'
                            required
                            minLength={1}
                            maxLength={5000}
                            className='mh-input min-h-35 w-full px-3 py-2 text-base'
                            value={description}
                            onChange={(event) =>
                                setDescription(event.target.value)
                            }
                        />
                    </div>

                    <div>
                        <div>
                            <label
                                htmlFor='posting-category'
                                className='mb-1.5 block mh-field-label'
                            >
                                {t('posting.categoryLabel')}
                            </label>
                            <select
                                id='posting-category'
                                name='category'
                                autoComplete='off'
                                className='mh-input w-full px-3 py-2 text-base'
                                value={category}
                                onChange={(event) =>
                                    setCategory(
                                        event.target
                                            .value as AidPostingCategory,
                                    )
                                }
                            >
                                {aidCategories.map((option) => (
                                    <option key={option} value={option}>
                                        {formatLocalizedLabel(t, option)}
                                    </option>
                                ))}
                            </select>
                        </div>

                    </div>

                    <div>
                        <SegmentedControl
                            label={String(t('posting.urgencyLabel'))}
                            hideLabel={false}
                            value={String(urgency) as '1' | '2' | '3' | '4' | '5'}
                            options={(['1', '2', '3', '4', '5'] as const).map(
                                (level) => ({ value: level, label: level }),
                            )}
                            onChange={(level) =>
                                setUrgency(Number(level) as 1 | 2 | 3 | 4 | 5)
                            }
                        />
                        <p className='mh-field-hint mt-1.5'>
                            {t('posting.urgencyHint')}
                        </p>
                    </div>

                    <div>
                        <label
                            htmlFor='posting-tags'
                            className='mb-1.5 block mh-field-label'
                        >
                            {t('posting.accessibilityTags')}
                        </label>
                        <Input
                            id='posting-tags'
                            name='accessibilityTags'
                            autoComplete='off'
                            value={tagsText}
                            onChange={(event) =>
                                setTagsText(event.target.value)
                            }
                        />
                    </div>

                    <div className='mh-surface mh-surface--quiet p-4'>
                        <h2 className='mh-field-label'>{t('posting.approximateArea')}</h2>
                        <p className='mt-2 text-sm text-mh-textMuted'>
                            {t('posting.selectedArea', { area: location.areaLabel })}
                        </p>
                        <p className='mt-1 text-sm text-mh-textMuted'>
                            {t('posting.publicPrecisionSummary')}
                        </p>
                        <Button
                            className='mt-3'
                            type='button'
                            variant='secondary'
                            size='sm'
                            onClick={() => onNavigate('/map')}
                        >
                            {t('posting.changeArea')}
                        </Button>
                    </div>

                    <Banner
                        tone='info'
                        live='none'
                        title={t('posting.privacySummary')}
                    >
                        <ul className='list-disc space-y-1 pl-5 text-sm'>
                            <li>{t('posting.publicSummary')}</li>
                            <li>{t('posting.privateSummary')}</li>
                            <li>{t('posting.neverSummary')}</li>
                        </ul>
                    </Banner>

                    <div className='grid gap-4 sm:grid-cols-2'>
                        <div>
                            <label
                                htmlFor='posting-start-at'
                                className='mb-1.5 block mh-field-label'
                            >
                                {t('posting.timeWindowStart')}
                            </label>
                            <Input
                                id='posting-start-at'
                                name='startAt'
                                autoComplete='off'
                                type='datetime-local'
                                value={startAt}
                                onChange={(event) =>
                                    setStartAt(event.target.value)
                                }
                            />
                        </div>
                        <div>
                            <label
                                htmlFor='posting-end-at'
                                className='mb-1.5 block mh-field-label'
                            >
                                {t('posting.timeWindowEnd')}
                            </label>
                            <Input
                                id='posting-end-at'
                                name='endAt'
                                autoComplete='off'
                                type='datetime-local'
                                value={endAt}
                                onChange={(event) =>
                                    setEndAt(event.target.value)
                                }
                            />
                        </div>
                    </div>

                    <div>
                        <label
                            htmlFor='posting-attachments'
                            className='mb-1.5 block mh-field-label'
                        >
                            {t('posting.attachments')}
                        </label>
                        <Input
                            id='posting-attachments'
                            type='file'
                            multiple
                            accept='image/jpeg,image/png,image/gif,image/webp,application/pdf'
                            onChange={(event) =>
                                setAttachmentFiles(
                                    Array.from(event.target.files ?? []),
                                )
                            }
                        />
                        <p className='mh-field-hint mt-1.5'>
                            {t('posting.attachmentHelp')}
                        </p>
                        {attachmentFiles.length ? (
                            <ul className='mt-2 text-xs'>
                                {attachmentFiles.map((file) => (
                                    <li key={`${file.name}-${file.size}`}>
                                        {file.name} ·{' '}
                                        {Math.ceil(file.size / 1024)}{' '}
                                        {t('posting.kilobytes')}
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                        {attachmentStatus ? (
                            <p className='mt-2 text-xs font-bold' role='status'>
                                {attachmentStatus}
                            </p>
                        ) : null}
                    </div>

                    {errors.length > 0 ? (
                        <Banner tone='danger' title={t('posting.fixErrors')}>
                            <ul className='list-disc space-y-1 pl-5'>
                                {errors.map((issue) => (
                                    <li key={`${issue.field}-${issue.message}`}>
                                        {issue.message}
                                    </li>
                                ))}
                            </ul>
                        </Banner>
                    ) : null}

                    {successMessage ? (
                        <Banner tone='success'>{successMessage}</Banner>
                    ) : null}

                    {projectionNotice ? (
                        <div
                            className={projectionFailed ? 'mh-alert text-xs font-bold' : 'rounded-none border-2 border-mh-border bg-mh-surfaceElev px-3 py-2 text-xs font-bold'}
                            role={projectionFailed ? 'alert' : 'status'}
                            aria-live='polite'
                        >
                            <p>{projectionNotice}</p>
                            {projectionFailed ? (
                                <Button
                                    size='sm'
                                    type='button'
                                    variant='neutral'
                                    className='mt-2'
                                    onClick={() => projectionPostUri && void pollProjection(projectionPostUri)}
                                >
                                    {t('discovery.retryProjection')}
                                </Button>
                            ) : null}
                        </div>
                    ) : null}

                    {apiError ? (
                        <Banner tone='danger'>
                            {t('posting.unableToPresist', { error: apiError })}
                        </Banner>
                    ) : null}

                    <div className='flex flex-wrap gap-2'>
                        <Button
                            type='submit'
                            variant='accent'
                            disabled={isSubmitting}
                        >
                            {isSubmitting
                                ? t('posting.publishing')
                                : t('posting.publishRequest')}
                        </Button>
                        <Button
                            variant='secondary'
                            type='button'
                            onClick={() => onNavigate('/feed')}
                        >
                            {t('posting.openFeed')}
                        </Button>
                    </div>
                </form>
            </Surface>
        </section>
    );
};
