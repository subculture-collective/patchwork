import {
    eligibilityQuestionIds,
    type ResourceProfile,
    type ResourceServiceProfile,
    type ResourceEvidence,
} from '@patchwork/shared';
import { useLocale } from '../i18n';
import { Button } from '../components/Button';

export function ResourceProfileEditor({
    profile,
    onChange,
    sourceUrl,
    sourceName,
    reconfirmServiceIds,
    onReconfirmChange,
}: {
    profile?: ResourceProfile;
    reconfirmServiceIds: string[];
    onReconfirmChange: (ids: string[]) => void;
    onChange: (profile: ResourceProfile) => void;
    sourceUrl: string;
    sourceName: string;
}) {
    const { t } = useLocale();
    const current = profile ?? { version: 1 as const, services: [] };
    const evidence = (): ResourceEvidence => ({
        sourceUrl,
        sourceName,
        confirmedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        reviewStatus: 'reviewed',
    });
    const update = (index: number, service: ResourceServiceProfile) =>
        onChange({
            ...current,
            services: current.services.map((s, i) =>
                i === index ? service : s,
            ),
        });
    return (
        <fieldset className="space-y-4 border-t pt-3">
            <legend>{t('serviceDetails.heading')}</legend>
            <p>{t('profileEditor.sourceNotice')}</p>
            <label className="block">
                {t('profileEditor.organization')}
                <input
                    className="mh-input block w-full"
                    maxLength={200}
                    value={current.organizationName ?? ''}
                    onChange={(e) =>
                        onChange({
                            ...current,
                            organizationName: e.target.value || undefined,
                        })
                    }
                />
            </label>
            {current.services.map((service, index) => (
                <fieldset key={service.id} className="space-y-3 border-t pt-3">
                    <legend>
                        {service.name || t('profileEditor.newService')}
                    </legend>
                    <label className="block">
                        <input type="checkbox" checked={reconfirmServiceIds.includes(service.id)} onChange={event => onReconfirmChange(event.target.checked ? [...reconfirmServiceIds,service.id] : reconfirmServiceIds.filter(id=>id!==service.id))} />
                        {t('profileEditor.reconfirm')}
                    </label>
                    <label className="block">
                        {t('profileEditor.name')}
                        <input
                            className="mh-input block w-full"
                            required
                            maxLength={160}
                            value={service.name}
                            onChange={(e) =>
                                update(index, {
                                    ...service,
                                    name: e.target.value,
                                })
                            }
                        />
                    </label>
                    {(
                        [
                            'serviceArea',
                            'cost',
                            'languages',
                            'accessibility',
                            'documents',
                        ] as const
                    ).map((field) => (
                        <label className="block" key={field}>
                            {t(`serviceDetails.fields.${field}`)}
                            <input
                                className="mh-input block w-full"
                                maxLength={500}
                                value={
                                    Array.isArray(service[field]?.value)
                                        ? (
                                              service[field]!.value as string[]
                                          ).join(', ')
                                        : String(service[field]?.value ?? '')
                                }
                                onChange={(e) => {
                                    const text = e.target.value;
                                    const next = { ...service };
                                    if (
                                        field === 'serviceArea' ||
                                        field === 'cost'
                                    )
                                        next[field] = text
                                            ? {
                                                  value: text,
                                                  evidence: evidence(),
                                              }
                                            : undefined;
                                    else
                                        next[field] = text
                                            ? {
                                                  value: text
                                                      .split(',')
                                                      .map((v) => v.trim())
                                                      .filter(Boolean),
                                                  evidence: evidence(),
                                              }
                                            : undefined;
                                    update(index, next);
                                }}
                            />
                        </label>
                    ))}
                    <p className="text-sm">{t('profileEditor.commas')}</p>
                    {(['delivery', 'appointment'] as const).map((field) => (
                        <label className="block" key={field}>
                            {t(`serviceDetails.fields.${field}`)}
                            <select
                                className="mh-input block w-full"
                                value={service[field]?.value ?? ''}
                                onChange={(e) => {
                                    const next = { ...service };
                                    if (field === 'delivery')
                                        next.delivery = e.target.value
                                            ? {
                                                  value: e.target.value as
                                                      | 'in-person'
                                                      | 'remote'
                                                      | 'hybrid',
                                                  evidence: evidence(),
                                              }
                                            : undefined;
                                    else
                                        next.appointment = e.target.value
                                            ? {
                                                  value: e.target.value as
                                                      | 'required'
                                                      | 'recommended'
                                                      | 'walk-in',
                                                  evidence: evidence(),
                                              }
                                            : undefined;
                                    update(index, next);
                                }}
                            >
                                <option value="">
                                    {t('profileEditor.unknown')}
                                </option>
                                {(field === 'delivery'
                                    ? ([
                                          'in-person',
                                          'remote',
                                          'hybrid',
                                      ] as const)
                                    : ([
                                          'required',
                                          'recommended',
                                          'walk-in',
                                      ] as const)
                                ).map((value) => (
                                    <option key={value} value={value}>
                                        {t(`serviceDetails.values.${value}`)}
                                    </option>
                                ))}
                            </select>
                        </label>
                    ))}
                    <label className="block">
                        {t('profileEditor.application')}
                        <input
                            type="url"
                            className="mh-input block w-full"
                            value={service.applicationUrl?.value ?? ''}
                            onChange={(e) =>
                                update(index, {
                                    ...service,
                                    applicationUrl: e.target.value
                                        ? {
                                              value: e.target.value,
                                              evidence: evidence(),
                                          }
                                        : undefined,
                                })
                            }
                        />
                    </label>
                    <details>
                        <summary>{t('profileEditor.hours')}</summary>
                        {!service.hours ? (
                            <Button
                                variant="neutral"
                                type="button"
                                onClick={() =>
                                    update(index, {
                                        ...service,
                                        hours: {
                                            evidence: evidence(),
                                            value: {
                                                timezone: '',
                                                weekly: [],
                                                exceptions: [],
                                            },
                                        },
                                    })
                                }
                            >
                                {t('profileEditor.addHours')}
                            </Button>
                        ) : (
                            <>
                                <label className="block">
                                    {t('profileEditor.timezone')}
                                    <input
                                        className="mh-input block w-full"
                                        required
                                        placeholder="America/Chicago"
                                        value={service.hours.value.timezone}
                                        onChange={(e) =>
                                            update(index, {
                                                ...service,
                                                hours: {
                                                    evidence: evidence(),
                                                    value: {
                                                        ...service.hours!.value,
                                                        timezone:
                                                            e.target.value,
                                                    },
                                                },
                                            })
                                        }
                                    />
                                </label>
                                {service.hours.value.weekly.map(
                                    (interval, i) => (
                                        <div
                                            key={i}
                                            className="flex flex-wrap gap-2 py-2"
                                        >
                                            <label>
                                                {t('profileEditor.day')}
                                                <select
                                                    className="mh-input block"
                                                    value={interval.day}
                                                    onChange={(e) =>
                                                        update(index, {
                                                            ...service,
                                                            hours: {
                                                                evidence:
                                                                    evidence(),
                                                                value: {
                                                                    ...service
                                                                        .hours!
                                                                        .value,
                                                                    weekly: service.hours!.value.weekly.map(
                                                                        (
                                                                            v,
                                                                            n,
                                                                        ) =>
                                                                            n ===
                                                                            i
                                                                                ? {
                                                                                      ...v,
                                                                                      day: Number(
                                                                                          e
                                                                                              .target
                                                                                              .value,
                                                                                      ),
                                                                                  }
                                                                                : v,
                                                                    ),
                                                                },
                                                            },
                                                        })
                                                    }
                                                >
                                                    {[0, 1, 2, 3, 4, 5, 6].map(
                                                        (day) => (
                                                            <option
                                                                key={day}
                                                                value={day}
                                                            >
                                                                {t(
                                                                    `profileEditor.days.${day as 0 | 1 | 2 | 3 | 4 | 5 | 6}`,
                                                                )}
                                                            </option>
                                                        ),
                                                    )}
                                                </select>
                                            </label>
                                            {(['start', 'end'] as const).map(
                                                (field) => (
                                                    <label key={field}>
                                                        {t(
                                                            `profileEditor.${field}`,
                                                        )}
                                                        <input
                                                            type="time"
                                                            className="mh-input block"
                                                            required
                                                            value={`${String(Math.floor((interval[field] % 1440) / 60)).padStart(2, '0')}:${String(interval[field] % 60).padStart(2, '0')}`}
                                                            onChange={(e) => {
                                                                if (
                                                                    !e.target
                                                                        .value
                                                                )
                                                                    return;
                                                                const [h, m] =
                                                                    e.target.value
                                                                        .split(
                                                                            ':',
                                                                        )
                                                                        .map(
                                                                            Number,
                                                                        );
                                                                update(index, {
                                                                    ...service,
                                                                    hours: {
                                                                        evidence:
                                                                            evidence(),
                                                                        value: {
                                                                            ...service
                                                                                .hours!
                                                                                .value,
                                                                            weekly: service.hours!.value.weekly.map(
                                                                                (
                                                                                    v,
                                                                                    n,
                                                                                ) =>
                                                                                    n ===
                                                                                    i
                                                                                        ? {
                                                                                              ...v,
                                                                                              [field]:
                                                                                                  field ===
                                                                                                      'end' &&
                                                                                                  h ===
                                                                                                      0 &&
                                                                                                  m ===
                                                                                                      0
                                                                                                      ? 1440
                                                                                                      : h! *
                                                                                                            60 +
                                                                                                        m!,
                                                                                          }
                                                                                        : v,
                                                                            ),
                                                                        },
                                                                    },
                                                                });
                                                            }}
                                                        />
                                                    </label>
                                                ),
                                            )}
                                            <Button
                                                type="button"
                                                variant="neutral"
                                                onClick={() =>
                                                    update(index, {
                                                        ...service,
                                                        hours: {
                                                            evidence:
                                                                evidence(),
                                                            value: {
                                                                ...service
                                                                    .hours!
                                                                    .value,
                                                                weekly: service.hours!.value.weekly.filter(
                                                                    (_, n) =>
                                                                        n !== i,
                                                                ),
                                                            },
                                                        },
                                                    })
                                                }
                                            >
                                                {t('saved.remove')}
                                            </Button>
                                        </div>
                                    ),
                                )}
                                <Button
                                    type="button"
                                    variant="neutral"
                                    onClick={() =>
                                        update(index, {
                                            ...service,
                                            hours: {
                                                evidence: evidence(),
                                                value: {
                                                    ...service.hours!.value,
                                                    weekly: [
                                                        ...service.hours!.value
                                                            .weekly,
                                                        {
                                                            day: 1,
                                                            start: 540,
                                                            end: 1020,
                                                        },
                                                    ],
                                                },
                                            },
                                        })
                                    }
                                >
                                    {t('profileEditor.addInterval')}
                                </Button>
                                <p>{t('profileEditor.overnight')}</p>
                                {service.hours.value.exceptions.map(
                                    (exception, i) => (
                                        <div
                                            key={i}
                                            className="flex gap-2 py-2"
                                        >
                                            <label>
                                                {t(
                                                    exception.intervals.length
                                                        ? 'profileEditor.exceptionDate'
                                                        : 'profileEditor.closedDate',
                                                )}
                                                <input
                                                    className="mh-input block"
                                                    type="date"
                                                    required
                                                    value={exception.date}
                                                    onChange={(e) =>
                                                        update(index, {
                                                            ...service,
                                                            hours: {
                                                                evidence:
                                                                    evidence(),
                                                                value: {
                                                                    ...service
                                                                        .hours!
                                                                        .value,
                                                                    exceptions:
                                                                        service.hours!.value.exceptions.map(
                                                                            (
                                                                                v,
                                                                                n,
                                                                            ) =>
                                                                                n ===
                                                                                i
                                                                                    ? {
                                                                                          ...v,
                                                                                          date: e
                                                                                              .target
                                                                                              .value,
                                                                                      }
                                                                                    : v,
                                                                        ),
                                                                },
                                                            },
                                                        })
                                                    }
                                                />
                                            </label>
                                            {exception.intervals.length > 0 && (
                                                <p>
                                                    {exception.intervals
                                                        .map(
                                                            (value) =>
                                                                `${String(Math.floor(value.start / 60)).padStart(2, '0')}:${String(value.start % 60).padStart(2, '0')}–${String(Math.floor(value.end / 60)).padStart(2, '0')}:${String(value.end % 60).padStart(2, '0')}`,
                                                        )
                                                        .join(', ')}
                                                </p>
                                            )}
                                            <Button
                                                type="button"
                                                variant="neutral"
                                                onClick={() =>
                                                    update(index, {
                                                        ...service,
                                                        hours: {
                                                            evidence:
                                                                evidence(),
                                                            value: {
                                                                ...service
                                                                    .hours!
                                                                    .value,
                                                                exceptions:
                                                                    service.hours!.value.exceptions.filter(
                                                                        (
                                                                            _,
                                                                            n,
                                                                        ) =>
                                                                            n !==
                                                                            i,
                                                                    ),
                                                            },
                                                        },
                                                    })
                                                }
                                            >
                                                {t('saved.remove')}
                                            </Button>
                                        </div>
                                    ),
                                )}
                                <Button
                                    type="button"
                                    variant="neutral"
                                    onClick={() =>
                                        update(index, {
                                            ...service,
                                            hours: {
                                                evidence: evidence(),
                                                value: {
                                                    ...service.hours!.value,
                                                    exceptions: [
                                                        ...service.hours!.value
                                                            .exceptions,
                                                        {
                                                            date: '',
                                                            intervals: [],
                                                        },
                                                    ],
                                                },
                                            },
                                        })
                                    }
                                >
                                    {t('profileEditor.addClosure')}
                                </Button>
                                <Button
                                    type="button"
                                    variant="neutral"
                                    onClick={() =>
                                        update(index, {
                                            ...service,
                                            hours: undefined,
                                        })
                                    }
                                >
                                    {t('profileEditor.clearHours')}
                                </Button>
                            </>
                        )}
                    </details>
                    <details>
                        <summary>{t('profileEditor.requirements')}</summary>
                        <p>{t('profileEditor.rulesHelp')}</p>
                        {service.eligibility.map((rule, i) => (
                            <fieldset
                                key={i}
                                className="space-y-2 border-t py-2"
                            >
                                <label>
                                    {t('profileEditor.question')}
                                    <select
                                        className="mh-input block w-full"
                                        value={rule.question}
                                        onChange={(e) => {
                                            const question = e.target
                                                .value as typeof rule.question;
                                            update(index, {
                                                ...service,
                                                eligibility:
                                                    service.eligibility.map(
                                                        (v, n) =>
                                                            n === i
                                                                ? {
                                                                      ...v,
                                                                      question,
                                                                      operator:
                                                                          'equals',
                                                                      value:
                                                                          question ===
                                                                          'state'
                                                                              ? ''
                                                                              : question ===
                                                                                      'veteran' ||
                                                                                  question ===
                                                                                      'pregnantOrPostpartum'
                                                                                ? false
                                                                                : 0,
                                                                  }
                                                                : v,
                                                    ),
                                            });
                                        }}
                                    >
                                        {eligibilityQuestionIds.map((q) => (
                                            <option key={q} value={q}>
                                                {t(
                                                    `serviceDetails.questions.${q}`,
                                                )}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label>
                                    {t('profileEditor.operator')}
                                    <select
                                        className="mh-input block w-full"
                                        value={rule.operator}
                                        onChange={(e) =>
                                            update(index, {
                                                ...service,
                                                eligibility:
                                                    service.eligibility.map(
                                                        (v, n) =>
                                                            n === i
                                                                ? {
                                                                      ...v,
                                                                      operator:
                                                                          e
                                                                              .target
                                                                              .value as typeof rule.operator,
                                                                  }
                                                                : v,
                                                    ),
                                            })
                                        }
                                    >
                                        {(typeof rule.value === 'number'
                                            ? ([
                                                  'equals',
                                                  'at-most',
                                                  'at-least',
                                              ] as const)
                                            : (['equals'] as const)
                                        ).map((op) => (
                                            <option key={op} value={op}>
                                                {t(
                                                    `profileEditor.operators.${op}`,
                                                )}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label>
                                    {t('profileEditor.value')}
                                    {typeof rule.value === 'boolean' ? (
                                        <select
                                            className="mh-input block"
                                            value={String(rule.value)}
                                            onChange={(e) =>
                                                update(index, {
                                                    ...service,
                                                    eligibility:
                                                        service.eligibility.map(
                                                            (v, n) =>
                                                                n === i
                                                                    ? {
                                                                          ...v,
                                                                          value:
                                                                              e
                                                                                  .target
                                                                                  .value ===
                                                                              'true',
                                                                      }
                                                                    : v,
                                                        ),
                                                })
                                            }
                                        >
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
                                            required
                                            type={
                                                typeof rule.value === 'number'
                                                    ? 'number'
                                                    : 'text'
                                            }
                                            min={0}
                                            value={rule.value}
                                            onChange={(e) =>
                                                update(index, {
                                                    ...service,
                                                    eligibility:
                                                        service.eligibility.map(
                                                            (v, n) =>
                                                                n === i
                                                                    ? {
                                                                          ...v,
                                                                          value:
                                                                              typeof rule.value ===
                                                                              'number'
                                                                                  ? Number(
                                                                                        e
                                                                                            .target
                                                                                            .value,
                                                                                    )
                                                                                  : e.target.value.toUpperCase(),
                                                                      }
                                                                    : v,
                                                        ),
                                                })
                                            }
                                        />
                                    )}
                                </label>
                                <label>
                                    {t('profileEditor.description')}
                                    <input
                                        className="mh-input block w-full"
                                        required
                                        maxLength={500}
                                        value={rule.description}
                                        onChange={(e) =>
                                            update(index, {
                                                ...service,
                                                eligibility:
                                                    service.eligibility.map(
                                                        (v, n) =>
                                                            n === i
                                                                ? {
                                                                      ...v,
                                                                      description:
                                                                          e
                                                                              .target
                                                                              .value,
                                                                  }
                                                                : v,
                                                    ),
                                            })
                                        }
                                    />
                                </label>
                                <Button
                                    type="button"
                                    variant="neutral"
                                    onClick={() =>
                                        update(index, {
                                            ...service,
                                            eligibility:
                                                service.eligibility.filter(
                                                    (_, n) => n !== i,
                                                ),
                                        })
                                    }
                                >
                                    {t('saved.remove')}
                                </Button>
                            </fieldset>
                        ))}
                        <Button
                            type="button"
                            variant="neutral"
                            onClick={() =>
                                update(index, {
                                    ...service,
                                    eligibility: [
                                        ...service.eligibility,
                                        {
                                            question: 'ageYears',
                                            operator: 'at-least',
                                            value: 18,
                                            description: '',
                                            evidence: evidence(),
                                        },
                                    ],
                                })
                            }
                        >
                            {t('profileEditor.addRule')}
                        </Button>
                    </details>
                    <Button
                        variant="neutral"
                        type="button"
                        onClick={() =>
                            onChange({
                                ...current,
                                services: current.services.filter(
                                    (_, i) => i !== index,
                                ),
                            })
                        }
                    >
                        {t('profileEditor.removeService')}
                    </Button>
                </fieldset>
            ))}
            <Button
                type="button"
                variant="neutral"
                onClick={() =>
                    onChange({
                        ...current,
                        services: [
                            ...current.services,
                            {
                                id: crypto.randomUUID(),
                                name: '',
                                eligibility: [],
                            },
                        ],
                    })
                }
            >
                {t('profileEditor.addService')}
            </Button>
        </fieldset>
    );
}
