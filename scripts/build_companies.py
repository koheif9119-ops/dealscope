# -*- coding: utf-8 -*-
"""企業プロフィール（業種・売上・営業利益・従業員数）を自動生成する。

仕組み:
1. EDINETの書類一覧をさかのぼり、証券コード→最新の有価証券報告書の対照表
   （data/master/yuho_index.json）を作る。初回は約380日分、以後は差分のみ。
2. 画面に登場している企業のうちプロフィール未取得のものについて、
   有報のCSVデータ（EDINET API v2 type=5）から売上高・営業利益などを抽出し、
   data/companies.json に保存する。1回の実行で最大8社ずつ（実行時間を抑えるため）。
"""
import csv
import io
import json
import os
import urllib.parse
import zipfile
from datetime import datetime, timedelta

from util import (DATA_DIR, JST, LATEST_PATH, MASTER_PATH, polite_get,
                  read_json, write_json)

INDEX_PATH = os.path.join(DATA_DIR, "master", "yuho_index.json")
COMPANIES_PATH = os.path.join(DATA_DIR, "companies.json")

LIST_API = "https://api.edinet-fsa.go.jp/api/v2/documents.json?date={date}&type=2&Subscription-Key={key}"
DOC_API = "https://api.edinet-fsa.go.jp/api/v2/documents/{doc_id}?type=5&Subscription-Key={key}"

BACKFILL_DAYS = 380        # 有報は年1回のため、1年強さかのぼれば全上場企業をカバーできる
MAX_PROFILE_UPDATES = 8    # 1回の実行で新規取得する社数

# 売上高に相当する項目（会計基準・業種により名前が異なるため候補を順に探す）
REV_ELEMENTS = [
    "jpcrp_cor:NetSalesSummaryOfBusinessResults",
    "jpcrp_cor:RevenueIFRSSummaryOfBusinessResults",
    "jpcrp_cor:RevenuesUSGAAPSummaryOfBusinessResults",
    "jpcrp_cor:OperatingRevenue1SummaryOfBusinessResults",
    "jpcrp_cor:OperatingRevenue2SummaryOfBusinessResults",
    "jpcrp_cor:GrossOperatingRevenueSummaryOfBusinessResults",
    "jpcrp_cor:OrdinaryIncomeSummaryOfBusinessResults",
]
REV_LABELS = ("売上高", "売上収益", "営業収益", "経常収益")

# 営業利益に相当する項目
OP_ELEMENTS = [
    "jpcrp_cor:OperatingIncomeLossSummaryOfBusinessResults",
    "jpcrp_cor:OperatingProfitLossIFRSSummaryOfBusinessResults",
    "jpcrp_cor:OperatingIncomeSummaryOfBusinessResults",
    "jppfs_cor:OperatingIncome",
]
OP_LABELS = ("営業利益",)

CTX_CUR = ["CurrentYearDuration", "CurrentYearDuration_NonConsolidatedMember"]
CTX_PRIOR = ["Prior1YearDuration", "Prior1YearDuration_NonConsolidatedMember"]
CTX_CUR_INSTANT = ["CurrentYearInstant", "CurrentYearInstant_NonConsolidatedMember"]


def update_index(key):
    """証券コード→最新の有報（docID）の対照表を更新する。"""
    idx = read_json(INDEX_PATH, {"lastScan": None, "codes": {}})
    today = datetime.now(JST).date()
    # 対照表が空のままなら（過去にキー不備等で失敗）最初から作り直す
    if idx.get("lastScan") and idx.get("codes"):
        start = datetime.strptime(idx["lastScan"], "%Y-%m-%d").date() + timedelta(days=1)
        start = max(start, today - timedelta(days=BACKFILL_DAYS))
    else:
        print(f"有報の対照表を初回作成します（過去{BACKFILL_DAYS}日分。10分ほどかかります）")
        start = today - timedelta(days=BACKFILL_DAYS)

    changed = False
    d = start
    while d <= today:
        try:
            body = polite_get(LIST_API.format(date=d.isoformat(), key=urllib.parse.quote(key)))
            data = json.loads(body)
            if "results" not in data:
                # キー不備などはHTTP 200のままエラー文が返る。続けても無駄なので中断する
                raise RuntimeError("EDINETからエラー応答: " + str(data.get("message") or data))
            for r in data.get("results") or []:
                if r.get("docTypeCode") != "120":  # 有価証券報告書のみ（訂正は除く）
                    continue
                sec = str(r.get("secCode") or "").strip()
                if not sec:
                    continue
                code = sec[:4]
                sub = (r.get("submitDateTime") or "")[:10]
                cur = idx["codes"].get(code)
                if not cur or sub >= cur.get("date", ""):
                    idx["codes"][code] = {
                        "docID": r.get("docID"),
                        "date": sub,
                        "name": (r.get("filerName") or "").strip(),
                    }
                    changed = True
        except RuntimeError:
            raise  # キー不備は続けても無駄なのでここで中断する
        except Exception as e:  # noqa: BLE001
            print("書類一覧の取得失敗", d, e)
        d += timedelta(days=1)

    if idx.get("lastScan") != today.isoformat():
        idx["lastScan"] = today.isoformat()
        changed = True
    if changed:
        write_json(INDEX_PATH, idx, sort_keys=True)
    return idx


