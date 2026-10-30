#!/usr/bin/env bash
set -Eeuo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
mkdir -p "$tmpdir/bin"

cat > "$tmpdir/bin/cosign" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$COSIGN_CALLS"
[[ "$*" != *'reject-this'* ]]
[[ ${FAKE_COSIGN_REJECT:-false} != true ]]
if [[ "$1" == verify-attestation && "$*" == *'--type slsaprovenance'* ]]; then
    case ${FAKE_PROVENANCE_CASE:-valid} in
        empty) exit 0 ;;
        malformed) printf 'not-json\n'; exit 0 ;;
    esac
    image=${!#}
    name=${image%@sha256:*}
    service=${name##*/patchwork-}
    statement=$(jq -n --arg name "$name" --arg service "$service" \
        --arg digest "${image##*@sha256:}" --arg sha "$FAKE_SOURCE_SHA" '
        "https://git.subcult.tv/subculture-collective/patchwork" as $repo |
        ($repo + "/actions/runs/42") as $builder |
        ("git+" + $repo + "@" + $sha) as $source |
        {_type:"https://in-toto.io/Statement/v0.1",predicateType:"https://slsa.dev/provenance/v0.2",
         subject:[{name:$name,digest:{sha256:$digest}}],
         predicate:{builder:{id:$builder},
           buildType:($repo + "/src/branch/main/.github/workflows/deploy-staging.yml"),
           invocation:{configSource:{uri:$source,digest:{sha1:$sha}},parameters:{service:$service}},
           metadata:{buildInvocationId:$builder},materials:[{uri:$source,digest:{sha1:$sha}}]}}')
    statement=$(jq --arg mode "${FAKE_PROVENANCE_CASE:-valid}" '
        if $mode == "wrong-source" then .predicate.invocation.configSource.digest.sha1 = ("f" * 40)
        elif $mode == "wrong-material" then .predicate.materials[0].digest.sha1 = ("f" * 40)
        elif $mode == "wrong-service" then .predicate.invocation.parameters.service = "wrong"
        elif $mode == "wrong-digest" then .subject[0].digest.sha256 = ("f" * 64)
        elif $mode == "wrong-image" then .subject[0].name = "registry.test/another-image"
        elif $mode == "wrong-repo" then .predicate.invocation.configSource.uri = "git+https://other.test/repo"
        elif $mode == "wrong-type" then .predicateType = "https://example.org/not-provenance"
        elif $mode == "wrong-builder" then .predicate.builder.id = "https://other.test/actions/runs/42"
        elif $mode == "wrong-invocation" then .predicate.metadata.buildInvocationId = "another-run"
        elif $mode == "split-run" and .predicate.invocation.parameters.service == "web" then
            .predicate.builder.id |= sub("42$"; "43") |
            .predicate.metadata.buildInvocationId = .predicate.builder.id
        else . end' <<< "$statement")
    envelope=$(jq -n --arg payload "$(printf '%s' "$statement" | base64 -w0)" \
        '{payloadType:"application/vnd.in-toto+json",payload:$payload,signatures:[]}')
    if [[ ${FAKE_PROVENANCE_CASE:-valid} == array ]]; then
        jq -s '.' <<< "$envelope"
    elif [[ ${FAKE_PROVENANCE_CASE:-valid} == ndjson ]]; then
        printf '%s\n%s\n' "$envelope" "$envelope"
    else
        printf '%s\n' "$envelope"
    fi
fi
EOF
chmod +x "$tmpdir/bin/cosign"

sha=0123456789abcdef0123456789abcdef01234567
export FAKE_SOURCE_SHA=$sha
digest=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
cat > "$tmpdir/manifest.json" <<EOF
{"gitSha":"$sha","images":{"api":"registry.test/patchwork-api@sha256:$digest","indexer":"registry.test/patchwork-indexer@sha256:$digest","moderation":"registry.test/patchwork-moderation@sha256:$digest","web":"registry.test/patchwork-web@sha256:$digest"}}
EOF

export PATH="$tmpdir/bin:$PATH"
export COSIGN_CALLS="$tmpdir/calls"
export PATCHWORK_RELEASE_VERIFY_MODE=keyless
export PATCHWORK_ALLOWED_IMAGE_PREFIX=registry.test/patchwork-
export PATCHWORK_COSIGN_CERTIFICATE_IDENTITY_REGEXP='https://example.test/workflow@.*'
bash "$repo_root/scripts/verify-release-trust.sh" "$tmpdir/manifest.json" >/dev/null
[[ "$(wc -l < "$tmpdir/calls")" -eq 12 ]]
grep -q 'verify-attestation.*--type spdxjson' "$tmpdir/calls"
grep -q 'verify-attestation.*--type slsaprovenance' "$tmpdir/calls"

if PATCHWORK_ALLOWED_IMAGE_PREFIX=wrong.example/ \
    bash "$repo_root/scripts/verify-release-trust.sh" "$tmpdir/manifest.json" >/dev/null 2>&1; then
    exit 1
fi

touch "$tmpdir/public.pem"
PATCHWORK_RELEASE_VERIFY_MODE=key \
PATCHWORK_COSIGN_PUBLIC_KEY="$tmpdir/public.pem" \
PATCHWORK_COSIGN_ALLOW_INSECURE_REGISTRY=true \
PATCHWORK_COSIGN_INSECURE_IGNORE_TLOG=true \
bash "$repo_root/scripts/verify-release-trust.sh" "$tmpdir/manifest.json" >/dev/null
grep -q -- '--key .*public.pem' "$tmpdir/calls"
grep -q -- '--allow-insecure-registry' "$tmpdir/calls"
grep -q -- '--insecure-ignore-tlog' "$tmpdir/calls"

for format in array ndjson; do
    FAKE_PROVENANCE_CASE="$format" PATCHWORK_RELEASE_VERIFY_MODE=key \
        PATCHWORK_COSIGN_PUBLIC_KEY="$tmpdir/public.pem" \
        bash "$repo_root/scripts/verify-release-trust.sh" "$tmpdir/manifest.json" >/dev/null
done
if FAKE_COSIGN_REJECT=true PATCHWORK_RELEASE_VERIFY_MODE=key \
    PATCHWORK_COSIGN_PUBLIC_KEY="$tmpdir/public.pem" \
    bash "$repo_root/scripts/verify-release-trust.sh" "$tmpdir/manifest.json" >/dev/null 2>&1; then
    echo 'Accepted a Cosign verification failure.' >&2
    exit 1
fi

for invalid in empty malformed wrong-source wrong-material wrong-service wrong-digest wrong-image wrong-repo wrong-type wrong-builder wrong-invocation split-run; do
    if FAKE_PROVENANCE_CASE="$invalid" PATCHWORK_RELEASE_VERIFY_MODE=key \
        PATCHWORK_COSIGN_PUBLIC_KEY="$tmpdir/public.pem" \
        bash "$repo_root/scripts/verify-release-trust.sh" "$tmpdir/manifest.json" >/dev/null 2>&1; then
        echo "Accepted invalid verified provenance: $invalid" >&2
        exit 1
    fi
done
if PATCHWORK_REQUIRE_RELEASE_ATTESTATIONS=false PATCHWORK_RELEASE_VERIFY_MODE=key \
    PATCHWORK_COSIGN_PUBLIC_KEY="$tmpdir/public.pem" \
    bash "$repo_root/scripts/verify-release-trust.sh" "$tmpdir/manifest.json" >/dev/null 2>&1; then
    echo 'Accepted Gitea promotion without required attestations.' >&2
    exit 1
fi

jq '.images.api = .images.web' "$tmpdir/manifest.json" > "$tmpdir/swapped.json"
if PATCHWORK_RELEASE_VERIFY_MODE=key PATCHWORK_COSIGN_PUBLIC_KEY="$tmpdir/public.pem" \
    bash "$repo_root/scripts/verify-release-trust.sh" "$tmpdir/swapped.json" >/dev/null 2>&1; then
    echo 'Accepted a web artifact in the API service slot.' >&2
    exit 1
fi

if PATCHWORK_RELEASE_VERIFY_MODE=invalid \
    bash "$repo_root/scripts/verify-release-trust.sh" "$tmpdir/manifest.json" >/dev/null 2>&1; then
    exit 1
fi
