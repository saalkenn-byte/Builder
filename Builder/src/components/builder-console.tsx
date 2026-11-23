"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Archive, ArrowDownToLine, ArrowRight, Check, CheckCircle2, ChevronDown, Circle,
  Clock3, Code2, Database, Eye, EyeOff, FileArchive, FileCode2, Folder, KeyRound,
  LoaderCircle, LockKeyhole, Package, Play, Plus, RefreshCw, Search, Settings2,
  ShieldCheck, Square, Terminal, Trash2, UploadCloud, X, XCircle,
} from "lucide-react";
import type { BuildJobDTO, BuildStatus, ProjectDTO, ProjectWithJobsDTO } from "@/lib/builder-types";

const ACTIVE_STATUSES: BuildStatus[] = ["queued", "extracting", "installing", "building", "packaging"];
const MAX_FILE_SIZE = 50 * 1024 * 1024;

type ConfigState = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  extraEnv: string;
  timeoutMinutes: number;
  clearAnonKey: boolean;
  clearServiceRoleKey: boolean;
  clearExtraEnv: boolean;
};

const blankConfig: ConfigState = {
  supabaseUrl: "", anonKey: "", serviceRoleKey: "", extraEnv: "", timeoutMinutes: 10,
  clearAnonKey: false, clearServiceRoleKey: false, clearExtraEnv: false,
};

