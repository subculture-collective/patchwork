# RACI Matrix -- Patchwork Production Operations

Tracks: [incident ownership #18](https://git.subcult.tv/subculture-collective/patchwork/issues/18) and [pilot acceptance #22](https://git.subcult.tv/subculture-collective/patchwork/issues/22).

---

## 1. Roles

| Alias | Role | Scope |
|-------|------|-------|
| **ENG-FE** | Frontend Engineering | `apps/web`, browser E2E, UI/UX implementation |
| **ENG-BE** | Backend / API Engineering | `services/api`, `packages/shared`, `packages/at-lexicons` |
| **ENG-IDX** | Indexer Engineering | `services/indexer`, AT Protocol firehose, ingestion pipeline |
| **ENG-MOD** | Moderation Engineering | `services/moderation-worker`, queue/state backend |
| **INFRA** | Infrastructure / SRE | Deploy pipelines, monitoring, database, DR, environments |
| **T-S** | Trust & Safety | Moderation policy, abuse response, legal/privacy compliance |
| **PM** | Product Management | Roadmap, prioritization, stakeholder communication |
| **IC** | Incident Commander (rotating) | Real-time incident ownership, communications, post-incident review |

---

## 2. RACI Matrix -- Key Activities

Legend: **R** = Responsible, **A** = Accountable, **C** = Consulted, **I** = Informed

| # | Activity | ENG-FE | ENG-BE | ENG-IDX | ENG-MOD | INFRA | T-S | PM | IC |
|---|----------|--------|--------|---------|---------|-------|-----|----|----|
| 1 | Feature development (frontend) | R/A | C | I | I | I | C | A | I |
| 2 | Feature development (API/backend) | C | R/A | C | C | I | C | A | I |
| 3 | Indexer pipeline changes | I | C | R/A | I | C | I | I | I |
| 4 | Moderation worker changes | I | C | I | R/A | C | C | I | I |
| 5 | Database schema migrations | C | R | C | C | A | I | I | I |
| 6 | CI/CD pipeline maintenance | C | C | C | C | R/A | I | I | I |
| 7 | Production deploy execution | I | C | C | C | R/A | I | I | I |
| 8 | Staging environment parity | I | C | C | C | R/A | I | I | I |
| 9 | Monitoring/alerting configuration | I | C | C | C | R/A | I | I | I |
| 10 | SLO definition and review | C | C | C | C | R | I | A | I |
| 11 | Incident detection and triage | I | I | I | I | R | I | I | A |
| 12 | Incident mitigation and resolution | C | C | C | C | R | C | I | A |
| 13 | Post-incident review (PIR) | C | C | C | C | R | C | I | A |
| 14 | Moderation policy creation | I | I | I | C | I | R/A | C | I |
| 15 | Moderation escalation response | I | I | I | R | I | A | I | I |
| 16 | Abuse/spam incident response | I | C | I | R | C | A | I | C |
| 17 | Security vulnerability triage | C | C | C | C | R | C | I | A |
| 18 | Secrets rotation | I | C | I | I | R/A | I | I | I |
| 19 | Backup and DR drills | I | C | C | I | R/A | I | I | I |
| 20 | Data retention/deletion execution | I | R | I | I | C | A | C | I |
| 21 | Legal/privacy compliance review | I | C | I | C | I | R | A | I |
| 22 | Release go/no-go decision | C | C | C | C | C | C | A | I |
| 23 | Rollback decision during incident | I | C | C | C | R | C | I | A |
| 24 | Roadmap and milestone planning | I | I | I | I | I | C | R/A | I |
| 25 | Production readiness review | C | C | C | C | R | C | A | I |

---

## 3. On-Call Rotation

### 3.0 Current interim home-staging assignment

Effective 2026-08-05, **Patrick Fanella** is the named home-staging primary
on-call, escalation owner, and default Incident Commander. This is a
single-person interim assignment; it does not satisfy the secondary-responder
or sustained-rotation model below and does not authorize public operation.

### 3.1 Structure

Three on-call tracks run concurrently, each with a **primary** and a **secondary** responder:

| Track | Primary | Secondary | Rotation Cadence |
|-------|---------|-----------|-----------------|
| **Engineering** | ENG-BE or ENG-IDX (alternating) | Any ENG-* volunteer | Weekly, handoff Monday 10:00 UTC |
| **Infrastructure** | INFRA team member | INFRA team member | Weekly, handoff Monday 10:00 UTC |
| **Trust & Safety** | T-S team member | ENG-MOD engineer | Weekly, handoff Monday 10:00 UTC |

### 3.2 On-Call Expectations

- **Primary**: Acknowledge pages within **5 minutes** during business hours, **15 minutes** outside business hours.
- **Secondary**: Available as backup if primary does not acknowledge within the SLA above, or if the incident requires a second responder.
- Each on-call engineer must have working access to production monitoring dashboards, deployment tooling, and the incident communication channel before the rotation begins.
- On-call handoff includes a written summary of any open issues, recent deploys, or known risks.

### 3.3 Handoff Procedure

1. Outgoing on-call writes a brief handoff note in the `#ops-handoff` channel (or equivalent) covering:
   - Active incidents or degradations
   - Recent production changes (last 7 days)
   - Known upcoming risky changes
2. Incoming on-call acknowledges receipt and confirms tooling access.
3. If handoff cannot occur synchronously, outgoing on-call remains primary until the incoming engineer acknowledges.

---

## 4. Escalation Ladder

### 4.1 Severity Levels

| Severity | Definition | Examples |
|----------|-----------|----------|
| **SEV-1** | Complete service outage or data loss risk | All users affected, data corruption, security breach |
| **SEV-2** | Major feature degraded, workaround possible | Indexer stalled, moderation queue backlog > 1 hr, auth failures for subset of users |
| **SEV-3** | Minor feature degraded, limited user impact | Slow map loads, intermittent UI errors, non-critical background job failures |
| **SEV-4** | Cosmetic or low-urgency issue | UI alignment issues, non-blocking log warnings |

### 4.2 Escalation Timeframes

| Elapsed Time | Action | Who |
|-------------|--------|-----|
| **T+0** | Alert fires or issue reported | Automated monitoring / reporter |
| **T+5 min** | Primary on-call acknowledges | Primary on-call (Engineering or Infra track) |
| **T+15 min** | If no ack: secondary on-call paged | Secondary on-call |
| **T+15 min** | SEV-1/SEV-2: Incident Commander activated | IC (see section 5) |
| **T+30 min** | If unresolved SEV-1: escalate to all available engineering leads | IC |
| **T+60 min** | If unresolved SEV-1: escalate to PM and stakeholders | IC |
| **T+4 hr** | If unresolved SEV-1/SEV-2: executive notification | IC + PM |

### 4.3 Trust & Safety Escalation

| Elapsed Time | Action | Who |
|-------------|--------|-----|
| **T+0** | Abuse/content report received | Automated filter or user report |
| **T+15 min** | T-S primary reviews and classifies | T-S primary on-call |
| **T+30 min** | If high-severity (imminent harm, legal): escalate to IC + PM | T-S primary |
| **T+1 hr** | If policy-ambiguous: escalate to T-S lead for policy call | T-S primary |
| **T+4 hr** | Unresolved high-severity: executive notification | T-S lead + PM |

---

## 5. Incident Commander Protocol

### 5.1 Activation

An Incident Commander is activated for any **SEV-1** or **SEV-2** incident. The IC is typically the **Infrastructure on-call primary**, but any senior engineer can assume the IC role if:

- The INFRA on-call is unavailable
- The incident is primarily a trust-safety or product issue
- A handoff is needed due to fatigue or timezone

### 5.2 IC Responsibilities

1. **Own the incident** -- single point of coordination and decision-making.
2. **Establish communication** -- open a dedicated incident channel or thread and post initial status.
3. **Assign roles** -- delegate investigation, mitigation, and communication tasks.
4. **Authorize mitigation actions** -- approve rollbacks, feature flags, traffic shifts.
5. **Provide status updates** -- at minimum every 30 minutes during active incidents.
6. **Declare resolution** -- confirm the incident is resolved or downgraded.
7. **Schedule post-incident review** -- within 48 hours of resolution for SEV-1, 1 week for SEV-2.

### 5.3 IC Handoff

If an IC needs to hand off (fatigue, timezone, expertise mismatch):

1. IC announces handoff intent in the incident channel.
2. IC provides a written summary:
   - Current status and severity
   - Actions taken so far
   - Open investigation threads
   - Pending decisions
3. Incoming IC acknowledges and confirms they have context.
4. IC announces the handoff completion: "IC is now @incoming-engineer as of HH:MM UTC."
5. Outgoing IC remains available for questions for 30 minutes after handoff.

### 5.4 Post-Incident Review

- **SEV-1**: Blameless PIR within 48 hours. Attendees: IC, all responders, PM, T-S (if applicable).
- **SEV-2**: PIR within 1 week. Attendees: IC, primary responders, relevant leads.
- **SEV-3/4**: Optional PIR at team discretion.
- PIR outputs:
  - Timeline of events
  - Root cause analysis
  - Action items with owners and due dates
  - Improvements to monitoring, runbooks, or process

---

## 6. Decision Authority Summary

| Decision | Authority | Backup |
|----------|-----------|--------|
| Ship a production release | PM (go/no-go) | ENG-BE lead |
| Execute emergency rollback | IC | INFRA on-call |
| Approve database migration | INFRA + ENG-BE | IC during incident |
| Suspend a user/content | T-S primary | T-S lead |
| Declare an incident | Any on-call engineer | IC |
| Close an incident | IC | PM |
| Approve policy changes | T-S lead + PM | -- |
| Rotate secrets | INFRA | ENG-BE (application secrets) |

---

## 7. Governance RACI -- Policy and Compliance Activities

The following matrix covers governance, policy, and compliance activities
using role aliases relevant to platform governance. These complement the
operational RACI in Section 2.

### 7.1 Governance Roles

| Alias           | Role                | Maps To (Section 1)        |
|-----------------|---------------------|----------------------------|
| **Admin**       | Platform Admin      | INFRA + ENG-BE (admin ops) |
| **Mod-Lead**    | Moderator Lead      | T-S lead / lead_mod        |
| **Moderator**   | Moderator           | ENG-MOD / senior_mod       |
| **Developer**   | Developer           | ENG-FE / ENG-BE / ENG-IDX  |
| **Community**   | Community Rep       | PM (stakeholder liaison)   |

### 7.2 Governance RACI Matrix

Legend: **R** = Responsible, **A** = Accountable, **C** = Consulted, **I** = Informed

| # | Activity                       | Admin | Mod-Lead | Moderator | Developer | Community |
|---|--------------------------------|-------|----------|-----------|-----------|-----------|
| 1 | Incident response coordination | A     | C        | R         | R         | I         |
| 2 | Moderation decisions (standard)| I     | A        | R         | I         | I         |
| 3 | Moderation decisions (escalated)| C    | R/A      | C         | I         | I         |
| 4 | Policy document updates        | A     | R        | C         | C         | C         |
| 5 | Data deletion requests         | A     | C        | I         | R         | I         |
| 6 | Backup and restore operations  | R/A   | I        | I         | C         | I         |
| 7 | Production deployments         | A     | I        | I         | R         | I         |
| 8 | User appeals (first level)     | I     | A        | R         | I         | I         |
| 9 | User appeals (escalation)      | C     | R/A      | I         | I         | C         |
| 10| Community guidelines review    | A     | R        | C         | I         | C         |
| 11| Privacy policy review          | A     | C        | I         | C         | C         |
| 12| Legal/compliance audit         | R/A   | C        | I         | C         | I         |

---

## 8. Review and Updates

- This RACI matrix is reviewed at the start of each milestone (M0--M5).
- Any role or responsibility change requires a PR updating this document.
- On-call rotation schedule is maintained in the team calendar and referenced from this document.
- Governance RACI (Section 7) is reviewed alongside policy document updates
  (see [policy changelog](../legal/changelog.md)).

---

*Created as part of Wave 0 governance lane. Updated for Wave 3 legal and
policy readiness. Current ownership and acceptance issues are linked above.*
