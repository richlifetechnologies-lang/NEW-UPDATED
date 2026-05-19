import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  useGetAdminChatThreads,
  getGetAdminChatThreadsQueryKey,
  useGetAdminChatThread,
  getGetAdminChatThreadQueryKey,
  useSendAdminChatReply,
} from "@workspace/api-client-react";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { MessageCircle, Send, Loader2, Users, Clock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function AdminChatPage() {
  const [, setLocation] = useLocation();
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!localStorage.getItem("fullswap_admin_token")) setLocation("/admin");
  }, [setLocation]);

  const threads = useGetAdminChatThreads({
    query: {
      queryKey: getGetAdminChatThreadsQueryKey(),
      refetchInterval: 8000,
    },
  });

  const thread = useGetAdminChatThread(
    selectedUserId ?? 0,
    {
      query: {
        queryKey: getGetAdminChatThreadQueryKey(selectedUserId ?? 0),
        enabled: selectedUserId !== null,
        refetchInterval: 5000,
      },
    }
  );

  const reply = useSendAdminChatReply({
    mutation: {
      onSuccess: () => {
        setReplyText("");
        queryClient.invalidateQueries({ queryKey: getGetAdminChatThreadQueryKey(selectedUserId ?? 0) });
        queryClient.invalidateQueries({ queryKey: getGetAdminChatThreadsQueryKey() });
      },
    },
  });

  useEffect(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, [thread.data]);

  const handleReply = () => {
    if (!replyText.trim() || !selectedUserId || reply.isPending) return;
    reply.mutate({ userId: selectedUserId, data: { message: replyText.trim() } });
  };

  const threadList = (threads.data ?? []) as any[];
  const messages = (thread.data ?? []) as any[];
  const selectedThread = threadList.find(t => t.userId === selectedUserId);

  const showChatOnMobile = selectedUserId !== null;

  return (
    <AdminLayout>
      <div className="h-[calc(100vh-56px)] lg:h-[calc(100vh-0px)] flex" data-testid="admin-chat-page">

        {/* Thread list — hidden on mobile when chat is open */}
        <div
          className={`${showChatOnMobile ? "hidden lg:flex" : "flex"} w-full lg:w-72 shrink-0 flex-col`}
          style={{ borderRight: "1px solid hsl(222 40% 10%)", background: "hsl(222 50% 4%)" }}
        >
          <div className="p-4 flex items-center gap-2" style={{ borderBottom: "1px solid hsl(222 40% 10%)" }}>
            <MessageCircle className="w-4 h-4 text-primary" />
            <h2 className="font-bold text-foreground">Support Threads</h2>
            {threadList.filter(t => t.unreadCount > 0).length > 0 && (
              <span className="ml-auto w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                {threadList.filter(t => t.unreadCount > 0).length}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {threads.isLoading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
              </div>
            ) : threadList.length === 0 ? (
              <div className="p-6 text-center">
                <Users className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No messages yet</p>
              </div>
            ) : (
              threadList.map((t: any) => (
                <button
                  key={t.userId}
                  onClick={() => setSelectedUserId(t.userId)}
                  className={`w-full p-4 text-left transition-colors ${selectedUserId === t.userId ? "bg-primary/10 border-l-2 border-primary" : "hover:bg-muted/10 border-l-2 border-transparent"}`}
                  style={{ borderBottom: "1px solid hsl(222 40% 8%)" }}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="font-semibold text-sm text-foreground truncate">{t.username}</p>
                    {t.unreadCount > 0 && (
                      <span className="shrink-0 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                        {t.unreadCount}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{t.email}</p>
                  {t.lastMessage && (
                    <p className="text-[11px] text-muted-foreground/60 mt-1 truncate">
                      {t.lastMessage.sender === "admin" ? "You: " : ""}{t.lastMessage.message}
                    </p>
                  )}
                  {t.lastMessage && (
                    <p className="text-[10px] text-muted-foreground/40 mt-0.5 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      {timeAgo(t.lastMessage.createdAt)}
                    </p>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Chat panel — full width on mobile when thread selected */}
        <div className={`${showChatOnMobile ? "flex" : "hidden lg:flex"} flex-1 flex-col min-w-0`}>
          {selectedUserId === null ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
              <MessageCircle className="w-12 h-12 text-muted-foreground/30" />
              <p className="text-muted-foreground font-medium">Select a thread to view messages</p>
              <p className="text-sm text-muted-foreground/60">Incoming messages from licence keys appear on the left</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="px-4 py-3 shrink-0 flex items-center gap-3" style={{ borderBottom: "1px solid hsl(222 40% 10%)", background: "hsl(222 50% 5%)" }}>
                {/* Back button — mobile only */}
                <button
                  className="lg:hidden p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                  onClick={() => setSelectedUserId(null)}
                  aria-label="Back to threads"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                  {selectedThread?.username?.[0]?.toUpperCase() ?? "?"}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-foreground truncate">{selectedThread?.username}</p>
                  <p className="text-xs text-muted-foreground truncate">{selectedThread?.email}</p>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
                {thread.isLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-5 h-5 text-primary animate-spin" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-muted-foreground text-sm">No messages in this thread</p>
                  </div>
                ) : (
                  messages.map((msg: any) => (
                    <div key={msg.id} className={`flex ${msg.sender === "admin" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[80%] sm:max-w-[65%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${msg.sender === "admin" ? "rounded-br-sm text-white" : "rounded-bl-sm text-foreground"}`}
                        style={
                          msg.sender === "admin"
                            ? { background: "linear-gradient(135deg, hsl(187 100% 40%) 0%, hsl(210 100% 43%) 100%)" }
                            : { background: "hsl(222 40% 10%)", border: "1px solid hsl(222 40% 16%)" }
                        }
                      >
                        <p>{msg.message}</p>
                        <p className={`text-[10px] mt-1 ${msg.sender === "admin" ? "text-white/60" : "text-muted-foreground/60"}`}>
                          {timeAgo(msg.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply input */}
              <div className="p-3 sm:p-4 shrink-0" style={{ borderTop: "1px solid hsl(222 40% 10%)" }}>
                <div className="flex items-center gap-2 sm:gap-3">
                  <input
                    type="text"
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
                    placeholder={`Reply to ${selectedThread?.username}...`}
                    maxLength={500}
                    className="flex-1 text-sm px-3 sm:px-4 py-2.5 rounded-xl text-foreground placeholder:text-muted-foreground/50 outline-none"
                    style={{ background: "hsl(222 40% 9%)", border: "1px solid hsl(222 40% 15%)" }}
                  />
                  <Button
                    onClick={handleReply}
                    disabled={!replyText.trim() || reply.isPending}
                    size="sm"
                    className="gap-1.5 px-3 sm:px-4 shrink-0"
                  >
                    {reply.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    <span className="hidden sm:inline">Send</span>
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