type Toast = { message: string; tone: "success" | "error" | "info" };

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed with status ${response.status}.`);
  return data as T;
}

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function duration(job: BuildJobDTO) {
  const milliseconds = job.durationMs ?? Date.now() - new Date(job.startedAt).getTime();
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function statusLabel(status: BuildStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function BuilderConsole() {
  const [records, setRecords] = useState<ProjectWithJobsDTO[]>([]);
  const [active, setActive] = useState<ProjectWithJobsDTO | null>(null);
  const [job, setJob] = useState<BuildJobDTO | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [config, setConfig] = useState<ConfigState>(blankConfig);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [connectionCheck, setConnectionCheck] = useState<{ state: "idle" | "checking" | "success" | "error"; message: string }>({ state: "idle", message: "" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [showAnon, setShowAnon] = useState(false);
  const [showService, setShowService] = useState(false);
  const [inspectionTab, setInspectionTab] = useState<"files" | "scripts" | "environment">("files");
  const [fileQuery, setFileQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const terminal = useRef<HTMLPreElement>(null);

  const loadProjects = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await api<{ projects: ProjectWithJobsDTO[] }>("/api/projects");
      setRecords(data.projects);
    } catch (reason) {
      setToast({ message: reason instanceof Error ? reason.message : "Could not load projects.", tone: "error" });
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
    try {
      const draft = JSON.parse(localStorage.getItem("forge-builder-draft") ?? "{}") as { supabaseUrl?: string; timeoutMinutes?: number };
      setConfig((current) => ({ ...current, supabaseUrl: draft.supabaseUrl ?? "", timeoutMinutes: draft.timeoutMinutes ?? 10 }));
    } catch { /* A malformed local draft should not block importing. */ }
  }, [loadProjects]);

  useEffect(() => {
    localStorage.setItem("forge-builder-draft", JSON.stringify({ supabaseUrl: config.supabaseUrl, timeoutMinutes: config.timeoutMinutes }));
  }, [config.supabaseUrl, config.timeoutMinutes]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!settingsOpen && !deleteOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setSettingsOpen(false); setDeleteOpen(false); }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [settingsOpen, deleteOpen]);

  useEffect(() => {
    if (autoScroll && terminal.current) terminal.current.scrollTop = terminal.current.scrollHeight;
  }, [job?.logs, autoScroll]);

  const syncJob = useCallback((updated: BuildJobDTO) => {
    setJob(updated);
    setActive((current) => current ? {
      ...current,
      jobs: [updated, ...current.jobs.filter((item) => item.id !== updated.id)],
    } : current);
    setRecords((current) => current.map((record) => record.project.id === updated.projectId ? {
      ...record,
      jobs: [updated, ...record.jobs.filter((item) => item.id !== updated.id)],
    } : record));
  }, []);

  useEffect(() => {
    if (!job || !ACTIVE_STATUSES.includes(job.status)) return;
    let stopped = false;
    const poll = async () => {
      try {
        const data = await api<{ job: BuildJobDTO }>(`/api/jobs/${job.id}`);
        if (!stopped) {
          syncJob(data.job);
          if (!ACTIVE_STATUSES.includes(data.job.status)) {
            setAuthorized(false);
            const projectData = await api<ProjectWithJobsDTO>(`/api/projects/${data.job.projectId}`);
            if (!stopped) {
              setActive(projectData);
              setRecords((current) => current.map((record) => record.project.id === projectData.project.id ? projectData : record));
              setToast({
                message: data.job.status === "succeeded" ? "Build verified. Your artifact is ready." : data.job.status === "cancelled" ? "Build cancelled." : "Build failed. Inspect the log for the exact error.",
                tone: data.job.status === "succeeded" ? "success" : data.job.status === "cancelled" ? "info" : "error",
              });
            }
          }
        }
      } catch (reason) {
        if (!stopped) setToast({ message: reason instanceof Error ? reason.message : "Live status disconnected.", tone: "error" });
      }
    };
    const timer = setInterval(() => void poll(), 1100);
    void poll();
    return () => { stopped = true; clearInterval(timer); };
  }, [job?.id, job?.status, syncJob]);

  function chooseFile(selected: File | null) {
    setError("");
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith(".zip")) { setError("Choose a .zip archive containing your Next.js project."); return; }
    if (selected.size > MAX_FILE_SIZE) { setError("This ZIP exceeds the 50 MB upload limit."); return; }
    if (selected.size === 0) { setError("The selected ZIP is empty."); return; }
    setFile(selected);
  }

  function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files[0] ?? null);
  }

  async function checkConnection() {
    if (!config.supabaseUrl.trim()) {
      setConnectionCheck({ state: "error", message: "Enter a Supabase URL first." });
      return;
    }
    setConnectionCheck({ state: "checking", message: "Requesting /auth/v1/health…" });
    try {
      const result = await api<{ reachable: boolean; message: string }>("/api/supabase/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: settingsOpen ? active?.project.id : undefined,
          supabaseUrl: config.supabaseUrl,
          anonKey: config.anonKey,
        }),
      });
      setConnectionCheck({ state: result.reachable ? "success" : "error", message: result.message });
    } catch (reason) {
      setConnectionCheck({ state: "error", message: reason instanceof Error ? reason.message : "Connection check failed." });
    }
  }

  async function importProject(event: FormEvent) {
    event.preventDefault();
    if (!file) { setError("Select your Next.js ZIP before inspecting."); return; }
    if (!config.supabaseUrl.trim()) { setError("Enter your Supabase project URL."); return; }
    setLoading(true); setError("");
    try {
      const body = new FormData();
      body.append("archive", file);
      body.append("supabaseUrl", config.supabaseUrl);
      body.append("anonKey", config.anonKey);
      body.append("serviceRoleKey", config.serviceRoleKey);
      body.append("extraEnv", config.extraEnv);
      body.append("timeoutMinutes", String(config.timeoutMinutes));
      const record = await api<ProjectWithJobsDTO>("/api/projects", { method: "POST", body });
      setActive(record); setJob(null); setRecords((current) => [record, ...current]);
      setConfig((current) => ({ ...current, anonKey: "", serviceRoleKey: "", extraEnv: "", clearAnonKey: false, clearServiceRoleKey: false, clearExtraEnv: false }));
      setAuthorized(false); setInspectionTab("files"); setFileQuery("");
      setToast({ message: "Archive inspected. Nothing has been executed.", tone: "success" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Archive inspection failed.");
    } finally { setLoading(false); }
  }

  async function resumeProject(id: string) {
    setLoading(true); setError("");
    try {
      const record = await api<ProjectWithJobsDTO>(`/api/projects/${id}`);
      setActive(record); setJob(record.jobs[0] ?? null); setAuthorized(false); setInspectionTab("files"); setFileQuery("");
      setConfig({ ...blankConfig, supabaseUrl: record.project.supabaseUrl, timeoutMinutes: record.project.timeoutMinutes });
      document.getElementById("console")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (reason) { setToast({ message: reason instanceof Error ? reason.message : "Could not open project.", tone: "error" }); }
    finally { setLoading(false); }
  }

  async function startBuild() {
    if (!active || !authorized) return;
    setLoading(true); setError("");
    try {
      const data = await api<{ job: BuildJobDTO }>(`/api/projects/${active.project.id}/build`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ authorization: true }),
      });
      setJob(data.job);
      setActive((current) => current ? { ...current, project: { ...current.project, status: "building" }, jobs: [data.job, ...current.jobs] } : current);
      setToast({ message: "Authorized worker started. Live output is real command output.", tone: "info" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The build could not be started."); }
    finally { setLoading(false); }
  }

  async function selectBuild(id: string) {
    if (id === job?.id) return;
    try {
      const data = await api<{ job: BuildJobDTO }>(`/api/jobs/${id}`);
      setJob(data.job);
    } catch (reason) {
      setToast({ message: reason instanceof Error ? reason.message : "Could not load that build.", tone: "error" });
    }
  }

  async function cancelBuild() {
    const target = active?.jobs.find((item) => ACTIVE_STATUSES.includes(item.status)) ?? job;
    if (!target) return;
    try {
      const data = await api<{ job: BuildJobDTO }>(`/api/jobs/${target.id}/cancel`, { method: "POST" });
      syncJob(data.job);
      setToast({ message: "Cancellation signal sent to the process group.", tone: "info" });
    } catch (reason) { setToast({ message: reason instanceof Error ? reason.message : "Could not cancel build.", tone: "error" }); }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!active) return;
    setLoading(true);
    try {
      const data = await api<{ project: ProjectDTO }>(`/api/projects/${active.project.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config),
      });
      setActive((current) => current ? { ...current, project: data.project } : current);
      setRecords((current) => current.map((record) => record.project.id === data.project.id ? { ...record, project: data.project } : record));
      setConfig((current) => ({ ...current, anonKey: "", serviceRoleKey: "", extraEnv: "", clearAnonKey: false, clearServiceRoleKey: false, clearExtraEnv: false }));
      setSettingsOpen(false);
      setToast({ message: "Encrypted project settings updated.", tone: "success" });
    } catch (reason) { setToast({ message: reason instanceof Error ? reason.message : "Settings could not be saved.", tone: "error" }); }
    finally { setLoading(false); }
  }

  async function deleteProject() {
    if (!active) return;
    setLoading(true);
    try {
      await api<{ ok: boolean }>(`/api/projects/${active.project.id}`, { method: "DELETE" });
      setRecords((current) => current.filter((record) => record.project.id !== active.project.id));
      setActive(null); setJob(null); setFile(null); setDeleteOpen(false); setAuthorized(false);
      setToast({ message: "Project, workspace, and artifacts deleted.", tone: "info" });
    } catch (reason) { setToast({ message: reason instanceof Error ? reason.message : "Project could not be deleted.", tone: "error" }); }
    finally { setLoading(false); }
  }

  function newImport() {
    setActive(null); setJob(null); setFile(null); setError(""); setAuthorized(false);
    setConfig((current) => ({ ...blankConfig, supabaseUrl: current.supabaseUrl, timeoutMinutes: current.timeoutMinutes }));
    if (fileInput.current) fileInput.current.value = "";
  }

  const runningJob = active?.jobs.find((item) => ACTIVE_STATUSES.includes(item.status));
  const activeJob = Boolean(runningJob);
  const visibleFiles = active?.project.files.filter((item) => item.path.toLowerCase().includes(fileQuery.toLowerCase())) ?? [];

  return (
    <section className="console-section" id="console" aria-labelledby="console-title">
      <div className="section-heading console-heading">
        <span className="section-number">01 / BUILD BAY</span>
        <h2 id="console-title">From ZIP to<br /><em>verified output.</em></h2>
        <p>Nothing executes at upload. Inspect the manifest, review the commands, then explicitly authorize the worker.</p>
      </div>

      <div className="console-shell">
        <div className="workspace-main">
          <div className="workspace-bar">
            <div className="workspace-title"><span className="window-dot" /><span>{active ? active.project.name : "New project import"}</span></div>
            <div className="runner-state"><span className={activeJob ? "is-running" : ""} /> {activeJob ? "WORKER ACTIVE" : "RUNNER READY"}</div>
          </div>

          <AnimatePresence>{error && (
            <motion.div className="inline-error" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
              <XCircle size={17} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button>
            </motion.div>
          )}</AnimatePresence>

          <AnimatePresence mode="wait">
            {!active ? (
              <motion.form key="import" className="import-form" onSubmit={importProject} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
                <div className="form-step-label"><span>01</span><div><strong>Source & connection</strong><small>Required to inspect your archive</small></div></div>
                <div
                  className={`dropzone ${dragging ? "is-dragging" : ""} ${file ? "has-file" : ""}`}
                  onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={dropFile}
                >
                  <input ref={fileInput} id="archive-input" type="file" accept=".zip,application/zip" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
                  {file ? <FileArchive size={31} strokeWidth={1.3} /> : <UploadCloud size={31} strokeWidth={1.3} />}
                  {file ? (
                    <><strong>{file.name}</strong><span>{bytes(file.size)} · Ready for read-only inspection</span><button type="button" onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ""; }}>Choose a different ZIP</button></>
                  ) : (
                    <><strong>Drop your Next.js ZIP here</strong><span>or choose a file · up to 50 MB compressed</span><label htmlFor="archive-input">Browse archive <ArrowRight size={14} /></label></>
                  )}
                </div>

                <div className="connection-fields">
                  <label className="field"><span>Supabase project URL <b>Required</b></span><div className="input-with-icon"><Database size={17} /><input type="url" value={config.supabaseUrl} onChange={(event) => setConfig({ ...config, supabaseUrl: event.target.value })} placeholder="https://your-project.supabase.co" autoComplete="url" /></div></label>
                  <label className="field"><span>Publishable / anon key <b>Optional</b></span><div className="input-with-icon"><KeyRound size={17} /><input type={showAnon ? "text" : "password"} value={config.anonKey} onChange={(event) => setConfig({ ...config, anonKey: event.target.value })} placeholder="eyJ… or sb_publishable_…" autoComplete="off" /><button type="button" onClick={() => setShowAnon(!showAnon)} aria-label={showAnon ? "Hide publishable key" : "Show publishable key"}>{showAnon ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
                </div>
                <div className={`connection-test connection-${connectionCheck.state}`}>
                  <button type="button" onClick={() => void checkConnection()} disabled={connectionCheck.state === "checking"}>{connectionCheck.state === "checking" ? <LoaderCircle className="spin" size={13} /> : <Database size={13} />} Test Supabase connection</button>
                  <span>{connectionCheck.message || "Advisory Auth health check · does not start a build"}</span>
                </div>

                <button className="advanced-toggle" type="button" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}><Settings2 size={15} /> Advanced environment & limits <ChevronDown size={15} className={advanced ? "rotate" : ""} /></button>
                <AnimatePresence initial={false}>{advanced && (
                  <motion.div className="advanced-fields" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                    <label className="field"><span>Service-role key <b>Server only</b></span><div className="input-with-icon"><LockKeyhole size={17} /><input type={showService ? "text" : "password"} value={config.serviceRoleKey} onChange={(event) => setConfig({ ...config, serviceRoleKey: event.target.value })} placeholder="Never exposed to the browser after import" autoComplete="off" /><button type="button" onClick={() => setShowService(!showService)} aria-label="Toggle service key visibility">{showService ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
                    <label className="field"><span>Additional environment <b>KEY=value per line</b></span><textarea value={config.extraEnv} onChange={(event) => setConfig({ ...config, extraEnv: event.target.value })} placeholder={"RESEND_API_KEY=…\nNEXT_PUBLIC_SITE_NAME=My app"} rows={4} spellCheck={false} /></label>
                    <label className="field timeout-field"><span>Per-command timeout</span><select value={config.timeoutMinutes} onChange={(event) => setConfig({ ...config, timeoutMinutes: Number(event.target.value) })}><option value={5}>5 minutes</option><option value={10}>10 minutes</option><option value={20}>20 minutes</option></select></label>
                  </motion.div>
                )}</AnimatePresence>

                <div className="import-footer"><p><ShieldCheck size={15} /> Keys are encrypted server-side. Upload performs no install or build.</p><button className="button button-dark" type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />}{loading ? "Inspecting archive…" : "Inspect archive"}</button></div>
              </motion.form>
            ) : (
              <motion.div key="project" className="project-view" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
                <div className="project-overview">
                  <div><span className={`project-status status-${active.project.status}`}>{active.project.status}</span><h3>{active.project.name}</h3><p>{active.project.archiveName} · imported {shortDate(active.project.createdAt)}</p></div>
                  <div className="project-actions"><button onClick={newImport} disabled={Boolean(activeJob)}><Plus size={15} /> New import</button><button onClick={() => setSettingsOpen(true)} disabled={Boolean(activeJob)}><Settings2 size={15} /> Settings</button><a href={`/api/projects/${active.project.id}/source`} download><ArrowDownToLine size={15} /> Source</a><button className="icon-danger" onClick={() => setDeleteOpen(true)} disabled={Boolean(activeJob)} aria-label="Delete project"><Trash2 size={15} /></button></div>
                </div>

                <div className="inspection-stats">
                  <div><Package size={18} /><span>Framework</span><strong>Next.js {active.project.nextVersion}</strong></div>
                  <div><Code2 size={18} /><span>Router</span><strong>{active.project.router}</strong></div>
                  <div><Folder size={18} /><span>Archive</span><strong>{active.project.fileCount} files · {bytes(active.project.uncompressedSize)}</strong></div>
                  <div><Archive size={18} /><span>Package manager</span><strong>{active.project.packageManager}</strong></div>
                </div>

                {active.project.warnings.length > 0 && <div className="warning-stack">{active.project.warnings.map((warning) => <p key={warning}><span>!</span>{warning}</p>)}</div>}

                <div className="command-grid"><div><span>INSTALL COMMAND</span><code>{active.project.installCommand}</code></div><div><span>BUILD COMMAND</span><code>{active.project.buildCommand}</code></div></div>

                <div className="inspection-panel">
                  <div className="inspection-tabs" role="tablist">
                    {(["files", "scripts", "environment"] as const).map((tab) => <button role="tab" aria-selected={inspectionTab === tab} className={inspectionTab === tab ? "active" : ""} onClick={() => setInspectionTab(tab)} key={tab}>{tab === "files" ? `Files (${active.project.fileCount})` : tab === "scripts" ? `Scripts (${Object.keys(active.project.scripts).length})` : `Environment (${active.project.envKeys.length})`}</button>)}
                  </div>
                  <AnimatePresence mode="wait">
                    {inspectionTab === "files" && <motion.div key="files" className="file-browser" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><div className="file-search"><Search size={14} /><input value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="Filter inspected paths…" /></div><div className="file-list">{visibleFiles.length ? visibleFiles.map((item) => <div key={item.path}><FileCode2 size={13} /><span>{item.path}</span><small>{bytes(item.size)}</small></div>) : <p>No inspected paths match “{fileQuery}”.</p>}</div>{active.project.fileCount > active.project.files.length && <p className="file-truncation">Showing the first {active.project.files.length} files in the saved manifest. All {active.project.fileCount} files remain in the source archive.</p>}</motion.div>}
                    {inspectionTab === "scripts" && <motion.div key="scripts" className="script-list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{Object.entries(active.project.scripts).map(([name, command]) => <div key={name}><code>{name}</code><span>{command}</span></div>)}</motion.div>}
                    {inspectionTab === "environment" && <motion.div key="env" className="env-list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><p>Keys discovered in your env templates. Values are never read from templates or displayed here.</p><div>{active.project.envKeys.length ? active.project.envKeys.map((key) => <code key={key}>{key}</code>) : <span>No environment template keys detected.</span>}</div><hr /><p>Forge connection status</p><div><code className={active.project.hasAnonKey ? "configured" : ""}>NEXT_PUBLIC_SUPABASE_ANON_KEY {active.project.hasAnonKey ? "✓ saved" : "— not saved"}</code><code className={active.project.hasServiceKey ? "configured" : ""}>SUPABASE_SERVICE_ROLE_KEY {active.project.hasServiceKey ? "✓ saved" : "— not saved"}</code><code className="configured">NEXT_PUBLIC_SUPABASE_URL ✓ saved</code></div></motion.div>}
                  </AnimatePresence>
                </div>

                <div className="authorization-panel">
                  <div><ShieldCheck size={23} /><div><strong>Authorize execution</strong><p>I own or trust this archive and authorize Forge to extract it, install its dependencies (including lifecycle scripts), and run its build script in a fresh workspace.</p></div></div>
                  <label className="authorization-check"><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} disabled={Boolean(activeJob)} /><span className="custom-check">{authorized && <Check size={14} />}</span><span>I understand and authorize this build</span></label>
                  {!active.project.hasAnonKey && <p className="key-note">No publishable key is saved. The build can still run, but Supabase browser features may require one.</p>}
                  <button className="button button-acid build-button" onClick={startBuild} disabled={!authorized || loading || Boolean(activeJob)}>{loading && !activeJob ? <LoaderCircle className="spin" size={18} /> : <Play size={18} fill="currentColor" />}{activeJob ? "Build in progress" : "Build application"}<ArrowRight size={18} /></button>
                </div>

                <BuildTerminal job={job} jobs={active.jobs} onSelectJob={(id) => void selectBuild(id)} activeJob={activeJob} onCancel={cancelBuild} terminalRef={terminal} autoScroll={autoScroll} setAutoScroll={setAutoScroll} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <aside className="history-panel">
          <div className="history-heading"><div><span>PROJECT HISTORY</span><strong>{records.length.toString().padStart(2, "0")}</strong></div><button onClick={() => void loadProjects()} aria-label="Refresh project history"><RefreshCw size={15} className={historyLoading ? "spin" : ""} /></button></div>
          <div className="history-list">
            {historyLoading && records.length === 0 ? <div className="history-empty"><LoaderCircle className="spin" size={22} /><p>Reading saved projects…</p></div> : records.length === 0 ? <div className="history-empty"><Archive size={27} strokeWidth={1.2} /><strong>No imports yet</strong><p>Your inspected projects and genuine build jobs will appear here.</p><a href="/api/sample" download>Get a test Next.js ZIP <ArrowRight size={14} /></a></div> : records.map((record) => {
              const latest = record.jobs[0];
              return <button className={`history-item ${active?.project.id === record.project.id ? "selected" : ""}`} key={record.project.id} onClick={() => void resumeProject(record.project.id)}><div className="history-item-top"><span className={`history-status status-${latest?.status ?? record.project.status}`} /> <small>{shortDate(record.project.createdAt)}</small></div><strong>{record.project.name}</strong><span>{record.project.packageManager} · {record.project.router}</span>{latest && <div className="history-job"><span>{statusLabel(latest.status)}</span><small>#{latest.id.slice(0, 8)}</small></div>}<ArrowRight className="history-arrow" size={16} /></button>;
            })}
          </div>
          <div className="history-foot"><LockKeyhole size={15} /><p>Only project metadata and saved-key indicators reach this browser. Internal paths and credentials stay on the server.</p></div>
        </aside>
      </div>

      <AnimatePresence>{settingsOpen && active && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <motion.form className="settings-modal" onSubmit={saveSettings} initial={{ opacity: 0, y: 30, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: 0.98 }}>
            <div className="modal-heading"><div><span>PROJECT SETTINGS</span><h3>{active.project.name}</h3></div><button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={19} /></button></div>
            <label className="field"><span>Supabase project URL</span><input type="url" value={config.supabaseUrl} onChange={(event) => setConfig({ ...config, supabaseUrl: event.target.value })} /></label>
            <div className={`connection-test connection-${connectionCheck.state}`}><button type="button" onClick={() => void checkConnection()} disabled={connectionCheck.state === "checking"}>{connectionCheck.state === "checking" ? <LoaderCircle className="spin" size={13} /> : <Database size={13} />} Test with saved/entered key</button><span>{connectionCheck.message || "Checks the URL above; a blank key uses the encrypted saved key."}</span></div>
            <label className="field"><span>Publishable key <b>{active.project.hasAnonKey && !config.clearAnonKey ? "Saved · blank keeps current" : "Not saved"}</b></span><input type="password" value={config.anonKey} onChange={(event) => setConfig({ ...config, anonKey: event.target.value })} placeholder="Enter a replacement key" autoComplete="off" /></label>
            {active.project.hasAnonKey && <label className="clear-secret"><input type="checkbox" checked={config.clearAnonKey} onChange={(event) => setConfig({ ...config, clearAnonKey: event.target.checked })} /> Remove saved publishable key</label>}
            <label className="field"><span>Service-role key <b>{active.project.hasServiceKey && !config.clearServiceRoleKey ? "Saved · blank keeps current" : "Not saved"}</b></span><input type="password" value={config.serviceRoleKey} onChange={(event) => setConfig({ ...config, serviceRoleKey: event.target.value })} placeholder="Enter a replacement key" autoComplete="off" /></label>
            {active.project.hasServiceKey && <label className="clear-secret"><input type="checkbox" checked={config.clearServiceRoleKey} onChange={(event) => setConfig({ ...config, clearServiceRoleKey: event.target.checked })} /> Remove saved service-role key</label>}
            <label className="field"><span>Additional environment <b>{active.project.hasExtraEnv && !config.clearExtraEnv ? "Saved · blank keeps current" : "Not saved"}</b></span><textarea rows={4} value={config.extraEnv} onChange={(event) => setConfig({ ...config, extraEnv: event.target.value })} placeholder="KEY=value per line. Re-enter to replace the saved set." /></label>
            {active.project.hasExtraEnv && <label className="clear-secret"><input type="checkbox" checked={config.clearExtraEnv} onChange={(event) => setConfig({ ...config, clearExtraEnv: event.target.checked })} /> Remove saved additional variables</label>}
            <label className="field"><span>Per-command timeout</span><select value={config.timeoutMinutes} onChange={(event) => setConfig({ ...config, timeoutMinutes: Number(event.target.value) })}><option value={5}>5 minutes</option><option value={10}>10 minutes</option><option value={20}>20 minutes</option></select></label>
            <div className="modal-actions"><button type="button" onClick={() => setSettingsOpen(false)}>Cancel</button><button className="button button-dark" disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Save encrypted settings</button></div>
          </motion.form>
        </motion.div>
      )}</AnimatePresence>

      <AnimatePresence>{deleteOpen && active && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div className="delete-modal" initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.97, opacity: 0 }}><Trash2 size={26} /><h3>Delete {active.project.name}?</h3><p>This removes the project record, uploaded source, extracted workspace, logs, and every build artifact. This cannot be undone.</p><div className="modal-actions"><button onClick={() => setDeleteOpen(false)}>Keep project</button><button className="button button-danger" onClick={() => void deleteProject()} disabled={loading}>Delete permanently</button></div></motion.div></motion.div>}</AnimatePresence>

      <AnimatePresence>{toast && <motion.div className={`toast toast-${toast.tone}`} initial={{ opacity: 0, y: 20, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: 12, x: "-50%" }} role="status">{toast.tone === "success" ? <CheckCircle2 size={18} /> : toast.tone === "error" ? <XCircle size={18} /> : <Circle size={18} />}<span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Dismiss notification"><X size={14} /></button></motion.div>}</AnimatePresence>
    </section>
  );
}

