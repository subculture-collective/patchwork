import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocale } from '../i18n';
import { accountLabel } from './identity/AccountName';
import { useHandles } from './identity/useHandles';
import {
    createChatConversationViaApi,
    fetchChatConversationsViaApi,
    fetchChatMessagesViaApi,
    fetchCoordinationViaApi,
    fetchGroupsViaApi,
    markChatReadViaApi,
    redactChatMessageViaApi,
    reportChatMessageViaApi,
    sendChatMessageViaApi,
    type CoordinationConnection,
    type ProductionChatConversation,
    type ProductionChatMessage,
    type ProductionGroup,
} from './api-client';

interface ScopeOption {
    key: string;
    kind: 'direct' | 'group';
    id: string;
    label: string;
}

type WorkspaceResource = 'conversations' | 'coordination' | 'groups';

const workspaceResourceKeys: Record<WorkspaceResource, string> = {
    conversations: 'chat.conversations',
    coordination: 'chat.coordination',
    groups: 'chat.groups',
};

export const ProductionChat = ({ currentUserDid }: { currentUserDid: string }) => {
    const { t, fmt } = useLocale();
    const [conversations, setConversations] = useState<ProductionChatConversation[]>([]);
    const [connections, setConnections] = useState<CoordinationConnection[]>([]);
    const [groups, setGroups] = useState<ProductionGroup[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [messages, setMessages] = useState<ProductionChatMessage[]>([]);
    const [nextCursor, setNextCursor] = useState<number | null>(null);
    const [scopeKey, setScopeKey] = useState('');
    const [draft, setDraft] = useState('');
    const [retryId, setRetryId] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [workspaceErrors, setWorkspaceErrors] = useState<
        Partial<Record<WorkspaceResource, string>>
    >({});
    const [status, setStatus] = useState('');
    const [online, setOnline] = useState(() => navigator.onLine);

    const handles = useHandles(connections.map((connection) => connection.counterpartDid));
    const scopes = useMemo<ScopeOption[]>(() => [
        ...connections.filter((connection) => connection.status === 'active').map((connection) => ({
            key: `direct:${connection.id}`, kind: 'direct' as const, id: connection.id,
            label: t('chat.directScope', { did: accountLabel(connection.counterpartDid, handles) }),
        })),
        ...groups.filter((group) => group.status === 'active').flatMap((group) =>
            group.rooms.filter((room) => room.status === 'active').map((room) => ({
                key: `group:${room.id}`, kind: 'group' as const, id: room.id,
                label: t('chat.groupScope', { group: group.name, room: room.name }),
            }))),
    ], [connections, groups, handles, t]);

    const loadWorkspace = useCallback(async (only?: WorkspaceResource) => {
        setBusy(true);
        setError('');
        const resources = only ? [only] : (['conversations', 'coordination', 'groups'] as const);
        const results = await Promise.all(resources.map(async (resource) => {
            if (resource === 'conversations') return [resource, await fetchChatConversationsViaApi()] as const;
            if (resource === 'coordination') return [resource, await fetchCoordinationViaApi()] as const;
            return [resource, await fetchGroupsViaApi()] as const;
        }));
        let loaded = 0;
        const failures: Partial<Record<WorkspaceResource, string>> = {};
        for (const [resource, result] of results) {
            if (!result.ok) {
                failures[resource] = result.error;
                continue;
            }
            loaded += 1;
            if (resource === 'conversations') {
                setConversations(result.data.conversations);
                setSelectedId((current) => current || result.data.conversations[0]?.id || '');
            } else if (resource === 'coordination') {
                setConnections(result.data.connections);
            } else {
                setGroups(result.data.groups);
            }
        }
        setWorkspaceErrors((current) => {
            const next = only ? { ...current } : {};
            for (const resource of resources) {
                if (failures[resource]) next[resource] = failures[resource];
                else delete next[resource];
            }
            return next;
        });
        if (loaded > 0) setStatus(t('chat.loaded'));
        if (loaded === 0) setError(t('chat.loadError'));
        setBusy(false);
    }, [t]);

    const loadMessages = useCallback(async (conversationId: string, before?: number) => {
        if (!conversationId) { setMessages([]); setNextCursor(null); return; }
        setBusy(true);
        setError('');
        const result = await fetchChatMessagesViaApi(conversationId,
            { ...(before !== undefined ? { before } : {}), limit: 30 });
        if (!result.ok) {
            setError(t('chat.loadError'));
        } else {
            setMessages((current) => before === undefined ? result.data.messages : [...result.data.messages, ...current]);
            setNextCursor(result.data.nextCursor);
            const newest = result.data.messages.at(-1);
            if (before === undefined && newest) {
                await markChatReadViaApi({ conversationId, throughMessageId: newest.id });
                setConversations((current) => current.map((conversation) =>
                    conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation));
            }
        }
        setBusy(false);
    }, [t]);

    useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);
    useEffect(() => { void loadMessages(selectedId); }, [selectedId, loadMessages]);
    useEffect(() => {
        const update = () => setOnline(navigator.onLine);
        window.addEventListener('online', update); window.addEventListener('offline', update);
        return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
    }, []);

    const createConversation = async () => {
        const scope = scopes.find((candidate) => candidate.key === scopeKey);
        if (!scope) return;
        setBusy(true); setError('');
        const result = await createChatConversationViaApi(scope.kind === 'direct' ?
            { kind: 'direct', connectionId: scope.id } : { kind: 'group', roomId: scope.id });
        if (!result.ok) setError(t('chat.operationError'));
        else {
            await loadWorkspace();
            setSelectedId(result.data.conversation.id);
            setScopeKey('');
            setStatus(t('chat.conversationReady'));
        }
        setBusy(false);
    };

    const send = async (event: FormEvent) => {
        event.preventDefault();
        if (!selectedId || !draft.trim() || !online) return;
        setBusy(true); setError(''); setStatus(t('chat.sending'));
        const clientMessageId = retryId || crypto.randomUUID();
        const result = await sendChatMessageViaApi({ conversationId: selectedId,
            clientMessageId, body: draft.trim() });
        if (!result.ok) {
            setRetryId(clientMessageId);
            setError(t('chat.sendError'));
        } else {
            setDraft(''); setRetryId('');
            await loadMessages(selectedId);
            await loadWorkspace();
            setStatus(result.data.created ? t('chat.sent') : t('chat.retryConfirmed'));
        }
        setBusy(false);
    };

    const redact = async (message: ProductionChatMessage) => {
        if (!window.confirm(t('chat.confirmRedact'))) return;
        const result = await redactChatMessageViaApi({ conversationId: selectedId, messageId: message.id });
        if (result.ok) { await loadMessages(selectedId); setStatus(t('chat.redacted')); }
        else setError(t('chat.operationError'));
    };

    const report = async (message: ProductionChatMessage) => {
        if (!window.confirm(t('chat.confirmReport'))) return;
        const result = await reportChatMessageViaApi({ conversationId: selectedId,
            messageId: message.id, reason: 'other' });
        if (result.ok) setStatus(t('chat.reported'));
        else setError(t('chat.operationError'));
    };

    return <section aria-labelledby='production-chat-heading' className='space-y-5'>
        <header className='mh-route-header'>
            <h1 id='production-chat-heading' className='mh-route-title'>{t('chat.heading')}</h1>
            <p className='mt-2 text-mh-textMuted'>{t('chat.description')}</p>
            <p className='mh-banner mh-banner--info mt-3'>{t('chat.trust')}</p>
        </header>
        {!online && <p role='alert' className='mh-banner mh-banner--warning'>{t('chat.offline')}</p>}
        <div role='status' aria-live='polite'>{busy ? t('chat.loading') : status}</div>
        {error && <p role='alert' className='mh-banner mh-banner--danger'>{error}</p>}
        {Object.entries(workspaceErrors).map(([resource, message]) => (
            <div key={resource} role='alert' className='mh-banner mh-banner--danger flex-wrap items-center'>
                <span>{t('chat.workspaceResourceUnavailable', {
                    resource: t(workspaceResourceKeys[resource as WorkspaceResource]),
                    // The template adds its own full stop.
                    message: message.replace(/[.\s]+$/, ''),
                })}</span>
                <button type='button' className='mh-button mh-button--secondary mh-button--sm' disabled={busy}
                    onClick={() => void loadWorkspace(resource as WorkspaceResource)}>
                    {t('chat.retryResource', { resource: t(workspaceResourceKeys[resource as WorkspaceResource]) })}
                </button>
            </div>
        ))}

        <section className='mh-card grid gap-3 p-4' aria-labelledby='new-chat-heading'>
            <h2 id='new-chat-heading' className='font-heading text-xl font-bold'>{t('chat.newConversation')}</h2>
            <label className='grid gap-1 font-bold'>{t('chat.scope')}
                <select className='mh-input px-3 py-2' value={scopeKey} onChange={(event) => setScopeKey(event.target.value)} disabled={busy}>
                    <option value=''>{t('chat.chooseScope')}</option>
                    {scopes.map((scope) => <option key={scope.key} value={scope.key}>{scope.label}</option>)}
                </select>
            </label>
            <p className='text-sm text-mh-textMuted'>{t('chat.scopeHelp')}</p>
            <button type='button' className='mh-button mh-button--primary mh-button--md' disabled={busy || !scopeKey} onClick={() => void createConversation()}>{t('chat.openConversation')}</button>
        </section>

        <div className='grid gap-5 lg:grid-cols-[minmax(15rem,1fr)_minmax(0,2fr)]'>
            <nav className='mh-card p-4' aria-labelledby='conversation-list-heading'>
                <div className='flex items-center justify-between gap-2'>
                    <h2 id='conversation-list-heading' className='font-heading text-xl font-bold'>{t('chat.conversations')}</h2>
                    <button type='button' className='mh-button mh-button--secondary mh-button--sm' onClick={() => void loadWorkspace()} disabled={busy}>{t('chat.refresh')}</button>
                </div>
                {conversations.length === 0 ? <p className='mt-3'>{t('chat.noConversations')}</p> :
                    <ul className='mt-3 space-y-2'>{conversations.map((conversation) => <li key={conversation.id}>
                        <button type='button' aria-current={selectedId === conversation.id ? 'page' : undefined}
                            className='mh-button mh-button--secondary mh-button--md w-full justify-start text-left' onClick={() => setSelectedId(conversation.id)}>
                            <strong className='block break-words'>{conversation.title}</strong>
                            <span className='block text-sm text-mh-textMuted'>{conversation.kind === 'direct' ? t('chat.direct') : t('chat.group')}</span>
                            {conversation.unreadCount > 0 && <span className='block text-sm font-bold'>{t('chat.unread', { count: conversation.unreadCount })}</span>}
                            {conversation.lastMessageAt && <span className='block text-sm text-mh-textMuted'>{fmt.longDate(conversation.lastMessageAt)}</span>}
                        </button>
                    </li>)}</ul>}
            </nav>

            <section className='mh-card space-y-4 p-4' aria-labelledby='messages-heading'>
                <h2 id='messages-heading' className='font-heading text-xl font-bold'>{conversations.find((conversation) => conversation.id === selectedId)?.title ?? t('chat.messages')}</h2>
                {!selectedId ? <p>{t('chat.chooseConversation')}</p> : <>
                    {nextCursor !== null && <button type='button' className='mh-button mh-button--secondary mh-button--md' disabled={busy} onClick={() => void loadMessages(selectedId, nextCursor)}>{t('chat.older')}</button>}
                    <ol className='space-y-3' aria-label={t('chat.messages')}>
                        {messages.length === 0 ? <li>{t('chat.noMessages')}</li> : messages.map((message) => {
                            const own = message.authorDid === currentUserDid;
                            return <li key={message.id} className={`rounded-md border border-mh-border p-3 ${own ? 'ml-6 bg-mh-surfaceAlt' : 'mr-6'}`}>
                                <p className='break-words'>{message.status === 'redacted' ? t('chat.messageRedacted') : message.body}</p>
                                <p className='mt-1 text-xs text-mh-textMuted'>{own ? t('chat.you') : message.authorDid} · {fmt.longDate(message.createdAt)}{own && message.deliveryState ? ` · ${message.deliveryState === 'read' ? t('chat.read') : t('chat.delivered')}` : ''}</p>
                                {message.status === 'active' && <div className='mt-2 flex gap-2'>
                                    {own ? <button type='button' className='mh-button mh-button--secondary mh-button--sm' onClick={() => void redact(message)}>{t('chat.redact')}</button> :
                                        <button type='button' className='mh-button mh-button--secondary mh-button--sm' onClick={() => void report(message)}>{t('chat.report')}</button>}
                                </div>}
                            </li>;
                        })}
                    </ol>
                    <form onSubmit={send} className='grid gap-2'>
                        <label className='grid gap-1 font-bold'>{t('chat.message')}
                            <textarea className='mh-input min-h-24 px-3 py-2' maxLength={2000} required value={draft} onChange={(event) => { setDraft(event.target.value); setRetryId(''); }} disabled={busy || !online} />
                        </label>
                        <span className='text-sm text-mh-textMuted'>{t('chat.characters', { count: draft.length })}</span>
                        <button className='mh-button mh-button--primary mh-button--md' disabled={busy || !online || !draft.trim()}>{retryId ? t('chat.retry') : t('chat.send')}</button>
                    </form>
                </>}
            </section>
        </div>
    </section>;
};
