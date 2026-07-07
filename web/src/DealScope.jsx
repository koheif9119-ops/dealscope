import { useState, useEffect, useMemo, useCallback } from "react";

/* ============================================================
   DealScope — M&A・上場企業開示モニター（本番版）
   ・データは data/latest.json（GitHub Actionsが自動更新）を読み込む
   ・デザインはプロトタイプ dealscope.jsx を正とし変更しない
   ============================================================ */

const GENRES = [
  { id: "all", label: "すべて" },
  { id: "ma", label: "M&A" },
  { id: "release", label: "事業リリース" },
  { id: "chukei", label: "中期経営計画" },
  { id: "kessan", label: "決算・有報" },
  { id: "news", label: "ニュース" },
];

const MARKETS = ["プライム", "スタンダード", "グロース", "地方"];

const GENRE_META = {
  ma: { label: "M&A", cls: "g-ma" },
  release: { label: "リリース", cls: "g-release" },
  chukei: { label: "中計", cls: "g-chukei" },
  kessan: { label: "決算", cls: "g-kessan" },
  news: { label: "NEWS", cls: "g-news" },
};

const STORAGE_KEY = "dealscope:bookmarks";
const DATA_URL = "data/latest.json";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/* "2026-07-03" → "7月3日（金）" */
function dateLabel(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const w = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}月${d}日（${w}）`;
}

/* "2026-07-05T08:30:00+09:00" → "07/05 08:30" */
function fmtUpdated(iso) {
  if (!iso || iso.length < 16) return "—";
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)} ${iso.slice(11, 16)}`;
}

/* 円の金額 → "1,180億円" などの表示（マイナスは▲） */
function fmtYen(n) {
  if (n == null || isNaN(n)) return "—";
  const neg = n < 0;
  const a = Math.abs(n);
  let s;
  if (a >= 1e12) s = (Math.round((a / 1e12) * 10) / 10).toLocaleString() + "兆円";
  else if (a >= 1e8) s = Math.round(a / 1e8).toLocaleString() + "億円";
  else s = Math.round(a / 1e6).toLocaleString() + "百万円";
  return (neg ? "▲" : "") + s;
}

/* 前期比 → "+8.4%" / "▲2.0%" */
function fmtYoy(p) {
  if (p == null || isNaN(p)) return "—";
  return p < 0 ? `▲${Math.abs(p).toFixed(1)}%` : `+${p.toFixed(1)}%`;
}

/* ---------- マイページ（本人情報・テンプレート）の保存 ----------
   個人情報は閲覧者のブラウザ内（localStorage）にのみ保存され、
   リポジトリ・インターネット上には一切置かれない（仕様書7）。 */
const MYINFO_KEY = "dealscope:myinfo";
const TEMPLATES_KEY = "dealscope:templates";

const EMPTY_MYINFO = { name: "", company: "", dept: "", tel: "", email: "" };

const DEFAULT_TEMPLATES = [
  {
    name: "M&A開示を見て（買収ニーズの打診）",
    body:
      "{先方社名}\nご担当者様\n\n突然のご連絡失礼いたします。\n{自社名}の{氏名}と申します。\n\n{開示日}付で開示されました「{開示タイトル}」を拝見し、ご連絡いたしました。\n貴社の今後の事業展開に際し、M&A・資本提携の面でお力添えできる可能性があると考えております。\n\nつきましては、一度30分ほどオンラインにてご挨拶とディスカッションの機会をいただけないでしょうか。\nご都合のよろしい日時を2〜3いただけますと幸いです。\n\n何卒よろしくお願い申し上げます。\n\n{自社名} {部署}\n{氏名}\n電話：{電話}\nメール：{メール}",
  },
  {
    name: "中期経営計画を見て（面談依頼）",
    body:
      "{先方社名}\nご担当者様\n\n突然のご連絡失礼いたします。\n{自社名}の{氏名}と申します。\n\n{開示日}付で公表されました「{開示タイトル}」を拝読いたしました。\n計画に掲げられた成長戦略の実現に向けて、M&A・提携先のご紹介という形でお手伝いできることがあるのではないかと考え、ご連絡いたしました。\n\nもしご関心をお持ちいただけましたら、一度短時間でもお打ち合わせの機会をいただけますと幸いです。\n\n何卒よろしくお願い申し上げます。\n\n{自社名} {部署}\n{氏名}\n電話：{電話}\nメール：{メール}",
  },
];

function loadMyInfo() {
  try {
    const raw = window.localStorage.getItem(MYINFO_KEY);
    if (raw) return { ...EMPTY_MYINFO, ...JSON.parse(raw) };
  } catch (e) { /* 保存なし */ }
  return { ...EMPTY_MYINFO };
}

function loadTemplates() {
  try {
    const raw = window.localStorage.getItem(TEMPLATES_KEY);
    if (raw) {
      const t = JSON.parse(raw);
      if (Array.isArray(t) && t.length > 0) return t;
    }
  } catch (e) { /* 保存なし */ }
  return DEFAULT_TEMPLATES.map((t) => ({ ...t }));
}

/* テンプレートの {差し込み} を実際の値に置き換える */
function fillTemplate(body, item, my) {
  const map = {
    先方社名: item.name,
    開示タイトル: item.title,
    開示日: dateLabel(item.date),
    氏名: my.name,
    自社名: my.company,
    部署: my.dept,
    電話: my.tel,
    メール: my.email,
  };
  return body.replace(/\{([^}]+)\}/g, (m, k) => (map[k] != null && map[k] !== "" ? map[k] : m));
}

