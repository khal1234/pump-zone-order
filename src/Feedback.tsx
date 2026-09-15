import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

interface Suggestion {
  id: string;
  message: string;
  createdAt: string;
  status: "open" | "done";
  pathname: string;
}

async function api(path: string, options?: RequestInit) {
  const response = await fetch(path, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(result.error || "요청을 처리하지 못했어.");
  return result;
}

export function FeedbackDialog({ onClose }: { onClose(): void }) {
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const openedAt = useRef(Date.now());

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (message.trim().length < 10 || state === "sending") return;
    setState("sending");
    setError("");
    try {
      await api("/api/suggestions", { method: "POST", body: JSON.stringify({ message: message.trim(), website, openedAt: openedAt.current }) });
      setState("sent");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "잠시 뒤 다시 시도해줘.");
      setState("error");
    }
  }

  return <DialogShell title="익명으로 건의하기" eyebrow="PRIVATE FEEDBACK" onClose={onClose}>
    {state === "sent" ? <div className="feedback-success"><b>건의를 남겼어.</b><p>내용은 관리자만 볼 수 있어. 확인이 필요한 건의는 매일 한 번 알림으로 전달돼.</p><button onClick={onClose}>닫기</button></div> :
      <form onSubmit={(event) => void submit(event)}>
        <div className="private-notice"><b>건의 내용은 공개되지 않아.</b><p>이름이나 계정 없이 비공개로 저장되고 관리자만 확인해. 답변 기능은 없으니 위치 오류라면 곡명과 존을 함께 적어줘.</p></div>
        <label htmlFor="suggestion">무엇을 고치거나 추가하면 좋을까?</label>
        <textarea id="suggestion" value={message} onChange={(event) => setMessage(event.target.value)} minLength={10} maxLength={800} placeholder="예: S17에서 ○○곡 순서가 실제 기기와 달라요." autoFocus required />
        <input className="feedback-trap" value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" />
        <div className="feedback-actions"><small>{message.length}/800</small><button type="submit" disabled={message.trim().length < 10 || state === "sending"}>{state === "sending" ? "등록 중…" : "비공개 건의 등록"}</button></div>
        {error && <p className="feedback-error" role="alert">{error}</p>}
      </form>}
  </DialogShell>;
}

export function FeedbackAdmin({ onClose }: { onClose(): void }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const result = await api("/api/suggestions");
    setSuggestions(result.suggestions);
  }, []);

  useEffect(() => {
    api("/api/admin-session").then(async (result) => {
      setAuthenticated(result.authenticated);
      if (result.authenticated) await load();
    }).catch(() => setAuthenticated(false));
  }, [load]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api("/api/admin-session", { method: "POST", body: JSON.stringify({ password }) });
      setAuthenticated(true);
      setPassword("");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "로그인하지 못했어."); }
  }

  async function setStatus(row: Suggestion, status: "open" | "done") {
    try {
      setError("");
      await api("/api/suggestions", { method: "PATCH", body: JSON.stringify({ pathname: row.pathname, status }) });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "상태를 바꾸지 못했어."); }
  }

  async function remove(row: Suggestion) {
    if (!confirm("이 건의를 완전히 삭제할까? 되돌릴 수 없어.")) return;
    try {
      setError("");
      await api("/api/suggestions", { method: "DELETE", body: JSON.stringify({ pathname: row.pathname }) });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "삭제하지 못했어."); }
  }

  async function logout() {
    await api("/api/admin-session", { method: "DELETE" });
    setAuthenticated(false);
    setSuggestions([]);
  }

  return <DialogShell title="건의 관리" eyebrow="ADMIN ONLY" onClose={onClose} wide>
    {authenticated === null ? <p className="feedback-loading">로그인 상태를 확인하고 있어…</p> : !authenticated ?
      <form onSubmit={(event) => void login(event)}><div className="private-notice"><b>관리자 전용 화면</b><p>관리자 암호는 서버에서만 확인하고 브라우저에는 저장하지 않아.</p></div><label htmlFor="admin-password">관리자 암호</label><input id="admin-password" className="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus required /><div className="feedback-actions"><span></span><button type="submit">로그인</button></div>{error && <p className="feedback-error" role="alert">{error}</p>}</form> :
      <div className="admin-inbox"><div className="admin-toolbar"><p>미처리 {suggestions.filter((row) => row.status === "open").length}건 · 전체 {suggestions.length}건</p><button onClick={() => void logout()}>로그아웃</button></div>{error && <p className="feedback-error" role="alert">{error}</p>}{suggestions.length ? <div className="suggestion-list">{suggestions.map((row) => <article key={row.id} className={row.status === "done" ? "done" : ""}><div><span>{row.status === "open" ? "미처리" : "처리 완료"}</span><time>{new Date(row.createdAt).toLocaleString("ko-KR")}</time></div><p>{row.message}</p><footer><button onClick={() => void setStatus(row, row.status === "open" ? "done" : "open")}>{row.status === "open" ? "처리 완료" : "다시 열기"}</button><button className="danger" onClick={() => void remove(row)}>삭제</button></footer></article>)}</div> : <div className="feedback-empty">아직 들어온 건의가 없어.</div>}</div>}
  </DialogShell>;
}

function DialogShell({ title, eyebrow, onClose, wide = false, children }: { title: string; eyebrow: string; onClose(): void; wide?: boolean; children: ReactNode }) {
  useEffect(() => {
    function close(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`feedback-dialog ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={`${eyebrow}-title`}><div className="dialog-head"><div><small>{eyebrow}</small><h2 id={`${eyebrow}-title`}>{title}</h2></div><button onClick={onClose} aria-label="창 닫기">×</button></div>{children}</section></div>;
}