def parse_csv_facts(zip_bytes):
    """有報CSV（ZIP）から (要素ID, コンテキストID)→値 の表と、項目名付きの一覧を取り出す。"""
    facts = {}
    labeled = []
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        for name in z.namelist():
            if not (name.endswith(".csv") and "jpcrp" in name):
                continue
            text = z.read(name).decode("utf-16", "replace")
            reader = csv.reader(io.StringIO(text), delimiter="\t")
            rows = list(reader)
            if not rows:
                continue
            head = rows[0]

            def col(label, head=head):
                for i, h in enumerate(head):
                    if label in h:
                        return i
                return -1

            ei, ci, vi, ni = col("要素ID"), col("コンテキストID"), col("値"), col("項目名")
            if min(ei, ci, vi) < 0:
                continue
            for row in rows[1:]:
                if len(row) <= max(ei, ci, vi):
                    continue
                facts[(row[ei], row[ci])] = row[vi]
                labeled.append((row[ni] if ni >= 0 else "", row[ci], row[vi]))
    return facts, labeled


def to_num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def pick(facts, elements, contexts):
    for el in elements:
        for cx in contexts:
            v = to_num(facts.get((el, cx)))
            if v is not None:
                return v
    return None


def pick_by_label(labeled, names, contexts):
    for label, cx, v in labeled:
        if cx in contexts and any(label.startswith(n) for n in names):
            num = to_num(v)
            if num is not None:
                return num
    return None


def pick_any(facts, element):
    for (el, _cx), v in facts.items():
        if el == element and v:
            return v
    return None


def build_profile(code, entry, master, key):
    zip_bytes = polite_get(DOC_API.format(doc_id=entry["docID"], key=urllib.parse.quote(key)), timeout=120)
    facts, labeled = parse_csv_facts(zip_bytes)

    rev = pick(facts, REV_ELEMENTS, CTX_CUR) or pick_by_label(labeled, REV_LABELS, CTX_CUR)
    rev_prior = pick(facts, REV_ELEMENTS, CTX_PRIOR) or pick_by_label(labeled, REV_LABELS, CTX_PRIOR)
    op = pick(facts, OP_ELEMENTS, CTX_CUR) or pick_by_label(labeled, OP_LABELS, CTX_CUR)
    employees = pick(facts, ["jpcrp_cor:NumberOfEmployees"], CTX_CUR_INSTANT)

    yoy = None
    if rev and rev_prior:
        yoy = round((rev / rev_prior - 1) * 100, 1)

    term = None
    end = pick_any(facts, "jpdei_cor:CurrentPeriodEndDateDEI")  # 例 "2026-03-31"
    if end and len(end) >= 7:
        term = f"{int(end[:4])}年{int(end[5:7])}月期"

    m = master.get(code, {})
    return {
        "name": entry.get("name") or "",
        "industry": m.get("industry") or "",
        "market": m.get("market") or "",
        "term": term,
        "rev": rev,
        "op": op,
        "yoyPct": yoy,
        "employees": int(employees) if employees is not None else None,
        "docID": entry["docID"],
        "docDate": entry.get("date"),
    }


def main():
    key = os.environ.get("EDINET_API_KEY", "").strip()
    if not key:
        print("EDINET_API_KEY が未設定のため、企業プロフィール更新をスキップしました")
        return

    master = read_json(MASTER_PATH, {})
    idx = update_index(key)
    companies = read_json(COMPANIES_PATH, {})
    latest = read_json(LATEST_PATH, {"items": []})

    # 画面に出ている企業のうち、未取得（または新しい有報が出た）ものを対象にする
    targets = []
    seen = set()
    for it in latest.get("items", []):
        code = it.get("code")
        if not code or code == "—" or code in seen:
            continue
        seen.add(code)
        entry = idx["codes"].get(code)
        if not entry:
            continue
        cur = companies.get(code)
        if cur and cur.get("docID") == entry["docID"]:
            continue
        targets.append((code, entry))
        if len(targets) >= MAX_PROFILE_UPDATES:
            break

    changed = False
    for code, entry in targets:
        try:
            companies[code] = build_profile(code, entry, master, key)
            changed = True
            print("プロフィール取得:", code, entry.get("name"))
        except Exception as e:  # noqa: BLE001
            print("プロフィール取得失敗", code, e)

    if changed:
        write_json(COMPANIES_PATH, companies, sort_keys=True)
        print(f"companies.json を更新しました（登録{len(companies)}社）")
    else:
        print("プロフィールの新規取得はありません")


if __name__ == "__main__":
    main()
