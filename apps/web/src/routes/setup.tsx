/// First-run wizard: connect metadata, add an optional first library, then finish.
///
/// The whole flow sits in the middle of the window as one card, with a quiet
/// progress rail beside it. Every step shares the same header, body inset, and
/// footer row, so a step never looks like a different product.
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  FolderPlus,
  Globe,
  Server,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { accountRequest, type AccountUser, type SetupState } from "@/auth";
import { api, type ServerStatus } from "@/client";
import { queries } from "@/queries";
import { LibraryFolderForm } from "@/components/library-folder-form";
import { Button, Input } from "@heroui/react";
import { cx } from "@/lib/cx";

const STEPS = [
  { label: "Metadata", detail: "Connect TMDB" },
  { label: "First library", detail: "Pick a type, then folders" },
  { label: "Ready", detail: "Connect your devices" },
];

function SetupFrame({
  step,
  children,
  aside,
}: {
  step: number;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8 sm:px-6 lg:py-12">
      <div className="w-full max-w-6xl">
        <div className="grid items-start gap-6 lg:grid-cols-[17.5rem_minmax(0,1fr)] lg:gap-10">
          <aside className="min-w-0">
            <Link to="/" className="inline-flex items-center gap-2.5 rounded-lg px-1 py-1">
              <img src="/icon.svg" alt="" className="h-7 w-7" />
              <span className="font-sans text-[15px] font-extrabold tracking-[-0.03em] text-foreground">Plexy</span>
            </Link>
            <h1 className="mt-5 font-sans text-2xl font-extrabold tracking-[-0.035em] text-foreground sm:text-3xl">
              Set up your server
            </h1>
            <p className="mt-2 max-w-sm text-[12.5px] leading-relaxed text-muted">
              Your owner account is ready. Connect metadata, choose what Plexy should scan, and finish.
              You can change everything later from Settings.
            </p>

            <StepRail step={step} />

            {aside}
          </aside>

          <section className="min-w-0">{children}</section>
        </div>
      </div>
    </main>
  );
}

