import { createFeedCard } from '../feed-ux';
import type { ResourceDirectoryCard } from '../resource-directory-ux';
import type { FeedRecordEnvelope } from './discovery-runtime';

// Demo data sits inside the Cook and DuPage demonstration area that discovery
// falls back to when location is unavailable (see demoAreaPresets).

/** Local demo data. Runtime callers must gate this behind VITE_DATA_MODE=fixture. */
export const fixtureFeedRecords: FeedRecordEnvelope[] = [
    {
        aidPostUri: 'at://did:example:resident-1/app.patchwork.aid.post/post-1',
        recipientDid: 'did:example:resident-1',
        card: createFeedCard({
            id: 'post-1',
            title: 'Groceries and infant formula tonight',
            description:
                'Two households in Pilsen need meal kits and infant formula before 9 pm.',
            category: 'food',
            urgency: 5,
            status: 'open',
            accessibilityTags: ['wheelchair', 'quiet-arrival'],
            updatedAt: '2026-09-22T22:20:00.000Z',
            location: { lat: 41.857, lng: -87.657, precisionKm: 1 },
        }),
    },
    {
        aidPostUri: 'at://did:example:resident-2/app.patchwork.aid.post/post-2',
        recipientDid: 'did:example:resident-2',
        card: createFeedCard({
            id: 'post-2',
            title: 'Ride to a clinic appointment',
            description:
                'Wheelchair-accessible ride needed from Cicero for an evening appointment.',
            category: 'transport',
            urgency: 4,
            status: 'in-progress',
            accessibilityTags: ['mobility-aid'],
            updatedAt: '2026-09-22T21:42:00.000Z',
            location: { lat: 41.846, lng: -87.754, precisionKm: 1 },
        }),
    },
    {
        aidPostUri: 'at://did:example:resident-3/app.patchwork.aid.post/post-3',
        recipientDid: 'did:example:resident-3',
        card: createFeedCard({
            id: 'post-3',
            title: 'Safe place to stay for two nights',
            description:
                'A caregiver and child in Berwyn need a safe overnight place while housing is sorted.',
            category: 'shelter',
            urgency: 4,
            status: 'open',
            accessibilityTags: ['child-safe'],
            updatedAt: '2026-09-22T20:55:00.000Z',
            location: { lat: 41.85, lng: -87.794, precisionKm: 1 },
        }),
    },
    {
        aidPostUri: 'at://did:example:resident-4/app.patchwork.aid.post/post-4',
        recipientDid: 'did:example:resident-4',
        card: createFeedCard({
            id: 'post-4',
            title: 'Pick up a prescription',
            description:
                'Someone to collect a prescription in Oak Park and drop it off this afternoon.',
            category: 'medical',
            urgency: 2,
            status: 'resolved',
            accessibilityTags: ['language-support'],
            updatedAt: '2026-09-22T18:05:00.000Z',
            location: { lat: 41.886, lng: -87.785, precisionKm: 1 },
        }),
    },
    {
        aidPostUri: 'at://did:example:resident-5/app.patchwork.aid.post/post-5',
        recipientDid: 'did:example:resident-5',
        card: createFeedCard({
            id: 'post-5',
            title: 'After-school childcare on Thursday',
            description:
                'Looking for two hours of childcare in Humboldt Park while I finish a shift.',
            category: 'childcare',
            urgency: 3,
            status: 'open',
            accessibilityTags: ['child-safe'],
            updatedAt: '2026-09-22T17:30:00.000Z',
            location: { lat: 41.902, lng: -87.721, precisionKm: 1 },
        }),
    },
    {
        aidPostUri: 'at://did:example:resident-6/app.patchwork.aid.post/post-6',
        recipientDid: 'did:example:resident-6',
        card: createFeedCard({
            id: 'post-6',
            title: 'Help moving boxes to a new apartment',
            description:
                'Need two people with a car for a short move in Elmhurst on Saturday morning.',
            category: 'transport',
            urgency: 2,
            status: 'open',
            accessibilityTags: [],
            updatedAt: '2026-09-22T16:10:00.000Z',
            location: { lat: 41.899, lng: -87.94, precisionKm: 1 },
        }),
    },
    {
        aidPostUri: 'at://did:example:resident-7/app.patchwork.aid.post/post-7',
        recipientDid: 'did:example:resident-7',
        card: createFeedCard({
            id: 'post-7',
            title: 'Warm coats for three kids',
            description:
                'Sizes 6, 8 and 10 before the cold snap. Can pick up anywhere in Wheaton.',
            category: 'other',
            urgency: 3,
            status: 'open',
            accessibilityTags: ['quiet-arrival'],
            updatedAt: '2026-09-22T14:45:00.000Z',
            location: { lat: 41.866, lng: -88.107, precisionKm: 1 },
        }),
    },
    {
        aidPostUri: 'at://did:example:resident-8/app.patchwork.aid.post/post-8',
        recipientDid: 'did:example:resident-8',
        card: createFeedCard({
            id: 'post-8',
            title: 'Spanish interpreter for a benefits call',
            description:
                'Need someone to join a 30-minute phone call on Friday from Naperville.',
            category: 'other',
            urgency: 3,
            status: 'in-progress',
            accessibilityTags: ['language-support'],
            updatedAt: '2026-09-22T12:15:00.000Z',
            location: { lat: 41.75, lng: -88.153, precisionKm: 1 },
        }),
    },
];

