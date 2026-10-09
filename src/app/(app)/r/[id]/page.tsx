import type { ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { AiQuestionCard } from "@/components/request/AiQuestionCard";
import { CommentBox } from "@/components/request/CommentBox";
import { Delivered } from "@/components/request/Delivered";
import { MarkDeliverableButton, type PickMessage } from "@/components/request/DoneSheet";
import { DueEditor, LockedHint, PriorityEditor, TitleEditor } from "@/components/request/Editors";
import { DueLabel } from "@/components/request/DueLabel";
import { MessageCard } from "@/components/request/MessageCard";
import { PersonChip } from "@/components/request/PersonChip";
import { StatusControl } from "@/components/request/StatusControl";
import { Thread } from "@/components/request/Thread";
import { Timeline } from "@/components/request/Timeline";
import { formatDateTimeIST, istDayKey, relativeTime } from "@/lib/format";
import { displayName } from "@/lib/names";
import { requireViewer } from "@/lib/viewer";
import { NotFoundError, PermissionError } from "@/services/errors";
import { canManage } from "@/services/permissions";
import * as requests from "@/services/requests";
import type { DetailMessage } from "@/services/requests";
import { commentAction, doneAction, markDeliverableAction, setDueAction, setPriorityAction, setStatusAction, setTitleAction } from "./actions";

export const metadata: Metadata = { title: "Request" };

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-ink-mute">
        {title}
        {aside}
      </h2>
      {children}
    </section>
  );
}

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const { actor, person: me } = await requireViewer(`/r/${id}`);
  // others get a plain 404: don't reveal that the request exists
  const detail = await requests.getDetail(db(), actor, id).catch((e) => {
    if (e instanceof NotFoundError || e instanceof PermissionError) notFound();
    throw e;
  });
  const { request: r, requester, assignee, createdBy, messages, attachments, timeline } = detail;
  // the assignee opened it: out of "New" (a no-op for everyone else and every later view)
  if (me.id === r.assigneeId && !r.assigneeSeenAt) await requests.markSeen(db(), actor, id);

  const original = messages.filter((m) => m.kind === "original" || m.kind === "append");
  const thread = messages.filter((m) => m.kind === "thread" || m.kind === "status");
  // "Tell <them>": the requester tells the assignee, everyone else tells the requester
  const other = me.id === r.requesterId ? assignee : requester;
  const tellName = other.id === me.id ? null : displayName(other);

  // the deliverable: any original/append/thread message (status commands are system lines, not deliverables)
  const media = (m: DetailMessage) => attachments.filter((a) => a.chatId === m.chatId && a.messageId === m.messageId).length;
  const picks: PickMessage[] = messages
    .filter((m) => m.kind !== "status")
    .map((m) => ({ id: m.id, name: displayName(m.from), snippet: m.text.replace(/\s+/g, " ").trim().slice(0, 80), media: media(m) }));
  const manage = canManage(actor, r);
  const star = manage
    ? (m: DetailMessage) => (
        <MarkDeliverableButton current={r.resultMessageId === m.id} done={r.status === "done"} onMark={markDeliverableAction.bind(null, id, m.id)} />
      )
    : undefined;

  return (
    <article className="flex flex-col gap-7">
      <header className="flex flex-col gap-2.5">
        <p className="text-[13px] text-ink-mute">
          #{r.id}
          {r.chatTitle && <> · {r.chatTitle}</>} ·{" "}
          <time dateTime={r.createdAt.toISOString()} title={formatDateTimeIST(r.createdAt)}>
            {relativeTime(r.createdAt)}
          </time>
        </p>
        <TitleEditor key={r.title} title={r.title} locked={r.titleLocked} onSave={setTitleAction.bind(null, id)} />
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[14.5px] text-ink-soft">
          <PersonChip person={requester} /> asked <PersonChip person={assignee} />
          {createdBy.id !== requester.id && (
            <span className="text-ink-mute">
              (raised by <PersonChip person={createdBy} />)
            </span>
          )}
          <DueLabel dueAt={r.dueAt} className="ml-1" />
        </p>
      </header>

      <Delivered
        request={r}
        message={messages.find((m) => m.id === r.resultMessageId) ?? null}
        attachments={attachments}
        timeline={timeline}
        assignee={assignee}
      />

      <AiQuestionCard requestId={r.id} question={r.aiQuestion} canAnswer={actor.isAdmin} />

      <Section title="Status">
        <StatusControl
          key={`${r.status}:${r.customStatus}`}
          status={r.status}
          customStatus={r.customStatus}
          onChange={setStatusAction.bind(null, id)}
          done={{ messages: picks, initialMessageId: r.resultMessageId, onDone: doneAction.bind(null, id) }}
        />
      </Section>

      <div className="grid gap-7 sm:grid-cols-2 sm:gap-5">
        <Section title="Priority" aside={<LockedHint locked={r.priorityLocked} />}>
          <PriorityEditor key={r.priority} priority={r.priority} onSave={setPriorityAction.bind(null, id)} />
        </Section>
        <Section title="Due" aside={<LockedHint locked={r.dueLocked} />}>
          <DueEditor key={r.dueAt?.toISOString() ?? ""} day={r.dueAt ? istDayKey(r.dueAt) : ""} onSave={setDueAction.bind(null, id)} />
        </Section>
      </div>

      <Section title={original.length > 1 ? "Messages" : "Message"}>
        {original.length ? (
          original.map((m) => <MessageCard key={m.id} message={m} attachments={attachments} action={star?.(m)} />)
        ) : (
          <p className="whitespace-pre-wrap break-words rounded-[var(--radius-card)] border border-line-soft p-3.5 text-[15px] leading-6">
            {r.body || "No message."}
          </p>
        )}
      </Section>

      {thread.length > 0 && (
        <Section title={`Thread · ${thread.filter((m) => m.kind === "thread").length}`}>
          <Thread
            messages={thread}
            all={messages}
            attachments={attachments}
            botConfirmMessageId={r.botConfirmMessageId}
            timeline={timeline}
            assignee={assignee}
            action={star}
          />
        </Section>
      )}

      <Section title="Activity">
        <Timeline entries={timeline} assignee={assignee} />
      </Section>

      <Section title="Comment">
        <CommentBox tellName={tellName} onSend={commentAction.bind(null, id)} />
      </Section>

    </article>
  );
}
