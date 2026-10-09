"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { createMcpToken, listMcpTokens, revokeMcpToken } from "@/app/(app)/settings/mcp-actions";
import { Note, SectionTitle } from "@/components/bits";
import { Bone, Spinner } from "@/components/feedback";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateIST, relativeTime } from "@/lib/format";
import type { TokenInfo } from "@/services/tokens";

const PLACEHOLDER = "etm_…";

/** Paste-ready setup text for a token (or the placeholder when the raw token is no longer known). */
export function mcpSnippets(siteUrl: string, token: string = PLACEHOLDER) {
  const url = `${siteUrl}/api/mcp`;
  const auth = `Authorization: Bearer ${token}`;
  return {
    claude: `claude mcp add --transport http edge-tasks ${url} --header "${auth}"`,
    json: JSON.stringify({ mcpServers: { "edge-tasks": { type: "http", url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
    curl: [
      `curl -s ${url}`,
      `  -H "${auth}"`,
      `  -H "Content-Type: application/json"`,
      `  -H "Accept: application/json, text/event-stream"`,
      `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
    ].join(" \\\n"),
  };
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // ponytail: clipboard can be blocked (some in-app browsers); the text is select-all as a fallback.
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function CodeBlock({ title, hint, code }: { title: string; hint?: string; code: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <CopyButton text={code} />
      </div>
      {hint && <p className="text-[13.5px] text-ink-mute">{hint}</p>}
      <pre className="rounded-xl bg-sand px-3.5 py-3 font-mono text-[12.5px] leading-5 break-all whitespace-pre-wrap select-all">
        {code}
      </pre>
    </div>
  );
}

export function McpAccess() {
  const [data, setData] = useState<TokenInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [name, setName] = useState("");
  const [revoking, setRevoking] = useState<TokenInfo | null>(null);
  const [pending, startTransition] = useTransition();

  const reload = () =>
    listMcpTokens().then((r) => {
      if (r.ok) setData(r.tokens);
      else setError(r.error);
    });
  useEffect(() => {
    void reload();
  }, []);

  const create = () =>
    startTransition(async () => {
      setError(null);
      const r = await createMcpToken(name);
      if (!r.ok) return setError(r.error);
      setFresh({ name: name.trim(), token: r.token });
      setName("");
      await reload();
    });

  const revoke = (t: TokenInfo) =>
    startTransition(async () => {
      setError(null);
      const r = await revokeMcpToken(t.id);
      setRevoking(null);
      if (!r.ok) return setError(r.error);
      await reload();
    });

  // the origin the person is on is the right one for setup (prod domain, preview, or local dev)
  const snippets = data && mcpSnippets(window.location.origin, fresh?.token);
  const now = new Date();

  return (
    <section className="flex flex-col gap-5 rounded-[var(--radius-card)] border border-line-soft bg-card p-4 sm:p-5">
      <div>
        <SectionTitle className="mb-1">AI assistant access (MCP)</SectionTitle>
        <p className="text-[14.5px] text-ink-soft">
          Let Claude or another AI assistant read your requests and update them for you. A token acts as you, so keep it private.
        </p>
      </div>

      {error && (
        <Note tone="danger" role="alert">
          {error}
        </Note>
      )}

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <Label htmlFor="mcp-token-name">New token</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="mcp-token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Claude Code on laptop"
            maxLength={100}
            className="sm:flex-1"
          />
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending && <Spinner />}
            Create token
          </Button>
        </div>
      </form>

      {fresh && (
        <Note tone="teal" role="status" className="flex flex-col gap-2">
          <p className="font-semibold text-ink">Token “{fresh.name}” created. Copy it now: you won&apos;t see it again.</p>
          <code className="rounded-lg bg-card px-2.5 py-2 font-mono text-[13px] break-all text-ink select-all">{fresh.token}</code>
          <div className="flex gap-2">
            <CopyButton text={fresh.token} label="Copy token" />
            <Button type="button" variant="ghost" size="sm" onClick={() => setFresh(null)}>
              I saved it
            </Button>
          </div>
          <p className="text-[13.5px]">The setup commands below already include it.</p>
        </Note>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-[15px] font-semibold">Your tokens</h3>
        {!data ? (
          <Bone className="h-14 rounded-xl" />
        ) : data.length === 0 ? (
          <p className="text-[14px] text-ink-mute">No tokens yet.</p>
        ) : (
          <ul className="divide-y divide-line-soft rounded-xl border border-line-soft">
            {data.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{t.name}</p>
                  <p className="text-[13px] text-ink-mute">
                    <span className="font-mono">{t.prefix}…</span> · {t.lastUsedAt ? `used ${relativeTime(new Date(t.lastUsedAt), now)}` : "never used"} ·
                    made {formatDateIST(new Date(t.createdAt))}
                  </p>
                </div>
                <Button type="button" variant="destructive" size="sm" onClick={() => setRevoking(t)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {snippets && (
        <div className="flex flex-col gap-4">
          {!fresh && (
            <p className="text-[13.5px] text-ink-mute">
              Replace <code className="font-mono">{PLACEHOLDER}</code> below with your token. Create a new one if you lost it.
            </p>
          )}
          <CodeBlock title="Claude Code" hint="Run this in a terminal." code={snippets.claude} />
          <CodeBlock title="Other MCP clients" hint="Add this to the client's JSON config (Cursor, Claude Desktop via a bridge, etc.)." code={snippets.json} />
          <CodeBlock title="Test it" hint="Should list the tools. A 401 means the token is wrong or revoked." code={snippets.curl} />
        </div>
      )}

      <Dialog open={!!revoking} onOpenChange={(open) => !open && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke “{revoking?.name}”?</DialogTitle>
            <DialogDescription>Anything using this token stops working right away. This can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" disabled={pending} onClick={() => revoking && revoke(revoking)}>
              {pending && <Spinner />}
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
