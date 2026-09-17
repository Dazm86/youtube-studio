"use client";

import { useState, useRef, useEffect } from "react";

export default function AssistantChat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در دستیار");
      setMessages([...nextMessages, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="card mb-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-right"
      >
        <h3 className="font-semibold">🤖 دستیار — از سایت و گیت‌هاب بپرس</h3>
        <span className="text-text-muted text-sm">{open ? "بستن" : "باز کردن"}</span>
      </button>

      {open && (
        <div className="mt-3">
          <div className="max-h-80 overflow-y-auto space-y-2 mb-2">
            {messages.length === 0 && (
              <p className="text-xs text-text-muted">
                مثلاً بپرس: «آخرین ویدیوها چه آماری داشتن؟» یا «زمان‌بندی‌ها فعالن؟» یا «آخرین اجرایِ گیت‌هاب اکشن چی شد؟»
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`text-sm rounded-md p-2 ${
                  m.role === "user" ? "bg-surface-raised" : "bg-teal/10 border border-teal/20"
                }`}
              >
                {m.content}
              </div>
            ))}
            {loading && <p className="text-xs text-text-muted">در حال بررسی...</p>}
            <div ref={bottomRef} />
          </div>

          {error && <div className="text-xs text-danger mb-1.5">{error}</div>}

          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="سوالت رو بپرس..."
              rows={1}
              className="field-input flex-1 resize-none"
            />
            <button type="button" onClick={send} disabled={loading || !input.trim()} className="btn-secondary shrink-0">
              بپرس
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
