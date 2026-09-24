#!/usr/bin/env bash
# link-issues.sh -- Add production readiness tracking comments to Wave 0 issues
# and add blocker clarification comments to #120 and #131.
# Tracked by: #95, #68
#
# Prerequisites:
#   gh auth login with a token that has Issues (read/write) permission
#
# Usage:
#   chmod +x docs/operations/link-issues.sh
#   ./docs/operations/link-issues.sh

set -euo pipefail

REPO="subculture-collective/mutual-hub"

echo "Adding production readiness tracking comments to Wave 0 issues..."

# --- Wave 0 issue tracking comments ---

WAVE0_ISSUES=(94 95 96 97 116 120 131 133 134)

for issue in "${WAVE0_ISSUES[@]}"; do
  echo "  Commenting on #$issue..."
  gh issue comment "$issue" --repo "$REPO" --body "$(cat <<'COMMENT'
**Production Readiness Tracking**

This issue is tracked under the production readiness program:
- Parent tracker: #68 ([Production] MVP to GA Readiness Program)
- Board and milestone structure: #95 ([Production][A1])
- Governance and RACI: #94 ([Production][A2])

Wave 0 governance lane.
COMMENT
)"
done

echo ""
echo "Adding dependency clarification comments to #120 and #131..."

# --- Blocker clarification for #120 ---

gh issue comment 120 --repo "$REPO" --body "$(cat <<'COMMENT'
**Wave 0 Dependency Note**

This issue notes "Depends on: H1" (#121 -- Implement full AT-native auth session UX). This dependency is **informational only** and does **not** block Wave 0 execution.

Wave 0 work on this issue focuses on governance, tracking, and readiness planning. The H1 dependency applies to the implementation phase (Milestone M3+), not to the current wave.
COMMENT
)"

# --- Blocker clarification for #131 ---

gh issue comment 131 --repo "$REPO" --body "$(cat <<'COMMENT'
**Wave 0 Dependency Note**

This issue notes "Depends on: H3" (#123 -- Implement role and capability model). This dependency is **informational only** and does **not** block Wave 0 execution.

Wave 0 work on this issue focuses on governance, tracking, and readiness planning. The H3 dependency applies to the implementation phase (Milestone M5+), not to the current wave.
COMMENT
)"

echo ""
echo "Done. All comments posted."
