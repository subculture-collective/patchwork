import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const read = path => readFileSync(path, 'utf8');
const collect = root => {
    const paths = [];
    for (const entry of readdirSync(root)) {
        const path = join(root, entry);
        if (statSync(path).isDirectory()) paths.push(...collect(path));
        else paths.push(path);
    }
    return paths;
};

const durableRoots = [
    'services/api/src/db/migrations',
    'services/indexer/src/migrations',
    'services/moderation-worker/src/migrations',
    'packages/at-lexicons/src/lexicons',
];
const durableFiles = durableRoots.flatMap(collect).concat([
    'services/api/src/account-privacy-service.ts',
    'services/api/src/authoring-receipts.ts',
    'services/api/src/coordination-service.ts',
    'scripts/backup-postgres.sh',
    'scripts/restore-postgres.sh',
]);
const forbiddenDurableField =
    /\b(exact_?location|peer_?location|location_?session_?id|personal_?exact_?(latitude|longitude|coordinates?))\b/i;
const findings = [];

for (const path of durableFiles) {
    const match = forbiddenDurableField.exec(read(path));
    if (match) {
        findings.push(
            `${relative('.', path)} contains forbidden durable field ${match[0]}`,
        );
    }
}

const serviceSource = read(
    'services/api/src/exact-location-signal-service.ts',
);
const handlerSource = read(
    'services/api/src/http/exact-location-signal-handler.ts',
);
if (/\bconsole\.(log|info|warn|error|debug)\b/.test(serviceSource)) {
    findings.push('exact-location signal service contains a logging call');
}
if (/\bconsole\.(log|info|warn|error|debug)\b/.test(handlerSource)) {
    findings.push('exact-location HTTP handler contains a logging call');
}

const apiIndex = read('services/api/src/index.ts');
for (const call of apiIndex.match(
    /console\.(?:log|info|warn|error|debug)\([\s\S]{0,600}?\);/g,
) ?? []) {
    if (
        /location_signal/i.test(call) &&
        /(sessionId|connectionId|participantProof|expectedPeerProof|payload)/i.test(
            call,
        )
    ) {
        findings.push(
            'location signal operational log includes an ephemeral identifier or payload',
        );
    }
}

const exportSource = read('services/api/src/account-privacy-service.ts');
if (
    /(ExactLocationSignalService|\/location\/session|locationSignalSession)/i.test(
        exportSource,
    )
) {
    findings.push('account export references ephemeral location state');
}

if (findings.length > 0) {
    throw new Error(
        `Exact-location absence check failed:\n${findings.join('\n')}`,
    );
}

console.log(
    `Exact-location absence check passed (${durableFiles.length} durable schema/export/backup surfaces plus HTTP logging).`,
);
