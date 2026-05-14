import { useState, useEffect, useRef } from "react";
import { MessageCircle, X, Send, Loader2, ChevronDown, AlertCircle } from "lucide-react";
import {
  useGetMyChatMessages,
  getGetMyChatMessagesQueryKey,
  useSendChatMessage,
  useGetChatUnreadCount,
  getGetChatUnreadCountQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getUserProfile } from "@/lib/auth";

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sendError, setSendError] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const token = localStorage.getItem("fullswap_token");
  const isLoggedIn = !!token;
  const userProfile = getUserProfile();
  const displayName = userProfile?.username || userProfile?.email || "You";

  const messages = useGetMyChatMessages({
    query: {
      queryKey: getGetMyChatMessagesQueryKey(),
      enabled: isLoggedIn && open,
      refetchInterval: open ? 5000 : false,
    },
  });

  const unread = useGetChatUnreadCount({
    query: {
      queryKey: getGetChatUnreadCountQueryKey(),
      enabled: isLoggedIn,
      refetchInterval: isLoggedIn ? 15000 : false,
    },
  });

  const send = useSendChatMessage({
    mutation: {
      onSuccess: () => {
        setText("");
        setSendError(false);
        queryClient.invalidateQueries({ queryKey: getGetMyChatMessagesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetChatUnreadCountQueryKey() });
      },
      onError: () => setSendError(true),
    },
  });

  useEffect(() => {
    if (open) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      queryClient.invalidateQueries({ queryKey: getGetMyChatMessagesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetChatUnreadCountQueryKey() });
    }
  }, [open, messages.data?.length]);

  const handleSend = () => {
    if (!text.trim() || send.isPending) return;
    send.mutate({ data: { message: text.trim() } });
  };

  const unreadCount = (unread.data as any)?.count ?? 0;

  if (!isLoggedIn) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {open && (
        <div
          className="w-80 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-200"
          style={{
            background: "hsl(222 50% 6%)",
            border: "1px solid hsl(222 40% 14%)",
            height: "420px",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 shrink-0"
            style={{ background: "linear-gradient(135deg, hsl(187 100% 42%) 0%, hsl(210 100% 45%) 100%)" }}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <div>
                <p className="text-white font-bold text-sm leading-none">Support Chat</p>
                <p className="text-white/80 text-[10px] mt-0.5 font-semibold">
                  Chatting as <span className="text-white font-bold">{displayName}</span>
                </p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-white/80 hover:text-white transition-colors"
            >
              <ChevronDown className="w-5 h-5" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
              </div>
            ) : !messages.data || messages.data.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center gap-2">
                <MessageCircle className="w-8 h-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground font-medium">No messages yet</p>
                <p className="text-xs text-muted-foreground/60 max-w-[200px]">
                  Send us a message and our team will get back to you shortly.
                </p>
              </div>
            ) : (
              (messages.data as any[]).map((msg: any) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                      msg.sender === "user"
                        ? "text-white rounded-br-sm"
                        : "text-foreground rounded-bl-sm"
                    }`}
                    style={
                      msg.sender === "user"
                        ? { background: "linear-gradient(135deg, hsl(187 100% 40%) 0%, hsl(210 100% 43%) 100%)" }
                        : { background: "hsl(222 40% 11%)", border: "1px solid hsl(222 40% 16%)" }
                    }
                  >
                    {msg.sender === "admin" && (
                      <p className="text-[10px] font-bold text-primary mb-1">Support</p>
                    )}
                    <p>{msg.message}</p>
                    <p className={`text-[10px] mt-1 ${msg.sender === "user" ? "text-white/60" : "text-muted-foreground/60"}`}>
                      {timeAgo(msg.createdAt)}
                    </p>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 shrink-0" style={{ borderTop: "1px solid hsl(222 40% 12%)" }}>
            {sendError && (
              <div className="flex items-center gap-1.5 mb-2 px-1">
                <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <p className="text-xs text-red-400">Failed to send. Please try again.</p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Type a message..."
                maxLength={500}
                className="flex-1 text-sm px-3 py-2 rounded-xl outline-none text-foreground placeholder:text-muted-foreground/50"
                style={{
                  background: "hsl(222 40% 10%)",
                  border: "1px solid hsl(222 40% 16%)",
                }}
              />
              <button
                onClick={handleSend}
                disabled={!text.trim() || send.isPending}
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all disabled:opacity-40"
                style={{ background: "linear-gradient(135deg, hsl(187 100% 42%) 0%, hsl(210 100% 45%) 100%)" }}
              >
                {send.isPending ? (
                  <Loader2 className="w-4 h-4 text-white animate-spin" />
                ) : (
                  <Send className="w-4 h-4 text-white" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bubble button */}
      <button
        onClick={() => setOpen(o => !o)}
        data-testid="chat-widget-button"
        className="w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-105 active:scale-95 relative"
        style={{ background: "linear-gradient(135deg, hsl(187 100% 42%) 0%, hsl(210 100% 45%) 100%)", boxShadow: "0 0 24px hsl(187 100% 52% / 0.4)" }}
      >
        {open ? (
          <X className="w-6 h-6 text-white" />
        ) : (
          <MessageCircle className="w-6 h-6 text-white" />
        )}
        {!open && unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