/** Local demo data. Runtime callers must gate this behind VITE_DATA_MODE=fixture. */
export const fixtureResourceCards: ResourceDirectoryCard[] = [
    {
        uri: 'at://did:example:org/app.patchwork.directory.resource/food-01',
        id: 'food-01',
        name: 'Pilsen Community Pantry',
        category: 'food-bank',
        location: {
            lat: 41.855,
            lng: -87.662,
            precisionMeters: 180,
            areaLabel: 'Pilsen',
        },
        openHours: 'Tue, Thu, Sat · 10:00–16:00',
        eligibilityNotes: 'Walk-ins welcome, no ID needed',
        contact: {
            phone: '+1-555-0110',
        },
    },
    {
        uri: 'at://did:example:org/app.patchwork.directory.resource/clinic-01',
        id: 'clinic-01',
        name: 'Westside Neighborhood Clinic',
        category: 'clinic',
        location: {
            lat: 41.881,
            lng: -87.724,
            precisionMeters: 220,
            areaLabel: 'West Garfield Park',
        },
        openHours: 'Mon–Sat · 09:00–18:00',
        eligibilityNotes: 'Sliding-scale fees; same-day visits',
        contact: {
            phone: '+1-555-0191',
            url: 'https://example.org/clinic',
        },
    },
    {
        uri: 'at://did:example:org/app.patchwork.directory.resource/shelter-01',
        id: 'shelter-01',
        name: 'Harbor House Family Shelter',
        category: 'shelter',
        location: {
            lat: 41.848,
            lng: -87.79,
            precisionMeters: 260,
            areaLabel: 'Berwyn',
        },
        openHours: '24/7 intake',
        eligibilityNotes: 'Family rooms and quiet space available',
        contact: {
            phone: '+1-555-0133',
        },
    },
    {
        uri: 'at://did:example:org/app.patchwork.directory.resource/legal-01',
        id: 'legal-01',
        name: 'Tenant Legal Aid Desk',
        category: 'legal-aid',
        location: {
            lat: 41.885,
            lng: -87.787,
            precisionMeters: 320,
            areaLabel: 'Oak Park',
        },
        openHours: 'Tue–Fri · 13:00–19:00',
        eligibilityNotes: 'Eviction, lease and benefits questions',
        contact: {
            url: 'https://example.org/legal-aid',
        },
    },
    {
        uri: 'at://did:example:org/app.patchwork.directory.resource/hotline-01',
        id: 'hotline-01',
        name: 'DuPage Warmline',
        category: 'hotline',
        location: {
            lat: 41.866,
            lng: -88.106,
            precisionMeters: 400,
            areaLabel: 'Wheaton',
        },
        openHours: 'Daily · 16:00–23:00',
        eligibilityNotes: 'Peer support by phone; English and Spanish',
        contact: {
            phone: '+1-555-0150',
        },
    },
    {
        uri: 'at://did:example:org/app.patchwork.directory.resource/food-02',
        id: 'food-02',
        name: 'Naperville Free Fridge',
        category: 'food-bank',
        location: {
            lat: 41.772,
            lng: -88.148,
            precisionMeters: 200,
            areaLabel: 'Naperville',
        },
        openHours: 'Always open',
        eligibilityNotes: 'Take what you need, leave what you can',
        contact: {
            url: 'https://example.org/fridge',
        },
    },
];
