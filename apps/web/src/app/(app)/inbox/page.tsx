export default function InboxPage() {
  // Phase 23: the approval inbox replaces this empty state.
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Inbox</h1>
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        No messages yet. Messages from your website form and Gmail will appear here.
      </div>
    </div>
  );
}
