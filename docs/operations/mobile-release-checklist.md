# Mobile Release Checklist

Tracks: [native implementation #60](https://git.subcult.tv/subculture-collective/patchwork/issues/60) and [native release #61](https://git.subcult.tv/subculture-collective/patchwork/issues/61).

This is a historical checklist, not a supported-device or release-completion claim. Refresh the device/OS matrix and provider-hosted OAuth scenarios before use; Patchwork must not collect an AT account password.

---

## Device QA Matrix

Test all core flows on the following device/OS combinations before each release.

### iOS

| Device | OS Version | Status | Tester | Date |
|--------|-----------|--------|--------|------|
| iPhone 15 Pro | iOS 17.4 | Pending | TBD | -- |
| iPhone 14 | iOS 17.2 | Pending | TBD | -- |
| iPhone SE (3rd gen) | iOS 16.7 | Pending | TBD | -- |
| iPad Air (5th gen) | iPadOS 17.4 | Pending | TBD | -- |

### Android

| Device | OS Version | Status | Tester | Date |
|--------|-----------|--------|--------|------|
| Pixel 8 | Android 14 | Pending | TBD | -- |
| Pixel 6a | Android 13 | Pending | TBD | -- |
| Samsung Galaxy S23 | Android 14 | Pending | TBD | -- |
| Samsung Galaxy A14 | Android 13 | Pending | TBD | -- |

---

## QA Check Categories

Each check must be executed on both platforms unless marked platform-specific.

### Authentication

| Check ID | Description | iOS | Android |
|----------|------------|-----|---------|
| auth-login | User completes provider-hosted AT Protocol OAuth without giving Patchwork a password | Pending | Pending |
| auth-session-refresh | Session refreshes automatically before expiry | Pending | Pending |
| auth-logout | User can log out and session is cleared | Pending | Pending |

### Navigation

| Check ID | Description | iOS | Android |
|----------|------------|-----|---------|
| nav-tab-bar | Bottom tab bar navigates to all core flows | Pending | Pending |
| nav-back | Back navigation works consistently across flows | Pending | Pending |

### Offline

| Check ID | Description | iOS | Android |
|----------|------------|-----|---------|
| offline-queue | Actions queued while offline sync when connectivity returns | Pending | Pending |
| offline-indicator | Offline indicator is displayed when network is unavailable | Pending | Pending |

### Push Notifications

| Check ID | Description | iOS | Android |
|----------|------------|-----|---------|
| push-registration | Push notification token is registered on app launch | Pending | Pending |
| push-receive | Push notifications received in foreground and background | Pending | Pending |
| push-tap-navigation | Tapping a push notification navigates to the correct screen | Pending | Pending |

### Deep Links

| Check ID | Description | iOS | Android |
|----------|------------|-----|---------|
| nav-deep-link | Deep links open the correct screen with parameters | Pending | Pending |

### Accessibility

| Check ID | Description | iOS | Android |
|----------|------------|-----|---------|
| a11y-screen-reader | All interactive elements accessible via VoiceOver/TalkBack | Pending | Pending |
| a11y-touch-target | Touch targets meet minimum 44x44 point size | Pending | Pending |

### Performance

| Check ID | Description | iOS | Android |
|----------|------------|-----|---------|
| perf-cold-start | Cold start time under 3 seconds on target devices | Pending | Pending |
| perf-scroll | Feed and map scroll at 60fps on target devices | Pending | Pending |

---

## Core Flow Parity

| Flow | Web | Mobile | Notes |
|------|-----|--------|-------|
| Map | Implemented | Pending | Clustered approximate-area discovery |
| Feed | Implemented | Pending | Ranked request stream with lifecycle actions |
| Post | Implemented | Pending | Aid request creation form |
| Chat | Implemented | Pending | 1:1 post-linked conversations |
| Inbox | Implemented | Pending | Unified inbox for requests and messages |
| Notifications | Implemented | Pending | Notification center with preferences |
| Profile | Not yet | Pending | Mobile-first profile management |
| Settings | Implemented | Pending | Account and privacy controls |

---

## Store Submission Checklist

### Apple App Store

| Step | Status | Notes |
|------|--------|-------|
| App name reserved | Pending | "Patchwork" |
| Bundle ID registered | Pending | `app.patchwork.mobile` |
| App Store screenshots (6.7", 6.1", 5.5") | Pending | |
| App description and keywords | Pending | |
| Privacy policy URL | Pending | Must link to /legal/privacy |
| App privacy declarations (ATT) | Pending | Location, push tokens |
| Age rating questionnaire | Pending | |
| TestFlight beta review | Pending | |
| Production review submission | Pending | |

### Google Play Store

| Step | Status | Notes |
|------|--------|-------|
| Package name reserved | Pending | `app.patchwork.mobile` |
| Play Console listing created | Pending | |
| Store screenshots (phone, 7" tablet, 10" tablet) | Pending | |
| Store description and tags | Pending | |
| Privacy policy URL | Pending | Must link to /legal/privacy |
| Data safety declarations | Pending | Location, push tokens |
| Content rating questionnaire | Pending | |
| Internal testing track | Pending | |
| Production release | Pending | |

---

## Privacy Declarations

Both stores require disclosure of data collection practices:

1. **Location data** -- Used for approximate-area discovery of nearby aid requests. Coarsened to precisionKm before storage. Not shared with third parties.
2. **Push notification tokens** -- Stored for notification delivery only. Deleted on logout or token rotation.
3. **Device identifiers** -- Used for push token association and session management. Not used for advertising or tracking.
4. **User-generated content** -- Aid posts, chat messages, and profile information are stored per AT Protocol conventions and user-controlled.

---

## Release Approval Gates

| Gate | Owner | Criteria | Status |
|------|-------|----------|--------|
| QA matrix complete | QA Lead | All checks pass or skip with justification | Pending |
| Store metadata complete | Product | All fields populated, screenshots approved | Pending |
| Privacy review | Legal | Declarations match actual data practices | Pending |
| Security review | Engineering | No critical or high vulnerabilities | Pending |
| Performance baseline | Engineering | Cold start < 3s, scroll 60fps | Pending |
| Accessibility review | Design | VoiceOver/TalkBack pass, touch targets met | Pending |

---

*Historical mobile checklist; current delivery ownership is linked above.*