function BuildTerminal({ job, jobs, onSelectJob, activeJob, onCancel, terminalRef, autoScroll, setAutoScroll }: {
  job: BuildJobDTO | null;
  jobs: BuildJobDTO[];
  onSelectJob: (id: string) => void;
  activeJob: boolean;
  onCancel: () => void;
  terminalRef: React.RefObject<HTMLPreElement | null>;
  autoScroll: boolean;
  setAutoScroll: (value: boolean) => void;
}) {
  const stages = ["Queue", "Extract", "Install", "Build", "Package"];
  let current = 0;
  if (job) {
    if (job.status === "succeeded") current = 5;
    else if (job.status === "packaging" || job.logs.includes("Packaging source")) current = 4;
    else if (job.status === "building" || job.logs.includes("Running the project build script")) current = 3;
    else if (job.status === "installing" || job.logs.includes("Installing dependencies")) current = 2;
    else if (job.status === "extracting" || job.logs.includes("fresh workspace")) current = 1;
  }
  return (
    <div className="terminal-panel">
      <div className="terminal-heading"><div><Terminal size={17} /><span>BUILD OUTPUT</span>{job && <small>#{job.id.slice(0, 8)}</small>}{jobs.length > 1 && job && <select aria-label="Select a previous build job" value={job.id} onChange={(event) => onSelectJob(event.target.value)} disabled={activeJob}>{jobs.map((item) => <option value={item.id} key={item.id}>#{item.id.slice(0, 8)} · {statusLabel(item.status)} · {shortDate(item.createdAt)}</option>)}</select>}</div>{job && <div className={`job-status job-${job.status}`}><span />{statusLabel(job.status)}<small><Clock3 size={12} />{duration(job)}</small></div>}</div>
      <div className="build-stages">{stages.map((stage, index) => <div className={`${index < current ? "complete" : ""} ${index === current && job?.status !== "succeeded" ? "current" : ""}`} key={stage}><span>{index < current || job?.status === "succeeded" ? <Check size={12} /> : index + 1}</span><small>{stage}</small></div>)}</div>
      <pre ref={terminalRef} className={!job ? "terminal-empty" : ""}>{job ? job.logs || "[worker] Waiting for the first process output…" : "[forge] No build job selected.\n[forge] Authorize a build to stream genuine stdout and stderr here.\n[forge] Upload and inspection alone never execute repository code."}</pre>
      <div className="terminal-footer">
        <label><input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} /> Auto-scroll</label>
        <div>{job && <a href={`/api/jobs/${job.id}/logs`} download><ArrowDownToLine size={14} /> Log</a>}{activeJob && <button className="cancel-build" onClick={onCancel}><Square size={12} fill="currentColor" /> Cancel</button>}{job?.status === "succeeded" && job.artifactName && <a className="artifact-download" href={`/api/jobs/${job.id}/artifact`} download><Package size={14} /> Download build {job.artifactSize ? `· ${bytes(job.artifactSize)}` : ""}</a>}</div>
      </div>
      {job?.error && <div className="job-error"><XCircle size={15} /><span>{job.error}</span></div>}
    </div>
  );
}
