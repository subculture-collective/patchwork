/** Non-transient publisher contract failure, safe to quarantine independently. */
export class PublisherValidationError extends Error {
    override name = 'PublisherValidationError';
}
