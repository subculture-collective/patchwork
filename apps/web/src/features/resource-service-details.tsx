import { useEffect, useState } from 'react';
import {
    currentResourceEvidence,
    evaluateServiceEligibility,
    serviceScheduleStatus,
    type EligibilityAnswers,
    type ResourceProfile,
} from '@patchwork/shared';
import { useAuth } from '../auth/AuthProvider';
import { useLocale } from '../i18n';
import { Button } from '../components/Button';

export function ResourceServiceDetails({
    profile,
    resourceUri,
}: {
    profile: ResourceProfile;
    resourceUri: string;
}) {
    const { t } = useLocale();
    const auth = useAuth();
    const [answers, setAnswers] = useState<EligibilityAnswers>({});
    const [matching, setMatching] = useState(false);
    useEffect(() => {
        setAnswers({});
        setMatching(false);
    }, [resourceUri, auth.session?.did]);
    const now = new Date();
    const questions = [
        ...new Set(
            profile.services.flatMap((service) =>
                service.eligibility
                    .filter((rule) =>
                        currentResourceEvidence(rule.evidence, now),
                    )
                    .map((rule) => rule.question),
            ),
        ),
    ];
    return (
        <section className="space-y-4" aria-label={t('serviceDetails.heading')}>
            <h3 className="font-bold">{t('serviceDetails.heading')}</h3>
            {profile.organizationName && <p>{profile.organizationName}</p>}
            {!!questions.length && (
                <details
                    onToggle={(event) => {
                        if (!event.currentTarget.open) {
                            setAnswers({});
                            setMatching(false);
                        } else setMatching(true);
                    }}
                >
                    <summary>{t('serviceDetails.check')}</summary>
                    <p>{t('serviceDetails.temporary')}</p>
                    {questions.map((question) => (
                        <label key={question} className="block py-2">
                            {t(`serviceDetails.questions.${question}`)}
                            {['veteran', 'pregnantOrPostpartum'].includes(
                                question,
                            ) ? (
                                <select
                                    className="mh-input block w-full"
                                    value={
                                        answers[question] === undefined
                                            ? ''
                                            : String(answers[question])
                                    }
                                    onChange={(event) =>
                                        setAnswers((previous) => ({
                                            ...previous,
                                            [question]:
                                                event.target.value === ''
                                                    ? undefined
                                                    : event.target.value ===
                                                      'true',
                                        }))
                                    }
                                >
                                    <option value="">
                                        {t('serviceDetails.skip')}
                                    </option>
                                    <option value="true">
                                        {t('serviceDetails.yes')}
                                    </option>
                                    <option value="false">
                                        {t('serviceDetails.no')}
                                    </option>
                                </select>
                            ) : (
                                <input
                                    className="mh-input block w-full"
                                    autoComplete="off"
                                    type={
                                        question === 'state' ? 'text' : 'number'
                                    }
                                    min={0}
                                    maxLength={
                                        question === 'state' ? 2 : undefined
                                    }
                                    value={String(answers[question] ?? '')}
                                    onChange={(event) =>
                                        setAnswers((previous) => ({
                                            ...previous,
                                            [question]:
                                                event.target.value === ''
                                                    ? undefined
                                                    : question === 'state'
                                                      ? event.target.value.toUpperCase()
                                                      : Number(
                                                            event.target.value,
                                                        ),
                                        }))
                                    }
                                />
                            )}
                        </label>
                    ))}
                    <Button
                        variant="neutral"
                        type="button"
                        onClick={() => setAnswers({})}
                    >
                        {t('serviceDetails.clear')}
                    </Button>
                </details>
            )}
            {profile.services.map((service) => {
                const result = evaluateServiceEligibility(
                    service,
                    answers,
                    now,
                );
                const schedule = serviceScheduleStatus(service, now, now);
                const fields = [
                    'delivery',
                    'serviceArea',
                    'cost',
                    'languages',
                    'accessibility',
                    'documents',
                    'appointment',
                ] as const;
                return (
                    <article
                        key={service.id}
                        className="border-t border-mh-borderSoft pt-3 space-y-2"
                    >
                        <h4 className="font-bold">{service.name}</h4>
                        <p>{t(`serviceDetails.schedule.${schedule}`)}</p>
                        {service.hours && (
                            <details>
                                <summary>
                                    {t('profileEditor.hours')} ·{' '}
                                    {service.hours.value.timezone}
                                </summary>
                                {!currentResourceEvidence(
                                    service.hours.evidence,
                                    now,
                                ) && <p>{t('serviceDetails.needsReview')}</p>}
                                <ul>
                                    {service.hours.value.weekly.map(
                                        (interval, i) => (
                                            <li key={i}>
                                                {t(
                                                    `profileEditor.days.${interval.day as 0 | 1 | 2 | 3 | 4 | 5 | 6}`,
                                                )}
                                                :{' '}
                                                {formatMinutes(interval.start)}–
                                                {formatMinutes(interval.end)}
                                                {interval.end <
                                                    interval.start && (
                                                    <>
                                                        {' '}
                                                        ·{' '}
                                                        {t(
                                                            'serviceDetails.nextDay',
                                                        )}
                                                    </>
                                                )}
                                            </li>
                                        ),
                                    )}
                                    {service.hours.value.exceptions.map(
                                        (exception) => (
                                            <li key={exception.date}>
                                                {exception.date}:{' '}
                                                {exception.intervals.length
                                                    ? exception.intervals
                                                          .map(
                                                              (interval) =>
                                                                  `${formatMinutes(interval.start)}–${formatMinutes(interval.end)}`,
                                                          )
                                                          .join(', ')
                                                    : t(
                                                          'serviceDetails.schedule.scheduled-closed',
                                                      )}
                                            </li>
                                        ),
                                    )}
                                </ul>
                                <a
                                    className="mh-link"
                                    href={service.hours.evidence.sourceUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {t('serviceDetails.source')}
                                </a>
                            </details>
                        )}
                        {fields.map((field) => {
                            const fact = service[field];
                            if (!fact) return null;
                            const current = currentResourceEvidence(
                                fact.evidence,
                                now,
                            );
                            return (
                                <div key={field}>
                                    <strong>
                                        {t(`serviceDetails.fields.${field}`)}
                                        :{' '}
                                    </strong>
                                    <span>
                                        {Array.isArray(fact.value)
                                            ? fact.value.join(', ')
                                            : [
                                                    'appointment',
                                                    'delivery',
                                                ].includes(field)
                                              ? t(
                                                    `serviceDetails.values.${fact.value as 'in-person' | 'remote' | 'hybrid' | 'required' | 'recommended' | 'walk-in'}`,
                                                )
                                              : fact.value}
                                    </span>
                                    {!current && (
                                        <span>
                                            {' '}
                                            · {t('serviceDetails.needsReview')}
                                        </span>
                                    )}
                                    <a
                                        className="mh-link ml-2"
                                        href={fact.evidence.sourceUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        {t('serviceDetails.source')}
                                    </a>
                                </div>
                            );
                        })}
                        {service.applicationUrl &&
                            currentResourceEvidence(
                                service.applicationUrl.evidence,
                                now,
                            ) && (
                                <a
                                    className="mh-link"
                                    href={service.applicationUrl.value}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {t('serviceDetails.apply')}
                                </a>
                            )}
                        {matching && (
                            <div role="status">
                                <strong>
                                    {t(`serviceDetails.match.${result.status}`)}
                                </strong>
                                <ul>
                                    {result.rules.map((rule, index) => (
                                        <li key={index}>
                                            {rule.description} ·{' '}
                                            {t(
                                                `serviceDetails.rule.${rule.status}`,
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </article>
                );
            })}
        </section>
    );
}

function formatMinutes(value: number): string {
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
