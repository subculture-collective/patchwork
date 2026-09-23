import { toChatStatusNotice, type ChatInitiationIntent, type ChatLaunchState } from '../chat-ux';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Panel } from '../components/Panel';

interface ChatRouteProps {
    currentUserDid: string;
    hasPermission: boolean;
    onTogglePermission: (enabled: boolean) => void;
    forceFallback: boolean;
    onToggleFallback: (enabled: boolean) => void;
    intent?: ChatInitiationIntent;
    state: ChatLaunchState;
    requestPreview?: string;
    onLaunch: () => void;
    onReset: () => void;
}

export const ChatRoute = ({
    currentUserDid,
    hasPermission,
    onTogglePermission,
    forceFallback,
    onToggleFallback,
    intent,
    state,
    requestPreview,
    onLaunch,
    onReset,
}: ChatRouteProps) => {
    const notice = toChatStatusNotice(state);

    const noticeTone =
        notice?.tone === 'danger'
            ? 'danger'
            : notice?.tone === 'warning'
              ? 'info'
              : notice?.tone === 'success'
                ? 'success'
                : 'neutral';

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>Chat handoff</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    Post-linked 1:1 initiation with permission checks and
                    recipient-capability fallback handling.
                </p>
            </header>

            <Panel title='Launch controls'>
                <div className='grid gap-3 sm:grid-cols-2'>
                    <label className='inline-flex items-center gap-2 text-sm text-mh-textMuted'>
                        <input
                            type='checkbox'
                            className='h-4 w-4'
                            checked={hasPermission}
                            onChange={(event) =>
                                onTogglePermission(event.target.checked)
                            }
                        />
                        Initiator has permission
                    </label>
                    <label className='inline-flex items-center gap-2 text-sm text-mh-textMuted'>
                        <input
                            type='checkbox'
                            className='h-4 w-4'
                            checked={forceFallback}
                            onChange={(event) =>
                                onToggleFallback(event.target.checked)
                            }
                        />
                        Force capability fallback
                    </label>
                </div>

                <p className='mt-3 break-all text-xs text-mh-textSoft'>
                    Initiator DID: {currentUserDid}
                </p>

                {intent ? (
                    <div className='mt-4 rounded-none border-2 border-mh-borderSoft bg-mh-surfaceElev p-3'>
                        <p className='text-sm font-bold text-mh-text'>
                            Pending intent · {intent.aidPostTitle}
                        </p>
                        <p className='mt-1 break-all text-xs text-mh-textSoft'>
                            Recipient: {intent.recipientDid} · Source:{' '}
                            {intent.initiatedFrom}
                        </p>
                    </div>
                ) : (
                    <p className='mt-4 text-sm text-mh-textMuted'>
                        No pending chat intent. Start from Map or Feed “Contact
                        helper”.
                    </p>
                )}

                <div className='mt-4 flex flex-wrap gap-2'>
                    <Button onClick={onLaunch} disabled={!intent}>
                        Launch handoff chat
                    </Button>
                    <Button variant='neutral' onClick={onReset}>
                        Reset state
                    </Button>
                </div>
            </Panel>

            <Card title='Launch status'>
                <p className='text-sm text-mh-textMuted'>
                    State: {state.status}
                </p>

                {notice ? (
                    <div className='mt-3'>
                        <Badge tone={noticeTone}>{notice.message}</Badge>
                    </div>
                ) : null}

                {requestPreview ? (
                    <pre className='mt-3 max-w-full overflow-x-auto whitespace-pre-wrap wrap-break-word rounded-none border-2 border-mh-borderSoft bg-mh-surfaceElev p-3 text-xs text-mh-text'>
                        {requestPreview}
                    </pre>
                ) : null}
            </Card>
        </section>
    );
};
