import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type FormEvent,
} from 'react';
import { StatusMessage } from '../components/StatusMessage';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Panel } from '../components/Panel';
import {
    type ExactAddressRequest,
    type PrivateAttachment,
    type VerificationApplication,
    type VerificationAppeal,
    type VerificationReviewQueue,
    type VerificationSubjectType,
    type VerificationWorkspace,
    fetchPrivateAttachmentsViaApi,
    fetchExactAddressReviewQueueViaApi,
    fetchVerificationReviewQueueViaApi,
    fetchVerificationWorkspaceViaApi,
    decideExactAddressViaApi,
    decideVerificationAppealViaApi,
    decideVerificationViaApi,
    requestExactPublicAddressViaApi,
    requestPrivateAttachmentAccessViaApi,
    submitVerificationAppealViaApi,
    submitVerificationApplicationViaApi,
    uploadPrivateAttachmentViaApi,
    deletePrivateAttachmentViaApi,
    reviewPrivateAttachmentViaApi,
} from '../features/api-client';
import { useLocale } from '../i18n';
import {
    formatLocalizedLabel,
} from '../features/shell-shared';

export const VerificationRoute = ({ did }: { did: string }) => {
    const { t, fmt } = useLocale();
    const [workspace, setWorkspace] = useState<VerificationWorkspace>();
    const [review, setReview] = useState<VerificationReviewQueue>();
    const [attachments, setAttachments] = useState<PrivateAttachment[]>([]);
    const evidenceFileRef = useRef<HTMLInputElement>(null);
    const [accessUrls, setAccessUrls] = useState<Record<string, string>>({});
    const [exactReview, setExactReview] = useState<ExactAddressRequest[]>();
    const [status, setStatus] = useState(t('verification.loading'));
    const [subjectType, setSubjectType] =
        useState<VerificationSubjectType>('volunteer');
    const [organizationId, setOrganizationId] = useState('');
    const [resourceUri, setResourceUri] = useState('');
    const [evidenceLabel, setEvidenceLabel] = useState('');
    const [evidenceIssuer, setEvidenceIssuer] = useState('');
    const [privateNotes, setPrivateNotes] = useState('');
    const [attachmentId, setAttachmentId] = useState('');
    const [appealApplicationId, setAppealApplicationId] = useState('');
    const [appealReason, setAppealReason] = useState('');
    const [streetAddress, setStreetAddress] = useState('');
    const [latitude, setLatitude] = useState('');
    const [longitude, setLongitude] = useState('');
    const [confidentialFacility, setConfidentialFacility] = useState(false);
    const [reviewReason, setReviewReason] = useState(
        'Evidence reviewed against the verification policy.',
    );
    const loadSequence = useRef(0);

    const load = useCallback(async () => {
        if (!did) return;
        const sequence = ++loadSequence.current;
        setStatus(t('verification.loading'));
        const [mine, privateFiles] = await Promise.all([
            fetchVerificationWorkspaceViaApi(),
            fetchPrivateAttachmentsViaApi(),
        ]);
        if (sequence !== loadSequence.current) return;
        if (!mine.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setWorkspace(mine.data);
        if (privateFiles.ok) {
            setAttachments(privateFiles.data);
        } else {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setStatus(t('verification.loaded'));

        const [verificationQueue, exactQueue] = await Promise.all([
            fetchVerificationReviewQueueViaApi(),
            fetchExactAddressReviewQueueViaApi(),
        ]);
        if (sequence !== loadSequence.current) return;
        setReview(verificationQueue.ok ? verificationQueue.data : undefined);
        setExactReview(exactQueue.ok ? exactQueue.data : undefined);
    }, [did, t]);

    useEffect(() => {
        void load();
    }, [load]);

    if (!did) {
        return (
            <Panel title={t('verification.signIn')}>
                <p className='text-sm text-mh-textMuted'>
                    {t('verification.signInHelp')}
                </p>
                <a className='mh-text-link mt-3 inline-block' href='/login'>
                    {t('verification.signInAction')}
                </a>
            </Panel>
        );
    }

    const submitApplication = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setStatus(t('verification.submittingApplication'));
        const result = await submitVerificationApplicationViaApi({
            subjectType,
            ...(subjectType !== 'volunteer' ? { organizationId } : {}),
            ...(subjectType === 'resource' ? { resourceUri } : {}),
            evidence: [
                {
                    kind:
                        subjectType === 'volunteer'
                            ? 'identity'
                            : subjectType === 'organization'
                              ? 'organization-registration'
                              : 'service-authorization',
                    label: evidenceLabel,
                    issuer: evidenceIssuer || null,
                    issuedAt: null,
                    attachmentId: attachmentId || null,
                    privateNotes: privateNotes || null,
                },
            ],
        });
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setEvidenceLabel('');
        setEvidenceIssuer('');
        setPrivateNotes('');
        setAttachmentId('');
        await load();
        setStatus(t('verification.applicationSubmitted'));
    };

    const uploadEvidence = async () => {
        const evidenceFile = evidenceFileRef.current?.files?.[0];
        if (!evidenceFile) {
            setStatus(
                `${t('common.error')}: ${t('verification.chooseFileError')}`,
            );
            return;
        }
        setStatus(t('verification.uploading'));
        const result = await uploadPrivateAttachmentViaApi(
            evidenceFile,
            'verification-evidence',
            null,
        );
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        if (evidenceFileRef.current) {
            evidenceFileRef.current.value = '';
        }
        await load();
        setStatus(t('verification.uploaded'));
    };

    const deleteAttachment = async (attachmentIdToDelete: string) => {
        const result =
            await deletePrivateAttachmentViaApi(attachmentIdToDelete);
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        if (attachmentId === attachmentIdToDelete) {
            setAttachmentId('');
        }
        await load();
        setStatus(t('verification.deletionQueued'));
    };

    const prepareAccess = async (attachmentIdToOpen: string) => {
        const result =
            await requestPrivateAttachmentAccessViaApi(attachmentIdToOpen);
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setAccessUrls((current) => ({
            ...current,
            [attachmentIdToOpen]: result.data.url,
        }));
        setStatus(t('verification.accessReady'));
    };

    const moderateAttachment = async (
        attachmentIdToReview: string,
        action: 'quarantine' | 'release-for-rescan' | 'delete',
    ) => {
        const result = await reviewPrivateAttachmentViaApi(
            attachmentIdToReview,
            action,
            reviewReason,
        );
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setAccessUrls((current) => {
            const next = { ...current };
            delete next[attachmentIdToReview];
            return next;
        });
        await load();
        setStatus(t('verification.attachmentAction', { action }));
    };

    const submitAppeal = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setStatus(t('verification.submittingAppeal'));
        const result = await submitVerificationAppealViaApi({
            applicationId: appealApplicationId,
            reason: appealReason,
        });
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setAppealReason('');
        await load();
        setStatus(t('verification.appealSubmitted'));
    };

    const submitExactAddress = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setStatus(t('verification.submittingAddress'));
        const result = await requestExactPublicAddressViaApi({
            organizationId,
            resourceUri,
            streetAddress,
            latitude: Number(latitude),
            longitude: Number(longitude),
            confidentialFacility,
        });
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setStreetAddress('');
        await load();
        setStatus(
            confidentialFacility
                ? t('verification.confidentialQuarantined')
                : t('verification.addressSubmitted'),
        );
    };

    const decideApplication = async (
        application: VerificationApplication,
        action: 'approve' | 'deny' | 'revoke' | 'renew',
    ) => {
        setStatus(t('verification.recordingDecision', { action }));
        const result = await decideVerificationViaApi({
            applicationId: application.id,
            action,
            reason: reviewReason,
        });
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        await load();
        setStatus(t('verification.verificationDecision', { action }));
    };

    const decideAppeal = async (
        appeal: VerificationAppeal,
        decision: 'upheld' | 'denied',
    ) => {
        const result = await decideVerificationAppealViaApi({
            appealId: appeal.id,
            decision,
            resolutionNote: reviewReason,
        });
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        await load();
        setStatus(t('verification.appealDecision', { decision }));
    };

    const decideExact = async (
        request: ExactAddressRequest,
        decision: 'approve' | 'reject' | 'revoke',
    ) => {
        const result = await decideExactAddressViaApi({
            requestId: request.id,
            decision,
            reason: reviewReason,
        });
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        await load();
        setStatus(t('verification.addressDecision', { decision }));
    };

    const appealable =
        workspace?.applications.filter((application) =>
            ['denied', 'revoked', 'expired'].includes(application.status),
        ) ?? [];

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>{t('verification.heading')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('verification.description')}
                </p>
                <StatusMessage message={status} className='mt-3' />
            </header>

            <Panel title={t('verification.apply')}>
                <form className='space-y-3' onSubmit={submitApplication}>
                    <label className='block text-sm font-bold'>
                        {t('verification.subject')}
                        <select
                            className='mh-input mt-1 w-full px-3 py-2'
                            value={subjectType}
                            onChange={(event) =>
                                setSubjectType(
                                    event.target
                                        .value as VerificationSubjectType,
                                )
                            }
                        >
                            <option value='volunteer'>
                                {t('verification.volunteer')}
                            </option>
                            <option value='organization'>
                                {t('verification.organization')}
                            </option>
                            <option value='resource'>
                                {t('verification.resource')}
                            </option>
                        </select>
                    </label>
                    {subjectType !== 'volunteer' ? (
                        <label className='block text-sm font-bold'>
                            {t('verification.organizationId')}
                            <Input
                                className='mt-1'
                                required
                                value={organizationId}
                                onChange={(event) =>
                                    setOrganizationId(event.target.value)
                                }
                            />
                        </label>
                    ) : null}
                    {subjectType === 'resource' ? (
                        <label className='block text-sm font-bold'>
                            {t('verification.resourceUri')}
                            <Input
                                className='mt-1'
                                required
                                value={resourceUri}
                                onChange={(event) =>
                                    setResourceUri(event.target.value)
                                }
                            />
                        </label>
                    ) : null}
                    <label className='block text-sm font-bold'>
                        {t('verification.evidenceLabel')}
                        <Input
                            className='mt-1'
                            required
                            value={evidenceLabel}
                            onChange={(event) =>
                                setEvidenceLabel(event.target.value)
                            }
                        />
                    </label>
                    <label className='block text-sm font-bold'>
                        {t('verification.issuer')}
                        <Input
                            className='mt-1'
                            value={evidenceIssuer}
                            onChange={(event) =>
                                setEvidenceIssuer(event.target.value)
                            }
                        />
                    </label>
                    <Card title={t('verification.privateFile')}>
                        <p className='mb-2 text-xs text-mh-textMuted'>
                            {t('verification.fileHelp')}
                        </p>
                        <div className='flex flex-wrap items-end gap-2'>
                            <label className='min-w-64 flex-1 text-sm font-bold'>
                                {t('verification.imagePdf')}
                                <input
                                    className='mt-1'
                                    type='file'
                                    ref={evidenceFileRef}
                                    accept='image/jpeg,image/png,image/gif,image/webp,application/pdf'
                                />
                            </label>
                            <Button
                                type='button'
                                variant='secondary'
                                onClick={() => void uploadEvidence()}
                            >
                                {t('verification.upload')}
                            </Button>
                            <Button
                                type='button'
                                variant='neutral'
                                onClick={() => void load()}
                            >
                                {t('verification.refresh')}
                            </Button>
                        </div>
                        {attachments.length ? (
                            <ul className='mt-3 space-y-2'>
                                {attachments.map((attachment) => (
                                    <li
                                        className='mh-record-card text-xs'
                                        key={attachment.id}
                                    >
                                        <div className='flex flex-wrap items-center justify-between gap-2'>
                                            <span>
                                                <strong>
                                                    {attachment.filename}
                                                </strong>{' '}
                                                · {attachment.status} ·{' '}
                                                {Math.ceil(
                                                    attachment.byteSize / 1024,
                                                )}{' '}
                                                {t('verification.kilobytes')}
                                            </span>
                                            <div className='flex flex-wrap gap-2'>
                                                {attachment.status ===
                                                'clean' ? (
                                                    <Button
                                                        size='sm'
                                                        type='button'
                                                        variant='neutral'
                                                        onClick={() =>
                                                            void prepareAccess(
                                                                attachment.id,
                                                            )
                                                        }
                                                    >
                                                        {t(
                                                            'verification.preview',
                                                        )}
                                                    </Button>
                                                ) : null}
                                                <Button
                                                    size='sm'
                                                    type='button'
                                                    variant='neutral'
                                                    onClick={() =>
                                                        void deleteAttachment(
                                                            attachment.id,
                                                        )
                                                    }
                                                >
                                                    {t('verification.delete')}
                                                </Button>
                                            </div>
                                        </div>
                                        {accessUrls[attachment.id] ? (
                                            <a
                                                className='mh-text-link mt-2 inline-block'
                                                href={accessUrls[attachment.id]}
                                                target='_blank'
                                                rel='noreferrer'
                                            >
                                                {t('verification.openFile')}
                                            </a>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className='mt-2 text-xs text-mh-textMuted'>
                                {t('verification.noFiles')}
                            </p>
                        )}
                    </Card>
                    <label className='block text-sm font-bold'>
                        {t('verification.cleanFile')}
                        <select
                            className='mh-input mt-1 w-full px-3 py-2'
                            value={attachmentId}
                            onChange={(event) =>
                                setAttachmentId(event.target.value)
                            }
                        >
                            <option value=''>{t('verification.noFile')}</option>
                            {attachments
                                .filter(
                                    (attachment) =>
                                        attachment.status === 'clean' &&
                                        attachment.purpose ===
                                            'verification-evidence',
                                )
                                .map((attachment) => (
                                    <option
                                        key={attachment.id}
                                        value={attachment.id}
                                    >
                                        {attachment.filename}
                                    </option>
                                ))}
                        </select>
                    </label>
                    <label className='block text-sm font-bold'>
                        {t('verification.notes')}
                        <Input
                            className='mt-1'
                            value={privateNotes}
                            onChange={(event) =>
                                setPrivateNotes(event.target.value)
                            }
                        />
                    </label>
                    <Button type='submit'>{t('verification.submit')}</Button>
                </form>
            </Panel>

            <Panel title={t('verification.status')}>
                {workspace?.applications.length ? (
                    <ul className='space-y-3'>
                        {workspace.applications.map((application) => (
                            <li className='mh-record-card' key={application.id}>
                                <div className='flex flex-wrap justify-between gap-2'>
                                    <strong>
                                        {formatLocalizedLabel(
                                            t,
                                            application.subjectType,
                                        )}
                                    </strong>
                                    <Badge
                                        tone={
                                            application.status === 'approved'
                                                ? 'success'
                                                : application.status ===
                                                    'pending'
                                                  ? 'info'
                                                  : 'danger'
                                        }
                                    >
                                        {formatLocalizedLabel(
                                            t,
                                            application.status,
                                        )}
                                    </Badge>
                                </div>
                                <p className='mt-2 text-xs text-mh-textMuted'>
                                    {t('verification.application', {
                                        id: application.id,
                                    })}
                                </p>
                                {application.expiresAt ? (
                                    <p className='mt-1 text-xs'>
                                        {t('verification.expires', {
                                            date: fmt.longDate(
                                                application.expiresAt,
                                            ),
                                        })}
                                    </p>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className='text-sm text-mh-textMuted'>
                        {t('verification.noApplications')}
                    </p>
                )}
            </Panel>

            {appealable.length ? (
                <Panel title={t('verification.appeal')}>
                    <form className='space-y-3' onSubmit={submitAppeal}>
                        <label className='block text-sm font-bold'>
                            {t('verification.application', { id: '' })}
                            <select
                                className='mh-input mt-1 w-full px-3 py-2'
                                required
                                value={appealApplicationId}
                                onChange={(event) =>
                                    setAppealApplicationId(event.target.value)
                                }
                            >
                                <option value=''>
                                    {t('verification.choose')}
                                </option>
                                {appealable.map((application) => (
                                    <option
                                        key={application.id}
                                        value={application.id}
                                    >
                                        {application.subjectType} —{' '}
                                        {application.status}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className='block text-sm font-bold'>
                            {t('verification.appealReason')}
                            <Input
                                className='mt-1'
                                required
                                value={appealReason}
                                onChange={(event) =>
                                    setAppealReason(event.target.value)
                                }
                            />
                        </label>
                        <Button type='submit'>
                            {t('verification.submitAppeal')}
                        </Button>
                    </form>
                </Panel>
            ) : null}

            <Panel title={t('verification.exactAddress')}>
                <p className='mb-3 text-sm text-mh-textMuted'>
                    {t('verification.exactHelp')}
                </p>
                <form className='space-y-3' onSubmit={submitExactAddress}>
                    <label className='block text-sm font-bold'>
                        {t('verification.organizationId')}
                        <Input
                            className='mt-1'
                            required
                            value={organizationId}
                            onChange={(event) =>
                                setOrganizationId(event.target.value)
                            }
                        />
                    </label>
                    <label className='block text-sm font-bold'>
                        {t('verification.resourceUri')}
                        <Input
                            className='mt-1'
                            required
                            value={resourceUri}
                            onChange={(event) =>
                                setResourceUri(event.target.value)
                            }
                        />
                    </label>
                    <label className='block text-sm font-bold'>
                        {t('verification.street')}
                        <Input
                            className='mt-1'
                            required
                            value={streetAddress}
                            onChange={(event) =>
                                setStreetAddress(event.target.value)
                            }
                        />
                    </label>
                    <div className='grid gap-3 sm:grid-cols-2'>
                        <label className='block text-sm font-bold'>
                            {t('verification.latitude')}
                            <Input
                                className='mt-1'
                                type='number'
                                step='any'
                                required
                                value={latitude}
                                onChange={(event) =>
                                    setLatitude(event.target.value)
                                }
                            />
                        </label>
                        <label className='block text-sm font-bold'>
                            {t('verification.longitude')}
                            <Input
                                className='mt-1'
                                type='number'
                                step='any'
                                required
                                value={longitude}
                                onChange={(event) =>
                                    setLongitude(event.target.value)
                                }
                            />
                        </label>
                    </div>
                    <label className='flex items-center gap-2 text-sm font-bold'>
                        <input
                            type='checkbox'
                            checked={confidentialFacility}
                            onChange={(event) =>
                                setConfidentialFacility(event.target.checked)
                            }
                        />
                        {t('verification.confidential')}
                    </label>
                    <Button type='submit'>
                        {t('verification.requestApproval')}
                    </Button>
                </form>
                {workspace?.exactAddressRequests.length ? (
                    <ul className='mt-4 space-y-2'>
                        {workspace.exactAddressRequests.map((request) => (
                            <li className='mh-record-card' key={request.id}>
                                {request.resourceUri} —{' '}
                                <strong>{request.status}</strong>
                            </li>
                        ))}
                    </ul>
                ) : null}
            </Panel>

            {review || exactReview ? (
                <Panel title={t('verification.moderator')}>
                    <p className='mb-3 text-sm text-mh-textMuted'>
                        {t('verification.moderatorHelp')}
                    </p>
                    <label className='block text-sm font-bold'>
                        {t('verification.rationale')}
                        <Input
                            className='mt-1'
                            required
                            value={reviewReason}
                            onChange={(event) =>
                                setReviewReason(event.target.value)
                            }
                        />
                    </label>
                    <div className='mt-4 space-y-3'>
                        {review?.applications.map((application) => (
                            <Card
                                key={application.id}
                                title={`${application.subjectType} verification`}
                            >
                                <p className='text-xs'>
                                    {application.applicantDid} ·{' '}
                                    {application.status}
                                </p>
                                <ul className='my-2 text-xs'>
                                    {review.evidence
                                        .filter(
                                            (item) =>
                                                item.applicationId ===
                                                application.id,
                                        )
                                        .map((item) => (
                                            <li key={item.id}>
                                                {item.label}
                                                {item.attachment
                                                    ? ` — attachment ${item.attachment.status}`
                                                    : ''}
                                                {item.attachment ? (
                                                    <div className='mt-1 flex flex-wrap gap-2'>
                                                        {item.attachment
                                                            .status ===
                                                        'clean' ? (
                                                            <Button
                                                                size='sm'
                                                                type='button'
                                                                variant='neutral'
                                                                onClick={() =>
                                                                    void prepareAccess(
                                                                        item
                                                                            .attachment!
                                                                            .id,
                                                                    )
                                                                }
                                                            >
                                                                {t(
                                                                    'verification.prepareFile',
                                                                )}
                                                            </Button>
                                                        ) : null}
                                                        <Button
                                                            size='sm'
                                                            type='button'
                                                            variant='neutral'
                                                            onClick={() =>
                                                                void moderateAttachment(
                                                                    item
                                                                        .attachment!
                                                                        .id,
                                                                    'quarantine',
                                                                )
                                                            }
                                                        >
                                                            {t(
                                                                'verification.quarantine',
                                                            )}
                                                        </Button>
                                                        <Button
                                                            size='sm'
                                                            type='button'
                                                            variant='neutral'
                                                            onClick={() =>
                                                                void moderateAttachment(
                                                                    item
                                                                        .attachment!
                                                                        .id,
                                                                    'release-for-rescan',
                                                                )
                                                            }
                                                        >
                                                            {t(
                                                                'verification.rescan',
                                                            )}
                                                        </Button>
                                                        <Button
                                                            size='sm'
                                                            type='button'
                                                            variant='neutral'
                                                            onClick={() =>
                                                                void moderateAttachment(
                                                                    item
                                                                        .attachment!
                                                                        .id,
                                                                    'delete',
                                                                )
                                                            }
                                                        >
                                                            {t(
                                                                'verification.deleteFile',
                                                            )}
                                                        </Button>
                                                    </div>
                                                ) : null}
                                                {item.attachment &&
                                                accessUrls[
                                                    item.attachment.id
                                                ] ? (
                                                    <a
                                                        className='mh-text-link mt-1 inline-block'
                                                        href={
                                                            accessUrls[
                                                                item.attachment
                                                                    .id
                                                            ]
                                                        }
                                                        target='_blank'
                                                        rel='noreferrer'
                                                    >
                                                        {t(
                                                            'verification.openFile',
                                                        )}
                                                    </a>
                                                ) : null}
                                            </li>
                                        ))}
                                </ul>
                                <div className='flex flex-wrap gap-2'>
                                    {application.status === 'approved' ? (
                                        <>
                                            <Button
                                                onClick={() =>
                                                    void decideApplication(
                                                        application,
                                                        'renew',
                                                    )
                                                }
                                            >
                                                {t('verification.renew')}
                                            </Button>
                                            <Button
                                                variant='neutral'
                                                onClick={() =>
                                                    void decideApplication(
                                                        application,
                                                        'revoke',
                                                    )
                                                }
                                            >
                                                {t('verification.revoke')}
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            <Button
                                                onClick={() =>
                                                    void decideApplication(
                                                        application,
                                                        'approve',
                                                    )
                                                }
                                            >
                                                {t('verification.approve')}
                                            </Button>
                                            <Button
                                                variant='neutral'
                                                onClick={() =>
                                                    void decideApplication(
                                                        application,
                                                        'deny',
                                                    )
                                                }
                                            >
                                                {t('verification.deny')}
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </Card>
                        ))}
                        {review?.appeals.map((appeal) => (
                            <Card
                                key={appeal.id}
                                title={t('verification.appealReview')}
                            >
                                <p className='text-sm'>{appeal.reason}</p>
                                <div className='mt-2 flex gap-2'>
                                    <Button
                                        onClick={() =>
                                            void decideAppeal(appeal, 'upheld')
                                        }
                                    >
                                        {t('verification.uphold')}
                                    </Button>
                                    <Button
                                        variant='neutral'
                                        onClick={() =>
                                            void decideAppeal(appeal, 'denied')
                                        }
                                    >
                                        {t('verification.denyAppeal')}
                                    </Button>
                                </div>
                            </Card>
                        ))}
                        {exactReview?.map((request) => (
                            <Card
                                key={request.id}
                                title={t('verification.addressReview')}
                            >
                                <p className='text-sm'>
                                    {request.streetAddress} ·{' '}
                                    {request.resourceUri}
                                </p>
                                {request.confidentialFacility ? (
                                    <p className='mh-alert mt-2 text-xs font-bold'>
                                        {t(
                                            'verification.confidentialProhibited',
                                        )}
                                    </p>
                                ) : null}
                                <div className='mt-2 flex gap-2'>
                                    <Button
                                        disabled={request.confidentialFacility}
                                        onClick={() =>
                                            void decideExact(request, 'approve')
                                        }
                                    >
                                        {t('verification.approveAddress')}
                                    </Button>
                                    <Button
                                        variant='neutral'
                                        onClick={() =>
                                            void decideExact(request, 'reject')
                                        }
                                    >
                                        {t('verification.reject')}
                                    </Button>
                                </div>
                            </Card>
                        ))}
                    </div>
                </Panel>
            ) : null}
        </section>
    );
};