function StepRail({ step }: { step: number }) {
  return (
    <nav aria-label="Setup progress" className="mt-6">
      {/* Mobile: one compact row. Desktop: a vertical rail with detail lines. */}
      <ol className="grid grid-cols-3 gap-2 lg:hidden">
        {STEPS.map((entry, index) => {
          const active = step === index;
          const done = step > index;
          return (
            <li
              key={entry.label}
              aria-current={active ? "step" : undefined}
              className={cx(
                "flex items-center gap-1.5 rounded-lg border px-2 py-1.5",
                active ? "border-border bg-surface" : "border-transparent",
              )}
            >
              <span
                className={cx(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold tabular-nums",
                  done
                    ? "border-foreground bg-foreground text-background"
                    : active
                      ? "border-foreground text-foreground"
                      : "border-border text-muted",
                )}
              >
                {done ? <Check size={11} /> : index + 1}
              </span>
              <span className={cx("truncate text-[10.5px] font-semibold", active || done ? "text-foreground" : "text-muted")}>
                {entry.label}
              </span>
            </li>
          );
        })}
      </ol>

      <ol className="hidden space-y-1 lg:block">
        {STEPS.map((entry, index) => {
          const active = step === index;
          const done = step > index;
          return (
            <li
              key={entry.label}
              aria-current={active ? "step" : undefined}
              className={cx(
                "relative rounded-lg px-3 py-2.5",
                active && "bg-surface-secondary/70",
              )}
            >
              {active && <span aria-hidden className="absolute inset-y-2 left-0 w-[2px] rounded-full bg-accent" />}
              <div className="flex items-center gap-2.5">
                <span
                  className={cx(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold tabular-nums",
                    done
                      ? "border-foreground bg-foreground text-background"
                      : active
                        ? "border-foreground text-foreground"
                        : "border-border text-muted",
                  )}
                >
                  {done ? <Check size={11} /> : index + 1}
                </span>
                <span className={cx("text-[12px] font-semibold", active || done ? "text-foreground" : "text-muted")}>
                  {entry.label}
                </span>
              </div>
              <p className="mt-1 pl-[1.9rem] text-[10.5px] text-muted">{entry.detail}</p>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepPanel({
  eyebrow,
  title,
  description,
  action,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="panel overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 px-5 py-5 sm:px-7 sm:py-6">
        <div className="min-w-0">
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="mt-2 font-sans text-xl font-bold tracking-[-0.03em] text-foreground sm:text-[1.4rem]">{title}</h2>
          <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-muted">{description}</p>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="px-5 py-5 sm:px-7 sm:py-6">{children}</div>
      {footer && <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-surface-secondary/20 px-5 py-4 sm:px-7">{footer}</footer>}
    </section>
  );
}

function SetupRoute() {
  const setup = useQuery({
    queryKey: ["account-setup"],
    queryFn: () => accountRequest<SetupState>("/setup"),
  });
  const me = useQuery({
    queryKey: ["setup-account"],
    queryFn: () => accountRequest<{ user: AccountUser }>("/me"),
    enabled: setup.data?.ownerCreated === true,
    retry: false,
  });
  const status = useQuery({
    ...queries.serverStatus(),
    enabled: setup.data?.ownerCreated === true,
  });
  const [step, setStepLocal] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    if (setup.data?.setupComplete) {
      window.location.replace("/");
      return;
    }
    if (setup.data) setStepLocal(Math.min(2, Math.max(0, setup.data.step - 1)));
  }, [setup.data]);
  const setStep = async (next: number) => {
    setError("");
    try {
      await accountRequest("/setup/progress", { step: next + 1 });
      setStepLocal(next);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save setup.",
      );
    }
  };
  if (!setup.data) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-8 text-sm text-muted">
        Loading server setup…
      </main>
    );
  }
  if (!setup.data.ownerCreated) return <OwnerStep />;
  if (!me.data) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-8 text-sm text-muted">
        Checking your account…
      </main>
    );
  }
  if (me.data.user.role !== "admin") {
    return (
      <main className="flex min-h-dvh items-center justify-center p-8 text-center text-sm text-muted">
        <p>
          Only an administrator can finish server setup.{" "}
          <a href="/" className="text-foreground underline underline-offset-4">
            Open Plexy
          </a>
        </p>
      </main>
    );
  }

  return (
    <SetupFrame step={step}>
      {error && (
        <p role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-danger/20 bg-danger/8 px-4 py-3 text-[12px] leading-relaxed text-danger-soft-foreground">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      {step === 0 && <TokenStep onContinue={() => setStep(1)} />}
      {step === 1 && (
        <div className="space-y-4">
          <LibraryFolderForm
            onComplete={() => setStep(2)}
            completeLabel="Create library and continue"
          />
          <div className="flex flex-wrap items-center justify-between gap-3 px-1">
            <button
              type="button"
              onClick={() => setStep(0)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-[11.5px] font-semibold text-muted transition-colors hover:text-foreground"
            >
              <ArrowLeft size={13} />
              Back
            </button>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="text-[11.5px] font-medium text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              Set up a library later
            </button>
          </div>
        </div>
      )}
      {step === 2 && <ReadyStep status={status.data} onAddLibrary={() => setStep(1)} />}
    </SetupFrame>
  );
}

export const Route = createFileRoute("/setup")({ component: SetupRoute });

function TokenStep({ onContinue }: { onContinue: () => void }) {
  const queryClient = useQueryClient();
  const settings = useQuery(queries.settings());
  const tmdbTest = useQuery({
    queryKey: ["tmdb-test"],
    queryFn: () => api.testTmdb(),
    retry: 1,
    staleTime: 30_000,
  });
  const [tokenInput, setTokenInput] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);
  const save = useMutation({
    mutationFn: async (rawToken: string) => {
      const clean = rawToken.trim();
      if (clean) await api.updateSettings({ tmdbToken: clean });
      return api.testTmdb();
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      await queryClient.invalidateQueries({ queryKey: ["server-status"] });
      await queryClient.invalidateQueries({ queryKey: ["tmdb-test"] });
      if (result.ok) setShowManualInput(false);
    },
  });
  const connected = tmdbTest.data?.ok === true;
  const envToken = settings.data?.settings.tokenSource === "env";
  const configured = settings.data?.settings.hasTmdbToken || envToken;

  return (
    <StepPanel
      eyebrow="Step 1 of 3"
      title="Connect metadata"
      description="TMDB provides posters, descriptions, release dates, and cast details."
      action={
        <span
          className={cx(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold",
            connected
              ? "border-success/25 bg-success/10 text-success-soft-foreground"
              : "border-warning/25 bg-warning/10 text-warning-soft-foreground",
          )}
        >
          {connected ? <Check size={12} /> : <Sparkles size={12} />}
          {connected ? "Connected" : configured ? "Needs verification" : "Token required"}
        </span>
      }
      footer={
        <>
          <button
            type="button"
            onClick={onContinue}
            className="text-[11.5px] font-medium text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            Configure metadata later
          </button>
          <Button onPress={onContinue} className="h-9 px-4 text-[11.5px] font-semibold">
            Continue
            <ArrowRight size={14} />
          </Button>
        </>
      }
    >
      {connected && !showManualInput ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface-secondary/40 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/12 text-success-soft-foreground">
              <CheckCircle2 size={18} />
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold text-foreground">Connected to TMDB</p>
              <p className="mt-0.5 text-[11px] text-muted">
                {envToken
                  ? "Token loaded from the server environment."
                  : "Metadata connection is ready. Metadata arrives with your first scan."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowManualInput(true)}
            className="text-[11px] font-semibold text-muted underline underline-offset-4 hover:text-foreground"
          >
            Change token
          </button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(tokenInput);
          }}
        >
          {tmdbTest.data && !tmdbTest.data.ok && (
            <div className="flex gap-2 rounded-xl border border-danger/20 bg-danger/8 p-3 text-[11.5px] leading-relaxed text-danger-soft-foreground">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {tmdbTest.data.message || "Could not connect to TMDB with the current token."}
            </div>
          )}
          {save.isError && (
            <p className="text-[11.5px] text-danger-soft-foreground">
              {save.error instanceof Error ? save.error.message : "Could not save the token."}
            </p>
          )}

          <div>
            <label htmlFor="tmdb-token" className="mb-1.5 block text-[11px] font-semibold text-muted">
              TMDB API v4 read-access token
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="tmdb-token"
                type="password"
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder="Paste the token from your TMDB account"
                fullWidth
                className="h-11 flex-1"
              />
              <Button
                type="submit"
                isDisabled={save.isPending || (!tokenInput.trim() && !configured)}
                className="h-11 shrink-0 px-5 text-[12px] font-semibold"
              >
                {save.isPending ? "Testing…" : "Verify and save"}
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              Create one under{" "}
              <a
                href="https://www.themoviedb.org/settings/api"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground underline underline-offset-4"
              >
                TMDB settings → API
              </a>
              . The token is stored on this server only.
            </p>
          </div>

          {showManualInput && connected && (
            <button
              type="button"
              onClick={() => setShowManualInput(false)}
              className="text-[11px] font-medium text-muted hover:text-foreground"
            >
              Cancel
            </button>
          )}
        </form>
      )}
    </StepPanel>
  );
}

