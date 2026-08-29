import { useCallback, useState } from 'react';
import Header from './components/Header';
import ChatPanel from './components/ChatPanel';
import HitlPanel from './components/HitlPanel';
import AuditPanel from './components/AuditPanel';
import { useAuditTrail } from './hooks/useAuditTrail';
import { sendChatMessage } from './lib/api';

const WELCOME_MESSAGE = {
  id: 'welcome',
  role: 'assistant',
  text: "Hi, I'm Nova — your shopping assistant. Ask me to find a product or help you buy something, and I'll take care of the rest.",
};

function makeId(prefix) {
  const id = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return prefix ? `${prefix}_${id}` : id;
}

export default function App() {
  const [sessionId, setSessionId] = useState(() => makeId());
  const [userId, setUserId] = useState(() => `user_${Math.random().toString(36).slice(2, 8)}`);
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [isSending, setIsSending] = useState(false);

  const { logs: auditLogs, error: auditError } = useAuditTrail(sessionId, 2000);

  const handleSend = useCallback(
    async (text) => {
      setMessages((prev) => [...prev, { id: makeId('u'), role: 'user', text }]);
      setIsSending(true);
      try {
        const { reply } = await sendChatMessage({ message: text, sessionId, userId });
        setMessages((prev) => [...prev, { id: makeId('a'), role: 'assistant', text: reply }]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          { id: makeId('err'), role: 'assistant', text: `⚠️ ${err.message}`, isError: true },
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [sessionId, userId]
  );

  const handleNewSession = useCallback(() => {
    setSessionId(makeId());
    setUserId(`user_${Math.random().toString(36).slice(2, 8)}`);
    setMessages([WELCOME_MESSAGE]);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-canvas text-ink">
      <Header sessionId={sessionId} onNewSession={handleNewSession} />
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-hidden bg-hairline lg:grid-cols-3">
        <ChatPanel messages={messages} onSend={handleSend} isSending={isSending} />
        <HitlPanel auditLogs={auditLogs} sessionId={sessionId} />
        <AuditPanel logs={auditLogs} error={auditError} />
      </main>
    </div>
  );
}
