/// First-run wizard: connect metadata, add an optional first library, then finish.
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ChevronRight, Server } from "lucide-react";
import { api } from "../client";
import { queries } from "../queries";
import { LibraryFolderForm } from "../components/library-folder-form";
import { Button } from "../components/ui/button";

function SetupRoute() {
  const [step, setStep] = useState(0);

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-4 py-12 sm:px-8">
      <div className="space-y-8">
        <header className="space-y-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface text-ink"><Server size={20} /></div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">Plexy · First run</p>
          <h1 className="font-sans text-3xl font-bold tracking-tight text-ink">Set up your server</h1>
          <p className="max-w-xl text-sm leading-relaxed text-ink-muted">Connect metadata and add your media folders. You can change these settings or manage libraries later from the admin page.</p>
        </header>

        <nav aria-label="Setup progress" className="grid grid-cols-3 gap-2">
          {["Metadata", "First library", "Ready"].map((label, index) => (
            <div key={label} className={`border-t-2 pt-2 text-xs ${step >= index ? "border-ink text-ink" : "border-line text-ink-muted"}`}>
              <span className="mr-2 tabular-nums">0{index + 1}</span>{label}
            </div>
          ))}
        </nav>

        {step === 0 && <TokenStep onContinue={() => setStep(1)} />}
        {step === 1 && (
          <section className="space-y-4">
            <div>
              <h2 className="font-sans text-xl font-bold text-ink">Add your first library</h2>
              <p className="mt-1 text-sm text-ink-muted">Choose a library type and the folders Plexy should scan.</p>
            </div>
            <LibraryFolderForm onComplete={() => setStep(2)} completeLabel="Create library & continue" />
            <div className="flex justify-between">
              <button type="button" onClick={() => setStep(0)} className="text-xs text-ink-muted hover:text-ink">Back</button>
              <button type="button" onClick={() => setStep(2)} className="text-xs text-ink-muted underline hover:text-ink">Set up a library later</button>
            </div>
          </section>
        )}
        {step === 2 && (
          <section className="border border-line bg-surface p-7">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-ink" />
              <div>
                <h2 className="font-sans text-xl font-bold text-ink">Your server is ready</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">Plexy will scan your library in the background. You can add, remove, and configure libraries whenever you need.</p>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/"><Button variant="primary" className="h-10 px-5">Go to Plexy <ChevronRight size={16} /></Button></Link>
              <Link to="/add-library"><Button variant="surface" className="h-10 px-5">Add another library</Button></Link>
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
  const tmdbTest = useQuery({ queryKey: ["tmdb-test"], queryFn: () => api.testTmdb(), retry: 1, staleTime: 30_000 });
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
    <section className="border border-line bg-surface p-6">
      <h2 className="font-sans text-xl font-bold text-ink">Connect metadata</h2>
      <p className="mt-1 text-sm text-ink-muted">TMDB provides posters, descriptions, release dates, and cast details.</p>
      {connected && !showManualInput ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border border-line bg-surface-2 p-4">
          <div className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5 text-ink" /><div><p className="text-sm font-semibold text-ink">Connected to TMDB</p><p className="text-xs text-ink-muted">{envToken ? "Token loaded from the server environment." : "Metadata connection is ready."}</p></div></div>
          <button type="button" onClick={() => setShowManualInput(true)} className="text-xs text-ink-muted underline hover:text-ink">Change</button>
          <Button variant="primary" onClick={onContinue} className="h-9 px-4">Continue <ChevronRight size={15} /></Button>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {tmdbTest.data && !tmdbTest.data.ok && <div className="flex gap-2 border border-red-500/20 bg-red-500/8 p-3 text-xs text-red-400"><AlertCircle size={15} />{tmdbTest.data.message || "Could not connect to TMDB with the current token."}</div>}
          {save.isError && <p className="text-xs text-red-400">{save.error instanceof Error ? save.error.message : "Could not save the token."}</p>}
          <p className="text-xs leading-relaxed text-ink-muted">Enter your TMDB API v4 Read-Access Token. Create one under <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer" className="text-ink underline">TMDB Settings → API</a>.</p>
          <div className="flex flex-col gap-2 sm:flex-row"><input type="password" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} placeholder="TMDB Read-Access Token" className="h-10 flex-1 rounded-sm border border-line bg-surface-2 px-4 text-sm text-ink placeholder:text-ink-muted/70 outline-none focus:border-line-strong" /><Button variant="primary" disabled={save.isPending || (!tokenInput.trim() && !configured)} onClick={() => save.mutate(tokenInput)} className="h-10 shrink-0 px-5">{save.isPending ? "Testing…" : "Verify & Save"}</Button></div>
          {showManualInput && connected && <button type="button" onClick={() => setShowManualInput(false)} className="text-xs text-ink-muted hover:text-ink">Cancel</button>}
        </div>
      )}
    </section>
  );
}
