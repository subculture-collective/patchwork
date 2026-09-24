#!/usr/bin/env bash
# Read-only release admission against Gitea's latest status per context.
set -Eeuo pipefail

: "${SOURCE_SHA:?Set SOURCE_SHA}"
: "${GITHUB_SERVER_URL:?Set GITHUB_SERVER_URL}"
: "${GITHUB_REPOSITORY:?Set GITHUB_REPOSITORY}"
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'A full source SHA is required.' >&2; exit 1; }
[[ "$GITHUB_SERVER_URL" == https://git.subcult.tv &&
   "$GITHUB_REPOSITORY" == subculture-collective/patchwork ]] || exit 1

# GITHUB_* are the compatibility variables supplied by Gitea's runner.
api="$GITHUB_SERVER_URL/api/v1/repos/$GITHUB_REPOSITORY"
request=(curl --fail --silent --show-error --connect-timeout 10 --max-time 30)
if [[ -n "${GITEA_TOKEN:-}" ]]; then
    request+=(-H "Authorization: token $GITEA_TOKEN")
fi
branch=$("${request[@]}" "$api/branches/main")
[[ $(jq -er '.commit.id' <<< "$branch") == "$SOURCE_SHA" ]] || {
    echo 'Source must be the current main commit; use the rollback runbook for older releases.' >&2
    exit 1
}

# Refuse truncated responses instead of accidentally accepting a stale page.
status=$("${request[@]}" "$api/commits/$SOURCE_SHA/status?limit=100")
jq -e --arg sha "$SOURCE_SHA" '
    .sha == $sha and (.statuses | type == "array") and
    .total_count == (.statuses | length)
' <<< "$status" >/dev/null || { echo 'Incomplete or mismatched CI status response.' >&2; exit 1; }

accepted_run=''
for context in 'CI / quality-gates (push)' 'CI / e2e-production (push)'; do
    check=$(jq -ce --arg context "$context" '
        [.statuses[] | select(.context == $context)] |
        select(length == 1 and .[0].status == "success") | .[0]
    ' <<< "$status") || { echo "Required CI gate has not passed: $context" >&2; exit 1; }
    target=$(jq -er '.target_url' <<< "$check")
    target=${target#"$GITHUB_SERVER_URL"}
    [[ "$target" =~ ^/subculture-collective/patchwork/actions/runs/([0-9]+)/jobs/[0-9]+$ ]] || exit 1
    run=${BASH_REMATCH[1]}
    [[ -z "$accepted_run" || "$accepted_run" == "$run" ]] || {
        echo 'Required CI gates must belong to the same push run.' >&2
        exit 1
    }
    accepted_run=$run
done
echo "Source $SOURCE_SHA accepted by Gitea CI run $accepted_run."
