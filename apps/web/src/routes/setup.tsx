/// First-run wizard: connect metadata, add an optional first library, then finish.
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ChevronRight, Server } from "lucide-react";
import { accountRequest, type AccountUser, type SetupState } from "../auth";
import { api } from "../client";
import { queries } from "../queries";
import { LibraryFolderForm } from "../components/library-folder-form";
import { Button, Input } from "@heroui/react";

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
    if (setup.data) setStepLocal(Math.max(0, setup.data.step - 1));
  }, [setup.data]);
  const setStep = async (next: number) => {
    setError("");
    try {
      await accountRequest("/setup/progress", { step: next + 1 });
      setStepLocal(next);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save setup.",
      );
    }
  };
  if (!setup.data) return <main className="p-8">Loading server setup…</main>;
  if (!setup.data.ownerCreated) return <OwnerStep />;
  if (!me.data) return <main className="p-8">Checking your account…</main>;
  if (me.data.user.role !== "admin")
    return (
      <main className="p-8">
        Only an administrator can finish server setup.{" "}
        <a href="/" className="underline">
          Open Plexy
        </a>
      </main>
    );

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-4 py-12 sm:px-8">
      <div className="space-y-8">
        <header className="space-y-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface text-foreground">
            <Server size={20} />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            Plexy · First run
          </p>
          <h1 className="font-sans text-3xl font-bold tracking-tight text-foreground">
            Set up your server
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted">
            Your owner account is ready. Connect metadata and add your media
            folders. You can change these settings or manage libraries later
            from the admin page.
          </p>
        </header>

        <nav aria-label="Setup progress" className="grid grid-cols-3 gap-2">
          {["Metadata", "First library", "Ready"].map((label, index) => (
            <div
              key={label}
              className={`border-t-2 pt-2 text-xs ${step >= index ? "border-foreground text-foreground" : "border-border text-muted"}`}
            >
              <span className="mr-2 tabular-nums">0{index + 1}</span>
              {label}
            </div>
          ))}
        </nav>

        {error && (
          <p role="alert" className="text-danger-soft-foreground">
            {error}
          </p>
        )}
        {step === 0 && <TokenStep onContinue={() => setStep(1)} />}
        {step === 1 && (
          <section className="space-y-4">
            <div>
              <h2 className="font-sans text-xl font-bold text-foreground">
                Add your first library
              </h2>
              <p className="mt-1 text-sm text-muted">
                Choose a library type and the folders Plexy should scan.
              </p>
            </div>
            <LibraryFolderForm
              onComplete={() => setStep(2)}
              completeLabel="Create library & continue"
            />
            <div className="flex justify-between">
              <button
                type="button"
                onClick={() => setStep(0)}
                className="text-xs text-muted hover:text-foreground"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="text-xs text-muted underline hover:text-foreground"
              >
                Set up a library later
              </button>
            </div>
          </section>
        )}
        {step === 2 && (
          <section className="border border-border bg-surface p-7">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-foreground" />
              <div>
                <h2 className="font-sans text-xl font-bold text-foreground">
                  Your server is ready
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Plexy will scan your library in the background. You can add,
                  remove, and configure libraries whenever you need.
                </p>
              </div>
            </div>
            <div className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
              <p className="font-semibold">Connect your other devices</p>
              {status.data?.lanUrls?.length ? (
                status.data.lanUrls.map((url) => (
                  <p key={url}>
                    <a className="break-all underline" href={`${url}/connect`}>
                      {url}/connect
                    </a>
                  </p>
                ))
              ) : (
                <p className="text-muted">
                  Enable LAN access in Server settings after setup to connect
                  other devices. Your client entry link is <code>/connect</code>
                  ; this server setup link is <code>/setup</code>.
                </p>
              )}
              <p className="text-xs text-muted">
                Manage users, content permissions, and your own pairing codes in
                My account.
              </p>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                className="h-10 px-5"
                onPress={async () => {
                  try {
                    await accountRequest("/setup/complete", {});
                    window.location.assign("/");
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : "Could not complete setup.",
                    );
                  }
                }}
              >
                Finish setup <ChevronRight size={16} />
              </Button>
              <Link to="/add-library">
                <Button variant="secondary" className="h-10 px-5">
                  Add another library
                </Button>
              </Link>
            </div>
          </section>
        )}
      </div>
    </main>
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
    <section className="border border-border bg-surface p-6">
      <h2 className="font-sans text-xl font-bold text-foreground">Connect metadata</h2>
      <p className="mt-1 text-sm text-muted">
        TMDB provides posters, descriptions, release dates, and cast details.
      </p>
      {connected && !showManualInput ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border border-border bg-surface-secondary p-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-foreground" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                Connected to TMDB
              </p>
              <p className="text-xs text-muted">
                {envToken
                  ? "Token loaded from the server environment."
                  : "Metadata connection is ready."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowManualInput(true)}
            className="text-xs text-muted underline hover:text-foreground"
          >
            Change
          </button>
          <Button onPress={onContinue} className="h-9 px-4">
            Continue <ChevronRight size={15} />
          </Button>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {tmdbTest.data && !tmdbTest.data.ok && (
            <div className="flex gap-2 border border-danger/20 bg-danger/8 p-3 text-xs text-danger-soft-foreground">
              <AlertCircle size={15} />
              {tmdbTest.data.message ||
                "Could not connect to TMDB with the current token."}
            </div>
          )}
          {save.isError && (
            <p className="text-xs text-danger-soft-foreground">
              {save.error instanceof Error
                ? save.error.message
                : "Could not save the token."}
            </p>
          )}
          <p className="text-xs leading-relaxed text-muted">
            Enter your TMDB API v4 Read-Access Token. Create one under{" "}
            <a
              href="https://www.themoviedb.org/settings/api"
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline"
            >
              TMDB Settings → API
            </a>
            .
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="password"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="TMDB Read-Access Token"
              fullWidth
              className="flex-1"
            />
            <Button
              isDisabled={save.isPending || (!tokenInput.trim() && !configured)}
              onPress={() => save.mutate(tokenInput)}
              className="h-10 shrink-0 px-5"
            >
              {save.isPending ? "Testing…" : "Verify & Save"}
            </Button>
          </div>
          <button
            type="button"
            onClick={onContinue}
            className="text-xs underline text-muted"
          >
            Configure metadata later
          </button>
          {showManualInput && connected && (
            <button
              type="button"
              onClick={() => setShowManualInput(false)}
              className="text-xs text-muted hover:text-foreground"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function OwnerStep() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 px-5 py-12">
      <header>
        <p className="text-sm text-muted">Plexy Server · First launch</p>
        <h1 className="mt-3 text-3xl font-bold">Create your owner account</h1>
        <p className="mt-3 text-sm text-muted">
          This account manages the server, users, and libraries. Setup runs once
          for this server installation.
        </p>
      </header>
      <form
        className="space-y-4"
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
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "Could not create account.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block text-sm">
          Username
          <Input
            required
            minLength={3}
            maxLength={40}
            autoComplete="username"
            pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            fullWidth
            className="mt-2"
          />
        </label>
        <label className="block text-sm">
          Password
          <Input
            required
            minLength={12}
            maxLength={128}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            className="mt-2"
          />
          <span className="mt-1 block text-xs text-muted">
            Use at least 12 characters.
          </span>
        </label>
        <label className="block text-sm">
          Confirm password
          <Input
            required
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            fullWidth
            className="mt-2"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-danger-soft-foreground">
            {error}
          </p>
        )}
        <Button
          type="submit"
          isDisabled={busy}
          className="h-11 w-full"
        >
          {busy ? "Creating account…" : "Create account & continue"}
        </Button>
      </form>
      <a href="/connect" className="text-sm underline text-muted">
        Looking for a server? Open Plexy Client
      </a>
    </main>
  );
}
