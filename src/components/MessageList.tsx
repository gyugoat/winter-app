import { useEffect, useRef } from 'react';
import type { Message } from '../types';
import '../styles/messages.css';

interface MessageListProps {
  messages: Message[];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="message-list">
        <div className="message-empty">
          <div className="message-empty-diamond" />
          <span className="message-empty-text">Do you wanna build a...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="message-list">
      {messages.map((msg) => (
        <div key={msg.id} className={`message-row ${msg.role}`}>
          {msg.role === 'assistant' && (
            <div className="message-avatar">
              <div className="message-diamond" />
            </div>
          )}
          <div>
            <div className="message-bubble">{msg.content}</div>
            <div className={`message-time${msg.role === 'user' ? ' user' : ''}`}>
              {formatTime(msg.timestamp)}
            </div>
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