export default function DealScope() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [genre, setGenre] = useState("all");
  const [markets, setMarkets] = useState(new Set(MARKETS));
  const [query, setQuery] = useState("");
  const [bookmarks, setBookmarks] = useState(new Set());
  const [showSaved, setShowSaved] = useState(false);
  const [toast, setToast] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("—");
  const [profile, setProfile] = useState(null); // {code, name, ...item}
  const [companies, setCompanies] = useState({}); // 企業プロフィール帳（companies.json）
  const [showSettings, setShowSettings] = useState(false);

  /* 過去検索（月別まとめ data/monthly/ を読み込んで横断検索） */
  const [showArchive, setShowArchive] = useState(false);
  const [archMonths, setArchMonths] = useState(null);
  const [archCache] = useState(() => new Map());
  const [archQuery, setArchQuery] = useState("");
  const [archGenre, setArchGenre] = useState("all");
  const [archPeriod, setArchPeriod] = useState("3");
  const [archResults, setArchResults] = useState(null);
  const [archLoading, setArchLoading] = useState(false);

  const runArchiveSearch = async (opts = {}) => {
    if (archLoading) return;
    const useQuery = opts.query != null ? opts.query : archQuery;
    const useGenre = opts.genre != null ? opts.genre : archGenre;
    const usePeriod = opts.period != null ? opts.period : archPeriod;
    setArchLoading(true);
    try {
      let months = archMonths;
      if (!months) {
        const r = await fetch(`data/monthly/index.json?ts=${Date.now()}`, { cache: "no-store" });
        months = r.ok ? await r.json() : [];
        setArchMonths(months);
      }
      const n = usePeriod === "all" ? months.length : Number(usePeriod);
      const target = months.slice(-n);
      let all = [];
      for (const m of target) {
        if (!archCache.has(m)) {
          const r = await fetch(`data/monthly/${m}.json?ts=${Date.now()}`, { cache: "no-store" });
          archCache.set(m, r.ok ? await r.json() : []);
        }
        all = all.concat(archCache.get(m));
      }
      const q = useQuery.trim();
      const hits = all.filter((i) =>
        (useGenre === "all" || i.genre === useGenre) &&
        (!q || i.name.includes(q) || i.title.includes(q) || i.code.includes(q)));
      hits.sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
      setArchResults({ total: hits.length, items: hits.slice(0, 300) });
    } catch (e) {
      flash("検索データの読み込みに失敗しました");
    } finally {
      setArchLoading(false);
    }
  };

  /* 企業プロフィール帳の読み込み */
  useEffect(() => {
    fetch(`data/companies.json?ts=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((j) => setCompanies(j || {}))
      .catch(() => setCompanies({}));
  }, []);

  /* ブックマークの読み込み（localStorageに永続化） */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setBookmarks(new Set(JSON.parse(raw)));
    } catch (e) { /* 保存データなし → そのまま開始 */ }
  }, []);

  /* ESCでポップアップを閉じる */
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") setProfile(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const persist = (next) => {
    setBookmarks(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch (e) { /* 保存失敗時はセッション内のみ */ }
  };

  const flash = useCallback((msg) => {
    setToast(msg);
    window.clearTimeout(flash._t);
    flash._t = window.setTimeout(() => setToast(null), 2400);
  }, []);

  /* latest.json の取得（キャッシュ回避のためクエリ付き） */
  const loadData = async (isRefresh, prevItems) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch(`${DATA_URL}?ts=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const incoming = json.items || [];
      if (isRefresh) {
        const prevIds = new Set((prevItems || []).map((i) => i.id));
        const marked = incoming.map((i) => (prevIds.has(i.id) ? i : { ...i, isNew: true }));
        const n = marked.filter((i) => i.isNew).length;
        setItems(marked);
        flash(n > 0 ? `新着 ${n} 件を取得しました` : "新着の開示はありません");
      } else {
        setItems(incoming);
      }
      if (json.updatedAt) setLastUpdated(fmtUpdated(json.updatedAt));
      setLoadError(false);
    } catch (e) {
      if (isRefresh) flash("データの取得に失敗しました");
      else setLoadError(true);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  };

  useEffect(() => { loadData(false); }, []);

  const toggleBookmark = (id) => {
    const next = new Set(bookmarks);
    if (next.has(id)) next.delete(id);
    else { next.add(id); flash("「後で読む」に登録しました"); }
    persist(next);
  };

  const toggleMarket = (m) => {
    const next = new Set(markets);
    if (next.has(m)) { if (next.size > 1) next.delete(m); }
    else next.add(m);
    setMarkets(next);
  };

  /* 更新ボタン：latest.json を再取得し、新規idにNEWバッジを付ける */
  const refresh = () => {
    if (refreshing) return;
    loadData(true, items);
  };

  const counts = useMemo(() => {
    const c = { all: items.length };
    GENRES.forEach((g) => { if (g.id !== "all") c[g.id] = items.filter((i) => i.genre === g.id).length; });
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim();
    return items.filter((i) => {
      if (showSaved && !bookmarks.has(i.id)) return false;
      if (!showSaved && genre !== "all" && i.genre !== genre) return false;
      /* 市場区分が「不明」「—」の開示は欠落で落とさず常に表示する */
      if (MARKETS.includes(i.market) && !markets.has(i.market)) return false;
      if (q && !(i.name.includes(q) || i.title.includes(q) || i.code.includes(q))) return false;
      return true;
    });
  }, [items, genre, markets, query, showSaved, bookmarks]);

  const grouped = useMemo(() => {
    const map = new Map();
    filtered.forEach((i) => {
      if (!map.has(i.date)) map.set(i.date, []);
      map.get(i.date).push(i);
    });
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);

  const openPdf = (item) => {
    if (item.pdfUrl) window.open(item.pdfUrl, "_blank", "noopener,noreferrer");
    else flash("原文のリンクがありません");
  };

  return (
    <div className="ds-root">
      <style>{CSS}</style>

      {/* ===== ヘッダー ===== */}
      <header className="ds-header">
        <div className="ds-header-inner">
          <div className="ds-brand">
            <LogoMark />
            <div className="ds-brand-text">
              <h1>DealScope</h1>
              <p>M&A・上場企業開示モニター</p>
            </div>
          </div>
          <div className="ds-head-right">
            <div className="ds-updated">
              <span>最終更新</span>
              <strong>{lastUpdated}</strong>
            </div>
            <button className="ds-mypage" onClick={() => setShowSettings(true)} aria-label="マイページ" title="マイページ（本人情報・テンプレート）">
              <svg viewBox="0 0 24 24" width="17" height="17">
                <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M4.5 20c1.6-3.4 4.4-5 7.5-5s5.9 1.6 7.5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <button className={"ds-refresh" + (refreshing ? " is-loading" : "")} onClick={refresh} aria-label="最新の開示を取得">
              <svg viewBox="0 0 24 24" width="16" height="16" className="ds-refresh-icon">
                <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{refreshing ? "取得中" : "更新"}</span>
            </button>
          </div>
        </div>

        <nav className="ds-tabs" aria-label="ジャンル">
          {GENRES.map((g) => (
            <button
              key={g.id}
              className={"ds-tab" + (!showSaved && !showArchive && genre === g.id ? " is-active" : "")}
              onClick={() => { setGenre(g.id); setShowSaved(false); setShowArchive(false); }}
            >
              {g.label}
              <span className="ds-tab-count">{counts[g.id]}</span>
            </button>
          ))}
          <button className={"ds-tab ds-tab-saved" + (showSaved ? " is-active" : "")} onClick={() => { setShowSaved(!showSaved); setShowArchive(false); }}>
            後で読む
            <span className="ds-tab-count">{bookmarks.size}</span>
          </button>
          <button className={"ds-tab" + (showArchive ? " is-active" : "")} onClick={() => { setShowArchive(!showArchive); setShowSaved(false); }}>
            過去検索
          </button>
        </nav>
      </header>

      {/* ===== 過去検索 ===== */}
      {showArchive && (
        <main className="ds-list">
          <div className="ds-arch-controls">
            <input
              className="ds-search"
              type="search"
              placeholder="社名・コード・キーワードで全期間を検索"
              value={archQuery}
              onChange={(e) => setArchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runArchiveSearch(); }}
            />
            <select className="ds-select ds-arch-select" value={archGenre} onChange={(e) => setArchGenre(e.target.value)}>
              {GENRES.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
            <select className="ds-select ds-arch-select" value={archPeriod} onChange={(e) => setArchPeriod(e.target.value)}>
              <option value="3">直近3か月</option>
              <option value="6">直近6か月</option>
              <option value="12">直近1年</option>
              <option value="all">全期間</option>
            </select>
            <button className="ds-btn ds-btn-primary" onClick={runArchiveSearch}>{archLoading ? "検索中…" : "検索"}</button>
          </div>
          <p className="ds-note">※開示の一覧・タイトルは全期間残りますが、TDnetの原文PDFのリンクは公開から約1か月で切れます（それ以前の原文は各社IRサイトでご確認ください）。</p>

          {archResults && archResults.total > 0 && (
            <>
              <h2 className="ds-datehead">
                検索結果
                <span className="ds-datehead-n">{archResults.total}件{archResults.total > 300 ? "（新しい順に300件を表示）" : ""}</span>
              </h2>
              <ul className="ds-items">
                {archResults.items.map((item) => (
                  <Row
                    key={item.id}
                    item={item}
                    saved={false}
                    onSave={() => {}}
                    onOpen={() => openPdf(item)}
                    onProfile={() => item.code !== "—" && setProfile(item)}
                    hideSave
                    showDate
                  />
                ))}
              </ul>
            </>
          )}
          {archResults && archResults.total === 0 && (
            <div className="ds-empty">該当する開示が見つかりませんでした。キーワードや期間を変えてみてください。</div>
          )}
          {!archResults && (
            <div className="ds-empty">キーワードや期間を選んで「検索」を押すと、蓄積した全開示から探せます。</div>
          )}
        </main>
      )}

      {/* ===== フィルター行 ===== */}
      {!showArchive && (
      <div className="ds-filters">
        <div className="ds-markets">
          {MARKETS.map((m) => (
            <button key={m} className={"ds-chip" + (markets.has(m) ? " is-on" : "")} onClick={() => toggleMarket(m)}>
              {m}
            </button>
          ))}
        </div>
        <input
          className="ds-search"
          type="search"
          placeholder="社名・コード・キーワードで検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      )}

      {/* ===== 一覧 ===== */}
      {!showArchive && (
      <main className="ds-list">
        {loading && <div className="ds-empty">読み込み中…</div>}

        {!loading && loadError && (
          <div className="ds-empty">データを読み込めませんでした。時間をおいて「更新」を押してください。</div>
        )}

        {!loading && !loadError && grouped.length === 0 && (
          <div className="ds-empty">
            {showSaved
              ? "「後で読む」はまだ空です。一覧の しおり ボタンで記事を登録できます。"
              : "条件に合う開示がありません。フィルターを広げてみてください。"}
          </div>
        )}

        {grouped.map(([date, list]) => (
          <section key={date}>
            <h2 className="ds-datehead">
              {dateLabel(date)}
              <span className="ds-datehead-n">{list.length}件</span>
            </h2>
            <ul className="ds-items">
              {list.map((item) => (
                <Row
                  key={item.id}
                  item={item}
                  saved={bookmarks.has(item.id)}
                  onSave={() => toggleBookmark(item.id)}
                  onOpen={() => openPdf(item)}
                  onProfile={() => item.code !== "—" && setProfile(item)}
                />
              ))}
            </ul>
          </section>
        ))}

        <footer className="ds-foot">
          出所：TDnet（適時開示）／EDINET／PR TIMES。内容は必ず原文でご確認ください。
        </footer>
      </main>
      )}

      {toast && <div className="ds-toast">{toast}</div>}

      {profile && (
        <ProfileModal
          item={profile}
          prof={companies[profile.code]}
          history={items.filter((i) => i.code === profile.code)}
          onClose={() => setProfile(null)}
          flash={flash}
          onSearchAll={(code) => {
            setProfile(null);
            setShowSaved(false);
            setShowArchive(true);
            setArchQuery(code);
            setArchGenre("all");
            setArchPeriod("all");
            runArchiveSearch({ query: code, genre: "all", period: "all" });
          }}
        />
      )}

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} flash={flash} />}
    </div>
  );
}

/* ---------- ロゴ ---------- */
function LogoMark() {
  return (
    <svg viewBox="0 0 40 40" width="34" height="34" className="ds-logo" aria-hidden="true">
      {/* レンズ＝スコープ。2つの円が重なる形でM&A（統合）を表現 */}
      <circle cx="16" cy="20" r="11" fill="none" stroke="#E8523F" strokeWidth="2.6" />
      <circle cx="25" cy="20" r="11" fill="none" stroke="#F2EFE8" strokeWidth="2.6" opacity="0.9" />
      <circle cx="20.5" cy="20" r="2.4" fill="#E8523F" />
    </svg>
  );
}

/* ---------- 一覧の行 ---------- */
function Row({ item, saved, onSave, onOpen, onProfile, hideSave, showDate }) {
  const g = GENRE_META[item.genre] || GENRE_META.news;
  const isMA = item.genre === "ma";
  const hasProfile = item.code !== "—";
  return (
    <li className={"ds-row" + (isMA ? " is-ma" : "") + (item.isCorrection ? " is-corr" : "")}>
      <div className="ds-row-meta">
        {showDate && <span className="ds-arch-date">{item.date.slice(2).replace(/-/g, "/")}</span>}
        <span className="ds-time">{item.time}</span>
        <span className={"ds-badge " + g.cls}>{g.label}</span>
        {item.isNew && <span className="ds-new">NEW</span>}
      </div>
      <div className="ds-row-body">
        <div className="ds-firm">
          {hasProfile && <span className="ds-code">{item.code}</span>}
          {hasProfile ? (
            <button className="ds-name ds-name-link" onClick={onProfile} title="企業情報を表示">
              {item.name}
            </button>
          ) : (
            <span className="ds-name">{item.name}</span>
          )}
          <span className="ds-market">{item.exch !== "—" ? item.exch + "・" : ""}{item.market !== "—" ? item.market : ""}</span>
          <span className="ds-src">{item.src}</span>
        </div>
        <button className="ds-title" onClick={onOpen} title="原文を開く">
          {item.title}
          <span className="ds-pdf">PDF</span>
        </button>
        {item.tags && item.tags.length > 0 && (
          <div className="ds-tags">
            {item.tags.map((t) => <span key={t} className="ds-tag">{t}</span>)}
          </div>
        )}
      </div>
      {!hideSave && <button
        className={"ds-save" + (saved ? " is-saved" : "")}
        onClick={onSave}
        aria-label={saved ? "後で読むから外す" : "後で読むに登録"}
        title={saved ? "登録済み" : "後で読む"}
      >
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"
            fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </button>}
    </li>
  );
}

/* ---------- 企業情報ポップアップ ----------
   会社概要（業種・売上・営業利益）は companies.json（有報から自動抽出）を表示。
   「アプローチ文面を作る」でテンプレート差し込み画面に切り替わる。 */
function ProfileModal({ item, prof, history, onClose, flash, onSearchAll }) {
  const [view, setView] = useState("profile"); // "profile" | "compose"
  const [templates] = useState(() => loadTemplates());
  const [my] = useState(() => loadMyInfo());
  const [tplIdx, setTplIdx] = useState(0);
  const [draft, setDraft] = useState("");

  const startCompose = () => {
    const t = templates[tplIdx] || templates[0];
    setDraft(t ? fillTemplate(t.body, item, my) : "");
    setView("compose");
  };

  const changeTpl = (i) => {
    setTplIdx(i);
    const t = templates[i];
    setDraft(t ? fillTemplate(t.body, item, my) : "");
  };

  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      flash("文面をコピーしました。先方サイトの問い合わせフォームに貼り付けてください");
    } catch (e) {
      flash("コピーできませんでした。文面を全選択してコピーしてください");
    }
  };

  const searchSite = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      flash("文面をコピーしました。開いた検索結果から問い合わせページを探して貼り付けてください");
    } catch (e) { /* コピー不可でも検索は続行 */ }
    const q = encodeURIComponent(`${item.name} お問い合わせ`);
    window.open(`https://www.google.com/search?q=${q}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="ds-modal-back" onClick={onClose}>
      <div className="ds-modal" role="dialog" aria-modal="true" aria-label={item.name + " の企業情報"} onClick={(e) => e.stopPropagation()}>
        <div className="ds-modal-head">
          <div>
            <span className="ds-modal-code">{item.code}</span>
            <h3>{item.name}</h3>
            <p className="ds-modal-market">{item.exch !== "—" ? item.exch + "証・" : ""}{item.market}{prof && prof.industry ? ` ／ ${prof.industry}` : ""}</p>
          </div>
          <button className="ds-modal-close" onClick={onClose} aria-label="閉じる">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {view === "profile" ? (
          <div className="ds-modal-body">
            {prof ? (
              <div className="ds-modal-fin">
                <span className="ds-fin-term">{prof.term || "直近通期（有価証券報告書より）"}</span>
                <div className="ds-fin-grid">
                  <div><label>売上高</label><strong>{fmtYen(prof.rev)}</strong></div>
                  <div><label>営業利益</label><strong>{fmtYen(prof.op)}</strong></div>
                  <div><label>前期比</label><strong>{fmtYoy(prof.yoyPct)}</strong></div>
                </div>
              </div>
            ) : (
              <p className="ds-modal-none">この企業の業績はまだ未取得です（有価証券報告書の取得後、自動で表示されます）。</p>
            )}

            <table className="ds-modal-table">
              <tbody>
                <tr><th>証券コード</th><td>{item.code}</td></tr>
                <tr><th>市場</th><td>{item.exch !== "—" ? item.exch + "証・" : ""}{item.market}</td></tr>
                {prof && prof.industry ? <tr><th>業種</th><td>{prof.industry}</td></tr> : null}
                {prof && prof.employees != null ? <tr><th>従業員数</th><td>{prof.employees.toLocaleString()}名</td></tr> : null}
              </tbody>
            </table>

            <p className="ds-modal-sub">直近の開示（最大7日分）</p>
            <ul className="ds-modal-list">
              {history.map((h) => (
                <li key={h.id}>
                  <span className="ds-modal-when">{dateLabel(h.date)} {h.time}・{(GENRE_META[h.genre] || GENRE_META.news).label}</span>
                  {h.pdfUrl
                    ? <a href={h.pdfUrl} target="_blank" rel="noopener noreferrer">{h.title}</a>
                    : h.title}
                </li>
              ))}
            </ul>

            <button className="ds-btn ds-btn-sub ds-btn-block" onClick={() => onSearchAll(item.code)}>この会社の過去の開示をすべて見る（M&A履歴など）</button>
            <button className="ds-compose-btn" onClick={startCompose}>この開示でアプローチ文面を作る</button>
            <p className="ds-note">文面の雛形と差出人情報は、右上の人型アイコン（マイページ）で登録できます。</p>
          </div>
        ) : (
          <div className="ds-modal-body">
            <div className="ds-field">
              <label>テンプレート</label>
              <select className="ds-select" value={tplIdx} onChange={(e) => changeTpl(Number(e.target.value))}>
                {templates.map((t, i) => <option key={i} value={i}>{t.name}</option>)}
              </select>
            </div>
            <div className="ds-field">
              <label>文面（自由に手直しできます）</label>
              <textarea className="ds-textarea" value={draft} onChange={(e) => setDraft(e.target.value)} />
            </div>
            {(!my.name || !my.company) && (
              <p className="ds-note">※ 氏名・会社名が未登録のため {"{氏名}"} などが残っています。マイページで登録すると自動で埋まります。</p>
            )}
            <div className="ds-btn-row">
              <button className="ds-btn ds-btn-primary" onClick={searchSite}>コピーして先方サイトを検索</button>
              <button className="ds-btn ds-btn-sub" onClick={copyDraft}>コピーのみ</button>
              <button className="ds-btn ds-btn-ghost" onClick={() => setView("profile")}>戻る</button>
            </div>
            <p className="ds-note">コピーした文面を、先方サイトの問い合わせフォームに貼り付けて送信してください（送信は必ずご自身の確認のうえで）。</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- マイページ（本人情報・テンプレート管理） ----------
   入力内容はこの端末のブラウザ内にのみ保存される。 */
function SettingsModal({ onClose, flash }) {
  const [my, setMy] = useState(() => loadMyInfo());
  const [tpls, setTpls] = useState(() => loadTemplates());
  const [sel, setSel] = useState(0);

  const setMyField = (k, v) => setMy({ ...my, [k]: v });
  const setTplField = (k, v) => {
    const next = tpls.map((t, i) => (i === sel ? { ...t, [k]: v } : t));
    setTpls(next);
  };

  const addTpl = () => {
    const next = [...tpls, { name: "新しいテンプレート", body: "" }];
    setTpls(next);
    setSel(next.length - 1);
  };

  const delTpl = () => {
    if (tpls.length <= 1) { flash("テンプレートは最低1件必要です"); return; }
    const next = tpls.filter((_, i) => i !== sel);
    setTpls(next);
    setSel(0);
  };

  const save = () => {
    try {
      window.localStorage.setItem(MYINFO_KEY, JSON.stringify(my));
      window.localStorage.setItem(TEMPLATES_KEY, JSON.stringify(tpls));
      flash("保存しました（この端末のブラウザ内にのみ保存されます）");
      onClose();
    } catch (e) {
      flash("保存に失敗しました");
    }
  };

  const t = tpls[sel] || tpls[0];

  return (
    <div className="ds-modal-back" onClick={onClose}>
      <div className="ds-modal" role="dialog" aria-modal="true" aria-label="マイページ" onClick={(e) => e.stopPropagation()}>
        <div className="ds-modal-head">
          <div>
            <span className="ds-modal-code">MY PAGE</span>
            <h3>マイページ</h3>
            <p className="ds-modal-market">差出人情報とアプローチ文面のテンプレート</p>
          </div>
          <button className="ds-modal-close" onClick={onClose} aria-label="閉じる">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="ds-modal-body">
          <p className="ds-modal-sub">本人情報（フォーム入力によく使うもの）</p>
          <div className="ds-field"><label>氏名</label><input className="ds-input" value={my.name} onChange={(e) => setMyField("name", e.target.value)} placeholder="例：山田 太郎" /></div>
          <div className="ds-field"><label>会社名</label><input className="ds-input" value={my.company} onChange={(e) => setMyField("company", e.target.value)} placeholder="例：株式会社〇〇" /></div>
          <div className="ds-field"><label>部署・役職</label><input className="ds-input" value={my.dept} onChange={(e) => setMyField("dept", e.target.value)} placeholder="例：M&Aアドバイザリー部" /></div>
          <div className="ds-field"><label>電話番号</label><input className="ds-input" value={my.tel} onChange={(e) => setMyField("tel", e.target.value)} placeholder="例：03-1234-5678" /></div>
          <div className="ds-field"><label>メールアドレス</label><input className="ds-input" value={my.email} onChange={(e) => setMyField("email", e.target.value)} placeholder="例：taro@example.co.jp" /></div>

          <p className="ds-modal-sub">文面テンプレート</p>
          <div className="ds-tpl-row">
            <select className="ds-select" value={sel} onChange={(e) => setSel(Number(e.target.value))}>
              {tpls.map((x, i) => <option key={i} value={i}>{x.name}</option>)}
            </select>
            <button className="ds-btn ds-btn-sub" onClick={addTpl}>新規</button>
            <button className="ds-btn ds-btn-ghost" onClick={delTpl}>削除</button>
          </div>
          {t && (
            <>
              <div className="ds-field"><label>テンプレート名</label><input className="ds-input" value={t.name} onChange={(e) => setTplField("name", e.target.value)} /></div>
              <div className="ds-field"><label>本文</label><textarea className="ds-textarea" value={t.body} onChange={(e) => setTplField("body", e.target.value)} /></div>
            </>
          )}
          <p className="ds-note">
            {"本文には {先方社名} {開示タイトル} {開示日} {氏名} {自社名} {部署} {電話} {メール} と書くと、文面作成時に自動で差し込まれます。"}
          </p>

          <div className="ds-btn-row">
            <button className="ds-btn ds-btn-primary" onClick={save}>保存する</button>
            <button className="ds-btn ds-btn-ghost" onClick={onClose}>閉じる</button>
          </div>
          <p className="ds-note">※ ここで入力した情報はこの端末のブラウザ内にのみ保存され、インターネット上には公開されません。</p>
        </div>
      </div>
    </div>
  );
}

/* ============================ styles ============================ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Noto+Sans+JP:wght@400;500;700&family=IBM+Plex+Mono:wght@500;600&display=swap');

.ds-root {
  --paper: #F5F4EF;
  --card: #FFFFFF;
  --ink: #1B2430;
  --ink-2: #5B6472;
  --line: #E1DFD6;
  --navy: #1E3A5F;
  --navy-deep: #101E31;
  --shu: #C0392B;
  --shu-bright: #E8523F;
  --shu-bg: #FBF1EF;
  --chukei: #8A6A1F;
  --chukei-bg: #F7F1E0;
  --kessan: #2F6B4F;
  --kessan-bg: #EAF3EE;
  --release-bg: #EAF0F7;
  --news-bg: #EEEEEC;

  font-family: 'Noto Sans JP', sans-serif;
  color: var(--ink);
  background: var(--paper);
  min-height: 100vh;
  font-size: 14px;
  line-height: 1.5;
}
.ds-root * { box-sizing: border-box; }
.ds-root button { font-family: inherit; cursor: pointer; }
.ds-root button:focus-visible { outline: 2px solid var(--navy); outline-offset: 2px; }

/* ---- ヘッダー ---- */
.ds-header {
  background: linear-gradient(160deg, #101E31 0%, #16283F 70%, #1B3050 100%);
  color: #F2EFE8; position: sticky; top: 0; z-index: 20;
  box-shadow: 0 1px 0 rgba(255,255,255,.06) inset, 0 4px 18px rgba(16,30,49,.28);
}
.ds-header-inner { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px 10px; max-width: 860px; margin: 0 auto; }
.ds-brand { display: flex; align-items: center; gap: 11px; }
.ds-logo { flex: none; }
.ds-brand-text h1 {
  font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 19px;
  margin: 0; letter-spacing: .015em;
}
.ds-brand-text p { margin: 1px 0 0; font-size: 10px; color: #97A6B8; letter-spacing: .12em; }

.ds-head-right { display: flex; align-items: center; gap: 12px; }
.ds-updated { text-align: right; line-height: 1.25; }
.ds-updated span { display: block; font-size: 9px; color: #7E8FA4; letter-spacing: .14em; }
.ds-updated strong { font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; font-weight: 600; color: #D8DEE7; }
.ds-refresh {
  display: flex; align-items: center; gap: 6px;
  background: var(--shu-bright); color: #fff; border: none; border-radius: 99px;
  font-weight: 700; font-size: 12.5px; padding: 8px 16px; letter-spacing: .04em;
  box-shadow: 0 2px 10px rgba(232,82,63,.35);
  transition: transform .12s ease, box-shadow .12s ease;
}
.ds-refresh:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(232,82,63,.45); }
.ds-refresh.is-loading { opacity: .85; pointer-events: none; }
.ds-refresh.is-loading .ds-refresh-icon { animation: ds-spin .8s linear infinite; }
@keyframes ds-spin { to { transform: rotate(360deg); } }

/* ---- タブ ---- */
.ds-tabs { display: flex; gap: 2px; overflow-x: auto; padding: 0 12px; max-width: 860px; margin: 0 auto; scrollbar-width: none; }
.ds-tabs::-webkit-scrollbar { display: none; }
.ds-tab {
  flex: none; background: none; border: none; color: #97A6B8;
  font-weight: 700; font-size: 13px; padding: 10px 12px 12px;
  border-bottom: 3px solid transparent; display: flex; align-items: center; gap: 6px;
}
.ds-tab.is-active { color: #fff; border-bottom-color: var(--shu-bright); }
.ds-tab-count { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; font-weight: 600; background: rgba(255,255,255,.12); padding: 1px 6px; border-radius: 99px; }
.ds-tab.is-active .ds-tab-count { background: var(--shu-bright); color: #fff; }
.ds-tab-saved { margin-left: auto; }

/* ---- フィルター ---- */
.ds-filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 12px 16px; max-width: 860px; margin: 0 auto; }
.ds-markets { display: flex; gap: 6px; flex-wrap: wrap; }
.ds-chip { border: 1px solid var(--line); background: var(--card); color: var(--ink-2); font-size: 12px; font-weight: 500; padding: 5px 12px; border-radius: 99px; }
.ds-chip.is-on { background: var(--navy); border-color: var(--navy); color: #fff; }
.ds-search { flex: 1; min-width: 180px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; font-size: 13px; font-family: inherit; background: var(--card); color: var(--ink); }
.ds-search:focus { outline: 2px solid var(--navy); outline-offset: 1px; }

/* ---- 一覧 ---- */
.ds-list { max-width: 860px; margin: 0 auto; padding: 0 12px 48px; }
.ds-datehead { font-weight: 700; font-size: 14px; margin: 18px 4px 8px; display: flex; align-items: baseline; gap: 8px; letter-spacing: .04em; }
.ds-datehead-n { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-2); font-weight: 500; }
.ds-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }

.ds-row {
  background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  padding: 12px 12px 12px 14px; display: flex; gap: 12px; align-items: flex-start;
  border-left: 4px solid var(--line);
}
.ds-row.is-ma { border-left-color: var(--shu); }
/* 訂正開示は薄く表示（仕様書3） */
.ds-row.is-corr .ds-row-meta, .ds-row.is-corr .ds-row-body { opacity: .55; }

.ds-row-meta { flex: none; display: flex; flex-direction: column; align-items: center; gap: 6px; width: 52px; }
.ds-time { font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 600; color: var(--ink-2); }
.ds-badge { font-size: 10px; font-weight: 700; letter-spacing: .05em; padding: 3px 0; width: 100%; text-align: center; border-radius: 4px; }
.g-ma { color: var(--shu); background: var(--shu-bg); border: 1px solid var(--shu); }
.g-release { color: var(--navy); background: var(--release-bg); }
.g-chukei { color: var(--chukei); background: var(--chukei-bg); }
.g-kessan { color: var(--kessan); background: var(--kessan-bg); }
.g-news { color: var(--ink-2); background: var(--news-bg); }
.ds-new { font-family: 'IBM Plex Mono', monospace; font-size: 9px; font-weight: 600; color: #fff; background: var(--shu-bright); border-radius: 3px; padding: 1px 5px; letter-spacing: .1em; }

.ds-row-body { flex: 1; min-width: 0; }
.ds-firm { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; margin-bottom: 3px; }
.ds-code { font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; font-weight: 600; color: var(--navy); background: var(--release-bg); padding: 0 5px; border-radius: 3px; }
.ds-name { font-weight: 700; font-size: 13.5px; }
.ds-name-link { background: none; border: none; padding: 0; color: var(--ink); text-decoration: underline dotted #B4BCC7; text-underline-offset: 3px; }
.ds-name-link:hover { color: var(--navy); text-decoration-color: var(--navy); }
.ds-market { font-size: 11px; color: var(--ink-2); }
.ds-src { font-size: 10px; color: #9AA1AB; margin-left: auto; letter-spacing: .04em; }

.ds-title { display: block; width: 100%; text-align: left; background: none; border: none; padding: 0; color: var(--ink); font-size: 13.5px; line-height: 1.55; font-weight: 500; }
.ds-title:hover { color: var(--navy); text-decoration: underline; text-underline-offset: 3px; }
.ds-pdf { display: inline-block; margin-left: 6px; font-family: 'IBM Plex Mono', monospace; font-size: 9.5px; font-weight: 600; color: var(--shu); border: 1px solid var(--shu); border-radius: 3px; padding: 0 4px; vertical-align: 2px; }
.ds-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.ds-tag { font-size: 10.5px; font-weight: 500; color: var(--ink-2); background: var(--paper); border: 1px solid var(--line); border-radius: 99px; padding: 1px 8px; }
.ds-row.is-ma .ds-tag { color: var(--shu); border-color: #E5C4BF; background: var(--shu-bg); }

.ds-save { flex: none; background: none; border: none; color: #B8BDC5; padding: 4px; border-radius: 6px; }
.ds-save:hover { color: var(--navy); background: var(--release-bg); }
.ds-save.is-saved { color: var(--shu); }

.ds-empty { text-align: center; color: var(--ink-2); padding: 56px 20px; font-size: 13px; border: 1px dashed var(--line); border-radius: 12px; margin-top: 20px; background: var(--card); }
.ds-foot { text-align: center; font-size: 11px; color: #9AA1AB; margin-top: 32px; }

.ds-toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  background: var(--ink); color: #fff; font-size: 12.5px; padding: 10px 18px;
  border-radius: 99px; box-shadow: 0 6px 20px rgba(0,0,0,.25); z-index: 60;
  animation: ds-pop .18s ease-out;
}
@keyframes ds-pop { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }

/* ---- 企業情報ポップアップ ---- */
.ds-modal-back {
  position: fixed; inset: 0; background: rgba(16,30,49,.5); backdrop-filter: blur(2px);
  z-index: 50; display: flex; align-items: center; justify-content: center; padding: 20px;
  animation: ds-fade .15s ease-out;
}
@keyframes ds-fade { from { opacity: 0; } to { opacity: 1; } }
.ds-modal {
  background: var(--card); border-radius: 14px; width: 100%; max-width: 480px;
  max-height: 86vh; overflow-y: auto; box-shadow: 0 24px 60px rgba(16,30,49,.35);
  animation: ds-rise .2s ease-out;
}
@keyframes ds-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
.ds-modal-head {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding: 18px 18px 14px; border-bottom: 1px solid var(--line);
  background: linear-gradient(160deg, #101E31, #1B3050); color: #F2EFE8;
  border-radius: 14px 14px 0 0; position: sticky; top: 0;
}
.ds-modal-code { font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 600; color: #97A6B8; letter-spacing: .08em; }
.ds-modal-head h3 { margin: 2px 0 3px; font-size: 17px; font-weight: 700; }
.ds-modal-market { margin: 0; font-size: 11px; color: #B4C1D1; }
.ds-modal-close { background: rgba(255,255,255,.1); border: none; color: #D8DEE7; border-radius: 8px; padding: 6px; line-height: 0; }
.ds-modal-close:hover { background: rgba(255,255,255,.2); }

.ds-modal-body { padding: 16px 18px 20px; }
.ds-modal-biz { margin: 0 0 14px; font-size: 13px; line-height: 1.7; color: var(--ink); }

.ds-modal-fin { background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; }
.ds-fin-term { font-size: 10.5px; font-weight: 700; color: var(--ink-2); letter-spacing: .06em; }
.ds-fin-grid { display: flex; gap: 18px; margin-top: 6px; flex-wrap: wrap; }
.ds-fin-grid label { display: block; font-size: 10px; color: var(--ink-2); }
.ds-fin-grid strong { font-family: 'IBM Plex Mono', monospace; font-size: 15px; font-weight: 600; color: var(--navy); }

.ds-modal-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.ds-modal-table th { text-align: left; color: var(--ink-2); font-weight: 500; padding: 7px 10px 7px 0; width: 78px; vertical-align: top; border-bottom: 1px solid var(--paper); white-space: nowrap; }
.ds-modal-table td { padding: 7px 0; border-bottom: 1px solid var(--paper); }
.ds-td-url { font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; color: var(--navy); }
.ds-modal-none { margin: 0; font-size: 12.5px; color: var(--ink-2); }

/* ---- 直近の開示リスト（企業情報ポップアップ内） ---- */
.ds-modal-sub { margin: 14px 0 6px; font-size: 10.5px; font-weight: 700; color: var(--ink-2); letter-spacing: .06em; }
.ds-modal-list { list-style: none; margin: 0 0 14px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ds-modal-list li { border-bottom: 1px solid var(--paper); padding-bottom: 8px; font-size: 12.5px; line-height: 1.55; }
.ds-modal-when { display: block; font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; color: var(--ink-2); margin-bottom: 2px; }
.ds-modal-list a { color: var(--ink); text-decoration: none; }
.ds-modal-list a:hover { color: var(--navy); text-decoration: underline; text-underline-offset: 3px; }

/* ---- マイページ・アプローチ文面 ---- */
.ds-mypage { background: rgba(255,255,255,.1); border: none; color: #D8DEE7; border-radius: 99px; padding: 8px; line-height: 0; }
.ds-mypage:hover { background: rgba(255,255,255,.2); }
.ds-compose-btn {
  display: block; width: 100%; margin: 6px 0 10px;
  background: var(--navy); color: #fff; border: none; border-radius: 8px;
  font-weight: 700; font-size: 13px; padding: 11px 14px; letter-spacing: .02em;
}
.ds-compose-btn:hover { background: #27476f; }
.ds-field { margin-bottom: 10px; }
.ds-field label { display: block; font-size: 10.5px; color: var(--ink-2); font-weight: 700; margin-bottom: 3px; letter-spacing: .04em; }
.ds-input, .ds-select, .ds-textarea {
  width: 100%; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px;
  font-size: 13px; font-family: inherit; background: var(--card); color: var(--ink);
}
.ds-textarea { min-height: 220px; line-height: 1.7; resize: vertical; }
.ds-input:focus, .ds-select:focus, .ds-textarea:focus { outline: 2px solid var(--navy); outline-offset: 1px; }
.ds-btn-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.ds-btn { border: none; border-radius: 8px; font-weight: 700; font-size: 12.5px; padding: 9px 14px; }
.ds-btn-primary { background: var(--shu-bright); color: #fff; box-shadow: 0 2px 10px rgba(232,82,63,.25); }
.ds-btn-primary:hover { transform: translateY(-1px); }
.ds-btn-sub { background: var(--release-bg); color: var(--navy); }
.ds-btn-sub:hover { background: #DEE8F3; }
.ds-btn-ghost { background: none; border: 1px solid var(--line); color: var(--ink-2); }
.ds-btn-ghost:hover { color: var(--ink); border-color: #C9C6BB; }
.ds-note { font-size: 11px; color: var(--ink-2); margin: 8px 0 0; line-height: 1.6; }
.ds-tpl-row { display: flex; gap: 8px; margin-bottom: 10px; }
.ds-tpl-row .ds-select { flex: 1; }

.ds-btn-block { display: block; width: 100%; margin: 6px 0 8px; padding: 10px 14px; }

/* ---- 過去検索 ---- */
.ds-arch-controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 14px; }
.ds-arch-controls .ds-search { flex: 1; min-width: 180px; }
.ds-arch-select { width: auto; }
.ds-arch-date { font-family: 'IBM Plex Mono', monospace; font-size: 10px; font-weight: 600; color: var(--ink-2); }

@media (prefers-reduced-motion: reduce) {
  .ds-toast, .ds-modal, .ds-modal-back { animation: none; }
  .ds-refresh.is-loading .ds-refresh-icon { animation: none; }
}
@media (max-width: 560px) {
  .ds-row { padding: 10px; gap: 9px; }
  .ds-row-meta { width: 46px; }
  .ds-src { display: none; }
  .ds-updated { display: none; }
  .ds-modal-back { align-items: flex-end; padding: 0; }
  .ds-modal { border-radius: 16px 16px 0 0; max-height: 88vh; }
  .ds-modal-head { border-radius: 16px 16px 0 0; }
}
`;
