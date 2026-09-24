#!/usr/bin/env bash
# milestone-setup.sh -- Create GitHub milestones M0-M5 for the production readiness program
# Tracked by: #95, #68
#
# Prerequisites:
#   gh auth login with a token that has Issues (read/write) permission
#
# Usage:
#   chmod +x docs/operations/milestone-setup.sh
#   ./docs/operations/milestone-setup.sh

set -euo pipefail

REPO="subculture-collective/mutual-hub"

echo "Creating milestones M0-M5 for $REPO..."

gh api -X POST "repos/$REPO/milestones" \
  -f title="M0: Foundation & Governance (Wave 0)" \
  -f description="Production program setup, RACI, board creation, governance baseline. Tracks Epic A (#71) and Wave 0 execution structure. Parent: #68." \
  -f due_on="2026-03-15T00:00:00Z" \
  --jq '"  Created M0 (milestone #" + (.number | tostring) + ")"'

gh api -X POST "repos/$REPO/milestones" \
  -f title="M1: Runtime Durability" \
  -f description="Indexer + moderation runtime completion. Replace fixture dependencies with persistent ingestion and durable queue/state backends. Tracks Epic B (#70), Milestone M1 (#84). Parent: #68." \
  -f due_on="2026-04-05T00:00:00Z" \
  --jq '"  Created M1 (milestone #" + (.number | tostring) + ")"'

gh api -X POST "repos/$REPO/milestones" \
  -f title="M2: Core Product Lifecycle" \
  -f description="Security/compliance baseline, request lifecycle state machine, core product flows. Tracks Epic C (#72), Milestone M2 (#83). Parent: #68." \
  -f due_on="2026-04-19T00:00:00Z" \
  --jq '"  Created M2 (milestone #" + (.number | tostring) + ")"'

gh api -X POST "repos/$REPO/milestones" \
  -f title="M3: Account & Privacy" \
  -f description="Reliability, observability, DR, account settings, privacy controls, role model. Tracks Epic D (#75), Milestone M3 (#85). Parent: #68." \
  -f due_on="2026-05-03T00:00:00Z" \
  --jq '"  Created M3 (milestone #" + (.number | tostring) + ")"'

gh api -X POST "repos/$REPO/milestones" \
  -f title="M4: Global UX (i18n + a11y)" \
  -f description="Release engineering, environment promotion, internationalization, accessibility AA+ compliance. Tracks Epic E (#73), Milestone M4 (#86). Parent: #68." \
  -f due_on="2026-05-17T00:00:00Z" \
  --jq '"  Created M4 (milestone #" + (.number | tostring) + ")"'

gh api -X POST "repos/$REPO/milestones" \
  -f title="M5: Trust & Verification" \
  -f description="Trust-safety operations, legal/privacy readiness, verification tiers, pilot and GA launch. Tracks Epic F (#74), Milestone M5 (#87). Parent: #68." \
  -f due_on="2026-06-07T00:00:00Z" \
  --jq '"  Created M5 (milestone #" + (.number | tostring) + ")"'

echo ""
echo "Done. All milestones created."
echo ""
echo "Next steps:"
echo "  1. Assign issues to milestones using: gh issue edit <number> --milestone 'M0: Foundation & Governance (Wave 0)'"
echo "  2. Run docs/operations/link-issues.sh to add tracking comments to Wave 0 issues"
