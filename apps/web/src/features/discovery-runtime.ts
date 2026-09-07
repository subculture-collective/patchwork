import type { FeedAidCard } from '../feed-ux';

export interface FeedRecordEnvelope {
    postalCode?: string;
    aidPostUri: string;
    recipientDid: string;
    cid?: string;
    card: FeedAidCard;
    recordOrigin?: 'synthetic' | 'sourced-public' | 'visitor-created';
}
