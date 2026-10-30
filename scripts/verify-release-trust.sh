#!/usr/bin/env bash
# Verify every immutable image and required attestation before deployment.

set -Eeuo pipefail

manifest=${1:?Usage: verify-release-trust.sh MANIFEST}
mode=${PATCHWORK_RELEASE_VERIFY_MODE:?Set PATCHWORK_RELEASE_VERIFY_MODE to keyless or key}
allowed_prefix=${PATCHWORK_ALLOWED_IMAGE_PREFIX:?Set PATCHWORK_ALLOWED_IMAGE_PREFIX}
require_attestations=${PATCHWORK_REQUIRE_RELEASE_ATTESTATIONS:-true}
allow_insecure_registry=${PATCHWORK_COSIGN_ALLOW_INSECURE_REGISTRY:-false}
ignore_transparency_log=${PATCHWORK_COSIGN_INSECURE_IGNORE_TLOG:-false}

for command in jq cosign; do
    command -v "$command" >/dev/null
done
[[ -r "$manifest" ]]

case "$mode" in
    keyless)
        identity=${PATCHWORK_COSIGN_CERTIFICATE_IDENTITY_REGEXP:?Set certificate identity regexp}
        issuer=${PATCHWORK_COSIGN_CERTIFICATE_OIDC_ISSUER:-https://token.actions.githubusercontent.com}
        verify_args=(
            --certificate-identity-regexp "$identity"
            --certificate-oidc-issuer "$issuer"
        )
        ;;
    key)
        public_key=${PATCHWORK_COSIGN_PUBLIC_KEY:?Set PATCHWORK_COSIGN_PUBLIC_KEY}
        [[ -r "$public_key" ]]
        verify_args=(--key "$public_key")
        ;;
    *)
        echo 'PATCHWORK_RELEASE_VERIFY_MODE must be keyless or key.' >&2
        exit 2
        ;;
esac

if [[ "$allow_insecure_registry" == true ]]; then
    verify_args+=(--allow-insecure-registry)
fi
if [[ "$ignore_transparency_log" == true ]]; then
    verify_args+=(--insecure-ignore-tlog)
fi

git_sha=$(jq -er '.gitSha' "$manifest")
[[ "$git_sha" =~ ^[0-9a-f]{40}$ ]]
if [[ "$mode" == key && "$require_attestations" != true ]]; then
    echo 'Gitea key-based promotion requires source-bound attestations.' >&2
    exit 4
fi
accepted_builder=''

for service in api indexer moderation web; do
    image=$(jq -er ".images.${service}" "$manifest")
    [[ "$image" == "$allowed_prefix"* && "$image" =~ @sha256:[0-9a-f]{64}$ ]] || {
        echo "Refusing image outside the allowed registry/repository prefix: ${service}." >&2
        exit 3
    }
    cosign verify "${verify_args[@]}" "$image" >/dev/null
    if [[ "$require_attestations" == true ]]; then
        for attestation_type in spdxjson slsaprovenance; do
            verified=$(cosign verify-attestation "${verify_args[@]}" \
                --type "$attestation_type" "$image")
            if [[ "$mode" == key && "$attestation_type" == slsaprovenance ]]; then
                # Inspect only Cosign's verified DSSE output, never a separately
                # downloaded predicate. All four components must name this
                # source, their own service/digest and one Gitea publication run.
                builder=$(jq -ers \
                    --arg sha "$git_sha" --arg service "$service" \
                    --arg name "${image%@sha256:*}" --arg digest "${image##*@sha256:}" '
                    "https://git.subcult.tv/subculture-collective/patchwork" as $repo |
                    ("git+" + $repo + "@" + $sha) as $source |
                    [.[] | (if type == "array" then .[] else . end) |
                      select(.payloadType == "application/vnd.in-toto+json") |
                      .payload | @base64d | fromjson |
                      select((._type == "https://in-toto.io/Statement/v0.1" or ._type == "https://in-toto.io/Statement/v1")
                        and .predicateType == "https://slsa.dev/provenance/v0.2"
                        and any(.subject[]; .name == $name and .digest.sha256 == $digest)
                        and .predicate.invocation.configSource.uri == $source
                        and .predicate.invocation.configSource.digest.sha1 == $sha
                        and .predicate.invocation.parameters.service == $service
                        and .predicate.buildType == ($repo + "/src/branch/main/.github/workflows/deploy-staging.yml")
                        and any(.predicate.materials[]; .uri == $source and .digest.sha1 == $sha)
                        and (.predicate.builder.id | test("^https://git\\.subcult\\.tv/subculture-collective/patchwork/actions/runs/[1-9][0-9]*$"))
                        and .predicate.metadata.buildInvocationId == .predicate.builder.id) |
                      .predicate.builder.id] | unique | select(length == 1) | .[0]
                ' <<< "$verified") || {
                    echo "Verified provenance does not bind the requested source, service and image: ${service}." >&2
                    exit 4
                }
                [[ -z "$accepted_builder" || "$builder" == "$accepted_builder" ]] || {
                    echo 'All runtime images must belong to one Gitea publication run.' >&2
                    exit 4
                }
                accepted_builder=$builder
            fi
        done
    fi
done

printf 'Release trust verified for %s.\n' "$git_sha"