function ReadyStep({
  status,
  onAddLibrary,
}: {
  status: ServerStatus | undefined;
  onAddLibrary: () => void;
}) {
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const lanUrls = status?.lanUrls ?? [];
  const entry = lanUrls.length > 0 ? `${lanUrls[0]}/connect` : null;

  const copy = (value: string) => {
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(value);
        window.setTimeout(() => setCopied((current) => (current === value ? null : current)), 1500);
      })
      .catch(() => setCopied(null));
  };

  return (
    <StepPanel
      eyebrow="Step 3 of 3"
      title="Your server is ready"
      description="Plexy scans your library in the background. Add, remove, and configure libraries whenever you need from Settings."
      action={
        <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-[10.5px] font-semibold text-success-soft-foreground">
          <Check size={12} />
          Ready
        </span>
      }
      footer={
        <>
          <Button
            variant="secondary"
            onPress={onAddLibrary}
            className="h-10 px-4 text-[11.5px] font-semibold"
          >
            <FolderPlus size={14} />
            Add another library
          </Button>
          <Button
            className="h-10 px-5 text-[12px] font-semibold"
            onPress={async () => {
              try {
                await accountRequest("/setup/complete", {});
                window.location.assign("/");
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not complete setup.");
              }
            }}
          >
            Finish setup
            <ArrowRight size={15} />
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-secondary/35 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/12 text-success-soft-foreground">
            <ShieldCheck size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-foreground">Connect your other devices</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
              Pairing codes, users, and content permissions live in Settings in the app.
            </p>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold text-muted">Client entry link</p>
          {entry ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-border bg-surface-secondary/50 px-3 py-2 font-mono text-[11px] text-foreground">
                {entry}
              </code>
              <button
                type="button"
                onClick={() => copy(entry)}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[11px] font-semibold text-foreground transition-colors hover:bg-surface-secondary"
              >
                {copied === entry ? <Check size={12} className="text-success-soft-foreground" /> : <Copy size={12} />}
                {copied === entry ? "Copied" : "Copy"}
              </button>
            </div>
          ) : (
            <div className="mt-1.5 flex items-start gap-3 rounded-lg border border-border bg-surface-secondary/35 p-3">
              <Server size={15} className="mt-0.5 shrink-0 text-muted" />
              <p className="text-[11.5px] leading-relaxed text-muted">
                LAN access is off. Turn it on in Server settings after setup, then this page shows the
                address other devices should open.
              </p>
            </div>
          )}
        </div>

        {lanUrls.length > 1 && (
          <div>
            <p className="text-[11px] font-semibold text-muted">Other addresses</p>
            <ul className="mt-1.5 space-y-1">
              {lanUrls.slice(1).map((url) => (
                <li key={url} className="flex items-center gap-2">
                  <Globe size={12} className="shrink-0 text-muted" />
                  <span className="truncate font-mono text-[10.5px] text-muted">{url}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p role="alert" className="text-[11.5px] text-danger-soft-foreground">
            {error}
          </p>
        )}
      </div>
    </StepPanel>
  );
}

function OwnerStep() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10 sm:px-6">
      <section className="w-full max-w-lg">
        <Link to="/" className="inline-flex items-center gap-2.5 px-1">
          <img src="/icon.svg" alt="" className="h-7 w-7" />
          <span className="font-sans text-[15px] font-extrabold tracking-[-0.03em] text-foreground">Plexy</span>
        </Link>
        <h1 className="mt-6 font-sans text-2xl font-extrabold tracking-[-0.035em] text-foreground sm:text-3xl">
          Create your owner account
        </h1>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
          This account manages the server, users, and libraries. Setup runs once for this installation.
        </p>
        <form
          className="panel mt-6 space-y-4 p-5 sm:p-6"
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            if (password !== confirm) {
              setError("The passwords do not match.");
              return;
            }
            setBusy(true);
            try {
              await accountRequest("/setup/owner", { username, password });
              window.location.replace("/setup");
            } catch (caught) {
              setError(
                caught instanceof Error ? caught.message : "Could not create account.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold text-muted">Username</span>
            <Input
              required
              minLength={3}
              maxLength={40}
              autoComplete="username"
              pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              fullWidth
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold text-muted">Password</span>
            <Input
              required
              minLength={12}
              maxLength={128}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              fullWidth
            />
            <span className="mt-1.5 block text-[10.5px] text-muted">Use at least 12 characters.</span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold text-muted">Confirm password</span>
            <Input
              required
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              fullWidth
            />
          </label>
          {error && (
            <p role="alert" className="text-[11.5px] text-danger-soft-foreground">
              {error}
            </p>
          )}
          <Button
            type="submit"
            isDisabled={busy}
            className="h-11 w-full text-[12px] font-semibold"
          >
            {busy ? "Creating account…" : "Create account and continue"}
          </Button>
        </form>
        <a href="/connect" className="mt-4 inline-block text-[11.5px] text-muted underline-offset-4 hover:text-foreground hover:underline">
          Looking for a server? Open Plexy Client
        </a>
      </section>
    </main>
  );
}
